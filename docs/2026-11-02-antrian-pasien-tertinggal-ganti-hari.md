# Pasien belum lunas "hilang" dari Antrian setelah ganti hari (2 Nov 2026)

## Laporan
Grup klinik, 2 Nov 09.07–09.23 WIB.
- **Andri (Cimanggis):** shift malam mendaftarkan 2 pasien yang belum dibayar. Pagi harinya, setelah ganti shift, kedua
  pasien tidak muncul lagi, baik di akun staf pagi maupun di akun shift malam.
- **Anisa (TKI):** hal yang sama terjadi pada Miaw (Kak Regina), Goldy (Bu Linda) dan Bule (Kak Felicia). Transaksinya
  belum diselesaikan karena kemarin masih menunggu update harga vaksin.
- **Pak Aldi:** "Berarti transaksi yg belum ke payment tanpa masuk ranap ilang saat ganti hari ya?" Jawabannya ya. Yang
  hilang hanya tampilannya; datanya tidak terhapus.

## Penyebab
- `src/app/(app)/klinik/antrian/page.tsx` membaca `visits` hanya untuk `created_at` di dalam hari WIB yang dipilih
  (`queueDayBounds(tanggal || hariIniWIB())`, `.gte/.lt`). Hari yang dipilih default-nya hari ini. Lewat 00.00 WIB,
  pasien kemarin yang berstatus Menunggu, Diperiksa atau Pembayaran keluar dari semua tab.
- Polling 20 detik (`LiveRefresh`) menjalankan ulang halaman tanpa `?tanggal`. Karena itu layar yang masih terbuka di
  akun shift malam ikut "kehilangan" pasiennya.
- Untuk pasien berstatus Menunggu dan Diperiksa, Antrian adalah satu-satunya daftar di aplikasi. Daftar Rekam medis
  (`daftar_rekam_medis`) hanya memuat kunjungan yang sudah punya rekam medis, dan tidak ada daftar tagihan klinik.
- Langkah lanjutan tidak punya gerbang tanggal, karena semuanya membaca kunjungan berdasarkan id dan RLS hanya
  memeriksa cabang: rekam medis, `set_visit_service_state`, `clinic_save_initial_record`, `clinic_post_invoice`, dan
  struk. Pembayaran tetap memakai shift kas klinik milik kasir yang membayar di cabang kunjungan, dan tercatat dengan
  tanggal hari bayar.

## Data produksi (dicek baca-saja, 2 Nov 09.20 WIB)
- Semua baris utuh. Tidak ada kunjungan yang terhapus.
- **Cimanggis:** CMGG-A021 Mocha (Risma) dan CMGG-A022 Sita (Dian) berstatus Diperiksa. Rekam medisnya belum
  tersimpan; isian dokter yang belum disimpan hanya ada di sessionStorage browser yang dipakai semalam.
- **TKI:** TKI-V001 Miaw, TKI-V002 Goldy dan TKI-V003 Bule berstatus Pembayaran, dengan rekam medis dan item resep
  lengkap.
- Total 60 kunjungan non-rawat-inap dari hari-hari sebelumnya yang belum Selesai: 42 Pembayaran, 14 Diperiksa,
  4 Menunggu. Paling tua 22 Okt, paling banyak sekitar 20 per cabang. Belum ada yang punya tagihan DP / Belum Lunas.

## Perbaikan
1. Antrian, saat melihat hari ini:
   - Bacaan ketiga yang paralel (`qSisa`) memuat kunjungan di cabang yang sama, berstatus bukan Selesai, dengan
     `created_at < awal hari ini`. Diurutkan terbaru dulu, dibatasi `limit 200`.
   - Rawat inap aktif disaring keluar seperti sebelumnya, lalu daftarnya ikut tab status: Menunggu → Menunggu,
     Diperiksa → Diperiksa, Aktif/Semua → semuanya, Selesai → tidak tampil.
   - Hasilnya ditampilkan di tabel "BELUM SELESAI DARI HARI SEBELUMNYA" di atas "ANTRIAN HARI INI". Tombolnya sama
     dengan baris hari ini (Panggil/Batal, Rekam medis, Bayar). Tiap baris membawa tanggal daftar, karena nomor antrian
     berulang tiap hari dan tidak unik di basis data.
   - Spanduk menampilkan jumlahnya (belum dibayar · sedang diperiksa · belum dipanggil). Di tab Selesai, spanduk
     menautkan ke tab Aktif.
   - Bila batas 200 tercapai, layar menuliskannya; tidak ada pemotongan diam-diam.
2. Bacaan "menunggu" (panggilan berikutnya) digabung ke bacaan hari ini (`qHari`). Jumlah bacaan `visits` tetap 3
   dan semuanya paralel; dijaga oleh `klinik-a-navigasi-waterfall.test.tsx`. Ini penting karena insiden basis data
   1 Nov dan polling 20 detik.
3. Panggilan berikutnya, informasi poli dan kartu angka sengaja tetap untuk pendaftaran hari ini. Kunjungan Menunggu
   yang terbengkalai dari hari-hari lalu tidak boleh menyerobot "panggilan berikutnya"; pasien seperti itu dipanggil
   atau dibatalkan dari bagian tertinggal.
4. Melihat tanggal lampau tetap menampilkan persis hari itu, tanpa bacaan tertinggal.
5. Dashboard: KPI "Sedang menunggu antrian" kini tanpa batas awal hari (`status = Menunggu`, `created_at < akhir hari
   ini`).

## Uji
- Baru: `src/components/__tests__/queue-carry-over.test.tsx`. Fixture-nya menerapkan saringan kueri sungguhan
  (cabang, tanggal, status, urutan, batas). Ada 7 kasus: pasien shift malam tampil beserta tombol dan tanggalnya;
  angka dan panggilan berikutnya tetap hari ini; bacaan tertinggal satu kali, paralel, dalam cabang aktif, tanpa batas
  awal; tanggal lampau tidak tercampur; tab status; batas 200 diberi tahu; bacaan gagal berarti antrian gagal.
  Di kode lama 6 dari 7 kasus merah.
- Disesuaikan: `queue-page.test.tsx`. Ada 2 bacaan berbatas hari dan 1 bacaan sebelum awal hari; bacaan tertinggal
  kosong di fixture lama.
- `npm test`: 724 file / 6019 tes hijau. `npm run lint`: 0 error, peringatan `<img>` yang memang sudah ada.
  `tsc --noEmit` hijau. `npm run build` hijau.

## Sisa / tindak lanjut
- Kunjungan lama yang memang tidak jadi (Menunggu) bisa dibatalkan dari bagian tertinggal. Untuk yang sudah
  Diperiksa atau Pembayaran tetapi tidak jadi bayar, belum ada tombol tutup tanpa bayar; perlu keputusan bisnis bila
  ingin dibuat.
- Terpisah: laporan Operasional Penjualan (`src/lib/operation-sales-server.ts`) hanya menghitung tagihan klinik bila
  kunjungannya juga terdaftar di periode yang sama. Pembayaran lintas hari, seperti kasus ini, hilang dari laporan
  harian kedua hari itu. Dicatat sebagai tugas terpisah.
- Isian rekam medis yang belum disimpan tetap per browser dan per akun (sessionStorage), sesuai desain yang ada.
