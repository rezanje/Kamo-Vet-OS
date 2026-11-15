# Owner jual di bawah modal (obral) — petshop, barang persediaan

Permintaan Andri (14 Nov 2026): stok hampir kadaluarsa diskon 50% ditolak kasir ("Harga neto … di bawah batas aman HPP FIFO; penjualan ditolak") walau akun Owner. Aturan: Owner tidak boleh terkunci. Ruang lingkup: **hanya barang Persediaan, hanya petshop** (kasir `/kasir` dan POS `/pos/transaksi`); klinik tidak berubah.

## Cara pakai (kasir)
1. Masukkan barang ke keranjang, beri diskon seperti biasa (potongan per barang di `/kasir`, diskon total di `/pos/transaksi`; hanya Owner/Admin atau peran berizin yang bisa mengetik diskon).
2. Pada baris barang persediaan centang **Jual di bawah modal (obral)**, pilih alasan (Mau kadaluarsa / Rusak kemasan / Cuci gudang / Lainnya + ketik alasan, min 3 huruf). Tombol Bayar menunggu alasan terisi.
3. Bayar. Struk tersimpan; modal (HPP) tetap HPP FIFO asli sehingga rugi tampil sebagai margin lebih kecil (tidak ada akun khusus).

## Siapa
OWNER selalu. Peran lain hanya bila Owner mencentang izin **Jual di bawah modal (obral)** di Pengaturan > Akses Grup (bawaan MATI untuk semua, termasuk Admin). Dicek di database (`below_cost_sale_allowed()`), bukan hanya layar.

## Yang tetap ditolak
Harga neto nol, HPP tidak diketahui / Rp0 (COST_MISSING), jasa, paket Grup, baris promo di bawah modal (aturan promo tidak berubah), peran tanpa izin walau kolom alasan dipalsukan.

## Jejak
`sale_items.below_hpp_owner_reason` (alasan), `below_hpp_owner_by` (pelaku, diisi database), `below_hpp_loss` (rugi = HPP baris − harga neto baris, diisi saat posting kasir). Ubah transaksi petshop membawa alasan ke struk pengganti (pemosting tetap harus berizin).

## Laporan
Laporan › **Penjualan di Bawah Modal** (`/laporan/jual-bawah-modal`, Owner/Admin/Finance, Excel): tanggal, cabang, struk, barang, qty, HPP, harga neto, rugi, alasan, siapa. Struk yang dibatalkan atau diubah tidak dihitung dua kali.

## Catatan
- POS back-office (`/pos/transaksi`) sebelumnya sudah boleh menjual di bawah HPP dengan konfirmasi peringatan untuk semua peran (tidak ada lantai di database untuk jalur itu). Perilaku itu tidak diubah; centang obral hanya menghapus peringatan untuk baris itu dan mencatat alasannya.
- Klinik (`clinic_private.assert_invoice_price_floor`) juga menolak Owner di bawah HPP; tindak lanjut terpisah.
- Bukti: `supabase/tests/owner_jual_bawah_modal.sql` (PostgreSQL 17 native).
