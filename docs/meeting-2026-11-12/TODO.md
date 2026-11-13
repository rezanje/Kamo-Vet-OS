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
  `20261116400000_a1_index_tanggal_laporan.sql`, **belum dipasang** ke Production (menunggu persetujuan).

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
  Centang "Laporan Visit" di Akses Grup: migrasi `20261116500000_a4_submenu_laporan_visit.sql` (disetujui, dipasang malam ini
  sebelum deploy). ADMIN yang laporannya dibatasi perlu dicentang Owner di Akses Grup.

### A5 · [x] P1 — Akses koreksi visit untuk yang lupa input
- Disepakati: tetap ada akses untuk mengedit/menambah visit yang terlupa, **hanya untuk Owner/Manager**. Diatur lewat Akses Grup.
- Aturan bisnis ke depan: yang tidak mengisi visit tidak dapat insentif. Cukup didokumentasikan, tidak perlu enforcement di sistem.
- Screenshot: `pengaturan-akses-grup.jpg`
- Status: izin Akses Grup baru **"Koreksi visit rawat inap"** (Owner selalu; ADMIN otomatis dicentang — keputusan 1A/2A/3A,
  lihat `USULAN-A5.md`). Pemegang izin: visit > 48 jam lalu, ubah waktu/dokter/jenis/paramedis visit, dan tambah/ubah catatan
  setelah pasien pulang — alasan wajib & tersimpan. Migrasi `20261116600000_a5_koreksi_visit_rawat_inap.sql` **harus dipasang
  sebelum** aplikasinya dideploy.

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

### D1 · [ ] P1 — Menu tambah/sesuaikan poin manual
- Pelanggan hasil migrasi sudah punya poin dari sistem lama. Perlu menu untuk menambah poin ke pelanggan secara manual, dengan alasan dan tercatat di log.
- Bisa juga dipakai untuk hadiah quest/game.
- Screenshot: `crm-pelanggan.jpg`

### D2 · [ ] P2 — Filter retensi: pelanggan tidak datang N bulan
- Filter pelanggan yang tidak datang dalam 2 bulan (sebaiknya N bisa diatur).
- Retention WA masih "halaman dalam pengembangan", jadi lanjutkan setelah filter ada.
- Screenshot: `crm-retention-wa.jpg`

### D3 · [x] Promo paket
- Sudah diperbaiki semalam. Cukup verifikasi.

---

## E. PENJUALAN ONLINE (Impor Shopee)

### E1 · [x] Impor dengan pilihan satuan — sudah jalan
- Contoh: Shopee menjual 1 kg, master memakai satuan 1/2KG, jadi satuan diganti di kolom Satuan. **Qty dikunci** (ikut default dari Shopee); yang boleh diubah hanya satuan. Pastikan perilaku ini konsisten.
- Screenshot: `penjualan-online-impor-satuan.jpg`

### E2 · [ ] P2 — Bundling / promo paket di impor
- Belum didukung. Kerjakan setelah item P0/P1.

### E3 · [ ] P1 — Akses khusus Penjualan Online per user
- Perlu akun untuk staf online dengan role Admin/Staff yang **hanya** punya akses Penjualan Online.
- Masalah: akses diatur per role (Akses Grup). Kalau role Staff umum diberi akses penjualan, semua staff ikut dapat akses.
- Yang diminta: pengaturan akses tambahan per user (override di atas role), atau solusi lain yang setara. Usulkan desainnya dulu.
- Akun tetap terhubung ke data karyawan (untuk insentif).
- Screenshot: `pengaturan-akses-grup.jpg`

### E4 · [ ] P1 — Gudang (WH) otomatis sesuai user/cabang saat impor
- Saat impor, user tidak memilih WH lagi karena sering salah pilih. WH otomatis mengikuti cabang/WH yang terikat ke user (misalnya user Panduraya → WH Panduraya).
- Hapus WH "Online" yang terpisah (misalnya "WH ONLINE TKI", "WH ONLINE PDRY"). Cukup satu WH per cabang.
- [?] Konfirmasi: data stok dan transaksi yang sudah ada di WH Online dipindah ke WH cabang, atau WH Online cukup dinonaktifkan?
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
