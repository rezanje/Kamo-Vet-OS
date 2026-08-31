# Papan Kerja VetOS — satu-satunya daftar yang dipantau

**Diperbarui** 1 September 2026 · **Target go-live** Oktober 2026 (ulang tahun Kamo Group)

> **Catatan uji 17 Agustus:** blok stok opname (M1–M10) sudah diuji langsung di aplikasi —
> daftar 30 barang otomatis, kunci per barang yang bertahan setelah layar ditutup, buka kunci,
> simpan semua, sampai faktur selisih FJS.2026.08.00001 Rp 100.000 dan jurnalnya. Jalur klinik
> (dinilai modal) baru teruji lewat tes otomatis: gudang klinik di data uji belum ada isinya.

Foto kondisi untuk klien: `docs/Papan-Progres-VetOS-untuk-Kamo-Group-26-Agustus-2026.pdf`
(sumbernya `docs/papan-progres-26-agustus.html` — ubah HTML-nya lalu cetak ulang ke PDF).

Gabungan dari dua sumber:
- `docs/Progres-VetOS-14-Agustus-2026.pdf` — status menu per modul (54/81 menu wajib = 67%)
- `docs/NOTULEN-MEETING-2026-08-14.md` — 42 permintaan dari meeting 14 Agustus

Mulai sekarang **file ini yang diperbarui tiap kali ada pekerjaan beres.** Dua file di atas
dibekukan sebagai foto kondisi 14 Agustus.

Status: `⬜ belum` · `🔨 dikerjakan` · `✅ selesai` (isi tanggal) · `⏸ nunggu klien`

---

## Program onboarding data & cockpit operasional — 1 September 2026

| Pekerjaan | Status | Catatan bisnis |
|---|---|---|
| Impor lanjutan master Accurate, komponen, saldo awal, dan keluarga varian | 🔨 | Mesin preview, reject, audit, posting sekali, dan rekonsiliasi sudah dibuat; eksekusi pilot menunggu paket data lengkap dan konfirmasi gudang/tanggal cut-off. |
| Data operasional klinik | 🔨 | Booking/no-show, waktu layanan, provider, follow-up, kapasitas, referral, dan audit sudah disiapkan; smoke test data aktual menunggu kapasitas serta tautan karyawan/provider. |
| Dashboard Operation & Sales | 🔨 | Cockpit lintas sales, cabang, customer, stok, pembelian, dan klinik sudah dibuat; sementara dikunci untuk OWNER/ADMIN. Rekonsiliasi laporan aktual belum selesai. |
| Alert operasional | 🔨 | Lima aturan bawaan, ambang perusahaan/cabang, prioritas merah/kuning, missing-state, dan drill-down sudah dibuat; reproduksi dengan data pilot belum selesai. |
| Keputusan produksi | ⏸ | **Belum boleh produksi — BLOCKED BY DATA.** Pilot satu gudang, rekonsiliasi nol selisih, uji keamanan cabang, dan persetujuan OWNER/ADMIN masih wajib. |

Runbook evidence dan syarat pembukaan produksi: `docs/runbooks/2026-08-31-operation-sales-production-rollout.md`.

---

## Skor

| Ukuran | Angka |
|---|---|
| Menu wajib ala Accurate sudah jadi | 69 / 81 · 85% (dihitung per menu; 21 Agu = 65) |
| Permintaan meeting 14 Agustus selesai | 40 / 42 · sisa: AI WhatsApp + 1 yang nunggu klien |
| Permintaan susulan di luar meeting | 9 / 9 · M43–M50 (review drh. Ilham & Pak Aldi) + impor data awal (S11) |
| Sisa pekerjaan pra-meeting | 8 / 11 · sisa: WA otomatis & desain cetakan (nunggu klien), e-Faktur (nunggu template Coretax + PPh 21 Fase 3) |
| Nunggu jawaban klien | 2 hal (token WA, identitas perusahaan) |

---

## A. Permintaan meeting 14 Agustus (42)

### A1. Stok opname — blok terbesar, semua P1 kecuali satu

Delapan keputusan mengubah rancangan yang sudah jalan; rinciannya di notulen bagian 1.

| # | Pekerjaan | Prioritas | Status | Beres |
|---|---|---|---|---|
| M1 | Daftar hitung digenerate otomatis: 20 barang terlaris + 10 acak = 30 | P1 | ✅ | 17 Agu 2026 |
| M2 | Sembunyikan kolom stok sistem & selisih dari petugas hitung | P1 | ✅ | 17 Agu 2026 |
| M3 | Kunci per barang + simpan otomatis tiap kunci, bisa dibuka lagi (warna tombol dibedakan) | P1 | ✅ | 17 Agu 2026 |
| M4 | Tombol muat ulang stok sistem saat opname berjalan | P1 | ✅ | 17 Agu 2026 |
| M5 | Tombol simpan semua di akhir → baru keluar laporan & jurnal | P1 | ✅ | 17 Agu 2026 |
| M6 | Selisih dijurnal pakai **harga jual** → jadi faktur penjualan kategori khusus "selisih stok", flat tanpa promo | P1 | ✅ | 17 Agu 2026 · seri faktur FJS |
| M7 | Khusus klinik tetap pakai modal (HPP), ditentukan dari setting unit bisnis | P1 | ✅ | 17 Agu 2026 · ikut jenis gudang/cabang |
| M8 | Opname seluruh gudang dipindah ke layar kasir; versi backoffice dihapus | P1 | ✅ | 17 Agu 2026 · backoffice jadi arsip baca-saja |
| M9 | Filter & urutkan di opname seluruh gudang: nama, kategori, harga jual, selisih terbesar | P2 | ✅ | 17 Agu 2026 |
| M10 | Hak akses: petugas toko tidak bisa mengintip angka stok sistem | P1 | ✅ | 17 Agu 2026 · angkanya tidak dikirim ke layar |

SOP klien: kepala toko menghitung sekali sehari. Kalau minus, kantor pusat yang menegur dan
memutuskan — dicari besoknya atau dikoreksi dari sistem.

### A2. Persediaan & pembelian

| # | Pekerjaan | Prioritas | Status | Beres |
|---|---|---|---|---|
| M11 | Kartu stok dilengkapi — retur belum mengurangi penjualan | P1 | ✅ | 17 Agu 2026 · omzet bersih di 2 laporan penjualan |
| M12 | Satu barang beberapa tanggal kedaluwarsa: isi jumlah per tanggal saat terima barang | P2 | ✅ | 18 Agu 2026 |
| M13 | Penjualan otomatis mengambil stok yang kedaluwarsanya paling dekat | P2 | ✅ | 18 Agu 2026 · FEFO |
| M14 | Data barang: tingkatan jumlah + harga jual bertingkat (seperti Accurate) | P2 | ✅ | 18 Agu 2026 |
| M15 | Pesanan penjualan belum bisa pilih satuan | P2 | ✅ | 18 Agu 2026 |
| M16 | Pembelian langsung tanpa PO: tambah lampiran surat jalan | P2 | ✅ | 18 Agu 2026 |
| M17 | Struk POS toko: tampilkan satuan, bukan cuma jumlah | P2 | ✅ | 18 Agu 2026 |
| M18 | Produksi own brand (bahan baku → barang jadi), terpisah dari resep obat klinik | P3 | ✅ | 18 Agu 2026 · sekaligus menutup S1 |

### A3. Klinik

| # | Pekerjaan | Prioritas | Status | Beres |
|---|---|---|---|---|
| M19 | Pembayaran rombongan disamakan dengan pembayaran biasa; tombol "lunasi semua" dihapus | P2 | ✅ | 17 Agu 2026 |
| M20 | Rincian tagihan: tambah diskon persen per item | P2 | ✅ | 17 Agu 2026 |
| M21 | Tambah obat di rekam medis tersambung master barang | P1 | ✅ | 17 Agu 2026 · dicek: sudah live, semua baris obat tertaut master |
| M22 | Antrian: filter tanggal (bisa mundur) + filter cabang | P2 | ✅ | 17 Agu 2026 |
| M23 | Nomor antrian pakai kode awalan per cabang | P2 | ✅ | 17 Agu 2026 · mis. CMGG-A001 |
| M24 | Rawat inap: total hari otomatis masuk tagihan saat pasien pulang | P2 | ✅ | 21 Agu 2026 · per 24 jam dibulatkan ke atas, qty terkunci |
| M25 | Formulir persetujuan diikat ke jenis tindakan; tidak bisa bayar sebelum ditandatangani | P2 | ✅ | 21 Agu 2026 · klinik mengatur sendiri di layar Form Persetujuan |
| M26 | Promo, voucher, poin muncul di klinik persis seperti di petshop | P2 | ✅ | 17 Agu 2026 · poin nyusul promo & voucher |

### A4. CRM & promo

| # | Pekerjaan | Prioritas | Status | Beres |
|---|---|---|---|---|
| M27 | Voucher bisa diikat ke pelanggan tertentu atau golongan, bukan cuma cabang | P2 | ✅ | 18 Agu 2026 |
| M28 | Pengingat aktivasi voucher muncul di layar admin klinik | P3 | ✅ | 18 Agu 2026 · di layar antrian |
| M29 | Loyalty: belanja dapat poin + tutup poin akhir tahun | P3 | ✅ | 18 Agu 2026 · tutup poin per tahun, khusus OWNER |
| M43 | Status ulasan pelanggan yang bisa ditambah sendiri (mis. bintang 1 Google) | P2 | ✅ | 19 Agu 2026 · permintaan komisaris; muncul juga di kasir & antrian klinik |
| M44 | Catatan harian rawat inap: makan, minum, BAB, BAK disamakan ke skala Baik/Sedang/Buruk supaya bisa jadi grafik | P2 | ✅ | 25 Agu 2026 · keputusan drh. Ilham & Pak Aldi |
| M45 | Obat khusus berprotokol: berapa kali sehari, berapa hari, siapa yang memberikan | P2 | ✅ | 25 Agu 2026 · permintaan drh. Ilham |
| M46 | Status reproduksi: tambah Monorchid & Kriptorkid | P2 | ✅ | 25 Agu 2026 · review drh. Ilham; dulu cuma Utuh/Steril |
| M47 | Formulir rawat inap harian dikasih pintu langsung dari daftar pasien | P2 | ✅ | 25 Agu 2026 · dokter tidak menemukannya karena harus buka detail dulu |
| M48 | Layar Racik Obat menjelaskan resep ditulis di Rekam Medis | P2 | ✅ | 25 Agu 2026 · dokter mencari form resep di halaman apotek |
| M49 | Status ulasan & catatan pemilik tampil di layar antrian sebelum diperiksa | P2 | ✅ | 25 Agu 2026 · "pelanggan loyal / suka komplain" perlu diketahui dokter lebih dulu |
| M50 | Kolom "dokter sebelumnya" di daftar follow up | P2 | ✅ | 25 Agu 2026 · menentukan kasusnya dikonsulkan ke dokter yang sama atau diperiksa ulang |

Latar: Pak Aldi mau menggiring pelanggan klinik ke petshop lewat voucher yang hanya berlaku
hari itu dan menempel di data orangnya, jadi tidak bisa ditiru seperti voucher kertas.

### A5. Keuangan & backoffice

| # | Pekerjaan | Prioritas | Status | Beres |
|---|---|---|---|---|
| M30 | Transaksi berulang: tampilkan sudah berjalan berapa kali + rincian sampai nomor jurnal | P2 | ✅ | 17 Agu 2026 |
| M31 | Hapus dua pasang menu kembar (Transaksi/Jurnal Berulang, Kas Keluar/Pencatatan Beban) | P2 | ✅ | 17 Agu 2026 · riwayat beban digabung ke Kas Keluar |
| M32 | Pencatatan beban: filter kategori & cabang, pencarian, pengurutan | P2 | ✅ | 17 Agu 2026 · di layar Kas Keluar |
| M33 | Jurnal umum: filter + kolom cabang | P2 | ✅ | 17 Agu 2026 |
| M34 | Rincian hutang bisa diklik ke pembelian — ke PO maupun fakturnya | P2 | ✅ | 17 Agu 2026 |
| M35 | Semua nomor dokumen bisa diklik di mana pun (laporan, dashboard) | P2 | ✅ | 17 Agu 2026 · satu pintu /dokumen/<nomor> |
| M36 | Faktur penjualan backoffice: kode berbeda untuk klinik dan petshop | P2 | ✅ | 17 Agu 2026 · seri FJK vs FJ |

### A6. Dashboard, peringatan, laporan

| # | Pekerjaan | Prioritas | Status | Beres |
|---|---|---|---|---|
| M37 | Dashboard menyesuaikan peran (operasional, marketing) — sekarang condong ke keuangan | P3 | ✅ | 18 Agu 2026 · 3 sudut pandang |
| M38 | Peringatan saat stok kosong tapi tetap diinput | P3 | ✅ | 18 Agu 2026 |
| M39 | Peringatan saat diskon membuat harga di bawah modal — boleh dilanjut | P3 | ✅ | 18 Agu 2026 |
| M40 | Laporan jumlah transaksi per cabang + rata-rata belanja per struk per cabang | P3 | ✅ | 25 Agu 2026 · `/laporan/transaksi-cabang` + `/laporan/pelanggan-harian`. Daftar 50 laporan permintaan klien ada di `docs/DAFTAR-LAPORAN-KAMO-2026-08-24.md` — **50/50 tuntas** 25 Agu 2026 |

### A7. WhatsApp & AI

| # | Pekerjaan | Prioritas | Status | Beres |
|---|---|---|---|---|
| M41 | Modul WhatsApp otomatis untuk CRM — didahulukan dari AI | P3 | ⏸ | kode siap, nunggu token layanan WhatsApp (lihat S3) |
| M42 | Agen AI WhatsApp: baca data pelanggan, jawab chat, follow-up sampai closing, dengan pembatasan kirim | P3 | ⬜ | |

---

## B. Sisa pekerjaan pra-meeting (10)

Dari papan progres 14 Agustus, belum tersentuh permintaan meeting.

| # | Pekerjaan | Modul | Kenapa perlu | Status |
|---|---|---|---|---|
| S1 | Produksi own brand: resep produksi · perintah produksi · penyelesaian | Persediaan | SKU gabungan masih dihitung manual, harga pokok barang jadi belum terbentuk | ✅ 18 Agu 2026 |
| S2 | Penyesuaian persediaan jadi dokumen bernomor + alasan wajib | Persediaan | Koreksi stok belum meninggalkan jejak audit | ✅ 19 Agu 2026 · form cepat di Stok per Gudang dimatikan, satu pintu lewat dokumen |
| S3 | WhatsApp otomatis: struk · retensi 7 pemicu · laporan rawat inap | CRM, Kasir, Klinik | Pelanggan dapat struk & pengingat vaksin langsung | ⏸ nunggu token |
| S4 | Desain cetakan: kop, logo, catatan kaki di 6 layar cetak | Pengaturan | Dokumen keluar ke pihak lain tanpa identitas perusahaan | ⏸ nunggu logo/alamat/NPWP |
| S5 | Penomoran dokumen bisa diatur sendiri (awalan, digit, reset periode) | Pengaturan | Ubah format nomor sekarang harus lewat developer | ✅ 25 Agu 2026 · `/pengaturan/penomoran`, 27 jenis dokumen; JRN sengaja dikecualikan |
| S6 | Penyetuju transaksi (approval berjenjang) | Pengaturan, Perusahaan | Transaksi besar belum perlu persetujuan atasan | ✅ 25 Agu 2026 · `/pengaturan/penyetuju`; menjaga pembayaran hutang & kas keluar |
| S7 | Popup promo berjalan di layar kasir | Kasir | Kasir tidak tahu promo yang sedang jalan | ✅ 25 Agu 2026 · muncul sendiri sekali sehari per cabang |
| S8 | Proses akhir bulan otomatis tiap tanggal 1 | Buku Besar | Tutup buku masih ditekan manual | ✅ 25 Agu 2026 · cron + tombol manual di Tutup Buku; penguncian opsional |
| S9 | Impor Excel aturan komisi & target | Penjualan | Sekarang diinput satu-satu | ✅ 25 Agu 2026 · `/pengaturan/impor/komisi` & `/impor/target`, master dirujuk lewat nama |
| S11 | Impor massal pelanggan, pemasok, dan bagan akun | Pengaturan | Data awal masih diketik satu-satu, menahan trial klien | ✅ 21 Agu 2026 |
| S10 | e-Faktur & SPT: CTAS · email faktur · legacy · bukti potong PPh 21 | Pajak, Laporan | Pelaporan pajak masih manual — sesuai keputusan manajemen, ditaruh paling akhir | 🔨 25 Agu 2026 · `/pajak/faktur` (berkas pajak per masa + unduhan CSV + identitas NPWP). Berkas impor Coretax menunggu template resmi dari klien; PPh 21 menunggu mesin potongan gaji (Fase 3) |

**Catatan data:** harga beli "RC Baby Milk Cat 300gr" masih Rp 0 di master barang, jadi tiap
penjualannya tercatat untung 100%. Perlu diisi klien supaya laporan laba akurat.

---

## C. Yang ditagih ke klien

| Yang ditunggu | Dari | Menahan |
|---|---|---|
| Tarif jasa "Rawat Inap" per hari di master barang | Kamo Group | tagihan rawat inap otomatis |
| Token layanan WhatsApp | Kamo Group | M41, S3 |
| Logo, alamat, NPWP perusahaan | Kamo Group | S4 |

---

## D. Sudah jalan (jangan dikerjakan ulang)

Modul tuntas: **Pembelian** (9/9) · **Penjualan B2B** (10/10) · **Buku Besar** (9/9) ·
**Kas & Bank** (4/4) · **Aset Tetap** (6/6) · **HRIS** (5/5) · **Klinik** (inti operasional penuh).

Sebagian: Persediaan 11/14 · CRM 3/4 · Pengaturan 2/6 · Perusahaan 2/7 · Laporan (hub sudah ada) ·
Pajak 0/3.

Sudah beres sebelum meeting dan sempat ditanyakan di meeting:
- Sesi kasir tidak putus tiap 60 menit — bertahan selama shift belum ditutup.
- Opname sebagian rak sudah bisa dijalankan langsung dari layar kasir.
- Angka stok sistem & selisih sudah tidak tampil di layar hitung versi kasir.

---

## E. Di luar aplikasi — rencana perangkat klien

Memengaruhi rancangan layar, bukan pekerjaan kita:
- Petshop pindah ke all-in-one dengan dua layar berhadapan; layar pelanggan menampilkan barang
  yang sedang diinput dan poin miliknya.
- Klinik tambah dua perangkat: rawat inap dan apotek. Tanda tangan persetujuan di tablet dokter.

## F. Catatan cara kerja

Database dipakai bersama. Kalau klien mengetes sementara pengembangan jalan, datanya bisa
terlihat aneh. Perlu disepakati jam ngoprek, atau dipisah data uji coba sendiri.
