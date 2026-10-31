# Usulan pemetaan COA lama → COA baru (draf, untuk dicek finance)

Sumber: berkas COA dari Reza 31 Okt 2026 (205 baris, kode 6 digit). Belum diterapkan ke sistem.

## A. Masalah di berkas yang harus dibereskan dulu

| # | Masalah | Contoh | Usulan |
|---|---|---|---|
| 1 | Kode dobel — satu kode untuk banyak akun | 110001 dipakai 22 akun kas; 120001 dipakai 6 rekening BCA | Beri nomor urut unik: kas 110001–110022, bank 120001–120006 |
| 2 | Pola digit beda dengan sistem | Berkas: 1=Kas/Aset lancar, 2=Aset tetap, 3=Liabilitas, 4=Ekuitas, 5=Pendapatan, 6=HPP, 7=Beban, 8=Di luar operasional. Sistem: 1=Aset, 2=Liabilitas, 3=Ekuitas, 4=Pendapatan, 5=Beban | Sistem diubah mengikuti pola berkas (pekerjaan teknis) |
| 3 | Saldo normal janggal | 200011 Aset Tetap Dalam Pembangunan = Kredit; 530000–530002 Pendapatan Lainnya = Debit | 200011 → Debit; 5300xx → Kredit |
| 4 | Akun ganda isi sama | Pendapatan Bunga Bank/Deposito ada di 530001/530002 **dan** 810001/810002 | Pilih satu kelompok |
| 5 | Akun yang dipakai sistem tidak ada padanannya | Hutang belum difakturkan (barang diterima, faktur belum), Piutang marketplace, Beban komisi marketplace, Beban perawatan aset, Pendapatan kelebihan kas | Finance tentukan kode baru atau padanan |

## B. Akun yang dipakai otomatis oleh sistem → kode baru

| Lama | Dipakai untuk | Usulan baru | Catatan |
|---|---|---|---|
| 1101 | Kas bawaan & selisih kas tutup shift | 110001–110022 per toko | Perlu pasangan kas ↔ cabang |
| 1102 | Bank bawaan non-tunai | 120001–120006 | Perlu pasangan metode bayar ↔ rekening |
| 1105 | PPN Masukan | 182004 | |
| 1201 | Piutang usaha | 150001 | |
| 1202 | Piutang marketplace | 130001–130008? | Ecommerce di berkas berupa akun per toko online — konfirmasi |
| 1203 | Piutang karyawan (kasbon) | 182001 | |
| 1301 | Persediaan | 170001 | |
| 1303 | Uang muka pembelian | 160001 | |
| 1501 | Aset tetap | 200001–200010 per kategori | Pasangan kategori aset |
| 1509 | Akumulasi penyusutan | 200012–200016 per kategori | |
| 2101 | Hutang usaha | 311001 | |
| 2102 | Hutang belum difakturkan | **tidak ada** | Perlu kode baru (mis. 311003) |
| 2103 | Uang muka penjualan | 314001 | |
| 2201 | PPN Keluaran | 312005 | |
| 3101 | Modal / saldo awal | 410001 | |
| 3201 | Laba ditahan (tutup buku) | 420001 | |
| 4101 | Penjualan produk | 510001 | |
| 4102 | Diskon penjualan | 520002 | |
| 4201 | Jasa klinik | 510002 | |
| 4301 | Bunga bank | 530001 atau 810001 | Lihat A.4 |
| 4302 | Laba jual aset | 810003 | |
| 4303 | Kelebihan kas tutup shift | **tidak ada** (810004?) | Konfirmasi |
| 5101 | HPP | 600001 | |
| 5201 | Gaji | 710001 | |
| 5301 | Listrik & air | 720002 / 720003 | Di berkas dipisah — pilih atau pisah kategori |
| 5302 | Perlengkapan | 740001 | |
| 5303 | Transportasi | 740003 | |
| 5304 | Perawatan aset | **tidak ada** (720007/740007?) | Konfirmasi |
| 5305 | Komisi marketplace | **tidak ada** | Perlu kode baru |
| 5401 | Operasional lain | 760003 | |
| 5501 | Admin bank | 740010 | |
| 5601 | Penyusutan | 750001–750004 per kategori | |
| 5602 | Rugi jual aset | 820004 | |
| 5901 | Selisih kas | 760002 | |
| 5902 | Selisih persediaan | 720010 | |

## C. Dampak teknis (untuk perencanaan)

- Kode akun ditulis langsung di ±60 berkas fungsi database dan ±40 berkas aplikasi. Perubahan aman = semua
  dipindah ke satu tabel pemetaan, baru kodenya diganti.
- Riwayat jurnal tidak hilang bila akun lama **diganti kodenya** (jurnal menempel ke akun, bukan ke kode).
- Laporan yang mengelompokkan berdasarkan digit pertama kode harus diubah ke pola baru.
- Butuh rilis terjadwal + migrasi database, sama seperti PR #314.
