# VetOS – To-Do dari Meeting 12 Nov 2026

Sumber: rekaman meeting tim klinik/finance + dev (±35 menit), setelah migrasi ke VetOS.
Aplikasi: `kamo-vet-os.vercel.app`. Screenshot ada di folder `screenshots/` (diambil dari rekaman, jadi data di layar adalah data asli/percobaan saat itu).

Status: `[ ]` belum, `[x]` sudah jalan (cukup verifikasi), `[?]` butuh klarifikasi sebelum dikerjakan.
Urutan prioritas: **P0** (hari ini/besok) → **P1** (minggu ini) → **P2** (bisa setelahnya).

---

## A. LAPORAN

### A1 · [x] P0 — Semua laporan wajib filter dulu sebelum menarik data
- Masalah: laporan loading sangat lama karena saat dibuka langsung menarik semua data dari semua cabang (kasusnya sama dengan dashboard).
- Yang diminta: alur seperti Accurate. Halaman laporan dibuka dalam keadaan kosong, user pilih filter dulu (minimal cabang dan rentang tanggal), lalu klik "Tampilkan" baru query jalan.
- Berlaku untuk **semua laporan** di Daftar Laporan.
- Tambahan: cek query/index supaya tetap cepat walaupun data sudah setahun.
- Screenshot: `laporan-daftar.jpg`, `laporan-penjualan-per-tenaga-penjual.jpg`
- Kriteria selesai: membuka halaman laporan tidak memicu query berat; data baru ditarik setelah filter dipilih dan "Tampilkan" diklik.
- Status: dikerjakan di branch `claude/epic-hypatia-raw2el` (lihat `RENCANA-P0.md`). Index tanggal ditulis sebagai migrasi
  `20261113031139_a1_index_tanggal_laporan.sql` — **terpasang di Production** (13 Nov 2026, 10.11 WIB).

### A2 · [x] P0 — Laporan Penjualan per Tenaga Penjual: rekap per item (qty)
- Halaman: `/laporan/penjual`
- Masalah: rinciannya masih per customer/transaksi, terlalu detail untuk rekap gaji/insentif bulanan.
- Yang diminta: tampilan **rekap per tenaga penjual → per item, dengan total quantity** dalam periode filter (misalnya sebulan).
- Tampilan rincian yang sekarang **tetap ada**, jangan dihapus (misalnya jadi mode/tab terpisah).
- Status: filter baru "Tampilan" → "Rekap per item (qty)" / "Rincian per transaksi" (bawaan tetap rincian).
  Retur mengurangi item asalnya; satuan berbeda ditulis terpisah.
- Screenshot: `laporan-penjualan-per-tenaga-penjual.jpg`

### A3 · [x] P0 — Laporan Penjualan per Tenaga Penjual: download Excel
- Saat difilter ke **satu tenaga penjual**, laporan belum bisa diunduh.
- Yang diminta: export ke Excel bisa dipakai untuk semua kombinasi filter, termasuk mode rekap per item dari A2.
- Status: tombol "Excel"/"CSV" kini membentuk berkas di server dari data & saringan yang sama dengan layar.
  Isi: Filter (nama, bukan ID), Rekap per orang, Rekap per item, Rincian baris, Faktur grosir.

### A4 · [x] P1 — Laporan Visit (baru)
- Belum ada. Dibutuhkan di klinik karena dokter/paramedis dapat insentif per visit.
- Sumber data: laporan visit harian rawat inap (lihat bagian "Laporan Rawat Inap Harian" di `klinik-obat-khusus.jpg`), dengan kolom dokter visit dan paramedis.
- Minimal: filter periode, cabang, dan dokter/paramedis; rekap jumlah visit per orang; bisa export Excel.
- ~~[?] Konfirmasi: insentif dihitung per visit saja, atau ada nilai rupiahnya?~~ → **Dijawab Reza (12 Nov): jumlah visit saja**, rupiah dihitung manual Finance.
- Status: `/laporan/visit` (Daftar Laporan › Klinik) — filter periode, cabang, peran, dokter/paramedis; rekap jumlah visit,
  pasien berbeda, hari visit per orang; rincian catatan; unduh Excel/CSV. 1 catatan "Visit dokter" = 1 visit untuk dokter
  visit + 1 untuk paramedis di catatan itu; catatan "Pemantauan" tidak dihitung. Tanpa nilai rupiah (sesuai jawaban).
  Centang "Laporan Visit" di Akses Grup: migrasi `20261113031150_a4_submenu_laporan_visit.sql` (**terpasang di Production** 13 Nov 2026,
  10.11 WIB, sebelum deploy). ADMIN yang laporannya dibatasi perlu dicentang Owner di Akses Grup.

### A5 · [x] P1 — Akses koreksi visit untuk yang lupa input
- Disepakati: tetap ada akses untuk mengedit/menambah visit yang terlupa, **hanya untuk Owner/Manager**. Diatur lewat Akses Grup.
- Aturan bisnis ke depan: yang tidak mengisi visit tidak dapat insentif. Cukup didokumentasikan, tidak perlu enforcement di sistem.
- Screenshot: `pengaturan-akses-grup.jpg`
- Status: izin Akses Grup baru **"Koreksi visit rawat inap"** (Owner selalu; ADMIN otomatis dicentang — keputusan 1A/2A/3A,
  lihat `USULAN-A5.md`). Pemegang izin: visit > 48 jam lalu, ubah waktu/dokter/jenis/paramedis visit, dan tambah/ubah catatan
  setelah pasien pulang — alasan wajib & tersimpan. Migrasi `20261113031357_a5_koreksi_visit_rawat_inap.sql` — **terpasang di Production**
  13 Nov 2026, 10.13 WIB (wajib sebelum aplikasinya dideploy).

### A6 · [x] P1 — Laporan Penjualan per Cabang: omset harian
- Tambahkan rekap omset per hari per cabang. Isinya **omset saja**, tanpa biaya operasional. Tujuannya membantu Finance.
- Status: di laporan **Transaksi per Cabang** ditambah tabel "Omzet harian per cabang" (tanggal × cabang + total per hari
  dan per cabang; hari tanpa transaksi = 0). Angka omzet sama dengan kolom Omzet laporan itu (setelah diskon & retur).
  Ikut terunduh di Excel/CSV laporan tersebut.

### A7 · [?] P2 — Laporan lain mengikuti referensi Accurate
- Tim klinik/finance akan memberi contoh laporan dari Accurate. **Tunggu input**, jangan dikerjakan dulu.

---

## B. KLINIK

### B1 · [x] P1 — Tambah beberapa obat racikan sekaligus
- Di rawat inap, dokter tidak bisa menambahkan beberapa obat racikan (misalnya racik kapsul dan racik vitamin) dalam satu kali "Tambah obat / BMHP ke tagihan"; harus satu per satu.
- Langkah: investigasi alurnya dulu. Apakah ini memang batasan desain atau bug? Laporkan temuannya sebelum mengubah apa pun.
- Temuan (`TEMUAN-B1.md`): bukan batasan desain. Racikan yang sedang disusun terbuang diam-diam bila dokter memilih
  racikan/tindakan lain sebelum klik "Tambah ke keranjang". Perbaikan (pilihan 2A): ditanya dulu — Masukkan ke keranjang &
  lanjut / Buang / Batal — plus petunjuk cara memasukkan beberapa racikan.
- Screenshot: `klinik-obat-khusus.jpg`

### B2 · [ ] P1 — Hapus/arsip data percobaan & transaksi oleh Owner/Admin
- Antrian klinik masih banyak data tes. Transaksi berstatus "menunggu pembayaran" tidak bisa diarsipkan.
- Yang diminta:
  - Role Owner (dan Admin kalau diizinkan) bisa **hapus/edit/arsip semua transaksi**, termasuk yang menunggu pembayaran.
  - Transaksi yang **sudah diproses**: diarsipkan (bukan dihapus), dan efeknya ke keuangan/jurnal ikut dibalik/menyesuaikan.
  - Semua aksi ini tercatat di log aktivitas.
- Screenshot: `klinik-antrian-arsip.jpg`

### B3 · [ ] P1 — Void/koreksi transaksi harus masuk ke tanggal transaksi asli
- Masalah: koreksi/void yang diminta malam hari lalu diproses besoknya ikut tercatat (termasuk omset) di tanggal perbaikan. Seharusnya masuk ke tanggal transaksi asli.
- Catatan: sudah dilaporkan di Telegram dan katanya sedang dikerjakan. Cek status kode yang ada dulu sebelum mengerjakan ulang.

### B4 · [x] Pasien dobel (1 hewan tercatat 2 pasien) — tidak perlu perubahan
- Keputusan: untuk sekarang diproses terpisah, aman selama terikat ke satu customer. Tidak perlu dikerjakan.
- Screenshot konteks: `klinik-rekam-medis-lanjutan-ranap.jpg`

---

## C. HRIS (target selesai Desember, paling lambat awal tahun)

### C1 · [ ] P1 — Penjadwalan (shift) & absensi dulu
- Prioritas HRIS: penjadwalan dan absensi. Absensi memakai verifikasi wajah.
- Setelah stabil, baru disambungkan ke modul lain (terutama penjualan/insentif).
- Screenshot: `hris-menu.jpg`, `hris-absensi.jpg`

---

## D. CRM & LOYALTY

### D1 · [x] P1 — Menu tambah/sesuaikan poin manual
- Pelanggan hasil migrasi sudah punya poin dari sistem lama. Perlu menu untuk menambah poin ke pelanggan secara manual, dengan alasan dan tercatat di log.
- Bisa juga dipakai untuk hadiah quest/game.
- Status (14 Nov): dikerjakan; Reza setuju (A). Migrasi `20261114085215_d1_poin_manual.sql` **terpasang di Production** 14 Nov 2026,
  15.52 WIB (cek live: 3 kolom jejak, penjaga, izin katalog, 2 fungsi; Owner = boleh). Tampil di aplikasi setelah PR di-merge & deploy.
  CRM › Pelanggan › detail › "Sesuaikan poin": tambah/kurangi, jumlah, alasan wajib (3–300 huruf); saldo tidak bisa minus;
  klik ganda tidak dobel; tercatat di riwayat poin (pelaku, alasan) + Log Aktifitas. Hak: Owner, atau peran yang dicentang
  izin khusus baru "Sesuaikan poin pelanggan" (CRM) di Akses Grup. Tanpa jurnal (poin memang tidak dijurnal).
  Sebelum migrasi dipasang tombolnya tidak muncul (aman). Data 14 Nov: 3.771 pelanggan bersaldo poin, semuanya dari transaksi
  VetOS sejak 1 Nov — poin sistem lama belum ada yang masuk. Bila saldo lama banyak, bisa ditambah impor Excel massal.
- Screenshot: `crm-pelanggan.jpg`

### D2 · [x] P2 — Filter retensi: pelanggan tidak datang N bulan
- Filter pelanggan yang tidak datang dalam 2 bulan (sebaiknya N bisa diatur).
- Retention WA masih "halaman dalam pengembangan", jadi lanjutkan setelah filter ada.
- Status (14 Nov): dikerjakan; Reza setuju (A). Migrasi fungsi baca `20261114085222_d2_filter_retensi.sql` **terpasang di Production**
  14 Nov 2026, 15.52 WIB (cek live sebagai Owner: tidak datang ≥2 bln 1.882, ≥6 bln 970, ≥12 bln 760 pelanggan). CRM › Pelanggan: "Tidak datang ≥ N bulan" (1/2/3/6/12, bawaan 2; URL bisa 1–60),
  bisa digabung dengan cari, kolom "Terakhir Datang", jumlah hasil. "Datang" = transaksi petshop/online tidak dibatalkan atau
  kunjungan klinik tidak diarsipkan, dihitung lintas semua cabang; yang belum pernah datang tidak ikut. Catatan: riwayat klinik
  hasil impor ikut (bertanggal asli sejak 2024), riwayat petshop sistem lama tidak ada (VetOS mulai 1 Nov). Sebelum migrasi
  dipasang saringan menampilkan daftar biasa + pesan "belum aktif" (aman). Retention WA belum dikerjakan.
- Screenshot: `crm-retention-wa.jpg`

### D3 · [x] Promo paket
- Sudah diperbaiki semalam. Cukup verifikasi.
- **Diverifikasi 14 Nov 2026:** perbaikan "nilai belanja dipakai bersama" (rezanje/kamo-vet-os#497, migrasi
  `20261111150000_promo_syarat_nilai_bersama`, terpasang di Production) — satu struk Rp155rb tidak lagi memberi 3 hadiah
  "belanja min Rp100rb"; tiap promo memakai porsi belanja sendiri, total tidak melebihi belanja. Diuji vitest
  `promo-syarat-hasil.shared.test.ts`, SQL `promo_nilai_bersama.sql`, harness Postgres + mutan. Ikut terkait: lantai harga
  promo per baris klinik (`20261111140000`, GROOM11). Catatan kecil (bukan bug promo paket): saat koreksi nota klinik,
  baris yang BARU diberi promo belum mengirim potongan promonya per baris (database sudah siap, aplikasi belum).

---

## E. PENJUALAN ONLINE (Impor Shopee)

### E1 · [x] Impor dengan pilihan satuan — sudah jalan
- Contoh: Shopee menjual 1 kg, master memakai satuan 1/2KG, jadi satuan diganti di kolom Satuan. **Qty dikunci** (ikut default dari Shopee); yang boleh diubah hanya satuan. Pastikan perilaku ini konsisten.
- **Diverifikasi 14 Nov 2026 — konsisten:** kolom Qty hanya teks (tanpa input) untuk semua jenis baris; qty tidak dikirim
  dari layar sama sekali — server membaca ulang file Shopee (qty & harga dari file); satuan yang dipilih wajib terdaftar
  di satuan berjenjang barang (database menolak "Satuan tidak terdaftar"); stok keluar = qty × faktor satuan.
  Diuji `shopee-import-workspace.test.tsx`, `shopee-import-actions.test.ts`, `shopee-import-match.test.ts`.
  Catatan: order yang sudah tersimpan tidak bisa diimpor ulang dengan satuan lain (ditolak "rincian berbeda") — sesuai desain.
- Screenshot: `penjualan-online-impor-satuan.jpg`

### E2 · [ ] P2 — Bundling / promo paket di impor
- Belum didukung. Kerjakan setelah item P0/P1.

### E3 · [x] P1 — Akses khusus Penjualan Online per user
- Perlu akun untuk staf online dengan role Admin/Staff yang **hanya** punya akses Penjualan Online.
- Masalah: akses diatur per role (Akses Grup). Kalau role Staff umum diberi akses penjualan, semua staff ikut dapat akses.
- Yang diminta: pengaturan akses tambahan per user (override di atas role), atau solusi lain yang setara. Usulkan desainnya dulu.
- Akun tetap terhubung ke data karyawan (untuk insentif).
- Screenshot: `pengaturan-akses-grup.jpg`
- Status: dikerjakan (keputusan 1A/2A/3A, `USULAN-E3.md`). Owner mengatur "Akses khusus akun ini" di Pengaturan › Pengguna ›
  edit akun: Ikuti peran / Peran + tambahan / Hanya akses khusus. Migrasi `20261114074354_e3_akses_khusus_akun.sql` disetujui
  (1A, 13 Nov; bagian 8 memperluas `sales_module_access` untuk akun yang diberi modul Penjualan lewat akses khusus) —
  **terpasang di Production** 14 Nov 2026, 14.43 WIB (versi tercatat `20261114074354`; dulu bernama `20261117200000_…`).
  Cek live: 4 tabel, 5 fungsi, 4 trigger, sumber Log Aktifitas, klausa E3 di `sales_module_access`; 0 akun ber-akses khusus.
  Detail order online kini punya rute sendiri `/penjualan/online/[id]` (3A), jadi akun "hanya Penjualan Online" bisa
  membuka pesanannya tanpa akses Rekap penjualan.

### E4 · [ ] P1 — Gudang (WH) otomatis sesuai user/cabang saat impor
- Saat impor, user tidak memilih WH lagi karena sering salah pilih. WH otomatis mengikuti cabang/WH yang terikat ke user (misalnya user Panduraya → WH Panduraya).
- Hapus WH "Online" yang terpisah (misalnya "WH ONLINE TKI", "WH ONLINE PDRY"). Cukup satu WH per cabang.
- [?] Konfirmasi: data stok dan transaksi yang sudah ada di WH Online dipindah ke WH cabang, atau WH Online cukup dinonaktifkan?
- Status (sebagian): **gudang otomatis saat impor Shopee sudah dikerjakan** — yang dipilih kini CABANG, gudangnya = gudang
  utama cabang (gudang Toko; cabang tanpa gudang Toko = satu-satunya gudangnya, mis. B2C). Akun satu cabang terkunci
  otomatis; Owner/multi-cabang memilih cabang (bawaan = cabang petshop aktif). Server menghitung ulang gudangnya.
  **Belum:** penghapusan/penonaktifan WH Online (menunggu jawaban [?]). Data 13 Nov: WH ONLINE PDRY 31 barang / 230 unit,
  WH ONLINE TKI 3 barang / 16 unit masih bersaldo; mutasi terakhir 4 Nov. Order online manual (Penjualan Online → Baru)
  masih memilih gudang seperti sebelumnya.
- ~~[?]~~ → **Dijawab Reza: 2A** (pindah stok ke gudang toko + nonaktifkan WH Online).
- Bagian 2, **tahap 1 terpasang di Production** 14 Nov 2026, 15.08 WIB (migrasi `20261114080823_e4_pindah_stok_wh_online.sql`).
  Preflight 14 Nov cocok persis (31/230 dan 3/16, mutasi terakhir 4 Nov), tetapi 4 barang PDRY sama dengan kiriman Permintaan
  Barang DC LOJI yang masih di Transit → **keputusan Reza "B"**: pindah sekarang tanpa 4 barang itu.
  Hasil: WH ONLINE TKI → WH TKI 3 barang / 16 unit (IT.2026.11.00330/00331), **WH ONLINE TKI nonaktif**;
  WH ONLINE PDRY → WH PDRY 27 barang / 209 unit (IT.2026.11.00328/00329). Nilai pindah Rp3.604.373,06 = nilai masuk toko,
  tanpa jurnal. **Sisa:** WH ONLINE PDRY masih aktif memegang 4 barang / 21 unit (Chester Tuna 800gr 8, Cat Choize Tuna adult 8,
  Cat Choize Salmon adult 4, Pasir Lala 25L Coffee 1) → **tahap 2** `20261118500000_e4_pindah_stok_wh_online_tahap2.sql`
  (ditulis + diuji, BELUM dipasang) dipasang setelah kiriman Transit itu diterima toko (Panduraya, Muara, Ciawi, TKI/Kopo).
- Screenshot: `penjualan-online-pilih-wh.jpg`

---

## F. PERSEDIAAN — STOK OPNAME

### F1 · [ ] P1 — Laporan hasil stok opname
- Bisa ditampilkan dalam nilai HPP dan harga jual.
- Selisih **plus** → Pendapatan Lain-lain. Selisih **minus** → Beban Selisih Stok. Yang minus **belum muncul**, jadi perlu dicek.
- HPP memakai **average**. Cek apakah ada perbedaan hitungan average vs FIFO di kode sekarang.
- Screenshot: `persediaan-stok-opname.jpg`

### F2 · [ ] P2 — Notifikasi & beban selisih minus ke karyawan
- Saat selisih minus, munculkan notifikasi/ringkasan nilai minusnya.
- Nilai minus dikonversi ke harga jual sebagai beban karyawan. Contoh: selisih HPP Rp100rb, harga jual Rp150rb → yang ditanggung karyawan Rp150rb.
- Alur proses opname tetap seperti sekarang; ini hanya hasil/laporannya.

### F3 · [ ] Ops (bukan dev) — Uji coba stok opname pertengahan–akhir bulan, sekaligus cek apakah proses tercatat di log.
