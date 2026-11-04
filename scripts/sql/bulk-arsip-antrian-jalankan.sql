-- ARSIP MASSAL antrean klinik sebelum 1 Nov 2026 — JANGAN dijalankan sebelum Andri/Reza menyetujui pratinjau.
-- (Keputusan Andri 4 Nov 2026: semua antrean sebelum 1 Nov 2026 adalah data percobaan.)
--
-- Memakai JALUR YANG SAMA dengan tombol "Paksa arsip": clinic_private.change_visit_archive(... p_force=true, 'PAKSA'),
-- jadi kunci baris kunjungan, pemeriksaan ulang di bawah kunci, permit, lock_timeout 5 detik, event append-only
-- (forced=true + daftar syarat yang dilewati) dan activity_log berlaku persis sama. Peran OWNER diperiksa DI DALAM
-- fungsi arsip (profil aktif ber-role OWNER), bukan hanya oleh skrip ini.
--
-- Yang DILEWATI (tidak pernah dipaksa, dicatat di hasil): invoice (batal pun), pembayaran/kwitansi, uang muka, refund,
-- racikan terjual, jejak tagihan/kasir rawat inap, rawat inap (berjalan/riwayat), Selesai hasil impor atau asal tidak pasti.
-- Idempotent: kunci permintaan per kunjungan ('bulk-arsip-20261101-<visit_id>'); yang sudah diarsipkan tidak disentuh;
-- yang pernah diarsipkan massal lalu dipulihkan manual TIDAK diarsipkan ulang (dilaporkan "SUDAH_PERNAH").
-- Berhenti setelah p_batas kunjungan per eksekusi (jalankan ulang sampai hasilnya kosong).
--
-- Cara pakai (SQL editor, sebagai postgres, satu eksekusi): ubah OWNER_UUID di baris terakhir.
--   1) p_jalankan=false  -> simulasi (hanya melaporkan "AKAN_DIARSIPKAN"/"DILEWATI"), tidak menulis apa pun.
--   2) p_jalankan=true   -> mengarsipkan. Semua dalam satu transaksi; kegagalan satu kunjungan hanya mencatat GAGAL untuknya.

create function pg_temp.bulk_arsip_antrian(p_owner uuid, p_cutoff timestamptz, p_alasan text, p_jalankan boolean, p_batas integer)
returns table(visit_id uuid, status text, tanggal date, hasil text, detail text)
language plpgsql as $$
declare r record; c jsonb; o jsonb; n integer:=0; k text;
begin
 if p_owner is null or not exists(select 1 from public.profiles pr where pr.id=p_owner and pr.is_active and pr.role='OWNER') then
  raise exception 'OWNER_UUID harus profil OWNER yang aktif';
 end if;
 if p_cutoff is null or p_cutoff > timestamptz '2026-11-01 00:00:00+07' then raise exception 'batas tanggal tidak boleh melewati 1 Nov 2026'; end if;
 if p_alasan is null or length(regexp_replace(p_alasan,'[^[:alnum:]]','','g'))<5 then raise exception 'alasan wajib'; end if;
 perform set_config('lock_timeout','5s',true);
 perform set_config('request.jwt.claims',json_build_object('sub',p_owner,'role','authenticated')::text,true);
 for r in select v.id as vid, v.status::text as st, v.created_at as dibuat from public.visits v
          where v.created_at < p_cutoff and v.archived_at is null order by v.created_at, v.id loop
  k:='bulk-arsip-20261101-'||r.vid::text;
  if exists(select 1 from public.visit_archive_events e where e.request_key=k) then
   visit_id:=r.vid; status:=r.st; tanggal:=r.dibuat::date; hasil:='SUDAH_PERNAH'; detail:='pernah diarsipkan massal lalu dipulihkan manual; tidak diarsipkan ulang'; return next; continue;
  end if;
  c:=clinic_private.visit_archive_classify(r.vid);
  if jsonb_array_length(c->'hard')>0 then
   visit_id:=r.vid; status:=r.st; tanggal:=r.dibuat::date; hasil:='DILEWATI'; detail:=(select string_agg(x,'; ') from jsonb_array_elements_text(c->'hard') x); return next; continue;
  end if;
  if n>=p_batas then exit; end if;
  n:=n+1; visit_id:=r.vid; status:=r.st; tanggal:=r.dibuat::date;
  if not p_jalankan then
   hasil:='AKAN_DIARSIPKAN'; detail:=coalesce((select 'dipaksa: '||string_agg(x,'; ') from jsonb_array_elements_text(c->'soft') x),'arsip biasa'); return next; continue;
  end if;
  begin
   o:=clinic_private.change_visit_archive(r.vid,p_alasan,k,true,true,'PAKSA');
   if (o->>'replay')::boolean then hasil:='SUDAH_PERNAH'; detail:='pernah diarsipkan massal lalu dipulihkan manual; tidak diarsipkan ulang';
   else hasil:='DIARSIPKAN'; detail:=coalesce((select 'dipaksa: '||string_agg(x,'; ') from jsonb_array_elements_text(o->'overridden') x),'arsip biasa'); end if;
  exception when others then hasil:='GAGAL'; detail:=sqlerrm;
  end;
  return next;
 end loop;
end $$;

select * from pg_temp.bulk_arsip_antrian(
 '00000000-0000-0000-0000-000000000000'::uuid,            -- <== OWNER_UUID (profiles.id milik pemilik, role OWNER, aktif)
 timestamptz '2026-11-01 00:00:00+07',                   -- semua kunjungan SEBELUM tanggal ini
 'data percobaan sebelum 1 Nov 2026',
 false,                                                  -- <== false = simulasi; true = benar-benar mengarsipkan
 500);                                                   -- <== batas kunjungan per eksekusi
