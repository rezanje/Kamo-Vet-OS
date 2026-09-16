# Panduan Uji Import Panduraya Harga Cabang dan Rekam Medis

**Tanggal:** 7 September 2026

**Status:** Panduan operasional untuk uji import hari ini. Dokumen ini tidak memberi izin untuk menjalankan import pada target yang belum disetujui.

## 1. Tujuan dan Ruang Lingkup

Panduan ini dipakai tim untuk mencoba import data pada target demo atau cloud yang sudah disetujui, tanpa wajib melakukan call. Tujuan uji adalah memastikan data masuk lengkap, terpetakan ke cabang yang benar, dapat dilacak per batch, dan dapat dipulihkan bila hasilnya tidak sesuai.

Ruang lingkup uji:

1. Import master barang dan data persediaan yang disetujui.
2. Import harga jual per cabang tanpa menggandakan master barang.
3. Import saldo stok awal **hanya** untuk Cabang Panduraya.
4. Import rekam medis dari Google Sheet multi-tab yang telah disetujui.
5. Menyiapkan trial operasional paralel Accurate dan VetOS untuk Petshop serta Klinik.
6. Verifikasi hasil sebelum data dinyatakan siap dipakai.

Di luar ruang lingkup:

- Input atau perubahan data gaji, HRIS, payroll, rekening, atau pembayaran.
- Saldo stok awal untuk cabang selain Panduraya.
- Import langsung ke target yang belum dikonfirmasi sebagai demo/cloud uji.

Nama cabang pada chat muncul sebagai **Pandu** dan **Panduraya**. Sebelum import atau trial, pemilik data wajib mengonfirmasi satu nama resmi beserta kodenya. Dokumen ini memakai Panduraya hanya sebagai label kerja sementara.

## Coverage Requirement Chat

| Requirement chat | Langkah panduan | Status |
| --- | --- | --- |
| Master seluruh data persediaan; saldo awal hanya Panduraya | Batas data, dry-run saldo Panduraya, verifikasi cabang lain nol atau tidak berubah | Sudah tercakup |
| Rekam medis dari Google Sheet | Mapping rekam medis, dry-run, verifikasi pasien dan cabang | Sudah tercakup |
| Google Sheet multi-sheet atau multi-tab | Manifest tab, mapping antar-tab, key pasien dan kunjungan, validasi tab wajib, diagnosis kosong | Baru ditambahkan |
| Harga jual berbeda per cabang | Mapping harga per kode barang dan cabang, uniqueness, dry-run, dan sampel harga | Baru ditambahkan |
| Trial Pandu atau Panduraya Petshop dan Klinik pada tanggal 5 | Trial paralel Accurate dan VetOS, angka kontrol, mismatch log, serta stok opname setelah selesai | Baru ditambahkan; nama cabang serta bulan dan tahun trial menunggu konfirmasi |
| Uji karyawan, absensi, insentif, dan payroll | Workstream HRIS dipisahkan dari batch persediaan serta rekam medis | Baru ditambahkan |
| Aldi mengontrol dari Sukabumi; short call sekitar 17.00 opsional | PIC, checkpoint tertulis, dan template WhatsApp | Sudah tercakup; waktu call menunggu konfirmasi |

## 2. PIC dan Persetujuan

| Peran | Tanggung jawab |
| --- | --- |
| Operator import | Menyiapkan file, menjalankan dry-run dan import setelah ada persetujuan, menyimpan laporan hasil. |
| Pemilik data atau penanggung jawab Panduraya | Memastikan file sumber, nama dan kode cabang resmi, mapping cabang, jumlah harapan, dan keputusan lanjut atau rollback. |
| Aldi di Sukabumi | Mengontrol hasil dari jarak jauh, memeriksa error serta angka kontrol, dan memberi masukan bila ada mismatch. |
| Pemegang keputusan | Memberi persetujuan tertulis sebelum commit dan menentukan rollback bila hasil tidak sesuai. |

Short call dengan Aldi sekitar pukul 17.00 bersifat **opsional**. Semua informasi yang dibutuhkan harus tetap tercatat tertulis di grup agar uji dapat berjalan tanpa call. Stok opname dikirim setelah proses operasional selesai dan sebelum hasil stok dinyatakan final.

## 3. Prasyarat Sebelum Mulai

Semua kotak berikut harus dipenuhi sebelum dry-run.

- [ ] Akun operator memiliki akses import pada target yang dipakai.
- [ ] Target demo/cloud ditulis jelas: nama target, alamat, dan statusnya sebagai target uji.
- [ ] Snapshot atau backup target tersedia, waktu pembuatannya dicatat, dan pemegang akses pemulihan diketahui.
- [ ] Template persediaan yang dipakai tim sudah disepakati.
- [ ] Template harga jual per cabang sudah disepakati.
- [ ] Link Google Sheet rekam medis tersedia dalam mode baca untuk pengecekan sumber.
- [ ] Manifest tab Google Sheet dan hubungan antar-tab sudah ditulis dengan placeholder yang telah diganti nama tab final.
- [ ] Cabang Panduraya sudah memiliki kode atau identitas cabang yang pasti untuk mapping; nama Pandu atau Panduraya sudah dikonfirmasi sebagai nama resmi.
- [ ] Daftar pasien dan cabang yang boleh menerima rekam medis telah disetujui.
- [ ] Jumlah harapan per file telah dicatat sebelum import.
- [ ] Baseline angka Accurate dan VetOS untuk trial paralel sudah dicatat sebelum tanggal trial.
- [ ] Jadwal trial tanggal 5 serta status Petshop dan Klinik sudah dikonfirmasi.
- [ ] PIC operator, Aldi, dan pemegang keputusan sudah disebut di grup.
- [ ] Persetujuan tertulis untuk menjalankan dry-run telah diberikan.

Jangan memulai bila target, backup, nama cabang resmi, mapping Panduraya, manifest tab, atau jadwal trial belum pasti.

## 4. Batas Data yang Wajib Dijaga

| Jenis data | Boleh diimport | Larangan |
| --- | --- | --- |
| Master barang | Boleh mencakup seluruh cabang sesuai file sumber yang disetujui. | Jangan membuat master ganda atau mengubah master yang tidak ada di scope. |
| Harga jual per cabang | Satu harga aktif per kombinasi kode barang dan cabang yang disetujui. | Jangan membuat barang baru hanya karena harga cabang berbeda. Jangan menggunakan harga cabang sebagai kode barang. |
| Saldo stok awal | Hanya baris dengan mapping Cabang Panduraya. | Jangan mengisi saldo awal Cabang Panduraya ke cabang lain. Jangan memberi saldo dari file ini ke cabang lain. |
| Rekam medis | Hanya pasien dan cabang yang sudah disetujui. | Jangan membuat rekam medis untuk pasien tidak ditemukan, pasien tidak disetujui, atau cabang salah. |
| HRIS dan data gaji | Workstream terpisah untuk uji karyawan, absensi, insentif, dan payroll. | Jangan memasukkan atau mengubah data HRIS, gaji, payroll, atau pembayaran melalui batch import ini. |

## 5. Persiapan File dan Mapping Kolom

Template yang dipakai tim adalah sumber kebenaran untuk nama header. Jangan menebak field aplikasi yang belum tersedia. Bila kolom sumber tidak punya pasangan pada template, masukkan ke daftar keputusan, bukan dipaksakan saat import.

### 5.1 Aturan umum file

- Satu file untuk satu jenis data dan satu batch import.
- Tambahkan `source_row_id` atau nomor baris sumber agar setiap error dapat ditelusuri.
- Gunakan kode unik yang stabil. Jangan memakai nama sebagai satu-satunya kunci.
- Tanggal memakai format `YYYY-MM-DD`.
- Angka memakai angka murni, tanpa `Rp`, titik ribuan, atau teks satuan.
- Nilai jumlah stok awal tidak boleh negatif. Koreksi stok dicatat sebagai isu terpisah.
- Baris dengan kolom wajib kosong tidak boleh dilanjutkan; pindahkan ke daftar error.
- Simpan salinan file sumber yang tidak diubah dan file hasil bersih yang dipakai import.

### 5.2 Mapping minimal master barang

| Kolom sumber | Status | Pemeriksaan sebelum dry-run |
| --- | --- | --- |
| `source_row_id` | Wajib | Unik per baris sumber. |
| Kode barang atau kode unik | Wajib | Tidak kosong dan tidak duplikat. |
| Nama barang | Wajib | Tidak kosong; bukan pengganti kode unik. |
| Satuan | Wajib bila diminta template | Konsisten dengan template persediaan. |
| Kategori atau atribut master lain | Sesuai template | Hanya diisi jika punya mapping yang disetujui. |

### 5.3 Mapping harga jual per cabang

Satu master barang tetap satu. Harga cabang disimpan sebagai data terpisah dengan kunci gabungan **kode barang + kode cabang**, bukan dengan membuat kode barang baru atau menyalin master barang.

| Kolom sumber | Status | Pemeriksaan sebelum dry-run |
| --- | --- | --- |
| `source_row_id` | Wajib | Unik per baris sumber. |
| Kode barang | Wajib | Harus cocok dengan satu master barang yang lolos tahap pertama. |
| Kode atau nama cabang | Wajib | Harus cocok dengan mapping cabang yang disetujui. |
| Harga jual | Wajib | Angka nol atau positif, tanpa format mata uang. |
| Tanggal berlaku atau status aktif | Hanya jika template meminta | Harus memakai aturan template; jangan membuat aturan masa berlaku baru. |

Dry-run harus memeriksa uniqueness kombinasi kode barang dan cabang. Satu kombinasi hanya boleh memiliki satu harga aktif untuk periode yang sama. Duplikat ditahan untuk keputusan pemilik data.

### 5.4 Mapping minimal saldo stok awal

| Kolom sumber | Status | Pemeriksaan sebelum dry-run |
| --- | --- | --- |
| `source_row_id` | Wajib | Unik per baris sumber. |
| Kode barang | Wajib | Harus cocok dengan master yang lolos tahap pertama. |
| Kode atau nama cabang | Wajib | Harus dipetakan tepat ke Panduraya. |
| Tanggal saldo awal | Wajib | Format `YYYY-MM-DD`; satu tanggal kontrol disepakati tim. |
| Jumlah stok awal | Wajib | Angka nol atau positif. |
| Nilai atau harga awal | Hanya jika template meminta | Angka valid dan sumbernya disetujui. |

Sebelum file saldo dipakai, filter harus menghasilkan **hanya Panduraya**. Semua baris cabang lain dipindahkan ke file terpisah dan tidak diimport dalam batch ini.

### 5.5 Manifest dan mapping rekam medis Google Sheet multi-tab

Google Sheet rekam medis dapat berisi lebih dari satu tab. Nama tab final belum dikonfirmasi; gunakan manifest berikut dan ganti semua placeholder sebelum dry-run. Jangan menganggap struktur tab dari satu file berlaku untuk file lain.

| Peran data | Nama tab final yang harus dikonfirmasi | Key utama | Hubungan yang harus dibuktikan | Status validasi |
| --- | --- | --- | --- | --- |
| Pasien | `[tab pasien]` | `kode_pasien_sumber` | Menjadi rujukan semua rekam medis. | Wajib ada |
| Kunjungan | `[tab kunjungan]` | `kode_kunjungan_sumber` | Terhubung ke satu pasien dan satu cabang. | Wajib ada bila rekam medis memakai kunjungan |
| Rekam medis | `[tab rekam medis]` | `kode_rekam_medis_sumber` | Terhubung ke pasien; terhubung ke kunjungan bila key kunjungan tersedia. | Wajib ada |
| Diagnosis atau field klinis tambahan | `[tab diagnosis atau field klinis]` | Key rekam medis atau kunjungan | Harus cocok satu-ke-satu atau sesuai aturan sumber yang disetujui. | Wajib hanya jika data ada di tab terpisah |

Sebelum dry-run, operator wajib membuktikan bahwa semua tab wajib ada, headernya cocok dengan manifest, dan setiap key pasien, kunjungan, serta rekam medis dapat dipakai untuk join antar-tab. Baris yang gagal join masuk error list; jangan dilengkapi dari tebakan.

### 5.6 Mapping minimal rekam medis

| Kolom sumber | Status | Pemeriksaan sebelum dry-run |
| --- | --- | --- |
| `source_row_id` | Wajib | Unik per baris sumber. |
| Kode pasien atau identitas pasien | Wajib | Harus ditemukan pada target dan ada dalam daftar pasien disetujui. |
| Kode atau nama cabang | Wajib | Harus cocok dengan cabang pasien yang disetujui. |
| Tanggal rekam medis | Wajib | Format `YYYY-MM-DD`. |
| Ringkasan rekam medis atau field klinis yang dipetakan | Sesuai template | Tidak boleh menebak diagnosis, dokter, atau nilai kosong. |
| Kode rekam medis sumber | Wajib bila tersedia | Dipakai untuk deduplikasi dan audit. |

Aturan diagnosis kosong:

- Jangan menebak, membuat, atau mengubah diagnosis.
- Tandai sebagai `DIAGNOSIS_KOSONG` pada error atau exception list.
- Sebelum commit, pemilik data memutuskan tertulis apakah baris ditahan atau boleh masuk dengan diagnosis tetap kosong bila target memang mendukung data kosong.
- Jumlah diagnosis kosong wajib muncul pada hasil dry-run dan laporan WhatsApp.

### 5.7 Duplikat dan data kosong

- Duplikat kode barang: tahan seluruh kelompok kode tersebut sampai pemilik data menentukan baris yang benar.
- Duplikat harga cabang: tahan bila kombinasi kode barang, cabang, dan periode atau status aktif muncul lebih dari sekali.
- Duplikat saldo: tahan bila kombinasi kode barang, Panduraya, dan tanggal muncul lebih dari sekali.
- Duplikat rekam medis: gunakan kode rekam medis sumber bila tersedia; bila tidak ada, tahan pasangan pasien, cabang, dan tanggal yang sama untuk review.
- Kolom wajib kosong: jangan diisi dengan perkiraan. Catat nomor baris, alasan, dan PIC pemutusnya.

## 6. Urutan Dry-Run dan Gerbang Persetujuan

Jalankan dry-run dalam urutan ini. Dry-run harus menghasilkan jumlah calon import, jumlah error, dan daftar error yang dapat diunduh atau disalin ke laporan.

| Tahap | Input | Hasil yang harus ditampilkan | Gerbang lanjut |
| --- | --- | --- | --- |
| 1 | Master barang dan data persediaan | Jumlah baris sumber, calon dibuat, calon diperbarui, duplikat, dan error. | Pemilik data menyetujui hasil master. |
| 2 | Harga jual per cabang | Jumlah kombinasi kode barang dan cabang, master barang cocok, harga aktif per kombinasi, duplikat, dan error. Ambil sampel harga dari cabang berbeda. | Pemilik data menyetujui hasil harga cabang. |
| 3 | Saldo stok awal Panduraya | Jumlah baris Panduraya, jumlah barang cocok, jumlah error, serta bukti cabang lain nol. | Pemilik data dan Aldi menyetujui hasil saldo. |
| 4 | Rekam medis Google Sheet multi-tab | Daftar tab ditemukan dan hilang, hasil join key pasien dan kunjungan, rekam medis calon masuk, pasien tidak ditemukan, cabang mismatch, duplikat, `DIAGNOSIS_KOSONG`, dan error. | Pemilik data menyetujui manifest serta hasil rekam medis. |

Jangan melakukan commit batch bila ada error yang belum diputuskan, mismatch cabang, atau jumlah hasil yang tidak sesuai dengan angka kontrol.

## 7. Langkah Eksekusi di Aplikasi atau Cloud

Nama menu dan alamat import belum dikonfirmasi dalam panduan ini. Operator wajib memakai **[menu import yang dipakai tim]** dan membuktikan tiga hal sebelum memilih file:

1. Target yang terbuka adalah demo/cloud uji yang sudah disetujui.
2. Jenis import yang dipilih sesuai tahap saat ini: master, harga cabang, saldo Panduraya, atau rekam medis.
3. Sistem menampilkan mode dry-run atau ringkasan sebelum commit, termasuk daftar error dan identitas batch bila tersedia.

Urutan operasional:

1. Catat nama target, waktu mulai, operator, dan nomor batch pada laporan.
2. Jalankan dry-run master barang. Simpan hasil dan tunggu persetujuan.
3. Jalankan dry-run harga jual per cabang. Simpan hasil dan tunggu persetujuan.
4. Jalankan dry-run saldo stok awal yang sudah difilter Panduraya. Simpan hasil dan tunggu persetujuan.
5. Jalankan dry-run rekam medis multi-tab. Simpan manifest, hasil join, dan daftar diagnosis kosong; tunggu persetujuan.
6. Setelah semua gerbang disetujui tertulis, commit tiap tahap satu per satu sesuai urutan dry-run.
7. Setelah setiap commit, lakukan verifikasi tahap tersebut sebelum melanjutkan ke tahap berikutnya.
8. Simpan identitas batch, log error, file sumber, dan file hasil pada lokasi yang disepakati tim.

### Trial operasional paralel Pandu/Panduraya Petshop dan Klinik

Trial ini adalah input transaksi paralel, bukan batch import. Dilaksanakan pada tanggal 5 **[bulan dan tahun menunggu konfirmasi]**, setelah nama cabang resmi Pandu atau Panduraya beserta kodenya dikonfirmasi.

1. Catat baseline transaksi, penjualan, pergerakan stok, dan kunjungan klinik pada Accurate serta VetOS sebelum trial dimulai.
2. Untuk transaksi yang sama selama trial, masukkan data pada Accurate dan VetOS dengan referensi transaksi yang sama atau saling ditautkan di log pembanding.
3. Bandingkan jumlah transaksi, kode barang, kuantitas, harga, diskon, total, pergerakan stok, pasien, dan kunjungan klinik.
4. Catat setiap selisih sebagai mismatch; jangan menyamakan angka dengan edit manual sebelum penyebab disetujui.
5. Aldi mengontrol dari Sukabumi melalui laporan tertulis. Short call sekitar pukul 17.00 hanya dilakukan bila dibutuhkan.
6. Kirim stok opname setelah proses operasional trial selesai, lalu bandingkan dengan saldo VetOS sebelum hasil stok dinyatakan final.

### Workstream HRIS terpisah

Uji karyawan, absensi, insentif, dan payroll tetap berjalan sebagai workstream HRIS tersendiri. Batch persediaan, harga cabang, serta rekam medis tidak boleh membuat, mengubah, atau memakai data HRIS.

## 8. Verifikasi Pasca Import

| Pemeriksaan | Hasil yang harus dibuktikan |
| --- | --- |
| Hitung baris | Jumlah berhasil, gagal, dilewati, dibuat, dan diperbarui sesuai angka kontrol. |
| Sampel master | Ambil sampel acak barang baru dan barang lama; kode, nama, dan satuan cocok dengan sumber. |
| Harga cabang | Ambil sampel minimal 10 kombinasi kode barang dan cabang; master tidak ganda, cabang benar, dan hanya satu harga aktif untuk kombinasi serta periode yang sama. |
| Saldo Panduraya | Sampel saldo barang cocok dengan file; total hanya tercatat pada Panduraya. |
| Cabang lain | Cabang selain Panduraya bernilai nol atau tidak berubah dari angka sebelum import. |
| Rekam medis multi-tab | Manifest seluruh tab wajib cocok; sampel rekam medis terhubung ke pasien, kunjungan bila digunakan, dan cabang yang benar; tidak ada pasien tidak ditemukan. |
| Diagnosis kosong | Jumlah `DIAGNOSIS_KOSONG` sesuai exception list dan memiliki keputusan tertulis untuk setiap baris. |
| Trial paralel | Transaksi Accurate dan VetOS dibandingkan satu per satu sesuai log; setiap mismatch punya status dan pemilik tindak lanjut. |
| Stok opname | Stok opname setelah trial diterima dan dibandingkan dengan saldo VetOS sebelum hasil final. |
| Audit batch | Identitas batch, operator, waktu import, dan sumber file dapat ditelusuri bila mekanisme tersedia. |
| Batas HRIS | Pastikan tidak ada data karyawan, gaji, payroll, atau HRIS yang dibuat atau berubah. |

Minimal gunakan sampel 10 baris atau 10 persen dari tiap jenis data, mana yang lebih besar, kecuali jumlah data kurang dari 10 maka periksa seluruhnya.

## 9. Rollback dan Penghentian

Hentikan proses segera bila terjadi mismatch cabang, duplikat massal, stok negatif, pasien tidak ditemukan dalam jumlah material, atau jumlah hasil tidak sesuai angka kontrol.

1. Jangan lanjut ke tahap berikutnya.
2. Simpan file sumber, hasil dry-run, waktu kejadian, identitas batch, dan error report.
3. Jangan menghapus baris satu per satu secara manual.
4. Gunakan restore snapshot atau hapus berdasarkan import ID **hanya** bila mekanisme tersebut benar-benar tersedia dan sudah disetujui.
5. Keputusan rollback dibuat oleh pemegang keputusan bersama pemilik data; Aldi memberi kontrol dan bukti pengecekan dari Sukabumi.
6. Setelah rollback, ulangi hitung kontrol dan catat hasilnya sebelum uji berikutnya.

Jika tidak ada snapshot atau mekanisme hapus per batch, jangan commit import.

## 10. Troubleshooting

| Masalah | Tindakan awal | Keputusan lanjut |
| --- | --- | --- |
| Cabang mismatch | Tahan baris, cek mapping Panduraya dan kode cabang sumber. | Lanjut hanya setelah pemilik data menyetujui mapping. |
| Kode barang duplikat | Kelompokkan semua baris dengan kode sama, jangan pilih salah satu secara sepihak. | Pemilik data menentukan data benar atau aturan pembaruan. |
| Harga cabang duplikat | Tahan kombinasi kode barang, cabang, serta periode atau status aktif yang muncul lebih dari sekali. | Pemilik data memutuskan satu harga yang berlaku; jangan membuat master barang baru. |
| Tanggal tidak valid | Kembalikan ke format `YYYY-MM-DD`; cek tanggal kosong atau salah urutan. | Import ulang hanya setelah validasi bersih. |
| Stok negatif | Tahan baris; cek apakah salah tanda, salah satuan, atau bukan saldo awal. | Jangan import sebagai saldo awal tanpa keputusan tertulis. |
| Pasien tidak ditemukan | Tahan rekam medis; cek kode pasien dan persetujuan cabang. | Jangan membuat pasien baru dari proses ini tanpa scope baru. |
| Tab Google Sheet tidak ditemukan atau header berubah | Tahan seluruh tahap rekam medis; perbarui manifest dari sumber yang disetujui. | Dry-run rekam medis diulang setelah semua tab wajib dan key join terbukti. |
| Diagnosis kosong | Tandai `DIAGNOSIS_KOSONG`; jangan mengisi dari perkiraan atau catatan lain. | Pemilik data memilih tahan baris atau mengizinkan nilai tetap kosong bila target mendukung. |
| Hasil Accurate dan VetOS berbeda saat trial | Tahan kesimpulan trial, catat referensi transaksi, lalu cek sumber dan waktu input. | Perbaiki hanya setelah penyebab dan sistem sumber kebenaran disetujui. |
| Permission denied | Catat akun, target, waktu, dan jenis import; jangan memakai akun orang lain. | Pemegang akses memperbaiki hak akun lalu dry-run diulang. |

## 11. Checklist Serah Terima

- [ ] Empat tahap import selesai atau status tertahan dicatat.
- [ ] Angka kontrol sebelum dan sesudah import sudah dibandingkan.
- [ ] Sampel harga per cabang membuktikan satu master barang tanpa duplikasi dan satu harga aktif per kombinasi yang diuji.
- [ ] Bukti saldo hanya Panduraya tersedia.
- [ ] Bukti cabang lain nol atau tidak berubah tersedia.
- [ ] Manifest tab rekam medis, hasil join, serta keputusan diagnosis kosong sudah disimpan.
- [ ] Sampel rekam medis sudah diperiksa terhadap pasien, kunjungan bila digunakan, dan cabang.
- [ ] Trial paralel Accurate dan VetOS selesai atau mismatch log sudah memiliki status.
- [ ] Stok opname setelah trial sudah dikirim dan dibandingkan dengan saldo VetOS.
- [ ] Error report dan identitas batch disimpan.
- [ ] Status HRIS, gaji, payroll, dan pembayaran dipastikan tidak berubah.
- [ ] Aldi sudah menerima ringkasan tertulis.
- [ ] Keputusan selesai, ulangi, atau rollback ditulis oleh pemegang keputusan.

## 12. Template Laporan WhatsApp

Salin format berikut setelah tiap tahap atau saat uji dihentikan.

```text
UJI IMPORT PANDURAYA — [tanggal dan waktu]
Target: [nama target demo/cloud]
Operator: [nama]
Kontrol jarak jauh: Aldi, Sukabumi

Tahap: [master barang / harga cabang / saldo Panduraya / rekam medis multi-tab / trial paralel]
File sumber: [nama file atau link yang disetujui]
Jumlah sumber: [angka]
Berhasil: [angka]
Diperbarui: [angka]
Dilewati/duplikat: [angka]
Error: [angka]

Kontrol cabang:
- Nama dan kode cabang resmi: [isi]
- Harga cabang: [sesuai / ada duplikat atau error]
- Saldo Panduraya: [sesuai / tidak sesuai]
- Cabang lain: [nol atau tidak berubah / perlu cek]

Kontrol rekam medis: [tab wajib lengkap / hasil join / pasien dan cabang sesuai / ada daftar error]
Diagnosis kosong: [jumlah dan keputusan]
Trial Accurate vs VetOS: [belum mulai / sesuai / jumlah mismatch dan status]
Stok opname setelah trial: [sudah dikirim dan sesuai / menunggu]
Kontrol HRIS/payroll: [tidak tersentuh]
Identitas batch/log: [isi bila tersedia]

Keputusan: [lanjut tahap berikutnya / tahan untuk perbaikan / rollback]
Disetujui oleh: [nama]
Short call Aldi: [tidak perlu / jadwal bila diperlukan]
```
