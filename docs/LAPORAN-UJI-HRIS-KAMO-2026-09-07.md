# Laporan Uji HRIS KAMO APP

**Tanggal:** 7 September 2026  
**Tujuan:** Menilai kesiapan alur HRIS KAMO APP untuk bahan presentasi dan menentukan batas aman sebelum pilot bersama Kamo Group.

## Kesimpulan Eksekutif

HRIS **boleh dipresentasikan sebagai prototipe yang sudah diuji**, tetapi **belum boleh dipilotkan memakai data karyawan atau gaji asli Kamo**.

Fondasi alur dan pagar akses pilot sudah disiapkan. Namun, bukti nyata pembatasan antar-cabang/peran, data Kamo, aturan gaji, dan pengalaman pengguna masih harus divalidasi di lingkungan demo terpisah sebelum sistem dipakai untuk proses nyata.

## Status Fitur yang Tersedia

### 1. Data karyawan

- Data dasar karyawan: identitas kerja dasar, jabatan, departemen, cabang utama, kontak, tanggal masuk, gaji pokok, dan status aktif.
- Pengaitan akun staf ke data karyawan untuk menu pribadi.
- Penempatan saat ini masih satu cabang utama per karyawan.

### 2. Absensi dan jadwal

- Master shift kerja dan jadwal bulanan per karyawan.
- Check-in dan check-out dari menu staf.
- Validasi lokasi memakai radius cabang apabila titik lokasi cabang sudah diisi.
- Rekap keterlambatan dan lembur dari jadwal serta absensi.

### 3. Pengajuan staf

- Pengajuan cuti, lembur, kasbon, dan reimburse.
- Proses persetujuan atau penolakan oleh pengelola.
- Kasbon yang disetujui dapat diperhitungkan sebagai cicilan gaji.

### 4. Payroll dan slip gaji

- Perhitungan draft gaji dari jadwal, absensi, cuti, lembur yang disetujui, komponen gaji, kasbon, reimburse, dan komisi.
- Koreksi sebelum pengesahan.
- Slip gaji siap cetak setelah perhitungan.
- Pengesahan payroll mengunci periode dan mencatatnya ke pembukuan.

### 5. Insentif Petshop dan Klinik

- Komisi Petshop berdasarkan omzet, laba, nominal per produk, target, dan retur.
- Insentif Klinik untuk dokter dari tagihan klinik yang telah lunas.
- Sumber transaksi Petshop dan Klinik dipisahkan agar aturan insentif tidak tertukar.

## Dokumentasi Pengujian

| Area uji | Yang diperiksa | Hasil | Dampak bisnis |
| --- | --- | --- | --- |
| Kesehatan aplikasi | Seluruh pengujian aplikasi dan pembangunan aplikasi setelah pengamanan akses | Lulus: 1.643 pengujian, termasuk 188 pengujian terkait HRIS; aplikasi selesai dibangun | Fondasi aplikasi dapat dijalankan untuk bahan demo |
| Hitung gaji | Kehadiran, telat, bolos, cuti, lembur, tunjangan, kasbon, reimburse, komisi, koreksi | Lulus | Angka draft dapat dipakai sebagai simulasi; gaji bersih tidak menjadi negatif dan cicilan kasbon tidak melebihi kemampuan gaji |
| Insentif | Komisi omzet/laba, nominal per produk, target, retur, transaksi Petshop dan Klinik | Lulus | Mekanisme komisi dapat dipresentasikan sebagai alur otomatis |
| Akses tanpa login | Halaman HRIS, komisi, dan menu staf | Ditahan di halaman login | Pagar akses dasar tersedia |
| Uji data nyata | Input, persetujuan, pengesahan, dan cetak slip dengan data Kamo | Tidak dilakukan | Lingkungan yang tersedia belum dapat dipastikan sebagai demo; tidak ada risiko data Kamo berubah |
| Uji peran staf, admin, dan pemilik | Alur klik nyata dengan akun demo | Tertahan: lingkungan demo belum terkonfirmasi | Pengalaman pengguna dan pembagian wewenang belum boleh diklaim selesai |
| Akses antar-cabang dan antar-peran | Pembatasan akses data karyawan, absensi, dan gaji | Pagar aplikasi dan rancangan pagar data selesai; bukti uji nyata tertahan | Menjadi penghambat utama sebelum data personal dan gaji asli dipakai |

## Klasifikasi Kesiapan

### Sudah terbukti

- Aplikasi dapat dibangun dan diuji dengan baik.
- Data karyawan dasar, jadwal, absensi lokasi, pengajuan staf, perhitungan payroll, slip, komisi Petshop, dan insentif Klinik tersedia.
- Rumus penting payroll, kasbon, absensi, lokasi, dan komisi telah melewati pengujian otomatis.
- Pengguna tanpa login tidak dapat membuka halaman HRIS.
- Aksi HRIS cabang hanya dapat dijalankan oleh pemilik atau admin; perhitungan, koreksi, dan pengesahan payroll hanya oleh pemilik selama pilot.
- Karyawan aktif tidak dapat disimpan tanpa cabang utama.

### Ada, tetapi belum tervalidasi dengan data Kamo

- Kelengkapan dan kualitas data karyawan Kamo.
- Ketepatan hasil gaji terhadap aturan gaji, jadwal, dan absensi Kamo.
- Alur staf mengajukan, admin menyetujui, lalu payroll dihitung sampai slip tercetak.
- Ketepatan komisi dari transaksi Petshop dan Klinik Kamo.
- Pengalaman pengguna pada akun staf, admin, dan pemilik.
- Penerapan pembatasan akses pada lingkungan yang akan dipakai Kamo.
- Pagar data antar-cabang dan antar-peran pada database demo; perubahan belum diterapkan ke lingkungan mana pun.

### Belum termasuk rilis saat ini

- Perhitungan PPh 21 otomatis.
- Perhitungan BPJS otomatis.
- Verifikasi wajah untuk absensi.
- Penempatan dokter di beberapa cabang sekaligus.
- Data lengkap pajak, BPJS, rekening, dan kontrak karyawan.
- Saldo cuti otomatis.
- Insentif khusus Achievement PIC, Grooming, dan Rawat Inap.

## Pedoman Presentasi Besok

### Aman didemokan

- Tampilan data karyawan dasar.
- Master shift dan jadwal bulanan.
- Mekanisme absensi berbasis radius lokasi.
- Pengajuan cuti, lembur, kasbon, dan reimburse.
- Simulasi draft payroll dan slip gaji.
- Layar komisi Petshop dan insentif Klinik.

Gunakan angka demonstrasi yang tidak sensitif. Jangan membuat, menyetujui, menghitung ulang, atau mengesahkan transaksi pada lingkungan yang belum dipastikan sebagai demo.

### Wajib disebut sebagai pilot

- Input data karyawan Kamo.
- Absensi dari ponsel staf.
- Persetujuan pengajuan oleh pengelola.
- Payroll periodik dan komisi aktual.
- Validasi hasil payroll bersama tim Kamo.

Pesan yang disarankan: **“Alur dan mesin hitung sudah tersedia untuk diuji bersama. Sebelum dipakai membayar, kita lakukan pilot terkontrol dengan data dan aturan Kamo.”**

### Jangan diklaim tersedia

- PPh 21 otomatis.
- BPJS otomatis.
- Verifikasi wajah.
- Dokter lintas cabang.
- Impor data HR lengkap beserta data pajak dan bank.

## Syarat Sebelum Pilot Data Asli

1. Siapkan lingkungan demo terpisah berisi data fiktif dan akun uji staf, admin, serta pemilik.
2. Terapkan lalu buktikan pembatasan akses pada lingkungan demo: staf hanya dapat melihat dan mengajukan data miliknya sendiri; pengelola hanya mengakses cabang yang menjadi tanggung jawabnya.
3. Siapkan data dan aturan Kamo: daftar karyawan, cabang, jadwal, komponen gaji, aturan telat/lembur, kasbon, reimburse, serta formula insentif.
4. Jalankan uji lengkap staf ke admin sampai slip memakai data fiktif, lalu bersihkan data uji.
5. Lakukan parallel run satu periode: sistem menghitung sebagai pembanding, tanpa pembayaran otomatis dan tanpa menjadi sumber pembayaran resmi.
6. Setelah hasil parallel run disetujui Kamo, baru putuskan ruang lingkup pilot data asli.

## Batas Audit dan Implementasi Pengaman

Audit awal melakukan pemeriksaan aman. Implementasi lanjutan menambahkan aturan akses aplikasi dan menyiapkan pagar data database, tanpa menerapkannya ke database mana pun. Tidak ada data, akun, konfigurasi, pembayaran, pengesahan payroll, maupun aksi keuangan nyata yang diubah atau dijalankan.
