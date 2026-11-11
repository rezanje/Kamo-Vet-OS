# Ganti barang di faktur FB.2026.11.00031 (11 Nov 2026)

**Permintaan:** user klinik, diteruskan Reza: baris "Pasir Markotop 5L" (18 PCS @ Rp 23.520) salah input,
seharusnya "Pasir TOP 5ltr". User menyebut varian mana saja boleh, yang penting Pasir Top 5L. Di master
barang hanya ada satu: Pasir TOP 5ltr (kode PXCLT0007).

**Kenapa koreksi data langsung:** pembatalan resmi ditolak dengan pesan "Stok atau harga sudah berubah
setelah faktur". Sebabnya, 29 detik setelah faktur disimpan, seluruh barang faktur langsung dikirim lewat
permintaan PRM-20261110-0011 (DC LOJI ke Transit, tujuan Kamo Petshop Granada). Belum ada fitur untuk
mengganti barang di faktur yang stoknya sudah bergerak, dan Retur Pembelian hanya untuk faktur dari PO.

**Yang diubah:** lihat `apply.sql`, dijalankan dalam satu transaksi dengan pengecekan jumlah baris dan
konsistensi bukti. Qty, harga, total faktur (Rp 4.516.820), hutang, dan jurnal JRN-202611-10623 tidak berubah,
karena kedua barang satu kategori dan memakai akun persediaan yang sama.

**Verifikasi setelah apply:**
- baris faktur: Pasir TOP 5ltr, 18 PCS @ 23.520; faktur tetap aktif, revisi 0;
- baris permintaan: Pasir TOP 5ltr, dikirim 18, belum diterima;
- stok: DC LOJI 0, Transit 18 (Pasir TOP 5ltr); Pasir Markotop 5L tidak punya mutasi atau layer lagi;
- jurnal: debit/kredit 4.516.820, tidak berubah.

**Rollback:** `rollback.sql` (hanya aman sebelum Pasir TOP 5ltr punya mutasi lain).

**Celah produk (belum dikerjakan):** fitur "ganti barang di faktur" untuk faktur yang stoknya sudah dikirim
atau terpakai.
