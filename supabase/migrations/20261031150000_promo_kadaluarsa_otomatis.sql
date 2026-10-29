-- Keputusan pemilik (Andri, 29 Okt 2026): "Yang sudah melewati batas waktu
-- otomatis harus non aktif."
--
-- Sebelum ini "lewat tanggal" hanya diperiksa saat DIBACA (lib/promo.ts,
-- lib/voucher.ts, loadPromoAktif). Perhitungan kasir memang sudah benar — promo
-- kedaluwarsa tidak pernah memotong — tetapi barisnya tetap tersimpan
-- is_active = true, jadi di daftar promo warnanya masih hijau dan pemilik harus
-- menonaktifkannya sendiri satu per satu. Yang ditambahkan di sini:
--
--   1. nonaktifkan_promo_kadaluarsa() — satu fungsi idempoten yang menyetel
--      is_active = false untuk promo/voucher yang tanggal akhirnya sudah lewat
--      (tanggal WIB), plus kode kampanye yang menunjuk ke promo/voucher
--      tersebut. Pencatat "siapa/kapan" memakai jalur audit yang sudah ada
--      (activity_log, trigger a01_activity_change pada promos & vouchers):
--      fungsi ini sengaja mengosongkan klaim JWT supaya barisnya tercatat
--      atas nama "Sistem / database" (actor_kind = 'system'), bukan atas nama
--      pengguna yang kebetulan sedang membuka layar.
--   2. Penjadwalan pg_cron BILA ekstensinya terpasang. Per 29 Okt 2026
--      pg_extension di proyek ini TIDAK memuat pg_cron (hanya btree_gist,
--      pg_stat_statements, pgcrypto, plpgsql, supabase_vault, uuid-ossp), jadi
--      yang berlaku sekarang adalah pendekatan "lazy": aplikasi memanggil
--      fungsi ini saat daftar promo / voucher / kode kampanye dan layar kasir
--      dimuat. Blok penjadwalan di bawah tetap ditulis supaya begitu pg_cron
--      dipasang, migrasi ini (atau pemasangan ulangnya) langsung memasang
--      jadwalnya tanpa perubahan kode.
--   3. Pagar tulis: promo/voucher yang sudah lewat tanggal tidak bisa
--      diaktifkan kembali tanpa memperpanjang "Berlaku s/d" dulu, dan promo
--      aktif yang tanggal akhirnya digeser ke masa lalu langsung menjadi
--      nonaktif di statement yang sama.
--
-- Aman dijalankan berulang (idempoten) dan tidak menyentuh baris transaksi.

-- ── 1. Indeks parsial: pemeriksaan "ada yang lewat tanggal?" harus murah ─────
-- Jalur lazy dipanggil tiap kali kasir dibuka; tanpa indeks ini pemeriksaannya
-- jadi seq scan pada tiap muat halaman.
create index if not exists promos_aktif_berakhir
  on public.promos (valid_until) where is_active and valid_until is not null;
create index if not exists vouchers_aktif_berakhir
  on public.vouchers (valid_until) where is_active and valid_until is not null;
create index if not exists campaign_codes_aktif_tujuan
  on public.campaign_codes (promo_id, voucher_id) where is_active;

-- ── 2. Guard konfigurasi promo: izinkan penonaktifan karena kedaluwarsa ──────
-- Definisi sama dengan migrasi 20261023070134, ditambah satu cabang di depan.
-- Menonaktifkan promo yang MEMANG sudah lewat tanggal adalah penegakan aturan,
-- bukan perubahan konfigurasi: hasilnya identik dengan yang sudah dilihat kasir
-- hari ini, jadi tidak perlu hak OWNER/ADMIN. Tulis langsung dari peran lain
-- tetap ditahan RLS (migrasi 20261031090000); cabang ini hanya membuka jalan
-- untuk fungsi SECURITY DEFINER di bawah, yang hanya bisa mengubah is_active.
create or replace function public.guard_promo_configuration() returns trigger
language plpgsql security definer set search_path='' as $$
declare old_row jsonb:='{}';new_row jsonb:='{}';parent record;
begin
 -- Dibungkus if bersarang, bukan satu rangkaian AND: OLD hanya terisi pada
 -- UPDATE/DELETE dan PostgreSQL tidak menjamin urutan evaluasi AND.
 if tg_op='UPDATE' and tg_table_name='promos' then
  if old.is_active and not new.is_active
   and new.valid_until is not null
   and new.valid_until < (now() at time zone 'Asia/Jakarta')::date
   and to_jsonb(new)-'is_active' = to_jsonb(old)-'is_active' then
   return new;
  end if;
 end if;
 if auth.uid() is not null or current_setting('role',true) in('authenticated','anon','service_role') then
  perform public.assert_promo_manager();
 end if;
 if tg_table_name='promo_items' then
  if tg_op<>'INSERT' then old_row:=to_jsonb(old);end if;
  if tg_op<>'DELETE' then new_row:=to_jsonb(new);end if;
  for parent in select id from public.promos where id in((old_row->>'promo_id')::uuid,(new_row->>'promo_id')::uuid) order by id for update loop
   null;
  end loop;
 end if;
 return coalesce(new,old);
end$$;
revoke all on function public.guard_promo_configuration() from public,anon,authenticated,service_role;

-- ── 3. Pagar tulis: aktif + sudah lewat tanggal tidak boleh tersimpan ────────
-- Dua perlakuan berbeda, sengaja:
--   * menghidupkan kembali baris yang sudah mati (nonaktif -> aktif) DITOLAK
--     dengan pesan yang menyebut apa yang harus dilakukan dulu;
--   * baris yang memang sedang aktif lalu tanggal akhirnya digeser ke masa lalu
--     langsung menjadi nonaktif — itu persis keputusan "lewat batas waktu
--     otomatis non aktif", bukan sesuatu yang perlu ditanyakan ulang.
create or replace function public.guard_aktivasi_kadaluarsa() returns trigger
language plpgsql set search_path = '' as $$
declare hari date := (now() at time zone 'Asia/Jakarta')::date; judul text; menghidupkan boolean;
begin
 if not new.is_active or new.valid_until is null or new.valid_until >= hari then
  return new;
 end if;
 -- OLD belum terisi pada INSERT, jadi dibaca terpisah dan bukan lewat OR.
 if tg_op = 'INSERT' then menghidupkan := true; else menghidupkan := not old.is_active; end if;
 if menghidupkan then
  -- Satu fungsi dipakai dua tabel dengan kolom nama berbeda; dibaca lewat
  -- to_jsonb supaya plpgsql tidak mencari kolom `code` di baris promo.
  judul := case tg_table_name
   when 'vouchers' then 'Voucher ' || (to_jsonb(new) ->> 'code')
   else 'Promo "' || (to_jsonb(new) ->> 'name') || '"' end;
  raise exception
   'KADALUARSA: % berakhir % dan sudah lewat. Perpanjang dulu tanggal "Berlaku s/d" sebelum diaktifkan kembali.',
   judul, to_char(new.valid_until, 'DD-MM-YYYY') using errcode = '23514';
 end if;
 -- Sudah aktif, tanggal akhirnya mundur ke masa lalu: matikan di tempat.
 new.is_active := false;
 return new;
end$$;
revoke all on function public.guard_aktivasi_kadaluarsa() from public, anon, authenticated, service_role;

-- Nama trigger sengaja berurutan SESUDAH promo_configuration_guard supaya
-- pemeriksaan OWNER/ADMIN tetap melihat nilai yang dikirim pengguna apa adanya.
drop trigger if exists promo_kadaluarsa_otomatis on public.promos;
create trigger promo_kadaluarsa_otomatis before insert or update on public.promos
 for each row execute function public.guard_aktivasi_kadaluarsa();
drop trigger if exists voucher_kadaluarsa_otomatis on public.vouchers;
create trigger voucher_kadaluarsa_otomatis before insert or update on public.vouchers
 for each row execute function public.guard_aktivasi_kadaluarsa();

-- ── 4. Penyapu: satu fungsi, dipakai pg_cron maupun jalur lazy ───────────────
-- Klaim JWT dikosongkan di tingkat fungsi (dipulihkan otomatis saat fungsi
-- selesai) dengan dua alasan: trigger audit a01_activity_change mencatat
-- perubahan ini atas nama "Sistem / database" alih-alih pengguna yang kebetulan
-- membuka layar, dan guard_promo_configuration tidak salah menagih hak
-- OWNER/ADMIN ke kasir yang memicunya.
create or replace function public.nonaktifkan_promo_kadaluarsa() returns jsonb
language plpgsql security definer
set search_path = ''
set "request.jwt.claims" to ''
set "request.jwt.claim.sub" to ''
set "request.jwt.claim.role" to ''
as $$
declare hari date := (now() at time zone 'Asia/Jakarta')::date;
 n_promo int := 0; n_voucher int := 0; n_kode int := 0;
begin
 -- Murah dulu: tiga pemeriksaan berindeks, tidak mengunci apa pun. Hampir
 -- selalu inilah satu-satunya yang dikerjakan saat halaman dimuat.
 if not exists (select 1 from public.promos where is_active and valid_until < hari)
  and not exists (select 1 from public.vouchers where is_active and valid_until < hari)
  and not exists (select 1 from public.campaign_codes c where c.is_active and (
       exists (select 1 from public.promos p where p.id = c.promo_id and p.valid_until < hari)
    or exists (select 1 from public.vouchers v where v.id = c.voucher_id and v.valid_until < hari)))
 then
  return jsonb_build_object('tanggal', hari, 'promo', 0, 'voucher', 0, 'kode', 0);
 end if;

 -- Beberapa kasir bisa membuka layar pada detik yang sama. Cukup satu yang
 -- membereskan; sisanya lanjut tanpa menunggu kunci baris.
 if not pg_try_advisory_xact_lock(hashtextextended('vetos:promo-kadaluarsa', 0)) then
  return jsonb_build_object('tanggal', hari, 'promo', 0, 'voucher', 0, 'kode', 0, 'dilewati', true);
 end if;

 update public.promos set is_active = false where is_active and valid_until < hari;
 get diagnostics n_promo = row_count;
 update public.vouchers set is_active = false where is_active and valid_until < hari;
 get diagnostics n_voucher = row_count;
 -- Kode kampanye cuma nama lain untuk promo/voucher tujuannya. Hanya yang
 -- tujuannya lewat TANGGAL yang ikut dimatikan; kode yang tujuannya sengaja
 -- dinonaktifkan manual dibiarkan, supaya menghidupkan promonya kembali tidak
 -- meninggalkan kode yang diam-diam ikut mati.
 update public.campaign_codes c set is_active = false, updated_at = now()
 where c.is_active and (
      exists (select 1 from public.promos p where p.id = c.promo_id and p.valid_until < hari)
   or exists (select 1 from public.vouchers v where v.id = c.voucher_id and v.valid_until < hari));
 get diagnostics n_kode = row_count;

 return jsonb_build_object('tanggal', hari, 'promo', n_promo, 'voucher', n_voucher, 'kode', n_kode);
end$$;
comment on function public.nonaktifkan_promo_kadaluarsa() is
  'Menonaktifkan promo/voucher yang masa berlakunya sudah lewat (tanggal WIB) beserta kode kampanyenya. Idempoten; dipanggil pg_cron bila tersedia, dan oleh layar promo/voucher/kampanye/kasir saat dimuat.';
revoke all on function public.nonaktifkan_promo_kadaluarsa() from public, anon, service_role;
grant execute on function public.nonaktifkan_promo_kadaluarsa() to authenticated;

-- ── 5. Jadwal harian bila pg_cron tersedia ───────────────────────────────────
-- 17:05 UTC = 00:05 WIB, jadi promo mati tepat setelah pergantian hari di
-- Jakarta. cron.schedule() dengan nama yang sama menimpa jadwal lama, jadi
-- blok ini aman dijalankan berulang. Saat pg_cron belum terpasang blok ini
-- tidak melakukan apa-apa dan jalur lazy yang dipakai.
do $$
begin
 if exists (select 1 from pg_extension where extname = 'pg_cron') then
  execute $cron$select cron.schedule('promo-kadaluarsa-harian','5 17 * * *',
    'select public.nonaktifkan_promo_kadaluarsa();')$cron$;
 end if;
end $$;
