# VetOS — Status Audit (Kode vs PRD v2.0)

**Tanggal audit:** 2026-07-19
**Metode:** verifikasi langsung ke kode (`src/`, `supabase/migrations/`), bukan dari dokumentasi/memory saja.
**Sumber PRD:** `Dokumen/PRD_VetOS_v2.0.md`, `Dokumen/update/VetOS_Spec_Addendum_v1.md`

Legend: `[x]` selesai · `[~]` sebagian (partial) · `[ ]` belum mulai

---

## FASE 1 — Fondasi (SELESAI, 2026-06-28)

- [x] Next.js 15 scaffold + Supabase core schema (branches, warehouses, profiles, user_branches, item_categories, items, customers, pets)
- [x] Branch-isolation RLS
- [x] Auth email/password
- [x] Seed 22 cabang, 27 gudang, 6 kategori item (dari audit Accurate)
- [x] Test user owner@vetos.local (OWNER) + staff@vetos.local (STAFF, 1 cabang) — RLS isolation terverifikasi
- [x] Push ke GitHub

Target PKS Fase 1 ("PRD v2.0, SOP Mapping, Supabase Schema, Prototype Auth") — **tercapai semua.**

---

## FASE 2 — Smart Clinic + POS MVP, Finance core, HRIS dasar

### Module 01 — Smart Clinic + Rawat Inap

**6.1 Registrasi & Booking**
- [x] Customer/pet fields lengkap (dob, berat, foto) — `supabase/migrations/0001_core.sql`
- [x] Antrian digital realtime — `src/app/(app)/klinik/antrian/LiveRefresh.tsx` (Supabase Realtime channel, bukan polling)
- [ ] Booking janji temu (pilih dokter/slot waktu/cabang/tipe kunjungan) — TIDAK ADA. Gak ada tabel appointment/booking, registrasi langsung jadi tiket antrian (walk-in only)
- [ ] Fuzzy search customer by nama/HP — sekarang exact-match phone lookup, bukan fuzzy/ilike

**6.2 Rekam Medis**
- [x] Satu record per visit, linked ke customer+hewan+dokter+cabang — `supabase/migrations/0006_rekam_medis.sql`
- [x] Riwayat kunjungan lengkap per hewan (lintas cabang) — `klinik/antrian/[id]/page.tsx` + `RiwayatTabs.tsx`
- [~] Field pemeriksaan fisik — cuma suhu+berat badan ada (`0040_rekam_medis_fields.sql`), field HR (detak jantung) + RR (laju napas) TIDAK ADA
- [ ] Riwayat vaksinasi (jenis, tanggal, jatuh tempo) — TIDAK ADA tabel vaccinations sama sekali. "Vaksinasi" cuma string tipe kunjungan
- [ ] Akses dokter cross-branch via RLS proper — RLS klinik saat ini `using(true)` untuk semua authenticated user (`0039_demo_relax_klinik.sql`, komentar eksplisit "PROTOTYPE ONLY — produksi kembalikan ke user_can_access_branch"). **Ini flag keamanan sebelum data pelanggan asli masuk.**

**6.3 Tindakan & Resep Elektronik**
- [x] Worklist racikan (compounding): pending→ready→handed_over — `src/lib/compounding.ts`, tested
- [~] Auto-potong stok obat — cuma jalan buat item racikan (`klinik/rekam-medis/[visitId]/actions.ts`). Item "Obat" biasa di keranjang TIDAK motong stok
- [ ] e-Resep sebagai PDF generate — sekarang cuma `window.print()` HTML, bukan PDF real
- [ ] Kategorisasi tindakan (Konsultasi/Vaksinasi/Operasi/Grooming/Rawat Inap/Lab) — TIDAK ADA, "Jasa" cuma free-text input
- [ ] Consent form digital operasi/bedah — dekoratif doang, hardcode teks "Ditandatangani", tanpa capture tanda tangan atau tabel backing

**6.4 Rawat Inap**
- [x] Admission record (tanggal masuk, dokter PIC, diagnosis) — `supabase/migrations/0030_inpatient.sql`
- [x] Status rawat inap (skema Addendum: stabil/kritis/sembuh/rip — beda dari PRD asli Aktif/Observasi/Siap Pulang/Selesai, tapi fungsional)
- [x] Daily care notes (append-only log) — `src/lib/inpatient.ts`
- [ ] Field ruangan/kennel assigned — TIDAK ADA kolom
- [ ] Field estimasi lama rawat — TIDAK ADA kolom
- [ ] Tarif rawat inap per malam (configurable per cabang) — TIDAK ADA
- [ ] Billing formula tarif×hari + tindakan + obat digabung — discharge cuma nyambung ke invoice generic, tanpa kalkulasi hari
- [ ] Discharge summary (kondisi akhir, instruksi rumah, obat pulang, follow-up plan) — TIDAK dimodelkan
- [~] Obat harian rawat inap — insert prescription_items tapi TIDAK potong stok (gap sama seperti 6.3)
- [ ] Auto-journal khusus "Pendapatan Rawat Inap" [400002] — TIDAK ADA, masuk generic "Pendapatan jasa klinik"

**6.5 Pembayaran Klinik**
- [x] Manual confirm tunai/QRIS/transfer/kartu — `klinik/pembayaran/[visitId]/PembayaranForm.tsx`
- [x] Auto-generate faktur/kwitansi — `klinik/pembayaran/[visitId]/invoice/page.tsx`, `struk/page.tsx`
- [ ] Multi-payment split (sebagian tunai + sebagian QRIS dalam 1 transaksi) — TIDAK BISA, cuma 1 metode per invoice. (Tabel `invoice_payments` ada tapi cuma dipakai di AR installment `keuangan/piutang`, belum dipasang ke klinik checkout)

---

### Module 02 — POS & Inventory

**7.1 Point of Sale**
- [x] Multi-metode bayar (Tunai/Debit/Kredit/QRIS/E-Wallet)
- [x] Diskon per-item + per-transaksi — `src/lib/pos-calc.ts`
- [x] Member lookup by HP + tier badge
- [x] Redeem poin saat checkout
- [x] Struk digital via print
- [ ] Search produk by barcode/UPC — kolom `items.upc` ADA di schema tapi ZERO dipakai di search (cuma nama/kode)
- [ ] Rate poin configurable — hardcode konstanta (`POIN_PER_RUPIAH=1000`), bukan dari settings
- [ ] Struk via WA — `sendWA` (`src/lib/fonnte.ts`) TIDAK pernah dipasang ke flow kasir, cuma print
- [ ] Bundle/paket produk sebagai SKU beneran — TIDAK ADA, "bundling" cuma label reminder promo

**7.2 Loyalty & Tier**
- [x] Threshold tier configurable dari dashboard — `pengaturan/tier`, tabel `tier_settings` (`0042_tier_kategori_otomatis.sql`)
- [~] Basis tier — pakai Rp-spending threshold (Bronze/Silver/Gold/Platinum/New), BEDA dari PRD yang basis poin (New/Regular/Silver/Gold/VIP)
- [ ] Earn-rate multiplier per tier — TIDAK ADA, flat rate semua tier
- [ ] Tier downgrade rule (configurable, inactivity-based) — TIDAK ADA
- [ ] Poin expiry (configurable) — TIDAK ADA

**7.3 Inventory Management**
- [x] Stok real-time per gudang per item — `stock` table (`0013_stock.sql`)
- [x] Transfer stok antar gudang dengan approval — `stock_requests`/`stock_receipts`, role-gated (`src/lib/stock-recon.ts`)
- [ ] Expired date tracking — kolom `item_categories.track_expiry` ADA tapi ZERO referensi di kode, dan `stock_receipt_items` tidak punya kolom expiry sama sekali
- [ ] Batch/lot number — kolom `track_batch` ADA tapi ZERO referensi, tidak ada kolom batch di receipts
- [ ] Reorder point alert — `items.min_stock` ADA tapi ZERO referensi di seluruh `src/`. Tile "Reorder alert"/"Monitor expired" di nav = placeholder tanpa href

**7.4 Online/B2C Channel**
- [ ] Semua — TIDAK ADA. Cuma enum value `'ONLINE'` di type definition + 1 nav tile placeholder. Zero implementasi WH B2C/ONLINE, zero Sales Order channel online

**7.5 Komisi Grooming**
- [ ] Semua — TIDAK ADA. Zero kode, zero tabel, tidak nyambung ke payroll

---

### Module 05 — Finance & Accounting (PALING KRITIS di PRD)

**10.1 Chart of Accounts**
- [~] CoA ADA (`supabase/seed.sql`, `0022_bank_rec.sql`, `0043_ar_ap_fixed_assets.sql`) tapi skema kode beda (4-digit, bukan PRD 6-digit)
- [ ] Akun yang HILANG: PPh21 hutang, BPJS hutang×4, BPJS beban×2, Piutang Karyawan, PPN Masukan, Uang Muka Penjualan, Hutang Pembelian Belum Ditagih, Persediaan Terkirim, revenue split Rawat Inap/Grooming, Retur Penjualan contra, Diskon Penjualan contra, bank per-cabang
- [ ] CRUD UI untuk CoA — sekarang read-only display

**10.2 HPP Calculation — FIFO**
- [ ] **TIDAK ADA SAMA SEKALI.** Zero tabel `stock_ledger_entries`/`fifo_stock_queue`, zero fungsi `depleteFIFO`. HPP sekarang = `items.buy_price` statis × qty terjual — bukan FIFO, bukan bahkan weighted-average. **PRD tandai ini CRITICAL.**

**10.3 PPh 21 Calculation**
- [ ] **TIDAK ADA.** Zero kode PTKP/tarif progresif/kalkulasi. Repo-wide grep nol hasil.

**10.4 BPJS Calculation**
- [ ] **TIDAK ADA.** Zero kode Kesehatan/Ketenagakerjaan, zero rate constant.

**10.5 Payroll Auto-Journal**
- [x] Jurnal auto-post saat payroll run — `hris/penggajian/actions.ts` via `postJournal`
- [~] Versi sangat disederhanakan: gaji_pokok+tunjangan-potongan generic, BUKAN breakdown itemized (PPh21/BPJS employer+employee/lembur/insentif/kasbon per baris seperti PRD)

**10.6 Penyusutan Aset Tetap**
- [x] Kalkulasi straight-line benar + jurnal benar — `keuangan/aset/actions.ts` (`jalankanPenyusutan`)
- [ ] Auto-run cron tanggal 1 tiap bulan — TIDAK ADA, manual button trigger saja. **Repo ini tidak punya infra cron sama sekali** (vercel.json tanpa `crons`, tidak ada `/api` routes)

**10.7 Stock Transfer Journal**
- [ ] **TIDAK ADA.** Transfer gudang TIDAK dijurnal — ada komentar eksplisit di kode "tidak dijurnal ulang" (`kasir/persediaan/actions.ts`)

**10.8 Stock Opname Adjustment**
- [ ] **TIDAK ADA.** Fitur stock count/adjustment tidak ada, zero jurnal selisih.

**10.9 Laporan Keuangan**
- [x] Laba Rugi, Neraca (dengan balance-check), Arus Kas (metode langsung), AR Aging, AP Aging — semua real data, jalan bagus (`keuangan/*`, `src/lib/ledger.ts`, `src/lib/aging.ts`)
- [ ] Laporan HPP terpisah (breakdown per item/kategori/cabang) — TIDAK ADA
- [ ] Export PDF/Excel — TIDAK ADA (tidak ada dependency pdf/xlsx di package.json)
- [ ] Daily Digest WA ke Owner jam 07:00 — TIDAK ADA (butuh cron, lihat 10.6)

---

### Module 06 — HRIS dasar

**11.1 Master Karyawan**
- [~] Field dasar ada (nik, nama, jabatan, departemen, branch_id tunggal, phone, email, gaji_pokok, status) — `0016_hris.sql`
- [ ] KTP, tempat/tanggal lahir, NPWP, status wajib pajak (TK/K/K1/K2/K3), no. BPJS, rekening bank+nama pemilik, status kontrak+tanggal akhir — **TIDAK ADA satupun**
- [ ] Multi-branch assignment (dokter floating) — TIDAK ADA tabel `employee_branch_assignments`, employee cuma 1 `branch_id`

**11.2 Komponen Gaji**
- [~] Cuma 3 angka: gaji_pokok + tunjangan (freeform) + potongan (freeform)
- [ ] Semua komponen granular PRD (Tunjangan 1/2 split, Uang Lembur, Presensi per Klinik, Insentif per Klinik/Achievement PIC/Grooming/Rawat Inap, Komponen Manual, Denda Keterlambatan, Potongan Kasbon, BPJS breakdown, PPh 21) — **TIDAK ADA**

**11.3 Absensi Geolokasi**
- [x] Check-in/check-out (waktu server)
- [ ] Geolocation API — **TIDAK DIPAKAI SAMA SEKALI**, zero `navigator.geolocation`
- [ ] Radius verification per cabang, flag "Di Luar Lokasi" — TIDAK ADA
- [ ] Prompt "check-in di klinik mana?" untuk dokter floating — TIDAK ADA

**11.4 Shift Management (karyawan)**
- [ ] Master shift karyawan (nama shift, jam masuk/keluar, istirahat), assignment per karyawan — TIDAK ADA. (Yang ada = shift kasir/cash-drawer, fitur beda dari Addendum §1, bukan ini)

**11.5 Overtime/Lembur**
- [~] Numpang di tabel `leave_requests` sebagai jenis "Lembur", approval jalan
- [ ] Auto-masuk komponen "Uang Lembur" di payroll — TIDAK BISA (komponen lembur di payroll tidak ada, lihat 11.2)
- [ ] Rate lembur configurable, field jam mulai/selesai terpisah — TIDAK ADA (cuma 1 field durasi numerik)

**11.6 Cuti & Izin**
- [x] Request + approval workflow jalan (`hris/cuti`, `/me/CutiForm.tsx`)
- [~] Jenis cuti generic ("Cuti/Izin/Sakit/Lembur"), bukan subtipe PRD (Tahunan/Sakit/Melahirkan/Khusus)
- [ ] Saldo cuti / leave balance, opening balance dari GajiHub, auto-deduct — **TIDAK ADA**

**11.7 Payroll Run**
- [x] Approve → auto-jurnal — jalan (`hris/penggajian/actions.ts`)
- [ ] Grouping/filter ("Gaji Dokter Bogor" dsb) — TIDAK ADA, proses semua karyawan sekaligus
- [ ] Auto-calc dari attendance/insentif/komisi/lembur/BPJS/PPh21 — TIDAK ADA (semua input manual freeform)
- [ ] Download Slip Gaji Massal — TIDAK ADA
- [ ] Export bank transfer format (BCA) — TIDAK ADA

**11.8 KPI Tracking**
- [x] Target vs realisasi per karyawan/metrik/periode — jalan (`0020_kpi.sql`, `hris/kpi`)
- [ ] Target master per jabatan — TIDAK ADA (target ad hoc per row, bukan derived dari jabatan)
- [ ] Link eksplisit ke "Insentif Achievement PIC" payroll — TIDAK BISA (komponen itu tidak ada di payroll)

---

## DI LUAR SCOPE FASE 2 tapi SUDAH DIBANGUN
(fitur tambahan dari Addendum v1 + request lanjutan Aldi, 2026-07-03 s.d. sekarang — semacam "Fase 2.5")

- [x] Shift kasir + closing per-metode pembayaran + laporan shift
- [x] POS diskon per-item + tabel promo + reminder promo popup
- [x] Invoice edit/void/reissue dengan audit log (`invoice_edit_log`) + reversal jurnal otomatis
- [x] Racikan/compounding worklist (§2 Addendum)
- [x] Antrian digital + panggilan panel realtime (§4 Addendum)
- [x] Quest gamification — 7 tabel, ledger immutable, dashboard staff (`kasir/quest`) + admin (`pos/quest`)
- [x] Staff Personal Dashboard `/me` (quest ringkasan, KPI pribadi, absensi, pengajuan cuti)
- [x] Promo per-cabang per-tanggal (`crm/promo`)
- [x] Tier/kategori pelanggan otomatis (`pengaturan/tier`, `computeTier`/`recomputeCustomerTier`)
- [x] Owner detail stat row (rata2/poin/total transaksi) di antrian

---

## Module 03 — Pembelian (Purchasing) — BELUM DIMULAI (kecuali PO dasar)

**8.1 Purchase Order**
- [x] Buat PO (supplier, item+qty+harga, gudang tujuan, tanggal) — `pembelian/actions.ts`
- [ ] Approval gate (manager/owner approve) — TIDAK ADA role/permission check, siapapun bisa transisi status
- [ ] Auto-generate PO dari reorder point alert — TIDAK ADA (reorder alert sendiri belum ada, lihat 7.3)

**8.2 Penerimaan Barang (Goods Receipt)**
- [~] Digabung ke transisi status PO ("Diterima"), bukan step terpisah
- [ ] Input qty aktual berbeda dari PO — TIDAK BISA, seluruh PO diterima sekaligus
- [ ] Expired date + lot/batch per penerimaan — TIDAK ADA kolom
- [ ] Partial receipt — TIDAK ADA

**8.3 Faktur Pembelian (Purchase Invoice)**
- [ ] **TIDAK ADA TABEL SAMA SEKALI.** Hutang lahir langsung dari `purchase_orders.status='Diterima'`, skip step invoice. Zero 3-way matching, zero field nomor faktur/PPN Masukan/PKP flag

**8.4 Pembayaran Pembelian**
- [x] Partial payment, jurnal benar (`keuangan/hutang/actions.ts`)
- [ ] Batch payment (banyak faktur → 1 transaksi ke 1 supplier) — TIDAK ADA, 1 PO per pembayaran

**8.5 Retur Pembelian**
- [ ] **TIDAK ADA SAMA SEKALI.** Zero tabel, zero halaman, zero jurnal.

---

## Module 04 — Penjualan (Sales) — SEBAGIAN BESAR BELUM DIMULAI

**9.1 Sales module (Quote/SO/DO/DP/Invoice/Receipt/Return/SmartLink)**
- [ ] **TIDAK ADA sebagai modul transaksi.** Halaman `/penjualan` cuma dashboard read-only (agregat dari data POS+Klinik). Semua tile di nav (Sales Quote, SO, DO, DP, Sales Invoice, Sales Receipt, Sales Return, SmartLink) = placeholder tanpa href

**9.2 Komisi Penjual (3 tipe)**
- [ ] **TIDAK ADA.** Zero tabel, zero kalkulasi, zero Excel import, tidak nyambung payroll

**9.3 Target Penjualan**
- [ ] **TIDAK ADA.** Zero tabel, zero dashboard tracking

**9.4 Auto-Journal Penjualan**
- [~] Logic jurnal jalan tapi numpang di flow POS (`pos/transaksi/actions.ts`) dan Klinik (`klinik/pembayaran/[visitId]/actions.ts`), bukan modul Penjualan dedicated
- [x] Sales tunai + HPP journal (POS)
- [x] Sales non-tunai (piutang) + pelunasan piutang (Klinik + `keuangan/piutang`)
- [ ] Uang Muka Penjualan sebagai akun liability terpisah [210101] — TIDAK ADA, DP dinetkan langsung
- [ ] Retur Penjualan journal — TIDAK ADA sama sekali
- [ ] Diskon Penjualan sebagai akun terpisah [440101] — TIDAK ADA, diskon dinetkan ke total
- [ ] HPP/COGS journal untuk item lewat invoice Klinik — cuma POS checkout yang posting HPP

---

## Module 07 — CRM Layer — SEBAGIAN BESAR BELUM DIMULAI

**12.1 Customer Record**
- [x] Profil lengkap (nama/HP/email/alamat/dob/tier/poin/total_spending) — `crm/pelanggan`
- [x] Daftar hewan linked, riwayat transaksi semua cabang
- [~] Riwayat kunjungan klinik+rawat inap — cuma agregat stat, bukan list itemized
- [ ] Timeline interaksi (semua WA trigger terkirim) — TIDAK ADA, tabel `wa_trigger_log` tidak eksis

**12.2 Promo Management**
- [x] Buat promo (nama/periode/tipe/diskon/target cabang) — `crm/promo`
- [ ] Target promo per tier — TIDAK ADA (cuma per-cabang)
- [ ] Tipe bonus poin — TIDAK ADA di opsi promo_type
- [ ] Distribusi via WA blast/auto-trigger — TIDAK ADA, promo pasif cuma suggestion buat kasir

**12.3 Kategori Pelanggan / Loyalty Tier Management**
- [x] Threshold spending configurable — `pengaturan/tier`
- [ ] Nama tier configurable — hardcoded (Bronze/Silver/Gold/Platinum)
- [ ] Earn rate, benefit, trigger WA per tier configurable — TIDAK ADA, semua hardcode di kode (`PROGRAM_MEMBER` array)
- [ ] Tier downgrade toggle, poin expiry toggle — TIDAK ADA

**12.4 Retention — WA Automation Engine (7 trigger)**
- [ ] **TIDAK ADA SAMA SEKALI — 0% dibangun.** Zero logic untuk 7 trigger (post-grooming, post-treatment, vaksinasi jatuh tempo/terlambat, lama tak berkunjung, ulang tahun pemilik/hewan). Zero cron infra. Zero tabel history log/dedup. `FONNTE_TOKEN` belum di-set di `.env.local` → WA no-op walau ada kode

**12.5 Owner Dashboard (retensi)**
- [ ] **TIDAK ADA.** Zero lapsed customer list, zero tier distribution chart, zero churn/repeat-visit rate, zero revenue-per-tier, zero WA performance metric

---

## Blocker Infra Lintas-Modul

1. **Zero cron infrastructure** — `vercel.json` tanpa key `crons`, zero routes di `src/app/api`. Blokir: depresiasi otomatis (10.6), WA digest harian (10.9), 5 dari 7 trigger WA retensi (12.4)
2. **`FONNTE_TOKEN` belum di-set** — semua WA no-op silently. Satu-satunya call site aktif sekarang = notif duka rawat inap
3. **RLS klinik masih prototype-mode** — beberapa tabel `using(true)` (migration 0039, comment eksplisit "PROTOTYPE ONLY"). Wajib dikencangkan sebelum data pelanggan produksi masuk
4. **HPP bukan FIFO** — pakai `buy_price` statis. PRD tandai FIFO sebagai CRITICAL test priority

---

## FASE 3 — UAT 1-2 cabang pilot, parallel run dengan Accurate
**Belum bisa mulai.** Prasyarat kode yang harus selesai dulu: FIFO HPP, PPh21, BPJS (biar angka akuntansi bisa dibandingkan apple-to-apple dengan Accurate saat parallel run), plus Module 03 Purchase Invoice (biar hutang tercatat benar). Sisanya (UAT plan, jadwal, training staf) = kerja organisasi — belum ada artefak apapun di repo.

## FASE 4 — Full rollout semua cabang, sunset Accurate + GajiHub
Sepenuhnya organisasi/rollout. Tidak ada prasyarat kode tambahan di luar semua modul di atas closed. Belum dimulai.

---

## Prioritas rekomendasi buat nutup Fase 2

1. FIFO HPP engine (`stock_ledger_entries` + `fifo_stock_queue` + `depleteFIFO`) — CRITICAL per PRD
2. PPh 21 + BPJS calculator, breakdown komponen gaji granular
3. Purchase Invoice + 3-way matching (Module 03)
4. Expired date + batch/lot tracking + reorder point alert (Module 02)
5. Cron infrastructure (buat depresiasi otomatis + WA digest + WA retensi)
6. Perketat RLS klinik (`0039_demo_relax_klinik.sql` → kembalikan proper access control) sebelum data pelanggan real masuk
