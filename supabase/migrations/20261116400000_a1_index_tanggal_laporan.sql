-- A1 (meeting 12 Nov 2026): index tanggal untuk laporan.
--
-- BELUM DIPASANG KE PRODUCTION — menunggu persetujuan pemilik (aturan: perubahan skema wajib dikonfirmasi).
-- Pasang terarah lewat Supabase (bukan `supabase db push` massal, lihat runbook 2026-09-28), di luar jam operasional.
--
-- Kenapa: laporan menyaring periode memakai sales.created_at, invoices.created_at, sales_invoices.tanggal,
-- sales_returns.tanggal, dan journal_entries(branch_id, tanggal). Kolom tanggal penjualan belum ber-index, jadi
-- setiap laporan sebulan menyisir seluruh tabel; makin lama datanya makin lambat.
--
-- Dampak:
--   * Hanya MENAMBAH index. Tidak ada data yang diubah, dipindah, atau dihapus. Tidak ada fungsi/trigger yang berubah.
--   * Saat dibuat, tulis ke tabel terkait tertahan sebentar (hitungan detik pada ukuran data sekarang): kasir/klinik
--     yang menyimpan transaksi tepat saat itu menunggu sejenak, bukan gagal.
--   * Penyimpanan bertambah sedikit (index tanggal ±beberapa MB).
--   * Batal: `drop index if exists <nama>;` untuk tiap index di bawah — aman kapan pun.
-- apply as ONE transaction (the Supabase CLI runs this file in one; there is no begin/commit in it).

create index if not exists sales_branch_created_at_idx on public.sales (branch_id, created_at);
create index if not exists sales_created_at_idx on public.sales (created_at);
create index if not exists invoices_created_at_idx on public.invoices (created_at);
create index if not exists sales_invoices_tanggal_idx on public.sales_invoices (tanggal);
create index if not exists sales_invoices_branch_tanggal_idx on public.sales_invoices (branch_id, tanggal);
create index if not exists sales_returns_tanggal_idx on public.sales_returns (tanggal);
create index if not exists journal_entries_branch_tanggal_idx on public.journal_entries (branch_id, tanggal);
