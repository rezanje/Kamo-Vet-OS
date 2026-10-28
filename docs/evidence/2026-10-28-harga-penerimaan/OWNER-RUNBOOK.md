# Paket owner: harga Penerimaan Barang ikut edit baris PO

Satu fungsi privat diganti. Tidak ada data yang diubah saat apply.

Setelah ini, edit baris PO untuk barang yang sudah diterima juga mengubah harga di rincian
Penerimaan Barang aktif untuk baris itu. Nilai di daftar penerimaan = PO = faktur.

Urutan (SQL editor Supabase, produksi). **Jalankan sebelum kode dirilis/merge**:

1. `preflight.sql` (hanya baca). Pastikan `migrasi 20261029150000 tercatat` = `20261029150000`,
   `migrasi 20261029160000 tercatat` = `-`, dan `md5 fungsi edit baris PO` = **`28ac153afccb505a42dd9f3720f676da`**.
   Kalau md5 beda: berhenti, kabari developer.
2. `apply.sql`. Aman diulang.
3. `readback.sql` (hanya baca). Harapan: migrasi `20261029160000` tercatat, md5 = **`6d3a662cb92888bd079f81de18813541`**,
   dua baris lain `true`.
4. Rollback hanya kalau diputuskan mundur: `rollback.sql` (md5 kembali ke `28ac153a…`).

Kode aplikasi tidak berubah di PR ini, jadi urutan rilis kode tidak berpengaruh.

Gladi PG16 lokal (semua migrasi kecuali yang baru → preflight → apply 2x → readback → tes FIFO + rata-rata →
rollback → md5 kembali → tes gagal sesuai harapan): `rehearsal-pg16.log`.
