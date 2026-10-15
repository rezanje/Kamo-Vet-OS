# Perbaikan keluhan POS cabang — 15 Oktober 2026

## Perilaku yang diperbaiki

1. Transaksi kasir yang berhasil menghapus draf sesuai pengguna, cabang, shift,
   dan identitas transaksi. Pelanggan, keranjang, penjual, diskon, poin, voucher,
   pembayaran, dan uang bayar kembali kosong pada transaksi berikutnya.
   Struk lama tidak menghapus transaksi baru yang masih dikerjakan.
2. Katalog kasir dan data stok, harga cabang, harga bertingkat, diskon, serta
   komponen paket dibaca per halaman sampai lengkap. Urutan nama diakhiri ID
   agar hasil stabil. Halaman yang gagal atau berubah ditolak, bukan dianggap
   daftar lengkap. Perhitungan pembayaran memakai aturan diskon dan komponen
   paket lengkap yang sama dengan tampilan.
3. Permintaan cabang ke DC disimpan dalam satu transaksi database. Hak akses
   cabang dan shift tetap diperiksa, penomoran diperoleh secara global, dan
   rincian barang/satuan ditentukan dari master. Pengiriman ulang dengan
   identitas dan isi sama mengembalikan permintaan semula. Isian yang gagal
   tetap menjadi draf per pengguna/cabang/tab dan hanya dibersihkan setelah
   konfirmasi berhasil yang cocok.
4. Pengeluaran, bukti, dan jurnal disimpan bersama dengan identitas pengiriman
   yang tahan kirim ulang. Tombol dinonaktifkan selama penyimpanan. Tombol
   **Periksa Hasil Simpan** memulihkan hasil respons yang putus tanpa membuat
   pengeluaran baru, termasuk setelah shift asal ditutup. Browser harus dapat
   menyimpan identitas sebelum pengeluaran dikirim.
5. OWNER, ADMIN, dan FINANCE yang mempunyai akses cabang dapat mengedit atau
   membatalkan pengeluaran lewat detail Persediaan maupun Pencatatan Beban.
   Koreksi memakai jurnal pembalik/pengganti dan menyimpan alasan, nilai lama,
   pembuat, serta bukti. Pembatalan meniadakan nominal efektif dari total
   pengeluaran; dokumen asli tetap tersedia untuk audit.

## Penyebab

- Penyimpanan draf kasir sudah memakai konteks pengguna/cabang/shift, tetapi
  pembersihan struk masih memakai nama penyimpanan global lama.
- Pembacaan satu kali terkena batas 1.000 baris API. Melengkapi daftar barang
  saja juga akan meninggalkan harga, stok, dan diskon barang akhir tidak lengkap.
- Pemicu permintaan lama memeriksa gudang DC melalui izin pembaca cabang yang
  memang tidak boleh membaca gudang cabang lain. Penomoran dari baris yang
  terlihat cabang dapat bertabrakan dengan nomor cabang lain. Header dan
  rincian disimpan terpisah, kesalahan rincian diabaikan, dan draf belum ada.
- Pengeluaran memakai beberapa penyimpanan terpisah tanpa identitas pengiriman
  keuangan. Detail backoffice sebelumnya hanya menampilkan informasi.

## Pengujian yang dapat dijalankan ulang

```sh
npm test
npm run lint
npx tsc --noEmit
npm run build
python scripts/test-pos-complaints-postgres.py
python scripts/test-branch-stock-requests-postgres.py
```

Pengujian database membuat PostgreSQL 16 sementara melalui Docker lokal,
memuat seluruh migrasi repositori dengan pengganti autentikasi/storage khusus
uji, menggunakan data fiktif, dan menghapus kontainer setelah selesai. Tidak
ada URL database produksi yang diterima oleh kedua skrip tersebut.

Uji regresi mereproduksi kegagalan sebelum perbaikan, termasuk 1.205 barang
terpotong menjadi 1.000, diskon barang akhir tidak diterapkan saat pembayaran,
rincian paket terpotong, kegagalan izin DC, dan ketiadaan penyimpanan atomik.
Kasus 12.005 aturan diskon juga diperiksa agar batas daftar umum tidak mematikan
kasir yang memiliki beberapa golongan pelanggan.

Uji Chromium menggunakan komponen sumber asli dengan tindakan server dan
navigasi pengganti: transaksi sukses berikutnya kosong, draf gagal pulih,
struk lama aman, pencarian nama/kode barang akhir, halaman terakhir katalog,
draf permintaan, pencegahan klik ulang pengeluaran, dan pemulihan respons.
Pengujian ini terpisah dari pengujian database; tidak mengklaim pengujian
menyeluruh lewat Next, GoTrue, dan PostgREST atau transaksi toko produksi.

Hasil verifikasi akhir:

- `npm test`: 226 berkas, 1.863 pengujian lulus.
- `npm run lint`: 0 kesalahan; 13 peringatan lama di luar perubahan ini.
- `npx tsc --noEmit`: lulus.
- `npm run build -- --no-lint`: lulus, termasuk pemeriksaan tipe dan 191
  halaman statis. Lint dijalankan terpisah dengan hasil di atas.
- Database sementara: seluruh 195 migrasi dan tiga rangkaian SQL lulus.
- Permintaan bersamaan: identitas sama tetap satu dokumen; dua cabang
  memperoleh nomor global yang berbeda.
- Chromium: 12 skenario lulus, tanpa kesalahan JavaScript halaman.
- Tinjauan independen: temuan tentang diskon akhir, metadata jurnal,
  pemulihan respons, dan penyimpanan browser ditutup dan diuji ulang.

## Urutan penerapan

1. Terapkan `20261015050000_fix_branch_stock_requests.sql` dan
   `20261015051000_fix_pos_expense_workflow.sql` sebelum aplikasi baru.
2. Deploy aplikasi dari perubahan yang sudah ditinjau dan lulus pengujian.
3. Cek transaksi baru kosong, cari barang nama akhir, buat permintaan cabang,
   lalu periksa pengeluaran dari akun kasir dan backoffice dengan data uji
   yang disepakati untuk lingkungan tujuan.

Tidak ada data produksi yang diubah selama pengerjaan ini. Migrasi tidak
mengubah permintaan lama atau menebak pasangan jurnal pengeluaran lama.

## Batas operasional

- Draf permintaan mengikuti masa berlaku 12 jam dan tab browser yang sama.
- Pengeluaran dari shift tertutup, periode buku tertutup, atau jurnal lama
  yang belum terhubung memerlukan rekonsiliasi sebelum koreksi/pembatalan.
- Alur tutup shift lama masih membaca total dan menyimpan hasil dalam dua
  permintaan terpisah. Perubahan ini tidak menjadikan penutupan shift dan
  transaksi keuangan bersamaan sebagai satu transaksi atomik.
