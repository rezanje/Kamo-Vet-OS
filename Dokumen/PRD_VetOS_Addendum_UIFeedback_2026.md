# PRD VetOS — Addendum: UI/UX Findings & Owner Feedback

**Dokumen:** Lampiran PRD VetOS v2.0
**Sumber:** Sesi review wireframe bersama Aldi (Owner, Kamo Group) — `UI_ERP_KAMO_2026.pdf`
**Tujuan:** Menerjemahkan anotasi/feedback langsung dari Owner pada mockup UI menjadi spesifikasi teknis yang actionable, untuk dieksekusi bersama PRD utama.

> **Catatan untuk AI Agent:** Dokumen ini BUKAN pengganti PRD utama, melainkan lampiran detail yang memperjelas business logic, field tambahan, dan workflow state machine yang sebelumnya belum terdefinisi eksplisit. Tanggal pada mockup (05 Mei 2021, dll.) adalah dummy data, abaikan — fokus ke struktur dan logic-nya. Item bertanda **[CRITICAL]** adalah business logic yang berdampak langsung ke integritas data dan wajib didesain dengan benar di level skema database sebelum development jalan. Item bertanda **[OPEN QUESTION]** butuh konfirmasi ke Aldi sebelum dikerjakan — jangan diasumsikan sendiri.

---

## 1. Modul CRM — Data Pelanggan & Anabul

### 1.1 Field Tambahan — Data Pelanggan (Customer)

Field yang muncul di mockup detail pelanggan namun belum eksplisit di PRD:

| Field | Tipe | Catatan |
|---|---|---|
| Tanggal Lahir | date | Sudah dicatat sebagai gap di audit Accurate — perlu fresh collection |
| Pekerjaan | string | Free text |
| Sumber Info | enum/string | Contoh: "Instagram" — kemungkinan untuk tracking acquisition channel, berguna untuk modul CRM/marketing |
| Catatan Umum | text | Free text notes dari staff tentang pelanggan |
| Kategori Pelanggan | enum | Bronze / Silver / Gold / Platinum — tier loyalitas |
| Keanggotaan | enum | Member / Non-Member |

Field computed (read-only, hasil agregasi): Total Transaksi, Total Pembelian, Poin Reward, Peringkat Member, Terdaftar Sejak.

### 1.2 Field Tambahan — Data Anabul (Pet)

| Field | Tipe | Catatan |
|---|---|---|
| Golongan Darah | string | Contoh: "A" — relevan untuk transfusi/emergency, perlu ditampilkan menonjol di rekam medis |
| No. Microchip | string, nullable | |
| Status Reproduksi / Sterilisasi | enum | Utuh / Steril |
| Alergi | text | |
| Kondisi Khusus | text | |
| Warna/Ciri-ciri | string | |
| Berat Badan | numeric + **history log** | Mockup menampilkan "4,2 kg (25 Mei 2026)" — artinya berat badan perlu dicatat sebagai **time-series**, bukan single value, supaya bisa di-track tren kenaikan/penurunan berat per kunjungan |
| Status | enum | Aktif / (kemungkinan Tidak Aktif, RIP — lihat 3.7) |
| Foto | array (multiple images) | Mockup menunjukkan slot foto >1 dengan tombol tambah |

### 1.3 [CRITICAL] Logic Atribusi Riwayat Pembelian Multi-Pet

**Temuan (hal. 3):** Anotasi Owner pada tabel "Riwayat Pembelian Produk" di halaman detail anabul:
> *"Otomatis keisi di semua kucing owner, jika ada anjing tidak termasuk. Sesuai kategori jenis di produknya"*

**Konteks masalah:** Transaksi pembelian di POS dicatat di level pelanggan (owner), bukan selalu terikat ke satu ekor anabul spesifik. Saat menampilkan "riwayat pembelian" di halaman detail seekor anabul tertentu, sistem harus bisa menentukan transaksi mana yang relevan untuk anabul itu.

**Business rule yang harus diimplementasikan:**
1. Setiap produk di master data perlu field kategori spesies target — contoh: `target_species` dengan value `kucing` / `anjing` / `universal` / dll, mengikuti kategori jenis hewan yang sudah ada di Bagian III PRD (manajemen stok obat/pakan/aksesori).
2. Saat pelanggan melakukan transaksi pembelian produk dengan `target_species = kucing`, transaksi tersebut **otomatis muncul di riwayat pembelian SEMUA anabul kucing milik pelanggan itu** — karena sistem tidak tahu pasti dibeli untuk kucing yang mana.
3. Jika `target_species` tidak match dengan jenis anabul (misal pelanggan beli pakan kucing tapi anabulnya anjing), transaksi **tidak ditampilkan** di riwayat anabul tersebut.
4. **[OPEN QUESTION]** Apakah perlu opsi manual override di kasir — kasir bisa pilih anabul spesifik saat transaksi (misal pelanggan bilang "ini buat si Mio") supaya atribusi lebih akurat daripada selalu broadcast ke semua anabul sejenis? Ini akan menghindari riwayat pembelian yang "kotor" untuk pelanggan dengan banyak kucing.

**Rekomendasi skema:** tabel `products` punya kolom `target_species`; view/query riwayat pembelian per-anabul: `WHERE customer_id = :owner AND (product.target_species = pet.species OR product.target_species = 'universal' OR transaction_item.pet_id = :pet_id)`.

### 1.4 Program Loyalitas & Poin Reward

Struktur yang terlihat di mockup (hal. 2):

- **Program Member**: tiap program (Diskon Birthday, Cashback Grooming, Paket Hemat Platinum) punya `periode` (tanggal mulai–selesai), `status` (Aktif/Tidak Aktif), `benefit` (bisa berupa diskon % atau cashback %). Struktur ini perlu jadi tabel `loyalty_programs` yang bisa di-assign per tier membership, bukan hardcode.
- **Poin Reward**: perlu tracking `total_poin`, `poin_digunakan`, dan **`poin_kadaluarsa` dengan tanggal expiry** (mockup: "1.200 Poin, kadaluarsa 30 Nov 2026") — ini konfirmasi bahwa poin punya masa berlaku, bukan poin permanen. Setiap transaksi poin (+/-) dicatat di ledger dengan referensi ke nomor invoice.

### 1.5 Tampilan Riwayat Medis di Profil Anabul

Halaman detail anabul (hal. 3–4) menampilkan ringkasan kesehatan terintegrasi: Kondisi Saat Ini, Keluhan Terakhir, Penyakit yang Pernah Diderita, Obat Rutin, Dokter Hewan Utama, Klinik Utama. Ini sebaiknya jadi **materialized view / computed summary** dari data Rekam Medis (lihat Bagian 3), bukan field yang diisi manual berulang, supaya selalu sinkron dengan riwayat kunjungan aktual.

---

## 2. Modul POS & Inventory — Petshop

### 2.1 Shift Management

Setiap sesi kasir dimulai dengan input "Uang di Kasir Saat Ini" (modal awal kas) sebelum tombol "Mulai Shift" aktif, dan diakhiri dengan "Selesai Shift". Perlu tabel `cashier_shifts` mencatat: `opening_balance`, `opened_at`, `opened_by`, `closing_balance` (untuk rekonsiliasi kas saat tutup shift), `closed_at`. Ini relevan untuk modul Finance & Accounting — selisih kas saat tutup shift harus tercatat sebagai jurnal otomatis.

### 2.2 Notifikasi Promo & Target

**Temuan (hal. 8):** Anotasi pada ikon bell di header POS:
> *"Notif Pemberitahuan Promo Baru dan target dll"*

Bell icon di header POS (Petshop & Klinik) perlu jadi notification center yang menampilkan: promo baru yang baru di-publish ke cabang, progress target harian/bulanan frontliner (lihat juga Bagian 4 — terhubung dengan fitur gamifikasi). Perlu tabel `notifications` dengan `branch_id`, `recipient_role`, `type` (promo/target/system), `read_status`.

### 2.3 [NEW] Cross-sell Reminder Popup saat Checkout

**Temuan (hal. 9):** Saat kasir sedang memproses keranjang belanja, muncul popup overlay:
> *"REMINDER PROMO — Tawarkan Promo Bundling Lala, Tawarkan Promo Tebus Murah"*

Ini fitur baru: sistem perlu mendeteksi item di keranjang dan secara otomatis menyarankan promo cross-sell/upsell yang relevan (bundling atau tebus murah) ke kasir secara real-time, sebelum transaksi selesai. Implementasi:
- Tabel `promo_rules` dengan trigger condition (misal: jika cart berisi produk kategori X, tampilkan promo Y).
- Popup non-blocking yang muncul otomatis saat kondisi match, kasir bisa dismiss atau apply.
- **[OPEN QUESTION]** Apakah rule promo ini dikonfigurasi manual oleh admin per cabang, atau global dari pusat? Perlu dikonfirmasi ke Aldi karena berdampak ke desain dashboard admin promo.

### 2.4 Stock Request/Receipt Workflow

Mockup (hal. 11–13, 28) mengkonfirmasi status enum untuk alur Permintaan Barang antar cabang–gudang pusat:

```
Menunggu Persetujuan → Disetujui → Dikirim → Selesai
                      → Ditolak
```

Field penting di Penerimaan Barang: `Dipesan` vs `Diterima` (qty) per item, `Kondisi` (Baik/Rusak/dll) per item, `Selisih` (computed: dipesan − diterima), dukungan **Scan Barcode** saat penerimaan, dan field `Referensi` yang menghubungkan penerimaan ke nomor permintaan asal (PRM-xxx) — ini penting untuk audit trail rantai pasok antar gudang/cabang.

### 2.5 Modul Pengeluaran (Expense Tracking)

Konsisten muncul di Petshop dan Klinik (hal. 10, 27). Field: Tanggal, Kategori (Operasional, Listrik & Air, Perlengkapan, Transportasi, Perawatan, Lain-lain — sebaiknya jadi master kategori yang bisa di-manage admin), Deskripsi, Jumlah, Metode Pembayaran, Bukti (upload foto/PDF, opsional, maks 2MB). Halaman summary menampilkan total Hari Ini / Bulan Ini / Tahun Ini per cabang — ini harus terhubung ke jurnal akuntansi otomatis (kategori expense → COA mapping) sesuai prinsip "zero-error" di modul Finance.

---

## 3. Modul Smart Clinic + Rawat Inap

### 3.1 Branch Selector di Dashboard

**Temuan (hal. 16):** Anotasi "Tambah data cabang" pada dashboard utama klinik. Dashboard awal staff klinik perlu menu/dropdown untuk memilih cabang yang sedang dioperasikan (relevan karena dokter floating bekerja lintas cabang — sudah dicatat sebagai temuan audit sebelumnya). Pastikan RLS Supabase membatasi data yang terlihat sesuai cabang yang dipilih staff saat itu.

### 3.2 Pendaftaran Pasien Baru

**Temuan (hal. 17):** Dua anotasi penting:

1. **"Bisa memanggil data anabul existing"** — form pendaftaran perlu fitur search/autocomplete untuk pelanggan/anabul yang sudah pernah terdaftar (by nomor HP atau nama), supaya staff tidak perlu input ulang data lengkap untuk pelanggan lama. Ini juga jadi entry point natural untuk logic atribusi di Bagian 1.3.
2. **"Simpan dan Pembayaran"** — tombol simpan pendaftaran sebaiknya punya dua jalur: (a) Simpan Pendaftaran biasa, dan (b) Simpan + langsung lanjut ke pembayaran (misal untuk biaya pendaftaran/booking fee jika ada). **[OPEN QUESTION]** Perlu konfirmasi ke Aldi: apakah ada biaya pendaftaran yang harus dibayar di muka, atau ini hanya soal UX flow yang mempercepat ke invoice setelah kunjungan selesai?

### 3.3 Antrian Pasien (Queue Management)

Status enum: `Menunggu` → `Sedang Diperiksa` → `Selesai`. Dashboard antrian (hal. 18) menampilkan: counter real-time per status, breakdown antrian per poli (Poli Umum, Poli Gigi, Poli Bedah, Poli Kulit, dst — sebaiknya jadi master data `poli` yang configurable), estimasi waktu tunggu per pasien, dan kartu "Panggilan Berikutnya" dengan tombol "Panggil Sekarang" — kemungkinan terhubung ke sistem panggilan suara/display di ruang tunggu (perlu dikonfirmasi apakah perlu integrasi hardware atau cukup notifikasi visual).

### 3.4 [CRITICAL] Visit Workflow State Machine

Mockup Rekam Medis (hal. 20) secara eksplisit menampilkan stepper status kunjungan yang harus jadi **state machine resmi** untuk setiap kunjungan pasien:

```
1. Pendaftaran → 2. Antrian → 3. Rekam Medis → 4. Rawat Inap → 5. Racik Obat → 6. Pembayaran
```

Setiap tahap punya status sendiri (Selesai / Proses / Belum), dan tahap 4–5 (Rawat Inap, Racik Obat) bersifat **kondisional** — hanya muncul jika dokter memutuskan pasien perlu rawat inap dan/atau ada obat racikan dalam resep. Ini perlu dimodelkan sebagai field `visit_status` di tabel `visits` dengan kemungkinan tahapan yang skip jika tidak relevan, plus tabel log perubahan status untuk audit trail (siapa yang mengubah status dan kapan).

### 3.5 Rekam Medis — Catatan Resep per Item

**Temuan (hal. 20, 24):** Anotasi "Tambah resepnya" muncul berulang di keranjang Input Obat & Jasa, di samping setiap item obat. Saat ini hanya ada satu field "Catatan Resep" global untuk seluruh keranjang. Owner kemungkinan ingin instruksi dosis/aturan pakai **per item obat**, bukan hanya satu catatan gabungan. **[OPEN QUESTION]** Perlu konfirmasi: apakah field global "Catatan Resep" cukup (seperti contoh di mockup: "Amoxicillin 2x sehari 1 tablet, Mix Sirup 2x sehari 1 sendok...") atau memang perlu field `dosage_instruction` terpisah per baris item di tabel `prescription_items`? Rekomendasi: implementasikan field per-item supaya lebih terstruktur dan bisa dicetak rapi di resep, sekaligus tetap sediakan field catatan umum untuk instruksi tambahan.

### 3.6 Transisi Rekam Medis → Rawat Inap

**Temuan (hal. 21):** Anotasi popup pada tombol "Simpan & Lanjut Rawat Inap":
> *"Catatan Rawat Inap — Rencana tindakan dari dokter PIC"*

Saat dokter memutuskan pasien lanjut rawat inap dari rekam medis kunjungan biasa, sistem harus menangkap **rencana tindakan awal** (treatment plan) dari dokter penanggung jawab (PIC) sebagai bagian dari proses handoff — field ini terpisah dari catatan rekam medis kunjungan, dan jadi entry pertama di riwayat rawat inap pasien tersebut.

### 3.7 [CRITICAL] Enum Status Kondisi Rawat Inap

**Temuan (hal. 24):** Anotasi eksplisit:
> *"Tambah Kondisi: Sembuh, Stabil, Kritis, RIP"*

Field `kondisi` pada laporan rawat inap harian wajib pakai enum berikut (bukan free text):

```
'sembuh' | 'stabil' | 'kritis' | 'rip'
```

Catatan UX sensitif: status `rip` (pasien meninggal) adalah status yang secara emosional sensitif untuk pemilik anabul. Rekomendasi: tambahkan konfirmasi dua-langkah sebelum status ini bisa disimpan, dan pertimbangkan alur notifikasi ke pemilik yang lebih manusiawi (bukan notifikasi WA otomatis generik) — ini sebaiknya didiskusikan langsung dengan Aldi soal SOP komunikasi ke pelanggan dalam situasi ini.

### 3.8 Laporan Rawat Inap Harian

Setiap pasien rawat inap punya log harian (hal. 23) dengan kolom: Tanggal, Waktu, Kondisi Pasien (free text deskriptif), Tindakan, Keterangan, Oleh (dokter/staff), dan tombol Detail. Ini adalah audit trail wajib per pasien rawat inap — satu pasien bisa punya banyak entry log per hari (terlihat dari contoh 2 entry di tanggal yang sama, jam berbeda). Status Rawat Inap dashboard (hal. 22) menampilkan agregat lintas cabang: Total Rawat Inap, Rawat Inap Hari Ini, Sembuh/Boleh Pulang, Kritis — ini bisa jadi computed view dari status terbaru tiap pasien aktif.

### 3.9 Racik Obat (Compounding Workflow)

Mockup (hal. 25) mengkonfirmasi fitur peracikan obat sebagai bagian resmi dari alur klinik (bukan hanya pemberian obat jadi). Field: Nama Racikan, Komposisi (list bahan + qty per bahan), Aturan Pakai, Jumlah Racikan (total volume hasil), Bentuk Sediaan (Cair/Sirup/Nebul/dll), Petunjuk Racik (instruksi step-by-step). Status akhir: "Obat Siap Diserahkan" — ini perlu jadi state (`diracik` → `siap_diserahkan` → `diserahkan`) yang terhubung balik ke status step 5 di state machine kunjungan (Bagian 3.4). Perlu juga: pengurangan stok bahan baku racikan dari inventory saat racikan dibuat (terhubung ke modul Inventory FIFO).

### 3.10 Invoice — Item Editable & Down Payment

**Temuan (hal. 26):** Anotasi "Buat bisa di edit" pada bagian item Obat di invoice. Saat ini alur menyiratkan item obat/jasa terkunci dari tahap rekam medis. Owner ingin staff kasir/finance bisa **mengedit line item** (qty, harga) langsung di tahap invoice — kemungkinan untuk koreksi sebelum pembayaran final. **[OPEN QUESTION]** Ini berisiko terhadap integritas data rekam medis vs data billing (prinsip "zero-error" di modul Finance) — perlu didiskusikan dengan Aldi: apakah edit ini perlu approval/log perubahan terpisah (audit trail siapa yang edit, kapan, dari berapa ke berapa) supaya tidak membuka celah manipulasi billing tanpa jejak.

Struktur DP (Down Payment) juga eksplisit di mockup: `Tanggal DP`, `Jumlah DP`, `Status DP Dibayar`, `Sisa Setelah DP` — ini konfirmasi bahwa partial payment / DP adalah fitur resmi v1, bukan cuma pelunasan penuh di akhir. Status pembayaran invoice: `Belum Lunas` / `Lunas` (kemungkinan perlu tambahan `DP Dibayar` sebagai status antara).

---

## 4. Fitur Baru di Luar Scope Awal — Perlu Keputusan Scope

### 4.1 Daily/Monthly Quest & Target (Gamifikasi Frontliner)

**Temuan (hal. 29) — ditandai Aldi sendiri sebagai "Out of the Box":**
> *"Request fitur Daily dan Monthly Quest/Target buat frontliner di klinik dan Petshop. Integrasi dengan insentif tapi ada dashboard di masing-masing frontend. Tujuan supaya semangat anak dilapangan untuk kejar target harian atau bulanan."*

Ini adalah **fitur baru di luar 7 modul yang sudah disepakati di PKS** — sebuah sistem gamifikasi/incentive tracking untuk staff frontliner (kasir/dokter/admin cabang) dengan:
- Target harian dan bulanan (kemungkinan berbasis omset, jumlah transaksi, atau metrik lain — belum spesifik).
- Integrasi dengan perhitungan insentif (kemungkinan terhubung ke modul HRIS/Payroll untuk komponen bonus).
- Dashboard progress per frontliner di masing-masing aplikasi (Petshop POS dan Klinik).

**[OPEN QUESTION] — Ini wajib didiskusikan formal dengan Aldi sebelum masuk development, sesuai prinsip scope discipline proyek ini:**
1. Apakah fitur ini masuk scope v1 (Oktober–November 2026) atau didorong ke v2 mengingat sifatnya "nice-to-have" dan belum ada di PRD/PKS asli?
2. Apa metrik target yang dipakai (omset, jumlah transaksi, jumlah pasien, dll) dan apakah berbeda antara role di Klinik vs Petshop?
3. Bagaimana mekanisme insentif dihitung — apakah otomatis masuk ke payroll, atau hanya tracking/leaderboard tanpa payout otomatis dulu di v1?
4. Apakah ini berdampak ke kontrak (penambahan fitur di luar 7 modul PKS) sehingga perlu adendum kontrak seperti halnya keputusan platform Supabase?

**Rekomendasi:** Jangan commit tanggal atau scope ke Aldi soal fitur ini sebelum poin di atas dijawab — perlakukan sebagai item discovery baru, bukan bagian dari Fase 1 yang sedang berjalan.

---

## 5. Ringkasan Open Questions ke Aldi

1. Multi-pet purchase attribution — perlu manual override pilih anabul spesifik di kasir, atau cukup auto-broadcast by kategori spesies? *(Bagian 1.3)*
2. Cross-sell promo reminder — konfigurasi rule promo manual per cabang atau global dari pusat? *(Bagian 2.3)*
3. Pendaftaran pasien — apakah ada biaya pendaftaran di muka yang perlu dibayar saat itu juga? *(Bagian 3.2)*
4. Catatan resep — perlu field per-item obat terpisah, atau cukup satu field catatan resep global? *(Bagian 3.5)*
5. Edit item invoice — perlu approval/audit log terpisah untuk perubahan qty/harga di tahap billing? *(Bagian 3.10)*
6. Fitur gamifikasi frontliner — masuk scope v1 atau v2? Metrik target apa? Terhubung payroll atau leaderboard saja? *(Bagian 4.1)*

---

## 6. Prioritas Implementasi yang Disarankan

**Wajib didesain di level skema database sebelum coding jalan (high-impact terhadap integritas data):**
- Visit workflow state machine (3.4)
- Multi-pet purchase attribution logic (1.3)
- Enum status kondisi rawat inap (3.7)
- Struktur DP/partial payment di invoice (3.10)

**Bisa dikerjakan paralel, dampak lebih terisolasi:**
- Field tambahan customer & pet (1.1, 1.2)
- Shift management (2.1)
- Stock request/receipt status flow (2.4)
- Pengeluaran module (2.5)
- Racik Obat workflow (3.9)

**Tunda sampai open question terjawab:**
- Cross-sell reminder popup (2.3)
- Edit invoice item + audit log (3.10, bagian editable-nya)
- Gamifikasi frontliner (4.1) — kemungkinan besar v2
