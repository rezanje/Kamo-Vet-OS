# Notulen Meeting ERP — 14 Agustus 2026

**Durasi** 84 menit · **Sumber** rekaman Zoom "Meeting Erp" 09.04 WIB
**Hadir dari Kamo Group** Pak Aldi, Pak Faisal, Bu Nisa, Pak Andri, dok RV
**Target yang disepakati** aplikasi jalan **Oktober 2026** (ulang tahun Kamo Group)

Isi meeting: demo Stok Opname dari kasir, lalu putaran masukan per divisi.
Total **36 permintaan** — 8 di antaranya mengubah rancangan yang sudah jalan.

---

## 1. Keputusan yang mengubah rancangan

Delapan hal ini bukan sekadar tambahan fitur — mengubah cara kerja yang sudah dibangun.

| # | Keputusan | Kenapa |
|---|---|---|
| K1 | **Selisih stok opname dijurnal pakai HARGA JUAL, bukan modal (HPP)** — dikonversi jadi faktur penjualan dengan nomor & kategori khusus "selisih stok", flat harga normal tanpa promo | Minus stok ditanggung kepala toko, jadi nilainya harus harga jual. Sekarang sistem masih pakai modal. |
| K2 | **Khusus klinik tetap pakai modal (HPP)** | Banyak obat harga jualnya nol karena cuma bahan racikan. Ditentukan dari setting unit bisnis (klinik vs petshop), logikanya seragam tinggal pilih. |
| K3 | **Anak toko tidak boleh melihat angka stok sistem maupun selisih saat menghitung** — cuma isi angka fisik. Selisih baru muncul setelah simpan | Anti-kecurangan. Kata Pak Aldi: makin tahu data stok & omzet, makin gampang diakali. |
| K4 | **Daftar barang yang dihitung digenerate otomatis: 20 barang terlaris + 10 barang acak = 30** | Barang cepat laku paling rawan selisih; yang acak menangkap barang hilang yang tidak laku. 30 dari ~300 SKU per toko dianggap porsi pas. |
| K5 | **Stok opname seluruh gudang ikut pindah ke layar kasir** — versi backoffice tidak perlu lagi | Satu pintu. Pak Faisal pun akan menghitung lewat POS, bukan back panel. |
| K6 | **Hitung dikunci per barang + tersimpan otomatis tiap dikunci**, ada tombol buka kunci | Supaya angka yang sudah dihitung tidak berubah kalau barangnya keburu terjual, dan tidak hilang kalau mati lampu. |
| K7 | **Ada tombol muat ulang stok sistem** supaya opname bisa jalan sambil toko tetap jualan | Tidak perlu tutup toko; tidak perlu muat ulang tiap barang, cukup kalau ada yang laku. |
| K8 | **Dua pasang menu kembar dihapus** — "Transaksi Berulang" vs "Jurnal Berulang" (sisakan di Perusahaan), "Kas Keluar/Petty Cash" vs "Pencatatan Beban" (sisakan Petty Cash) | Bu Nisa: fungsinya sama, bikin bingung. |

---

## 2. Daftar pekerjaan

Prioritas: **P1** dibahas paling panjang & menghambat operasional · **P2** perbaikan alur yang sudah ada · **P3** pengembangan berikutnya.

### Stok Opname (bahasan utama)

| # | Pekerjaan | Diminta | Prioritas |
|---|---|---|---|
| 1 | Generate daftar hitung otomatis: 20 terlaris + 10 acak | Pak Faisal, Pak Aldi | P1 |
| 2 | Sembunyikan kolom stok sistem & selisih dari petugas hitung | Pak Aldi | P1 |
| 3 | Kunci per barang + simpan otomatis tiap kunci; bisa dibuka lagi (warna tombol dibedakan biar tidak salah pencet) | Pak Faisal | P1 |
| 4 | Tombol muat ulang stok sistem saat opname berjalan | Pak Faisal | P1 |
| 5 | Tombol simpan semua di akhir → baru keluar laporan & jurnal | Pak Faisal | P1 |
| 6 | Jurnal selisih pakai harga jual → jadi faktur penjualan kategori khusus | Pak Aldi | P1 |
| 7 | Khusus klinik pakai modal (HPP), ditentukan dari setting unit bisnis | Pak Aldi, dok RV | P1 |
| 8 | Opname seluruh gudang dipindah ke layar kasir | Pak Faisal, Pak Aldi | P1 |
| 9 | Filter & urutkan di layar opname seluruh gudang: nama barang, kategori, harga jual, urut selisih terbesar | Pak Faisal | P2 |
| 10 | Hak akses: petugas toko tidak bisa mengintip angka stok sistem | Pak Faisal | P1 |

Catatan SOP dari klien: kepala toko menghitung **sekali sehari**; kalau hasilnya minus, kantor pusat yang menegur dan memutuskan — dicari besoknya atau dikoreksi dari sistem.

### Persediaan & pembelian

| # | Pekerjaan | Diminta | Prioritas |
|---|---|---|---|
| 11 | Kartu stok dilengkapi — retur belum mengurangi penjualan | Pak Andri | P1 |
| 12 | Satu barang bisa punya beberapa tanggal kedaluwarsa: saat terima barang, isi jumlah per tanggal | Pak Faisal | P2 |
| 13 | Penjualan otomatis mengambil stok yang kedaluwarsanya paling dekat | Pak Faisal | P2 |
| 14 | Data barang: tingkatan jumlah + harga jual bertingkat (seperti Accurate) | Bu Nisa | P2 |
| 15 | Pesanan penjualan belum bisa pilih satuan | Bu Nisa | P2 |
| 16 | Pembelian langsung tanpa PO: tambah lampiran surat jalan | Bu Nisa | P2 |
| 17 | Struk POS toko: tampilkan satuan, bukan cuma jumlah | Bu Nisa | P2 |
| 18 | Produksi own brand (bahan baku → barang jadi), terpisah dari resep obat klinik | Reza | P3 |

### Klinik

| # | Pekerjaan | Diminta | Prioritas |
|---|---|---|---|
| 19 | Pembayaran rombongan disamakan dengan pembayaran biasa (total, metode, poin, voucher, promo); tombol "lunasi semua" dihapus | Pak Aldi | P2 |
| 20 | Rincian tagihan: tambah diskon persen per item | Pak Aldi | P2 |
| 21 | Tambah obat di rekam medis belum tersambung master barang — sudah diperbaiki, belum dinaikkan | Pak Aldi | P1 |
| 22 | Antrian: filter tanggal (bisa mundur) + filter cabang | Pak Andri | P2 |
| 23 | Nomor antrian pakai kode awalan per cabang | Pak Andri | P2 |
| 24 | Rawat inap: total hari otomatis masuk tagihan saat pasien pulang | Pak Aldi | P2 |
| 25 | Formulir persetujuan diikat ke jenis tindakan tertentu (mis. operasi) — tidak bisa lanjut ke pembayaran sebelum ditandatangani; isi klausul disiapkan tim klinik | Pak Aldi, dok RV | P2 |
| 26 | Promo, voucher, dan poin harus muncul di klinik persis seperti di petshop | Pak Aldi | P2 |

### CRM & promo

| # | Pekerjaan | Diminta | Prioritas |
|---|---|---|---|
| 27 | Voucher bisa diikat ke pelanggan tertentu atau golongan pelanggan, bukan cuma cabang | Pak Aldi | P2 |
| 28 | Pengingat aktivasi voucher muncul di layar admin klinik | Pak Aldi | P3 |
| 29 | Loyalty: belanja dapat poin + tutup poin akhir tahun | Pak Andri | P3 |

Latar belakangnya: Pak Aldi mau menggiring pelanggan klinik ke petshop. Pelanggan yang datang ke klinik diberi voucher yang **hanya berlaku hari itu**, menempel di data orangnya, jadi tidak bisa ditiru seperti voucher kertas.

### Keuangan & backoffice

| # | Pekerjaan | Diminta | Prioritas |
|---|---|---|---|
| 30 | Transaksi berulang: tampilkan sudah berjalan berapa kali + rincian tiap transaksi sampai nomor jurnalnya | Bu Nisa | P2 |
| 31 | Hapus dua pasang menu kembar (lihat K8) | Bu Nisa | P2 |
| 32 | Pencatatan beban: filter kategori & cabang, pencarian, dan pengurutan | Bu Nisa | P2 |
| 33 | Jurnal umum: filter + kolom cabang | Bu Nisa | P2 |
| 34 | Rincian hutang bisa diklik ke pembelian — ke PO maupun ke fakturnya | Bu Nisa | P2 |
| 35 | Semua nomor dokumen bisa diklik di mana pun (laporan, dashboard), seperti Accurate | Bu Nisa | P2 |
| 36 | Faktur penjualan backoffice: kode berbeda untuk klinik dan petshop | Bu Nisa | P2 |

### Dashboard, peringatan, laporan

| # | Pekerjaan | Diminta | Prioritas |
|---|---|---|---|
| 37 | Dashboard menyesuaikan peran — operasional (mis. grooming hari ini berapa), marketing fokus promo; sekarang isinya condong ke keuangan | Pak Andri | P3 |
| 38 | Peringatan saat stok kosong tapi tetap diinput | Pak Andri | P3 |
| 39 | Peringatan saat diskon membuat harga di bawah modal — sifatnya mengingatkan, boleh dilanjut | Pak Andri | P3 |
| 40 | Laporan jumlah transaksi per cabang + rata-rata belanja per struk per cabang | Bu Nisa, Pak Aldi | P3 |

Klien akan **mengirim daftar laporan yang benar-benar dipakai**. Catatan mereka: di Accurate hanya sekitar 30% laporan yang terpakai, dan sebagian masih harus diolah ulang di Excel.

### WhatsApp & AI (arah jangka menengah)

| # | Pekerjaan | Diminta | Prioritas |
|---|---|---|---|
| 41 | Modul WhatsApp otomatis untuk CRM — ini yang didahulukan | Pak Aldi | P3 |
| 42 | Agen AI WhatsApp: baca data pelanggan, jawab chat, follow-up sampai closing, dengan pembatasan kirim supaya nomor tidak diblokir | Pak Aldi | P3 |

Sudah pernah diuji coba dan jalan. Biaya bulanannya dinilai sepadan — dianggap setara beberapa tenaga kerja.

---

## 3. Di luar aplikasi — rencana perangkat klien

Bukan pekerjaan kita, tapi memengaruhi rancangan layar:

- **Petshop** pindah ke komputer all-in-one, **dua layar saling berhadapan**. Layar pelanggan menampilkan barang yang sedang diinput dan poin miliknya. Tujuannya menekan barang yang lolos tidak terinput.
- **Klinik** tetap komputer di depan, tablet untuk dokter (rekam medis + tanda tangan persetujuan), **tambah dua perangkat**: rawat inap dan apotek.
- Tanda tangan persetujuan dilakukan di tablet dokter, bukan di komputer.
- Sesi POS tidak boleh keluar sendiri tiap 60 menit — harus bertahan selama shift belum ditutup. **Sudah aman di sistem sekarang.**

---

## 4. Yang perlu ditagih ke klien

| Yang ditunggu | Dari |
|---|---|
| Daftar laporan yang benar-benar dipakai (mereka akan rinci sendiri) | Bu Nisa, Pak Daru |
| Daftar tindakan klinik yang wajib pakai formulir persetujuan + isi klausulnya | tim klinik / dok RV |
| Keputusan rawat inap: total hari otomatis masuk tagihan — Pak Aldi mau tanya dokternya dulu | Pak Aldi |

---

## 5. Catatan cara kerja

Satu hal yang muncul di meeting: **database dipakai bersama**, jadi kalau klien sedang mengetes sementara pengembangan jalan, datanya bisa terlihat aneh (kasus antrian klinik yang angkanya tidak cocok). Perlu disepakati jam ngoprek, atau dipisah data uji coba sendiri.
