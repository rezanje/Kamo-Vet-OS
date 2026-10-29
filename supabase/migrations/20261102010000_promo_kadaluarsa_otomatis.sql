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
--
-- ── VERIFIKASI SETELAH DIPASANG ─────────────────────────────────────────────
--   1. Tambalan terpasang dan pemeriksaan OWNER/ADMIN masih ada:
--        select position('KADALUARSA_SWEEP' in pg_get_functiondef(
--                 'public.guard_promo_configuration()'::regprocedure)) > 0
--             , position('assert_promo_manager' in pg_get_functiondef(
--                 'public.guard_promo_configuration()'::regprocedure)) > 0;
--      Keduanya harus true. Bila migrasinya berhenti dengan
--      PROMO_KADALUARSA_GUARD_DRIFT, definisi guard-nya berubah sejak
--      20261023070134 — tinjau dulu, jangan dipaksa.
--   2. Hak fungsi penyapu (authenticated boleh, anon/service_role tidak):
--        select has_function_privilege(r, 'public.nonaktifkan_promo_kadaluarsa()', 'EXECUTE')
--        from unnest(array['authenticated','anon','service_role']) r;
--      Harus true, false, false.
--   3. Hitung dulu, baru jalankan — berapa baris yang akan terdampak:
--        select (select count(*) from public.promos where is_active
--                  and valid_until < (now() at time zone 'Asia/Jakarta')::date) as promo,
--               (select count(*) from public.vouchers where is_active
--                  and valid_until < (now() at time zone 'Asia/Jakarta')::date) as voucher;
--      Lalu: select public.nonaktifkan_promo_kadaluarsa();  -- angkanya harus sama,
--      dan panggilan kedua harus mengembalikan 0/0/0 (idempoten).
--   4. Jejak auditnya atas nama sistem, bukan pengguna:
--        select actor_kind, count(*) from public.activity_log
--        where row_entity in ('promos','vouchers')
--          and occurred_at > now() - interval '5 minutes' group by 1;   -- harus 'system'
--   5. Jadwal pg_cron: select * from cron.job where jobname='promo-kadaluarsa-harian';
--      Kosong selama ekstensinya belum terpasang — itu yang diharapkan sekarang.
--
-- ── SEBELUM DIPASANG (wajib, supaya rollback-nya sepele) ────────────────────
--   select pg_get_functiondef('public.guard_promo_configuration()'::regprocedure);
-- Simpan keluarannya. Itulah satu-satunya hal yang ditambal migrasi ini pada
-- objek yang sudah ada; sisanya objek baru yang tinggal di-drop.
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- Baris promo/voucher yang terlanjur dinonaktifkan TIDAK dihidupkan kembali
-- oleh rollback ini: keputusannya memang "lewat batas waktu = nonaktif", dan
-- menghidupkannya lagi butuh perpanjangan tanggal lewat layar Edit. Yang
-- dikembalikan hanya mekanismenya:
--
--   drop trigger if exists promo_kadaluarsa_otomatis on public.promos;
--   drop trigger if exists voucher_kadaluarsa_otomatis on public.vouchers;
--   drop function if exists public.guard_aktivasi_kadaluarsa();
--   drop function if exists public.nonaktifkan_promo_kadaluarsa();
--   drop index if exists public.promos_aktif_berakhir;
--   drop index if exists public.vouchers_aktif_berakhir;
--   drop index if exists public.campaign_codes_aktif_tujuan;
--   -- lalu jalankan ulang definisi guard yang disimpan di langkah "SEBELUM
--   -- DIPASANG" apa adanya (satu CREATE OR REPLACE FUNCTION; ACL ikut terjaga),
--   -- dan bila pg_cron sempat terpasang:
--   --   select cron.unschedule('promo-kadaluarsa-harian');
--   -- Periksa ulang: KADALUARSA_SWEEP hilang, assert_promo_manager masih ada.
--
-- Aplikasi lama/baru aman dua arah: memanggil rpc penyapu yang belum ada hanya
-- menghasilkan error yang sengaja didiamkan (lib/promo-kadaluarsa.ts), dan
-- aplikasi lama tanpa panggilan itu tetap menyaring tanggal saat membaca.

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
-- Menonaktifkan promo yang MEMANG sudah lewat tanggal adalah penegakan aturan,
-- bukan perubahan konfigurasi: hasilnya identik dengan yang sudah dilihat kasir
-- hari ini, jadi tidak perlu hak OWNER/ADMIN. Tulis langsung dari peran lain
-- tetap ditahan RLS (migrasi 20261031090000); cabang ini hanya membuka jalan
-- untuk fungsi SECURITY DEFINER di bawah, yang hanya bisa mengubah is_active.
--
-- Cabangnya DISISIPKAN ke definisi yang sedang berjalan lewat satu jangkar,
-- bukan ditimpa dengan salinan definisi lama. Kalau rilis lain sempat mengubah
-- guard_promo_configuration, menimpanya akan diam-diam mengembalikan perubahan
-- itu; dengan jangkar, migrasinya berhenti dengan pesan GUARD_DRIFT dan minta
-- ditinjau ulang. Blok ini juga berhenti tanpa efek bila cabangnya sudah ada,
-- jadi aman dijalankan berulang.
do $patch$
declare
 guard_oid oid := to_regprocedure('public.guard_promo_configuration()');
 definition text;
 jangkar text := $jangkar$begin
 if auth.uid() is not null or current_setting('role',true) in('authenticated','anon','service_role') then$jangkar$;
 pengganti text := $pengganti$begin
 -- KADALUARSA_SWEEP (migrasi 20261102010000): penonaktifan karena lewat tanggal.
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
 if auth.uid() is not null or current_setting('role',true) in('authenticated','anon','service_role') then$pengganti$;
begin
 if guard_oid is null then
  raise exception 'PROMO_KADALUARSA_GUARD_DRIFT: guard_promo_configuration() tidak ada; migrasi 20261023070134 belum terpasang';
 end if;
 definition := pg_get_functiondef(guard_oid);
 -- Sudah dipasang (pemasangan ulang / rilis berulang): tidak ada yang dikerjakan.
 if position('KADALUARSA_SWEEP' in definition) > 0 then
  return;
 end if;
 -- Atribut keamanan fungsi harus persis seperti yang diasumsikan cabang baru ini.
 if not exists (select 1 from pg_proc p where p.oid = guard_oid
   and p.prosecdef and p.proconfig @> array['search_path=""']::text[])
  or has_function_privilege('anon', guard_oid, 'EXECUTE')
  or has_function_privilege('authenticated', guard_oid, 'EXECUTE')
  or has_function_privilege('service_role', guard_oid, 'EXECUTE') then
  raise exception 'PROMO_KADALUARSA_GUARD_DRIFT: atribut/hak guard_promo_configuration berubah';
 end if;
 if (length(definition) - length(replace(definition, jangkar, ''))) / length(jangkar) <> 1 then
  raise exception 'PROMO_KADALUARSA_GUARD_DRIFT: jangkar guard_promo_configuration tidak ditemukan tepat sekali';
 end if;
 execute replace(definition, jangkar, pengganti);
 -- Pemeriksaan OWNER/ADMIN harus tetap ada setelah disisipi.
 if position('perform public.assert_promo_manager();' in pg_get_functiondef(guard_oid)) = 0 then
  raise exception 'PROMO_KADALUARSA_GUARD_DRIFT: pemeriksaan assert_promo_manager hilang setelah tambalan';
 end if;
end $patch$;

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
