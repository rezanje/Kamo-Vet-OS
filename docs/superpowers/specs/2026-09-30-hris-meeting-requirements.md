# Ringkasan kebutuhan HRIS — meeting 30 September 2026

Sumber: rekaman Zoom `video1747187603.mp4`, durasi 52 menit 12 detik. Ditinjau 1 Oktober 2026 melalui cuplikan layar sepanjang rekaman dan transkripsi otomatis audio. Menit rujukan relatif terhadap awal video. Nama orang dan beberapa nama cabang dalam transkripsi tidak selalu akurat; ringkasan mengutamakan kebutuhan, bukan identitas atau nominal gaji pribadi.

## Kesimpulan

User ingin HRIS VetOS mengikuti alur kerja GajiHub yang sudah familiar, dengan hubungan yang lebih langsung antara data karyawan, jadwal, absensi, lembur, insentif, dan penggajian. Ini bukan sekadar permintaan warna atau tampilan: tujuan utama adalah mengurangi input ulang serta salah hitung akibat jadwal, komponen gaji, dan komisi yang terpisah.

Di akhir meeting, user menerima otomatisasi insentif secara bertahap. Prioritas pertama: alur dasar dari presensi sampai payroll tersedia. Pelacakan lokasi berkelanjutan ditunda. Pernyataan ini bukan persetujuan biaya, tenggat, atau perluasan kontrak.

## Tampilan dan pola interaksi yang dicontohkan

- **Daftar karyawan → profil detail.** Informasi personal, kepegawaian, rekening, kehadiran, izin/cuti, keuangan, pengaturan gaji, dan riwayat gaji tersedia dalam konteks satu karyawan. HR bisa mencari nama lalu langsung memeriksa apakah sudah absen.
- **Jadwal berupa matriks mingguan.** Baris karyawan, kolom hari/tanggal; setiap sel berisi nama shift dan jamnya. Warna membedakan shift/lokasi/libur. Rekap ini secara eksplisit diminta tetap ada untuk pemeriksaan sebelum penggajian.
- **Absensi berupa daftar dan ringkasan.** Ada shift, status, masuk/keluar, serta detail lembur. Ringkasan bulanan menampilkan hari kerja, jam kerja, keterlambatan dalam hari dan durasi, cuti, dan izin.
- **Pengaturan gaji memakai pola bersama.** HR membuat pola slip per kelompok, memilih komponen pendapatan/potongan, lalu menghubungkannya ke karyawan. Nominal tetap dapat diatur per orang.
- **Penggajian dari daftar ke rincian.** HR melihat daftar karyawan dalam kelompok/periode, membuka rincian pendapatan dan potongan, lalu menelusuri tanggal sumber perhitungan.
- **Rumus bisa diatur lewat formulir.** Contoh memperlihatkan komponen tetap, manual, dan berdasarkan hasil aktivitas. User ingin dapat mengatur sendiri beberapa nama/aturan.

Tema gelap dan warna GajiHub terlihat dalam demo, tetapi tidak ada permintaan tegas bahwa VetOS wajib memakai tema gelap atau menyalin tampilan persis. Yang disepakati dalam percakapan adalah mendekati alur yang familiar dan memperbaiki kelemahannya.

## Kebutuhan per bagian dan menit rujukan

| Bagian | Kebutuhan yang disampaikan | Menit |
|---|---|---|
| Tujuan utama | HRIS sampai payroll; jadwal dokter, kehadiran, dan insentif terhubung sehingga perhitungan lebih otomatis. | 01:22–02:15 |
| Profil karyawan | Data personal/kepegawaian/rekening dan rekap kehadiran dapat dilihat dari profil orang yang sama. | 02:43–04:15 |
| Absensi lintas hari | Shift malam, contoh masuk pukul 20.00 dan pulang 08.00 esok hari, harus tercatat benar. Ini masalah yang dikeluhkan dari sistem lama. | 04:58–05:27 |
| Lembur belum ditutup | Sistem lama menolak absensi berikutnya ketika lembur sebelumnya belum check-out. Keluhan ini perlu ditangani tanpa kehilangan jejak sesi kerja. Cara penanganan final belum diputuskan. | 04:16–04:57 |
| Izin dan cuti | Ada rekap izin/cuti. User menyebut izin berakibat potong gaji; jenis izin, pengecualian, dan rumusnya belum dirinci. | 05:31–05:45 |
| Kasbon | Batas Rp700.000 per orang per bulan; boleh diambil sebagian/bertahap. Seluruh saldo dipotong pada penggajian bulan itu, tanpa cicilan, kemudian ruang limit tersedia lagi. | 05:45–06:22 |
| Reimburse | Penggantian biaya terpisah, termasuk bensin/tim lapangan. Petty cash tidak digunakan dalam alur HRIS yang dibahas. | 06:23–06:47 |
| Pola slip gaji | Beberapa pola untuk kelompok berbeda; komponen pendapatan/potongan dapat dipilih dan ditambah. Nominal gaji pokok/tunjangan tetap per orang; komponen variabel bisa manual atau memakai rumus. | 07:03–12:08 |
| Pemeriksaan payroll | Rincian dapat diperiksa dan disesuaikan, termasuk toleransi potongan. Harapan: sebagian besar komponen dihitung otomatis. | 12:11–13:38 |
| Perubahan aturan | Keluhan: perubahan pola/komponen/aturan di sistem lama menuntut penghubungan ulang karyawan. Kebutuhan perbaikan: perubahan tidak merepotkan HR seperti itu. | 13:39–14:58 |
| Riwayat gaji | Rekap take-home pay per periode, bukan hanya riwayat kenaikan gaji. | 15:01–15:17 |
| Komisi/insentif | Aturan berdasarkan kelompok karyawan agar karyawan baru otomatis ikut; jangan bergantung pada daftar nama yang harus ditambah satu per satu. | 16:28–18:08 |
| Cabang dan tenaga penjual | Karyawan dapat ditempatkan di cabang tertentu atau lintas cabang; muncul sebagai tenaga penjual/dokter sesuai peran dan cakupan cabang. | 18:12–19:41 |
| Penerima komisi | Satu transaksi dapat melibatkan beberapa tenaga penjual; aturan menentukan siapa yang mendapat komisi. | 19:45–20:32 |
| Dasar komisi | Berlaku untuk barang, kategori, merek, atau seluruh barang. Bisa persentase penjualan/laba kotor atau nominal per kuantitas. Contoh nominal dalam demo adalah ilustrasi, bukan daftar tarif final. | 20:34–21:31 |
| Komisi masuk gaji | Hasil komisi dari transaksi langsung masuk ke komponen slip sesuai nama komisi, sehingga HR tidak menyalin manual dari laporan seperti sekarang. | 21:42–22:56 |
| Pembatasan lokasi absensi | Shift dikaitkan dengan lokasi kantor; absensi di cabang yang salah ditolak. Radius dapat diatur; angka yang akhirnya disebut dalam demo sekitar 200 meter, belum ketentuan final tiap cabang. | 26:23–27:51 |
| Pengaturan jadwal | Import/export Excel; jadwal biasanya diperbarui mingguan oleh penanggung jawab masing-masing, meskipun satu bulan penuh memungkinkan. | 27:54–28:58 |
| Rekap bulanan absensi | Ringkasan hari/jam kerja, terlambat, cuti, izin; dapat diolah di Excel dan diurutkan untuk pemeriksaan sebelum gaji. | 29:04–30:57 |
| Rincian lembur | Jam mulai/selesai, durasi, tanggal, catatan, serta koreksi durasi. Perubahan sumber lembur harus memperbarui jumlah di gaji. | 31:02–33:26 |
| Potongan terlambat | Rp10.000 tiap interval 5 menit, batas Rp100.000; toleransi bisa dikoreksi. User menyebut terlambat kurang dari satu menit pun sudah terkena Rp10.000. Batas interval persis dan penerapan plafon perlu dikonfirmasi. | 03:29–03:49; 33:27–35:31 |
| Tarif lembur | Non-dokter Rp10.000/jam; disebut plafon Rp75.000 untuk satu hari. Dokter memiliki tarif berbeda mengikuti uang duduk/kelompoknya. Cakupan plafon belum tegas untuk semua kelompok. | 36:02–37:40 |
| Pelacakan lokasi | Fitur sempat dipakai lalu dinonaktifkan; ada keluhan karyawan merasa dipantau. Disepakati dapat menyusul. | 37:53–39:26 |
| Pembagian biaya klinik | Kebutuhan membagi uang duduk/insentif ke klinik terkait, termasuk franchise, berdasarkan aktivitas/presensi. Saat ini dilakukan manual; detail dan prioritas lanjut belum ditetapkan. | 40:35–42:07 |
| Tukar jadwal | Setelah pengajuan disetujui, jadwal harus berubah otomatis. Jangan sampai jadwal lama menimbulkan potongan terlambat pada orang yang sudah mendapat izin pergantian shift. | 42:45–44:23 |
| Rekap shift untuk kontrol | Rekap jadwal jangan dihilangkan. HR menggunakannya untuk mendeteksi salah penempatan jenis shift yang menyebabkan uang duduk dokter tidak muncul. | 44:25–45:36 |
| Uang duduk dokter | Tarif dan cara hitung berbeda menurut kelompok dokter, shift, dan lokasi. Ada contoh per jam untuk poli serta nominal per hari untuk rawat inap. Jam buka klinik juga dapat berubah. | 46:00–50:29 |
| Tahapan pekerjaan | Otomatisasi rumus insentif boleh sambil berjalan; alur dasar seperti GajiHub dari presensi sampai payroll menjadi prioritas. | 50:30–51:03 |

## Masalah sistem lama yang ingin diperbaiki

1. Shift lintas tengah malam tidak terbaca benar.
2. Sesi lembur yang lupa ditutup menghambat absensi berikutnya.
3. Komisi sudah dihitung di Accurate, tetapi masih diketik ulang ke GajiHub.
4. Karyawan baru bisa terlewat komisinya karena belum dimasukkan ke daftar penerima.
5. Perubahan aturan gaji membuat HR harus menghubungkan ulang banyak karyawan.
6. Tukar jadwal yang disetujui masih perlu diubah manual, berisiko denda terlambat salah.
7. Salah jenis shift dokter bisa membuat uang duduk hilang dari payroll.
8. Uang duduk dihitung nominal per shift walaupun jam hadir sebenarnya lebih pendek. User mengeluhkan kelemahan ini, tetapi belum menetapkan rumus pengganti secara tegas.
9. Pembagian beban gaji antar-klinik masih manual.
10. Keluhan layanan absensi saat jam masuk dan ketidakakuratan lokasi disebut; solusi dan toleransi final belum disepakati.

## Urutan prioritas yang dapat ditarik dari meeting

**Prioritas eksplisit:** profil karyawan, pengaturan jadwal, absensi, rekap pemeriksaan, pola slip dan penggajian yang terhubung.

**Perbaikan penting dalam alur:** shift lintas hari, tukar jadwal otomatis setelah persetujuan, rincian dan koreksi lembur, aturan pendapatan/potongan berbeda per kelompok, pemeriksaan sumber uang duduk.

**Boleh bertahap:** rumus insentif dari transaksi dan pengisian otomatis ke slip. User akan memberikan daftar insentif beserta sumber data.

**Ditunda eksplisit:** pelacakan lokasi berkelanjutan. Ini berbeda dari pemeriksaan lokasi ketika absen, yang dibahas sebagai bagian alur presensi.

**Perlu pembahasan terpisah:** pembagian beban biaya ke klinik/franchise dan hubungan tugas dengan Quest. Hubungan Quest tidak dikonfirmasi oleh user yang mendemokan.

## Hal yang belum final

- Daftar seluruh insentif, penerima, tarif, sumber transaksi, dan kondisi pembatalan/retur.
- Uang duduk dokter: berdasarkan jam hadir nyata, jam terjadwal, atau nominal tetap per shift/per hari; aturan berbeda mungkin berlaku untuk kelompok berbeda.
- Pembulatan potongan terlambat pada batas tepat 5/10 menit, plafon per kejadian/hari/periode, dan kewenangan toleransi.
- Pembulatan jam lembur, penerapan plafon Rp75.000, serta aturan dokter dan shift lintas hari.
- Cara memperbaiki absensi/lembur yang tidak ditutup, dan pihak yang berwenang.
- Perubahan aturan gaji berlaku mulai kapan; perlindungan riwayat gaji yang sudah selesai perlu ditentukan sebelum penerapan.
- Mekanisme persetujuan, pembayaran, bukti reimburse/kasbon, dan pencatatan keuangan belum didemokan lengkap.
- Radius lokasi final per cabang dan penanganan lokasi perangkat yang tidak akurat.
- Pembagian biaya antar-klinik/franchise, dasar pembagiannya, dan pengecualian dokter.
- Status fitur yang sudah tersedia di VetOS belum diaudit dalam pekerjaan ini. Ringkasan ini tidak menyatakan fitur sudah dibangun, diuji, atau aktif.

## Contoh hasil yang perlu bisa diuji nanti

- Shift pukul 20.00 sampai 08.00 esok hari tercatat sebagai sesi yang tepat.
- Pergantian shift pukul 07.00 menjadi 08.00 yang disetujui tidak menghasilkan denda karena jadwal lama.
- Kasbon Rp200.000 lalu Rp500.000 dalam bulan yang sama mencapai limit; payroll memotong saldo Rp700.000.
- Perubahan durasi lembur dari sumbernya memperbarui rincian dan total penggajian.
- Karyawan baru dengan kelompok yang berhak ikut aturan komisi tanpa harus ditambahkan ke setiap daftar nama.
- HR bisa membuka komponen uang duduk/komisi dan melihat tanggal/aktivitas asalnya.

Contoh ini merupakan usulan pemeriksaan berdasarkan kebutuhan meeting, bukan bukti implementasi atau persetujuan seluruh aturan bisnis.
