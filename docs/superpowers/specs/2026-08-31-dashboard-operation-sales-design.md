# Desain Dashboard Operation & Sales

**Tanggal:** 31 Agustus 2026
**Status:** Disetujui untuk perencanaan implementasi
**Ruang lingkup:** dashboard pusat, KPI lintas-modul, ranking, dan drill-down

## 1. Latar Belakang

VetOS sudah memiliki dashboard per sudut pandang dan laporan terpisah untuk penjualan per cabang, penjual, pelanggan, retensi, promo, pembelian, klinik, stok minimum, kartu stok, dan kedaluwarsa. Permintaan client bukan alasan membangun ulang seluruh laporan. Gap utamanya adalah satu cockpit Operation & Sales dengan definisi angka yang konsisten dan tautan ke detail existing.

## 2. Sasaran

1. Menyediakan satu halaman `/laporan/operasional-penjualan`.
2. Menampilkan KPI Sales, Branch Performance, Customer, Stock & Operation, Purchasing, serta Clinic & Service.
3. Memakai perhitungan bersama agar angka dashboard dan laporan detail tidak berbeda.
4. Menyediakan filter periode, cabang, dan kanal serta drill-down.

## 3. Prinsip Arsitektur

- Laporan existing tetap menjadi halaman detail.
- Layer query/metric server menjadi satu sumber definisi KPI.
- Server membaca data sesuai RLS user; client tidak menerima data cabang terlarang.
- Implementasi awal memakai query terindeks dan agregasi server. Materialized view atau data warehouse belum dibutuhkan.
- Metrik yang belum punya data dasar menampilkan `Data belum tersedia`, bukan nol.

## 4. Filter dan Navigasi

Filter utama:

- periode: hari ini, MTD, rentang custom;
- cabang: semua cabang yang boleh diakses atau satu cabang;
- kanal: semua, POS, online, reseller, klinik;
- pembanding: periode sebelumnya dengan panjang setara.

Setiap kartu atau baris ranking mengarah ke laporan detail dengan filter yang sama jika halaman tujuan mendukungnya.

## 5. Definisi KPI Sales

- **Sales Today/MTD:** penjualan neto pada periode, tidak termasuk transaksi batal/void.
- **Sales vs Target:** realisasi dibagi target aktif. Target company-wide diprioritaskan bila ada; jika tidak ada, semua target cabang pada periode dijumlahkan tanpa mencampur target pegawai atau kategori.
- **Growth:** perubahan terhadap periode sebelumnya yang panjangnya sama. MTD dibandingkan tanggal 1 sampai tanggal setara bulan sebelumnya.
- **Transaction:** jumlah transaksi valid, bukan jumlah baris item.
- **ATV:** sales neto dibagi transaksi.
- **UPT:** total qty item dibagi transaksi.
- **Gross Margin:** sales neto dikurangi HPP FIFO transaksi.
- **Sales Split:** Produk, Jasa/Grooming, dan Klinik; kanal tetap tersedia sebagai dimensi terpisah.

## 6. Branch Performance

Ranking cabang menampilkan sales, achievement target, growth, transaksi, ATV, gross margin, dan pelanggan unik. Semua kolom memakai periode serta kanal yang sama. Cabang tanpa target menampilkan `Target belum diisi`, bukan achievement 0%.

## 7. Customer

- Pelanggan baru: transaksi pertama berada dalam periode.
- Repeat: minimal dua transaksi sepanjang histori dan bertransaksi pada periode.
- Aktif: bertransaksi dalam 90 hari terakhir.
- Dorman: pernah bertransaksi, tetapi tidak bertransaksi melewati ambang dorman.
- Spending: total penjualan neto per pelanggan.
- Frequency: jumlah transaksi dibagi masa aktif pelanggan.
- Jenis hewan: profil `pets.species` pelanggan; satu pelanggan dapat masuk lebih dari satu segmen.

Ambang dorman berasal dari pengaturan, default 90 hari.

## 8. Stock & Purchasing

- Nilai stok memakai sisa layer FIFO.
- Fast-moving memakai ranking qty terjual 90 hari; default kelompok 20% teratas.
- Slow-moving adalah stok positif tanpa penjualan selama ambang yang dipilih, default 90 hari.
- Near expired dan expired memakai monitor layer existing.
- Transfer log memakai mutasi stok antar-gudang.
- Purchase MTD memakai faktur pembelian valid.
- Outstanding PO memakai sisa qty pesanan yang belum diterima.
- Stock coverage adalah stok tersedia dibagi rata-rata pemakaian harian 90 hari.
- Low stock dan suggested purchase memakai batas minimum, satuan beli, minimum beli, dan pemasok existing.
- Purchase vs Sales membandingkan pembelian neto dan sales neto dalam periode.
- Supplier Performance awal menampilkan nilai pembelian, fill rate, retur, dan rata-rata lead time dari tanggal PO ke penerimaan. Ketepatan terhadap janji kirim belum dihitung karena tanggal janji belum tersedia.
- Aging hutang memakai jatuh tempo faktur dan pembayaran existing.

## 9. Clinic & Service

Dashboard menampilkan booked/walk-in/no-show, revenue per dokter/groomer, follow-up compliance, waktu tunggu, durasi layanan, okupansi rawat inap, dan referral. KPI yang memerlukan timestamp atau outcome baru baru aktif setelah desain Data Operasional selesai diterapkan.

## 10. Error Handling dan Performa

- Satu blok gagal tidak boleh memalsukan seluruh dashboard; blok menampilkan pesan gagal dan correlation ID server.
- Query memakai batas periode dan cabang sejak awal.
- Data detail besar tidak dikirim ke browser; dashboard menerima agregat.
- Target performa: halaman rentang MTD satu cabang selesai dirender dalam lima detik pada data produksi normal.

## 11. Kriteria Penerimaan

- Seluruh blok dapat difilter periode dan cabang.
- Angka yang sudah punya laporan existing cocok dengan halaman detail.
- Void/batal tidak terhitung.
- Margin cocok dengan HPP FIFO transaksi.
- User cabang tidak dapat membaca agregat cabang lain.
- KPI tanpa data dasar tidak tampil sebagai nol palsu.
- Drill-down mempertahankan konteks filter sejauh didukung halaman tujuan.
