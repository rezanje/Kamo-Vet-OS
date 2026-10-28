# K03 + J01 + S04 — verifikasi (28 Okt 2026)

## Production preflight (hanya baca, Supabase MCP `execute_sql` SELECT, 28 Okt 2026)

| Paket | Hasil |
|-------|-------|
| `owner-apply-k03-j01/preflight.sql` | SUMMARY: 0 failed (11/11 ok; diulang setelah review dengan cek kolom sumber salinan) — termasuk md5 tubuh `wholesale_access` = versi yang ditinjau |
| `owner-apply-s04/preflight.sql` | SUMMARY: 0 failed (8/8 ok) — tabel S04 belum ada, versi 20261026002000 belum tercatat, tepat satu OWNER aktif |

Pengamatan hanya-baca lain (tanpa angka data):
- Tabel tagihan klinik (`invoices`) selalu terkait kunjungan; kasir petshop memakai tabel lain → K03 tidak menyentuh petshop.
- Ada baris resep lama ber-SKU racik tanpa komposisi (sudah diketahui pemilik); K03 tidak mengubahnya dan baris itu tetap bisa ditagih.
- Tidak ada baris manual tagihan klinik ber-SKU racik tanpa komposisi.
- Peran FINANCE di production belum punya modul Penjualan (memakai daftar bawaan) → lihat langkah 5 runbook K03+J01.

## Tes (cluster sementara Homebrew PostgreSQL, tanpa Docker, data fiktif)

Runner: `run-native-pg.py <script>` menerjemahkan panggilan `docker` skrip repo ke cluster lokal sementara.

| Tes | Hasil |
|-----|-------|
| `supabase/tests/clinic_compound_issue.sql` (blok K03 baru: rawat jalan, catatan harian ranap, tagihan manual ditolak `RECIPE_REQUIRED` tanpa sisa data; obat biasa lolos; racik master + tagihannya lolos; baris lama bisa diubah & ditagih, ganti barang ke SKU racik ditolak; terbit ulang invoice yang dulu menagih SKU racik sebagai baris manual tetap jalan, dan pengecualian salinan tidak bisa dipinjam invoice lain) | lulus PG17 & PG16; merah tanpa migrasi K03 |
| `scripts/test-procedure-bmhp-postgres.py` (BMHP, invoice klinik, billing lifecycle, compound issue, manual units, kategori tindakan, katalog resmi, binding SKU racik, BMHP moving average) | lulus — `clinic-regression-pg17.log` |
| `scripts/test-wholesale-corrections-postgres.py` (suite grosir lama + blok J01: FINANCE tanpa modul Penjualan ditolak; FINANCE dengan modul mengoreksi faktur yang sudah dibayar, penerimaan tidak berubah, pembayaran terbawa ke faktur pengganti; ADMIN & STAFF ditolak; uji race 2 sesi) | lulus — `j01-wholesale-suite-pg17.log`; merah tanpa migrasi J01 |
| `scripts/test-service-commission-policy-postgres.py` (RLS/hak akses tabel S04; tulis hanya OWNER, ADMIN ditolak) | lulus — `s04-policy-suite-pg17.log` |
| Latihan paket owner (`rehearse-owner-apply.py`; termasuk rollback S04 ditolak saat ada baris kebijakan lain, lolos dengan flag owner) | lulus PG17 & PG16 — `rehearsal-pg17.log`, `rehearsal-pg16.log` |
| Runner klinik lain: refund klinik, koreksi rekam medis belum bayar, bukti obat ranap, riwayat rekam medis, penjual per baris, pelaksana jasa, lanjut ranap, insentif payroll, C05/Q01 | lulus |

Catatan runner: `scripts/test-posted-sales-postgres.py` (bootstrap suite grosir) belum punya shim `auth.jwt()`
yang dibutuhkan migrasi 20261023091210 — ditambahkan (sama dengan runner lain). Tanpa itu suite grosir sudah gagal di `main`.

## Temuan di luar cakupan (tidak diubah)

- Trigger lama `zz_grooming_requirement` (fungsi `enforce_branch_grooming_performers`, terpasang juga di production)
  gagal pada **UPDATE** baris `prescription_items`/`invoice_items` ("record new has no field sale_id"). INSERT tidak
  terdampak. Tes K03 mematikan trigger itu sementara khusus untuk langkah UPDATE langsung. Perlu tiket terpisah.
- Beberapa file `supabase/tests/*.sql` klinik lama (mis. `atomic_initial_clinic_record.sql`) gagal di fixture
  generik dengan atau tanpa perubahan ini (fixture tertinggal dari aturan baru); hasil identik sebelum/sesudah.
