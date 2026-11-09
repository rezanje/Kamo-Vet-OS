-- ARSIP MASSAL antrean klinik sebelum 1 Nov 2026 — JANGAN dijalankan sebelum Andri/Reza menyetujui pratinjau.
-- (Keputusan Andri 4 Nov 2026: semua antrean sebelum 1 Nov 2026 adalah data percobaan.)
-- Langkah lengkap dan urutan aman: scripts/sql/bulk-archive-plan.md (simulasi -> baca daftar baris demi baris -> jalankan per batch).
--
-- Memakai JALUR YANG SAMA dengan tombol "Paksa arsip": clinic_private.change_visit_archive(... p_force=true, 'PAKSA'),
-- jadi kunci baris kunjungan, pemeriksaan ulang di bawah kunci, permit, lock_timeout 5 detik, event append-only
-- (forced=true + daftar syarat yang dilewati) dan activity_log berlaku persis sama. Peran OWNER diperksa DI DALAM
-- fungsi arsip (profil aktif ber-role OWNER), bukan hanya oleh skrip ini.
--
-- KEAMANAN PARAMETER
--   p_jalankan : HANYA nilai TRUE yang mengarsipkan sungguhan. false atau NULL = SIMULASI (tidak menulis apa pun).
--   p_batas    : jumlah kunjungan yang diarsipkan per eksekusi. NULL = 50 (bukan tanpa batas). Harus 1..500, di luar itu ditolak.
--
-- HASIL (satu tabel, urut: ringkasan dulu)
--   RINGKASAN        satu baris; kolom ringkasan (jsonb): dry_run, batas, archived_this_run, would_archive_this_run,
--                    remaining_archivable, skipped_total, skipped_by_reason, manual_total, akan_dipaksa_per_status, gagal.
--   PERLU_MANUAL     kunjungan yang MASIH di antrean (Menunggu/Diperiksa/Pembayaran) tetapi TIDAK PERNAH diarsipkan skrip karena
--                    uang/stok/rawat inap (mis. Pembayaran dengan invoice draft/belum lunas, rawat inap berjalan). Tangani manual.
--   AKAN_DIARSIPKAN  (simulasi) kunjungan yang akan diarsipkan di eksekusi ini, dengan syarat yang akan dilewati (dipaksa: ...).
--   DIARSIPKAN       (jalankan) yang berhasil diarsipkan; GAGAL = ditolak/kena lock timeout, tidak diarsipkan, dicoba lagi di batch berikutnya.
--   Yang dilewati permanen (invoice/pembayaran/DP/refund/racikan/rawat inap, riwayat impor, Selesai asal tidak pasti, dan yang
--   dipulihkan manual setelah arsip massal = SUDAH_PERNAH) TIDAK ditampilkan per baris; hanya dihitung di skipped_total / skipped_by_reason.
--   Karena itu hasil per-baris selalu pendek dan pengulangan KONVERGEN: ulangi sampai remaining_archivable = 0.
--
-- Satu eksekusi = satu pernyataan = atomik: bila kena statement_timeout/dibatalkan, TIDAK ADA yang terarsip; kecilkan p_batas.
-- Kunci baris setiap kunjungan yang diarsipkan dipegang sampai pernyataan selesai: jalankan di luar jam klinik.
-- Idempotent: kunci permintaan per kunjungan ('bulk-arsip-20261101-<visit_id>'); yang sudah diarsipkan tidak disentuh.
--
-- Cara pakai (SQL editor, sebagai postgres, satu eksekusi): ubah OWNER_UUID di pemanggilan paling bawah.

create function pg_temp.bulk_arsip_antrian(p_owner uuid, p_cutoff timestamptz, p_alasan text, p_jalankan boolean, p_batas integer)
returns table(urut integer, visit_id uuid, status text, tanggal date, hasil text, detail text, ringkasan jsonb)
language plpgsql as $$
declare r record; c jsonb; o jsonb; k text; x text; inv text;
 v_run boolean:=(p_jalankan is true);          -- hanya TRUE yang menulis; NULL/false = simulasi
 v_batas integer:=coalesce(p_batas,50);        -- NULL bukan tanpa batas
 n integer:=0; v_ok integer:=0; v_gagal integer:=0; v_actionable integer:=0; v_skip_total integer:=0; v_manual integer:=0;
 v_skip jsonb:='{}'::jsonb; v_forced jsonb:='{}'::jsonb;
begin
 if p_owner is null or not exists(select 1 from public.profiles pr where pr.id=p_owner and pr.is_active and pr.role='OWNER') then
  raise exception 'OWNER_UUID harus profil OWNER yang aktif';
 end if;
 if p_cutoff is null or p_cutoff > timestamptz '2026-11-01 00:00:00+07' then raise exception 'batas tanggal tidak boleh melewati 1 Nov 2026'; end if;
 if p_alasan is null or length(regexp_replace(p_alasan,'[^[:alnum:]]','','g'))<5 then raise exception 'alasan wajib'; end if;
 if v_batas<1 or v_batas>500 then raise exception 'p_batas harus 1..500 (kosong = 50), bukan %', v_batas; end if;
 perform set_config('lock_timeout','5s',true);
 perform set_config('request.jwt.claims',json_build_object('sub',p_owner,'role','authenticated')::text,true);
 for r in select v.id as vid, v.status::text as st, v.created_at as dibuat, (v.checked_out_at is null and v.status::text<>'Selesai') as antrean_hidup
          from public.visits v where v.created_at < p_cutoff and v.archived_at is null order by v.created_at, v.id loop
  k:='bulk-arsip-20261101-'||r.vid::text;
  if exists(select 1 from public.visit_archive_events e where e.request_key=k) then
   -- pernah diarsipkan massal lalu dipulihkan manual: tidak diarsipkan ulang, hanya dihitung
   x:='SUDAH_PERNAH (diarsipkan massal lalu dipulihkan manual; tidak diarsipkan ulang)';
   v_skip:=jsonb_set(v_skip,array[x],to_jsonb(coalesce((v_skip->>x)::integer,0)+1)); v_skip_total:=v_skip_total+1; continue;
  end if;
  c:=clinic_private.visit_archive_classify(r.vid);
  if jsonb_array_length(c->'hard')>0 then
   -- dilewati permanen: dihitung per alasan, TIDAK dikembalikan per baris (supaya pengulangan konvergen)
   v_skip_total:=v_skip_total+1;
   for x in select jsonb_array_elements_text(c->'hard') loop
    v_skip:=jsonb_set(v_skip,array[x],to_jsonb(coalesce((v_skip->>x)::integer,0)+1));
   end loop;
   if r.antrean_hidup then   -- masih di antrean aktif: perlu ditangani manual, ditampilkan di bagian terpisah (maks 200 baris)
    v_manual:=v_manual+1;
    if v_manual<=200 then
     select string_agg(distinct 'invoice '||coalesce(i.paid_status::text,'?')||case when i.voided_at is not null then ' (dibatalkan)' else '' end,', ') into inv from public.invoices i where i.visit_id=r.vid;
     urut:=1; visit_id:=r.vid; status:=r.st; tanggal:=r.dibuat::date; hasil:='PERLU_MANUAL'; ringkasan:=null;
     detail:='perlu ditangani manual (tidak pernah diarsipkan skrip): '||(select string_agg(y,'; ') from jsonb_array_elements_text(c->'hard') y)||coalesce(' ['||inv||']','');
     return next;
    end if;
   end if;
   continue;
  end if;
  v_actionable:=v_actionable+1;
  if jsonb_array_length(c->'soft')>0 then
   v_forced:=jsonb_set(v_forced,array[r.st],to_jsonb(coalesce((v_forced->>r.st)::integer,0)+1));
  end if;
  if n<v_batas then
   n:=n+1; urut:=2; visit_id:=r.vid; status:=r.st; tanggal:=r.dibuat::date; ringkasan:=null;
   if not v_run then
    hasil:='AKAN_DIARSIPKAN'; detail:=coalesce((select 'dipaksa: '||string_agg(y,'; ') from jsonb_array_elements_text(c->'soft') y),'arsip biasa'); return next; continue;
   end if;
   begin
    o:=clinic_private.change_visit_archive(r.vid,p_alasan,k,true,true,'PAKSA');
    if (o->>'replay')::boolean then
     v_actionable:=v_actionable-1; continue;   -- sudah pernah (balapan): bukan pekerjaan lagi
    end if;
    v_ok:=v_ok+1; hasil:='DIARSIPKAN'; detail:=coalesce((select 'dipaksa: '||string_agg(y,'; ') from jsonb_array_elements_text(o->'overridden') y),'arsip biasa');
   exception when others then v_gagal:=v_gagal+1; urut:=3; hasil:='GAGAL'; detail:=sqlerrm;
   end;
   return next;
  end if;
 end loop;
 urut:=0; visit_id:=null; status:=null; tanggal:=null; hasil:='RINGKASAN'; detail:=case when v_run then 'jalankan sungguhan' else 'SIMULASI (tidak menulis apa pun)' end;
 ringkasan:=jsonb_build_object('dry_run',not v_run,'batas',v_batas,'archived_this_run',v_ok,
   'would_archive_this_run',case when v_run then 0 else n end,'remaining_archivable',v_actionable-v_ok,'skipped_total',v_skip_total,
   'skipped_by_reason',v_skip,'manual_total',v_manual,'manual_listed',least(v_manual,200),'akan_dipaksa_per_status',v_forced,'gagal',v_gagal);
 return next;
end $$;

select * from pg_temp.bulk_arsip_antrian(
 '00000000-0000-0000-0000-000000000000'::uuid,            -- <== OWNER_UUID (profiles.id milik pemilik, role OWNER, aktif)
 timestamptz '2026-11-01 00:00:00+07',                   -- semua kunjungan SEBELUM tanggal ini
 'data percobaan sebelum 1 Nov 2026',
 false,                                                  -- <== false = simulasi; HANYA true yang benar-benar mengarsipkan (NULL = simulasi)
 50)                                                     -- <== batas kunjungan per eksekusi (1..500; NULL = 50)
order by urut, tanggal, visit_id;
