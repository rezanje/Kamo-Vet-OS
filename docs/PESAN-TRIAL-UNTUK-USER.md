# Pesan trial VetOS untuk user

Halo Pak/Bu, update trial VetOS ya.

Versi terbaru sudah online. Perbaikan tanggal pada catatan rawat inap juga sudah
kami rilis. Untuk tahap ini, kita mulai dari trial terbatas dengan data simulasi
dulu supaya alurnya aman dan hasilnya mudah dicek sebelum dipakai untuk data
operasional.

## Yang bisa dicoba

1. Buka dashboard dan riwayat, lalu pastikan cabang yang dipilih sudah benar.
2. Coba maintenance dengan alat uji.
3. Coba transfer anabul uji ke pemilik lain, lalu pastikan identitas dan riwayat
   tetap ada.
4. Coba alur registrasi → antrean → pemeriksaan → rekam medis → rawat inap →
   catatan harian.
5. Setelah alur dasar aman, kita lanjut cek import barang, saldo awal, penjualan
   multisatuan, kartu stok, dokter lintas cabang, loyalty, dan cetak dokumen.
6. Untuk performa, coba buka alur penting dengan satu tab lalu beberapa tab. Kalau
   masih terasa lambat, mohon dicatat halaman dan kondisinya.
7. WhatsApp belum kita uji kirim nyata karena akun pengirim dan nomornya belum
   tersambung. Bagian ini kita lanjutkan setelah konfigurasi pengirim siap.

## Cara mulai

1. Buka [VetOS produksi](https://kamo-vet-os.vercel.app).
2. Gunakan data uji yang diberi tanda `SIMULASI QA`.
3. Mulai dari poin 1 sampai 4 terlebih dahulu.
4. Untuk tarif rawat inap, persetujuan, pembayaran, dan transaksi stok nyata,
   tandai `TERTUNDA` dulu sampai tarif/template resmi dan data operasional siap.
5. Jangan masukkan data pelanggan/pasien nyata atau menjalankan pengiriman
   WhatsApp massal selama trial ini.

## Format feedback

Untuk setiap poin, mohon balas dengan salah satu status berikut:

- `LULUS` — alurnya berjalan sesuai kebutuhan.
- `GAGAL` — ada kendala; mohon sertakan langkah terakhir dan screenshot.
- `TERTUNDA` — belum bisa dicoba karena data atau konfigurasi belum tersedia.

Kalau trial terbatas ini sudah sesuai, kita lanjutkan pengujian dengan data
operasional secara bertahap dan didampingi.

