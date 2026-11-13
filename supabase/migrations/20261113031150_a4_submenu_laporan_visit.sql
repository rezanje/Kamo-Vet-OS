-- A4 (meeting 12 Nov 2026): sub-menu Akses Grup "Laporan Visit Rawat Inap" (laporan.visit → /laporan/visit).
-- apply as ONE transaction (the Supabase CLI runs this file in one; there is no begin/commit in it).
--
-- Disetujui pemilik (Reza, 12 Nov 2026: "2A"). Dipasang SEBELUM aplikasi yang mendaftarkan sub-menu ini
-- dideploy: tanpa baris katalog ini, menyimpan Akses Grup yang mencentang "laporan.visit" ditolak
-- (ROLE_SUBMENU_INVALID).
--
-- Dampak:
--   * Hanya menambah SATU baris katalog. Tidak ada kebijakan peran yang berubah; tidak ada data lain disentuh.
--   * Peran tanpa kebijakan sub-menu laporan (= semua sub-menu) otomatis bisa membuka Laporan Visit.
--   * Peran yang daftar laporannya sudah dipilih satu-satu (saat ini: ADMIN) TIDAK otomatis mendapat akses;
--     Owner mencentangnya di Akses Grup bila diperlukan.
--   * Batal: delete from role_settings_private.submenu_catalog where id='laporan.visit';
--     (setelah memastikan tidak ada kebijakan yang menyebutnya).
set local lock_timeout='5s';

insert into role_settings_private.submenu_catalog(id,module_id) values
('laporan.visit','laporan')
on conflict (id) do nothing;
