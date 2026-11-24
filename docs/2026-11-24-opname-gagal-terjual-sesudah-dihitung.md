# Opname Granada gagal disimpan — barang terjual sesudah dihitung (24 Nov 2026)

## Gejala
OPO.00013 (SO BULAN NOV PET GRANADA, WH GRND, 378 barang terkunci). "Simpan semua & sesuaikan stok" selalu
gagal dengan pesan umum *"Stok/lapisan biaya tidak cukup atau tidak konsisten. Rekonsiliasi diperlukan"* —
tidak menyebut barang mana, jadi petugas tidak bisa menindaklanjuti.

## Penyebab
- Posting opname memakai **selisih terhadap foto stok saat barang dikunci** (supaya penjualan sesudah hitung tidak
  terhapus).
- *Life cat Tofu 7L Sweet Bubble Gum* dikunci 11:53 WIB: stok sistem 6, fisik 0 → selisih −6.
- 13:56 WIB terjual 1 di kasir (POS-20261124-0033-HTGG) → stok sistem sekarang 5.
- Posting harus mengeluarkan 6 dari stok 5 → ditolak di `issue_stock_document_recorded` dengan pesan generik.
- Hitungan fisik 0 bertentangan dengan penjualan sesudahnya (barangnya ternyata ada) → jalan keluarnya hitung ulang.
- Barang lain aman: 16 barang lain juga laku sesudah dikunci tetapi stoknya masih cukup; 2 barang stok −1 dihitung 0
  (selisih lebih, ditangani `stock_in_fifo`).

## Perbaikan
Migrasi `20261208100000_opname_hitung_ulang_terjual.sql` — `post_opname_atomic` memeriksa lebih dulu (sebelum nomor
hasil dibuat/apa pun ditulis) baris selisih kurang yang stok sekarang < jumlah yang akan dikeluarkan, lalu menolak
dengan pesan berisi nama barang, hitungan, stok saat dikunci, stok sekarang, dan petunjuk "Buka kunci, hitung ulang,
simpan lagi". Aturan stok/jurnal tidak berubah.

## Verifikasi (production, transaksi dibatalkan)
- Panggilan posting OPO.00013 → pesan baru menyebut *Life cat Tofu 7L Sweet Bubble Gum (dihitung 0, stok saat dikunci
  6, stok sekarang 5)*.
- Simulasi hitung ulang barang itu (stok sistem 5, fisik 0) → posting 378 barang berhasil (2 jurnal, status Selesai),
  lalu dibatalkan; data asli tidak berubah.
- Vitest penuh: 1054 file / 10025 tes lulus.

## Tindakan di toko
Buka kunci *Life cat Tofu 7L Sweet Bubble Gum*, hitung ulang fisiknya, lalu "Simpan semua & sesuaikan stok" lagi.
Bila sebelum disimpan ada barang lain yang keburu laku sampai stoknya habis, pesan baru akan menyebut barang itu juga.
