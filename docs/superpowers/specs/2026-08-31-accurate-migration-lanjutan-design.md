# Desain Migrasi Accurate Lanjutan

**Tanggal:** 31 Agustus 2026
**Status:** Disetujui untuk perencanaan implementasi
**Ruang lingkup:** kelengkapan data Barang & Jasa, saldo awal per gudang, Grup, dan Varian

## 1. Latar Belakang

Fase sebelumnya sudah menambahkan master Grup dan importer XLSX Accurate untuk kategori, barang, satuan, harga, merek, pemasok, serta status aktif. Importer sengaja tidak menulis stok, melewati Grup karena export tidak membawa komponen, dan melewati Varian.

File `daftar-barang (1).xlsx` yang diperiksa hanya memuat rentang 1–1.000 dari total 4.178 barang. Komposisinya 638 Persediaan, 321 Grup, 29 Jasa, 12 Non-Persediaan, dan 0 Varian. Seluruh kolom saldo awal, cabang, gudang, kuantitas, nilai satuan, dan tanggal saldo kosong. Karena itu stok dan rincian Grup tidak boleh ditebak dari file tersebut.

## 2. Sasaran

1. Mengimpor seluruh master dari lima rentang export Accurate tanpa duplikasi.
2. Mengimpor saldo awal per gudang secara aman ke stok, FIFO, dan kartu stok.
3. Mengimpor master Grup beserta komponennya dari sumber tambahan yang eksplisit.
4. Mendukung keluarga Varian dengan setiap varian tetap menjadi SKU mandiri.
5. Menyediakan preview, audit batch, proteksi impor ganda, dan rekonsiliasi.

## 3. Bukan Sasaran

- Menebak stok, HPP, batch, tanggal kedaluwarsa, atau komponen Grup dari nama barang.
- Mengambil 321 rincian Grup satu per satu melalui scraping browser sebagai alur produksi.
- Menggabungkan stok atau harga antar-SKU Varian.
- Menghapus histori stok setelah batch diposting.
- Mengimpor jurnal, akun GL, pajak, atau transaksi historis Accurate.

## 4. Sumber Data Wajib

### 4.1 Master Barang & Jasa

Admin mengunggah lima export: 1–1.000, 1.001–2.000, 2.001–3.000, 3.001–4.000, dan 4.001–4.178. Sistem menerima satu atau beberapa file dalam satu batch, lalu menggabungkan dan memeriksa kode kembar lintas-file.

### 4.2 Saldo Awal

Saldo awal memakai file terpisah dengan kolom wajib:

- kode barang;
- cabang dan gudang;
- kuantitas dalam satuan yang disebutkan;
- HPP per satuan dasar;
- tanggal saldo;
- batch dan tanggal kedaluwarsa bila barang melacak kedaluwarsa.

Baris tanpa HPP ditolak. Sistem tidak memakai harga beli master sebagai HPP pengganti.

### 4.3 Rincian Grup

Rincian Grup memakai template tambahan: kode Grup, kode komponen, kuantitas, satuan, dan urutan. Semua kode harus sudah ada pada master atau berada dalam batch master yang sama. Grup tanpa komponen tetap nonaktif dan tidak dapat dijual.

### 4.4 Varian

Implementasi parser Varian membutuhkan satu contoh export Accurate yang benar-benar memuat baris Varian. Sampai contoh tersedia, keluarga Varian dapat dibuat manual tetapi importer Varian tidak dinyatakan selesai.

## 5. Model Data dan Audit

`import_runs` menyimpan jenis impor, nama dan hash file, cabang/gudang bila relevan, tanggal saldo, status, jumlah baris per hasil, pembuat, waktu preview, dan waktu posting. Kombinasi jenis + hash mencegah file sama diposting dua kali.

`import_run_rows` menyimpan nomor baris, kode sumber, status, alasan, dan payload terstruktur untuk audit. Data ini tidak menjadi sumber kebenaran operasional setelah posting.

Keluarga Varian memakai master ringan dan relasi anggota. Setiap anggota menunjuk satu `items` aktif, memiliki label Varian dan urutan, tetapi harga, satuan, stok, HPP, barcode, serta histori tetap milik SKU tersebut.

## 6. Alur Master

1. Upload hanya membaca file.
2. Preview mengelompokkan Baru, Update, Sama, Dilewati, dan Ditolak.
3. Preview menampilkan master pendukung baru serta konflik lintas-file.
4. Konfirmasi menjalankan satu operasi server untuk batch tersebut.
5. Kode barang tetap menjadi identitas upsert.
6. Barang Grup diimpor sebagai `Grup`, tetapi `is_active=false` sampai rincian valid tersedia.
7. Barang yang sudah punya stok atau histori hanya diperbarui pada field master yang dipetakan.

## 7. Alur Saldo Awal

Posting saldo awal dijalankan atomik per batch dan gudang. Untuk setiap baris valid, sistem:

1. mengonversi kuantitas ke satuan dasar;
2. menambah `stock`;
3. membuat `stock_layers` dengan HPP, batch, dan kedaluwarsa;
4. membuat `stock_moves` bertipe IN dengan sumber `saldo-awal-accurate` dan referensi batch;
5. menyimpan hasil rekonsiliasi per barang dan gudang.

Jika satu baris gagal, seluruh posting batch dibatalkan. Setelah posting, batch tidak dapat dihapus atau diposting ulang. Koreksi dilakukan lewat Penyesuaian Persediaan agar jejak audit tetap utuh.

## 8. Validasi

- Semua kode unik lintas-file.
- Gudang harus aktif dan berada pada cabang yang dipilih.
- Hanya Persediaan boleh menerima saldo.
- Kuantitas dan HPP tidak boleh negatif.
- Satuan harus cocok dengan master dan faktor konversinya.
- Barang yang melacak kedaluwarsa wajib membawa tanggal kedaluwarsa untuk qty positif.
- Grup wajib punya minimal satu komponen non-Grup aktif.
- Komponen diri sendiri, Grup bertingkat, qty nol, dan satuan asing ditolak.
- Satu SKU hanya boleh menjadi anggota satu keluarga Varian.

## 9. Keamanan

Hanya OWNER/ADMIN dapat preview dan posting. Semua tabel baru memakai RLS. Batch stok terikat cabang/gudang dan memakai `user_can_access_branch`. Procedure posting tidak mempercayai branch, faktor satuan, harga, atau tipe barang dari browser; seluruhnya dimuat ulang di server/database.

## 10. Rekonsiliasi dan Kriteria Penerimaan

- Jumlah kode unik hasil lima file sama dengan hasil preview yang disetujui.
- Tidak ada file atau batch yang dapat diposting dua kali.
- Total qty dan nilai stok cocok per barang, gudang, dan keseluruhan terhadap sumber.
- `stock`, total sisa `stock_layers`, dan saldo `stock_moves` cocok.
- Grup tidak aktif tidak muncul di kasir; Grup lengkap dapat dijual memakai aturan Grup existing.
- Varian tampil sebagai keluarga, tetapi transaksi dan stok tetap memakai SKU anak.
- Seluruh kegagalan menampilkan nomor baris dan alasan yang dapat ditindaklanjuti.
