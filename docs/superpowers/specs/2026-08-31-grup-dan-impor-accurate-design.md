# Desain Grup Barang dan Impor Accurate

**Tanggal:** 31 Agustus 2026  
**Status:** Disetujui untuk perencanaan implementasi  
**Ruang lingkup:** Master Barang & Jasa, POS, retur POS, dan impor XLSX Accurate

## 1. Latar Belakang

Client meminta struktur persediaan VetOS mendekati cara kerja Accurate, terutama untuk kategori, satuan dan kuantitas, harga, produk Grup, serta pemindahan data awal. Tujuannya bukan menyalin seluruh Accurate. Tujuannya adalah membuat trial VetOS aman bagi data dan kebiasaan operasional yang sudah berjalan di Accurate.

VetOS sudah memiliki sebagian besar fondasi yang dibutuhkan:

- kategori barang dua tingkat;
- master satuan dan konversi satuan per barang;
- harga jual per satuan;
- harga bertingkat berdasarkan kuantitas;
- kode barang, barcode, merek, pemasok, harga beli, dan stok minimum;
- impor CSV Barang & Jasa;
- stok per gudang dan HPP FIFO.

Gap utama adalah produk virtual bertipe Grup, snapshot rincian Grup pada transaksi, retur Grup, dan pembacaan langsung file XLSX hasil export Accurate.

## 2. Sasaran

Implementasi harus menghasilkan kemampuan berikut:

1. Admin dapat membuat Barang & Jasa bertipe `Grup` dengan satu atau lebih komponen.
2. Grup dapat berisi komponen bertipe Persediaan, Jasa, atau Non-Persediaan.
3. Grup tidak memiliki stok sendiri dan tidak boleh berisi Grup lain.
4. Penjualan Grup memotong stok komponen Persediaan sesuai kuantitas dan satuan yang tersimpan pada master Grup.
5. Harga jual Grup berdiri sendiri dan tidak dihitung dari harga komponen.
6. HPP Grup berasal dari total HPP FIFO komponen Persediaan yang benar-benar keluar.
7. Rincian Grup disalin menjadi snapshot transaksi agar perubahan master setelah penjualan tidak mengubah sejarah.
8. Retur Grup mengembalikan komponen Persediaan berdasarkan snapshot transaksi dan kuantitas Grup yang diretur.
9. Admin dapat mengunggah XLSX export Barang & Jasa Accurate, melihat preview, lalu melakukan tambah atau update master berdasarkan kode barang.
10. Impor tidak mengubah stok, saldo awal, jurnal, akun, atau transaksi historis.

## 3. Bukan Sasaran

Fase ini tidak mencakup:

- clone seluruh fitur atau tampilan Accurate;
- impor saldo awal, akun GL, pajak, nomor seri, atau kolom custom;
- impor rincian Grup dari XLSX, karena export Accurate tidak memuat komponen;
- Grup bertingkat;
- produksi atau manufaktur;
- model parent–variant kompleks;
- perubahan transaksi historis yang sudah ada;
- penyamaan tampilan pixel-per-pixel dengan Accurate.

Jenis `Varian` tersedia di UI Accurate, tetapi data Kamo saat ini berisi nol item Varian, termasuk item nonaktif. Produk rasa dan ukuran dipelihara sebagai SKU terpisah. VetOS mempertahankan pola SKU terpisah pada fase ini.

## 4. Model Data

### 4.1 Jenis Barang

Constraint `items.item_type` ditambah nilai `Grup`. Aturan tiap jenis menjadi:

- `Persediaan`: memiliki stok dan HPP FIFO.
- `Jasa`: tidak memiliki stok.
- `Non-Persediaan`: dapat dijual tanpa pelacakan stok.
- `Grup`: produk virtual dengan harga sendiri dan komponen tetap; tidak memiliki stok sendiri.

### 4.2 Komponen Master Grup

Tabel baru `item_group_components` menyimpan:

- `id`;
- `group_item_id`, referensi ke item Grup;
- `component_item_id`, referensi ke item non-Grup;
- `qty`, kuantitas positif;
- `unit`, snapshot nama satuan yang dipilih;
- `factor`, faktor ke satuan dasar komponen;
- `sort_order`;
- timestamp.

Satuan dan faktor divalidasi ulang di server terhadap `items.unit` dan `item_units`. Klien tidak boleh menentukan faktor sendiri. Satu komponen dapat muncul lebih dari sekali hanya jika satuannya berbeda. Item Grup tidak boleh menjadi komponennya sendiri dan komponen bertipe Grup ditolak.

### 4.3 Snapshot Transaksi

Tabel baru `sale_item_group_components` mengikat rincian ke `sale_items`, bukan hanya ke `sales`. Setiap baris menyimpan:

- `sale_item_id`;
- `component_item_id`;
- nama dan kode komponen saat transaksi;
- qty komponen per satu Grup;
- satuan dan faktor saat transaksi;
- total qty satuan dasar yang keluar untuk baris Grup;
- HPP FIFO komponen untuk baris transaksi.

Snapshot menjadi sumber kebenaran untuk struk, audit, dan retur. Perubahan atau penonaktifan komponen master setelah transaksi tidak mengubah snapshot.

## 5. Master Barang & Jasa

Pilihan jenis barang menambahkan `Grup`. Saat Grup dipilih:

- tab `Rincian Grup` muncul;
- admin memilih komponen aktif non-Grup;
- tiap baris menampilkan kode, nama, kuantitas, dan satuan;
- minimal satu komponen diwajibkan;
- stok minimum, harga beli, pemasok, substitusi, expiry, dan pengaturan produksi disembunyikan atau dipaksa kosong;
- harga jual Grup tetap diisi pada tab Penjualan/Pembelian;
- satuan Grup tetap dipilih dari master satuan, dengan default `pcs`;
- komponen tidak dapat diubah kasir saat transaksi.

Penyimpanan item dan komponennya harus mencegah kondisi setengah tersimpan. Jika komponen gagal disimpan, item Grup baru tidak boleh tertinggal tanpa rincian. Untuk edit, validasi seluruh draft dilakukan sebelum rincian lama diganti.

## 6. Alur POS

### 6.1 Katalog dan Keranjang

Grup tampil di katalog POS sebagai satu produk dengan harga jual master atau harga cabang yang berlaku. Saat Grup masuk keranjang:

- keranjang memiliki satu baris utama Grup;
- komponen ditampilkan sebagai rincian read-only;
- qty komponen mengikuti qty Grup;
- kasir tidak dapat mengubah komponen atau kuantitas komponen;
- diskon, promo, voucher, dan poin diterapkan pada harga Grup, bukan pada komponen.

### 6.2 Validasi Server

Checkout tidak mempercayai rincian dari browser. Server memuat ulang:

- jenis item;
- harga resmi;
- satuan resmi;
- komponen Grup;
- faktor satuan komponen;
- stok komponen pada gudang cabang.

Kebutuhan stok dari semua baris digabung per item dalam satuan dasar. Ini mencakup barang biasa dan komponen dari satu atau lebih Grup. Checkout ditolak sebelum penjualan disimpan jika total kebutuhan melebihi stok tersedia.

### 6.3 Penyimpanan dan HPP

Penjualan menyimpan satu `sale_items` untuk baris Grup. Setelah identitas baris penjualan tersedia, server menyimpan snapshot komponen. Hanya komponen Persediaan yang memanggil `stockOut`. Komponen Jasa dan Non-Persediaan tetap masuk snapshot tanpa mutasi stok.

Total HPP FIFO seluruh komponen Persediaan dicatat sebagai HPP baris Grup dan ikut jurnal HPP penjualan. Harga jual dan pendapatan tetap berasal dari baris Grup.

## 7. Struk dan Retur

Struk menampilkan:

- nama Grup, qty, harga, diskon, dan subtotal sebagai baris utama;
- rincian komponen menjorok di bawah baris utama;
- kode/nama, kuantitas, dan satuan komponen;
- tanpa harga komponen.

Retur menggunakan snapshot transaksi. Jika pelanggan meretur `n` Grup, setiap komponen Persediaan kembali sebanyak `n × qty_per_group × factor`, dibatasi oleh sisa qty Grup yang belum pernah diretur. HPP pengembalian memakai proporsi HPP snapshot baris asal. Komponen Jasa dan Non-Persediaan tidak menghasilkan mutasi stok.

## 8. Impor XLSX Accurate

### 8.1 Sumber dan Mapping

Importer menerima workbook export `Barang & Jasa` Accurate. Mapping jenis:

- `INV` menjadi `Persediaan`;
- `SVC` menjadi `Jasa`;
- `NON` menjadi `Non-Persediaan`;
- nilai yang diawali `GROUP` dilewati dengan alasan bahwa rincian Grup tidak tersedia di file;
- `VARIANT`, jika muncul di file lain, dilewati pada fase ini.

Kolom yang dipetakan:

- kategori;
- kode dan nama;
- jenis;
- satuan #1 sampai #5 dan rasio #2 sampai #5;
- harga jual per satuan;
- UPC/barcode;
- diskon default;
- pemasok utama;
- merek;
- satuan beli, harga beli, minimum beli, dan stok minimum;
- flag tanggal kadaluarsa;
- status nonaktif.

Kolom saldo awal, akun, pajak, dimensi fisik, nomor seri, dan custom field tidak ditulis pada fase ini.

### 8.2 Preview dan Upsert

Upload hanya membaca file dan menghasilkan preview. Setiap baris berstatus:

- `Baru`: kode belum ada;
- `Update`: kode sudah ada dan field master berubah;
- `Sama`: tidak ada perubahan;
- `Dilewati`: jenis tidak didukung, terutama Grup/Varian;
- `Ditolak`: kode, angka, rasio, atau data wajib tidak valid.

Preview juga menampilkan kategori, satuan, merek, dan pemasok baru yang akan dibuat. Master baru hanya dibuat saat user mengonfirmasi proses. Importer Accurate boleh membuat master tersebut karena sumbernya adalah export terstruktur dan user melihat preview. Importer CSV umum tetap memakai kebijakan ketat yang menolak master asing.

Kode barang menjadi identitas upsert. Update hanya menyentuh field master yang dipetakan. Importer tidak menulis tabel stok, layer FIFO, jurnal, saldo awal, atau transaksi.

Baris gagal tidak menggagalkan baris valid lain. Hasil akhir menunjukkan jumlah berhasil, sama, dilewati, dan ditolak beserta alasan per baris.

## 9. Validasi dan Penanganan Kesalahan

- Grup tanpa komponen ditolak.
- Qty komponen nol, negatif, atau bukan angka ditolak.
- Satuan tidak dikenal atau faktor tidak konsisten ditolak.
- Komponen diri sendiri dan komponen Grup ditolak.
- Komponen nonaktif tidak dapat ditambahkan ke master Grup baru.
- Checkout Grup yang master komponennya rusak atau kosong ditolak dengan pesan operasional.
- Kekurangan stok menampilkan nama komponen, kebutuhan, dan stok tersedia.
- Import menolak duplikasi kode di dalam file yang sama.
- Import tidak menghapus barang yang tidak ada di file.
- Barang lama yang diupdate tetap mempertahankan stok dan histori transaksinya.
- Semua validasi harga, faktor, komponen, dan kebutuhan stok dilakukan ulang di server.

## 10. Keamanan dan Hak Akses

- Hanya OWNER/ADMIN dapat membuat atau mengubah master Grup dan menjalankan impor.
- Tabel baru memakai RLS.
- Akses baca mengikuti pola master Barang & Jasa yang sudah ada.
- Akses tulis tidak mengandalkan payload browser; server action memeriksa peran.
- Import tidak menerima nama tabel, nama kolom, query, atau faktor stok dari file sebagai instruksi database.

## 11. Strategi Pengujian

Pengembangan mengikuti TDD. Cakupan minimal:

1. parsing workbook Accurate dan alias header;
2. mapping `INV`, `SVC`, `NON`, `GROUP`, dan nilai tidak dikenal;
3. preview Baru/Update/Sama/Dilewati/Ditolak;
4. multi-satuan, rasio, dan harga #1–#5;
5. import tidak memetakan saldo awal;
6. validasi komponen Grup;
7. ekspansi satu dan beberapa komponen;
8. Grup campuran Persediaan/Jasa/Non-Persediaan;
9. agregasi kebutuhan item yang sama dari Grup dan barang biasa;
10. konversi satuan komponen ke satuan dasar;
11. kalkulasi HPP FIFO komponen;
12. snapshot tidak berubah saat master Grup diedit;
13. struk membaca snapshot;
14. retur proporsional dan batas maksimum retur;
15. regresi checkout barang biasa;
16. lint, typecheck, seluruh unit test, build produksi, dan smoke test POS.

## 12. Kriteria Penerimaan

Fitur diterima jika:

- OWNER/ADMIN dapat membuat dan mengedit Grup dari UI Barang & Jasa;
- Grup tunggal, Grup multi-komponen, dan Grup campuran dapat dijual;
- stok komponen dan jurnal HPP sesuai kuantitas serta faktor satuan;
- struk dan retur memakai snapshot transaksi;
- checkout menolak stok komponen yang kurang sebelum menyimpan penjualan;
- XLSX Accurate dapat dipreview dan di-upsert berdasarkan kode;
- import tidak mengubah stok atau saldo awal;
- data lama dan transaksi barang biasa tetap bekerja;
- pengujian dan build produksi lulus.

