-- Antrian klinik: pasien hari sebelumnya yang belum selesai (laporan klinik 2 Nov 2026).
--
-- Layar /klinik/antrian kini juga membaca kunjungan cabang yang statusnya bukan Selesai dan didaftarkan
-- sebelum hari ini (status <> 'Selesai', created_at < awal hari, terbaru dulu, limit 200). Layar itu
-- diperbarui tiap 20 detik di setiap layar antrian yang terbuka.
--
-- Tanpa indeks ini, kebijakan RLS visits memanggil public.user_can_access_branch(branch_id) (±33 µs per
-- baris di Production) untuk SETIAP kunjungan lampau cabang, termasuk ribuan yang sudah Selesai.
-- Penyebabnya: operator enum (enum_ne/enum_eq) tidak leakproof, jadi saringan status baru dijalankan
-- sesudah pemeriksaan RLS. Limit 200 tidak membatasi kerja itu, karena hanya puluhan baris yang lolos.
-- Indeks parsial ini hanya berisi kunjungan yang belum selesai (±60 baris pada 2 Nov 2026). Planner
-- memakainya karena predikat indeks terbukti dari saringan kueri, sehingga RLS hanya diperiksa untuk
-- baris yang belum selesai. Penghitung dashboard "Sedang menunggu antrian" (status = 'Menunggu') juga
-- terbantu.
--
-- Aditif: tidak ada data, fungsi, atau kebijakan yang berubah. Tabel visits kecil (±8 ribu baris), jadi
-- CREATE INDEX biasa hanya mengunci sesaat (migrasi berjalan dalam transaksi; CONCURRENTLY tidak bisa).

create index if not exists visits_belum_selesai_idx
  on public.visits (branch_id, created_at desc)
  where status <> 'Selesai';

comment on index public.visits_belum_selesai_idx is
  'Antrian klinik: kunjungan belum selesai per cabang (bagian "Belum selesai dari hari sebelumnya"), lihat docs/2026-11-02-antrian-pasien-tertinggal-ganti-hari.md';
