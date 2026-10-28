# K03 + J01 — racikan wajib komposisi, koreksi faktur grosir oleh FINANCE

Paket untuk pemegang akses Supabase production. **Belum ada yang dijalankan ke production.**
Jangan menulis ID project, jumlah data, atau keluaran production ke repo/PR.

Urutan (berhenti bila hasil tidak sesuai):

1. `preflight.sql` (hanya baca) — SUMMARY harus `0 failed`. Termasuk cek tubuh fungsi `wholesale_access`
   sama persis dengan versi yang ditinjau (md5 `6b15f97c64b813e269a7b2f3bfcbc8c1`). Kalau gagal: jangan apply,
   minta developer meninjau fungsi yang terpasang.
2. `apply.sql` (menulis, satu transaksi, wajib role `postgres`) — isi migrasi
   `20261029120000_k03_racikan_recipe_required.sql` dan `20261029121000_j01_finance_wholesale_correction.sql`
   apa adanya (sha256 di kepala file) + dua baris riwayat. Migrasi J01 sendiri menolak (dan membatalkan semuanya)
   bila tubuh `wholesale_access` berbeda dari yang ditinjau.
3. `readback.sql` (hanya baca) — SUMMARY harus `0 failed`.
4. Deploy aplikasi (PR ini). Urutan DB→aplikasi tidak kritis: tanpa langkah DB, aplikasi baru hanya
   menampilkan form koreksi grosir ke FINANCE yang lalu ditolak database ("hanya OWNER"), dan racikan belum dijaga.
5. **J01, langkah di aplikasi (OWNER):** FINANCE baru bisa membuka faktur grosir bila modul **Penjualan**
   dicentang untuk peran FINANCE di *Pengaturan → Akses Grup*. Saat ini FINANCE memakai daftar modul bawaan
   (tanpa Penjualan), sehingga juga belum bisa menerima pembayaran grosir. Centang Penjualan **dan** modul bawaan
   FINANCE yang masih dipakai (Dashboard, Buku Besar, Kas & Bank, Aset Tetap, Pajak, Laporan), karena begitu ada
   pilihan tersimpan, daftar bawaan tidak dipakai lagi.

Yang berubah:

- **K03:** baris obat dengan SKU obat racik (nama "Obat Racik…/Obat Racikan…" atau kategori OBAT RACIK /
  OBAT RACIKAN / RACIKAN, jenis Persediaan, bukan bahan racik) ditolak di rekam medis rawat jalan, catatan harian
  rawat inap, koreksi rekam medis, dan baris manual tagihan klinik bila tidak membawa komposisi racikan.
  Jalur "Racikan baru" (SKU + komposisi) tetap jalan. Baris lama yang sudah ada tidak diubah dan tetap bisa
  ditagih; hanya baris baru atau baris yang barangnya diganti yang diperiksa. Kasir petshop tidak terdampak.
- **J01:** koreksi harga faktur grosir (termasuk yang sudah dibayar) oleh OWNER **atau FINANCE**. Pembayaran
  tetap tercatat; kelebihan bayar jadi kredit pelanggan (perilaku lama). Perubahan qty tetap lewat retur/pengiriman
  fisik seperti sebelumnya.

Mundur: `rollback.sql` melepas dua trigger + tiga fungsi K03 dan mengembalikan `wholesale_access` ke versi
20261021073000 (koreksi grosir OWNER saja), lalu hapus dua baris riwayat. Data tidak diubah. Revert commit aplikasi.

Dilatih ujung-ke-ujung di cluster sementara PostgreSQL 17.11 dan 16.14 (Homebrew), seluruh migrasi repo kecuali
S04/K03/J01 (= keadaan production 28 Okt): preflight → apply ditolak saat tubuh fungsi diubah → pulihkan → apply →
readback → rollback → preflight → apply ulang → readback → suite K03. Log: `../rehearsal-pg17.log`, `../rehearsal-pg16.log`.
