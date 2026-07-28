# Ringkasan: Kloning Fitur Accurate → VetOS (Juli 2026)

> Handoff buat sesi/chat baru. Semua yang di bawah ini **sudah jadi, sudah diuji, dan sudah
> dirilis ke server** (Vercel, push main = auto-deploy). Database Supabase in-sync
> (migrasi 0052–0061). Detail teknis per fitur: `docs/superpowers/specs/`.

## Status Roadmap Paritas Accurate

| # | Fitur | Status | Lokasi di VetOS |
|---|-------|--------|-----------------|
| 1 | Pemindahan Barang antar gudang (Kirim → Transit → Terima, nomor IT.YYYY.MM.NNNNN, terima sebagian) | ✅ | POS & Inventori → Pemindahan barang |
| 2 | Retur Pembelian (potong hutang) & Retur Penjualan (refund tunai kasir, nyambung tutup shift) | ✅ | Pembelian → Retur · Penjualan → Retur |
| 3 | Stok Opname 2 dokumen ala Accurate (Perintah OPO → Hasil OPR, selisih otomatis jurnal) | ✅ | POS & Inventori → Stock opname |
| 4 | Laporan: Laba/Rugi per unit (Semua Klinik / Semua Petshop), Stok matrix semua gudang, Penjualan per cabang & per barang + filter periode | ✅ | Keuangan → Laba Rugi · POS → Stok (matrix) · Penjualan |
| 5 | Faktur Pembelian (hutang lahir dari faktur pemasok, jatuh tempo, bayar per faktur, akun antara 2102) | ✅ | Pembelian → Faktur pembelian · Keuangan → Hutang |
| 6 | Tutup Buku & Kunci Periode (jurnal lama digembok level database, laba → Laba Ditahan) | ✅ | Keuangan → Tutup buku |
| 7 | Penyusutan aset otomatis (catch-up saat halaman Aset dibuka + cron bulanan siap) | ✅ | Keuangan → Aset tetap |
| 8 | PPN + Mode PKP (toggle, default OFF; dulu PPN hardcoded nyala — sudah dikoreksi) + Rekap PPN | ✅ | Pengaturan → Pajak · Keuangan → Rekap PPN |
| 9 | HPP FIFO (PRD §10.2) — cost layers, semua mutasi stok 1 pintu, HPP jurnal = cost riil | ✅ | Otomatis di semua transaksi |
| 10 | Neraca Saldo (trial balance, badge Seimbang) | ✅ | Keuangan → Neraca saldo |
| 11 | Jurnal Berulang (langganan bulanan auto-posting) | ✅ | Keuangan → Jurnal berulang |
| 12 | Manajemen Pengguna (akun per karyawan, role, cabang, link HRIS, nonaktifkan; login page dibersihkan dari akun demo) | ✅ | Pengaturan → Manajemen pengguna |
| 13 | Penjualan Online/B2C (Shopee/Tokopedia/TikTok Shop/WA; marketplace lahir sebagai Piutang Marketplace 1202, komisi dihitung saat pencairan aktual ke 5305) | ✅ diuji end-to-end 2026-07-26 | Penjualan → Penjualan online |
| 14 | Master Data & Kategori (satuan global, kategori barang bertingkat 2 tingkat, kategori pemasok, kategori aset + akun jurnal, kategori pelanggan + diskon otomatis di kasir) | ✅ 2026-07-28, migrasi 0066 | Persediaan → Satuan/Kategori Barang · Pembelian → Kategori Pemasok · Aset Tetap → Kategori Aset · CRM → Kategori Pelanggan |

**Verifikasi Penjualan Online (2026-07-26, 9/9 lolos):** order Shopee → `piutang` + Dr 1202/Cr 4101 + HPP FIFO ·
pencairan Rp 142rb dari total Rp 150rb → komisi Rp 8rb ke 5305, jurnal seimbang · order WA → langsung Dr 1102,
pelanggan dapat poin · tolak: form kosong, qty pecahan, nominal cair melebihi total, klik cair kedua kali ·
ganti channel WA→Shopee melepas pelanggan · hapus baris tengah tidak menggeser SKU · order `ONL-` tidak bisa
diretur lewat kasir · drift-checker melaporkan "0 penjualan online". Data uji sudah dihapus bersih.

**Kesimpulan: sisi AKUNTANSI & INVENTORI Accurate sudah 100% pindah ke VetOS. Roadmap paritas Accurate TUTUP.**

**Master Data & Kategori (2026-07-28, migrasi 0066).** Enam master data Accurate dilengkapi.
Yang berubah buat pemakai sehari-hari:
- **Satuan barang** jadi daftar resmi. Dulu diketik bebas, jadi "pcs"/"Pcs"/"PCS" dianggap tiga
  satuan berbeda dan laporan stok pecah. Sekarang dipilih dari daftar.
- **Kategori barang bertingkat** (induk → anak), maksimum dua tingkat; tingkat ketiga ditolak.
- **Golongan pelanggan** bisa dibuat sendiri dan punya **diskon persen**. Kasir otomatis dapat
  harga golongan begitu pelanggannya dipilih. Diskon golongan dihitung SERVER dari master, muncul
  sebagai baris sendiri di struk, terpisah dari kolom diskon manual kasir — jadi ketahuan mana
  diskon sistem, mana diskon orang. Kasir tidak bisa mengarang angkanya (tidak dibaca dari form).
- **Kategori aset** bawa umur penyusutan + sepasang akun jurnal. Efek sampingnya: jurnal
  penyusutan bulanan yang dulu satu angka gabungan sekarang **pecah per kategori** (total sama).
- **Kategori pemasok** muncul di daftar pemasok.

Verifikasi 2026-07-28: migrasi dibandingkan sebelum/sesudah — barang 18=18, satuan berjenjang 1=1,
layer FIFO 432=432, stok 430=430, nol satuan yatim, nol kategori gagal dipetakan (Umum 28 + Member 4
pelanggan, aset 'Peralatan' semua ketemu induknya). `npm test` 258 lolos (dari 236), `tsc` bersih,
`npm run build` sukses dengan kelima halaman baru terkompilasi. Bentuk kueri relasi kasir/struk/
penyusutan/pemasok diuji langsung ke API (200), dengan kontrol negatif relasi ngawur (400) supaya
pengujiannya terbukti bergigi.

**Bug yang ketemu saat uji manual (dan sudah diperbaiki, migrasi 0067):** tabel kategori barang
lahir sejak awal proyek dengan izin **baca saja** — tidak pernah ketahuan selama kategori cuma
dipakai di dropdown. Begitu halaman kelola kategori dibuat, setiap simpan ditolak diam-diam oleh
database. Sekarang izin tulisnya ditambah (tetap tanpa izin hapus, supaya aturan "kategori tidak
pernah dihapus, hanya dinonaktifkan" dijaga database). Pesan error izin juga tidak lagi muncul
sebagai teks Inggris mentah ke layar kasir.

Uji manual 2026-07-28 (login OWNER, dev server): satuan kembar "PCS" ditolak dgn pesan Indonesia
(sekaligus bukti normalisasi jalan) · kategori anak tersimpan & tampil bertingkat, dan kategori anak
TIDAK ditawarkan jadi induk (tingkat ketiga terblokir di layar; guard servernya tertutup 12 tes) ·
golongan "Uji Reseller 10%" → kasir menampilkan `Subtotal 70.000 · Diskon Uji Reseller (10%) −7.000
· Diskon manual/promo 3.000 · Total 60.000`, poin ikut total akhir (60) · struk mencetak baris
"Diskon Uji Reseller" lengkap dgn nama golongan · form aset mengisi umur otomatis dari kategori
(Bangunan → 240 bulan). **Nol transaksi uji dibuat** — verifikasi struk dipakaikan ke satu struk
lama yang nilainya dikembalikan detik itu juga; penjualan tetap 29, jurnal 63, stok 430, layer 432,
poin & total belanja pelanggan tidak berubah. Yang belum diklik: tampilan read-only untuk role
non-OWNER (guard-nya satu fungsi yang sama di keenam halaman).

Batas yang sengaja tidak dikerjakan: tagihan klinik & order online TIDAK ikut diskon golongan;
tidak ada daftar harga per barang per golongan; golongan pajak fiskal aset ditunda; "ringkas per
induk" di laporan dicoret (tidak ada laporan yang mengelompokkan per kategori — itu laporan baru);
filter kategori pemasok di halaman hutang ditunda.



## Bonus/perbaikan penting yang nemu di jalan
- Form PO sekarang pilih barang dari master SKU (dulu teks bebas → stok tidak pernah nambah saat PO diterima).
- Bug tanggal hardcoded di halaman Penjualan (kartu "Hari Ini" selalu nol) — fixed.
- Klinik dulu selalu menambah PPN 11% ke tagihan pelanggan padahal belum tentu PKP — sekarang ikut toggle Mode PKP (default OFF).
- Konfirmasi email Supabase di-bypass via trigger DB (dashboard tak punya toggle-nya) — akun baru langsung bisa login. Insiden "Enable email provider" sempat kematiin (semua login mati) — sudah pulih.

## Keputusan bisnis yang sudah dikunci (jangan tanya ulang)
- Pemindahan barang: langsung kirim TANPA approval (ala Accurate).
- Retur jual = refund tunai kasir; retur beli = potong hutang pemasok.
- PPN: dibangun penuh, aktif via toggle Mode PKP (status PKP belum pasti → default OFF).
- HPP: FIFO (sesuai PRD §10.2).
- Order online TIDAK pakai shift kasir (bukan tunai fisik); marketplace dicatat Piutang Marketplace dulu,
  komisi baru muncul saat pencairan aktual (tidak menebak % di depan).
- Pembeli marketplace = teks bebas, tidak masuk CRM/poin/tier. Hanya order WA yang boleh dilink ke pelanggan.

## ⚠️ WAJIB DICABUT SEBELUM GO-LIVE
**Login page memajang akun uji + password (`password123`) semua role, termasuk di production.**
Keputusan boss 2026-07-26 selama fase development. Konsekuensinya: siapa pun yang menemukan URL
Vercel bisa masuk sebagai OWNER — pembukuan, data pelanggan, dan data gaji HRIS terbuka.
Sebelum sistem dipakai karyawan/pelanggan asli, kerjakan dua-duanya:
1. Hapus blok `AKUN_DEV` / `PASSWORD_DEV` di `src/app/login/page.tsx`.
2. Ganti password kelima akun tersebut (Pengaturan → Manajemen pengguna, atau via SQL).

## Sisa backlog (belum dikerjakan)
1. **12 transaksi lama tanpa jurnal** (muncul di Keuangan → Sinkron: 8 POS + 4 invoice klinik, 15–24 Jul, ± Rp 2,95 juta). Boss memastikan 2026-07-26 ini **sisa uji coba dev, bukan penjualan asli** — jadi **JANGAN** klik "Posting Ulang Semua", nanti pembukuan kembung omzet palsu. Yang benar: hapus transaksi + shift terkaitnya. Belum dikerjakan (butuh keputusan boss soal shift & stok yang sudah terlanjur kepotong).
2. **WA otomatis** — kode follow-up klinik & retensi sudah ada, mati karena `FONNTE_TOKEN` belum diisi (nunggu token dari boss).
3. **CRM Retensi screen** (7 trigger WA) — belum dibangun; tergantung #2.
4. Opsional ops: `SUPABASE_SERVICE_ROLE_KEY` + `CRON_SECRET` di Vercel → nyalain cron penyusutan bulanan (tanpa ini pun aman, ada lazy catch-up).
5. Opsional data: bersihkan PPN historis era hardcoded (Jun–Jul ± Rp 470rb di 2201) kalau dipastikan non-PKP.

## Catatan gudang online (penting buat baca laporan)
Gudang ONLINE **sudah ada** di master data, tidak perlu dibuat:
- `WH_B2C` → cabang `B2C` (tipe cabang **ONLINE**)
- `WH_ONLINE_PDRY` → cabang Kamo Petshop Panduraya (tipe cabang **PETSHOP**)
- `WH_ONLINE_TKI` → cabang Kamo Petshop TKI/Kopo (tipe cabang **PETSHOP**)

Konsekuensinya: preset Laba/Rugi **"— Cabang Online —"** hanya mencakup cabang `B2C`. Penjualan online
yang keluar dari WH_ONLINE_PDRY / WH_ONLINE_TKI masuk ke laba-rugi petshop masing-masing — sesuai asal
stoknya, dan ini **keputusan yang sudah disetujui boss (2026-07-26)**, bukan bug. Kalau suatu saat mau
laba-rugi online digabung jadi satu, laporannya harus difilter per channel (bukan per cabang) — itu
pekerjaan baru, belum ada.

## Fakta teknis buat sesi baru
- Repo: `~/Gen_Dev_Studio/VET_OS` · GitHub `rezanje/Kamo-Vet-OS` · push main = auto-deploy Vercel (kamo-group).
- Supabase project `koaglxcyjqfmgfzxszkj`; migrasi via MCP `apply_migration`; RLS mode demo (permissive).
- Tes: `npm test` (170 lolos) · `tsc --noEmit` bersih · pola: logika murni di `src/lib/*.ts` + test.
- Akun uji: `claude-test@vetos.local` / `password123` (ADMIN, tidak lagi dipajang di login page).
- Jangan `npm run build` saat dev server preview nyala (rusak `.next`).
- Nomor dokumen: IT/RB/RJ/FB = per bulan; OPO/OPR = global; via count+1 (ponytail).
