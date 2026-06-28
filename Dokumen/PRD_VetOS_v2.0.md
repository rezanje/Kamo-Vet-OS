# VetOS — Product Requirements Document v2.0
**PT Kamo Group Sejahtera · Gentanala Digital Advisory**
**Kontrak: PKS/VetOS/2026/001 · Revisi: 28 Juni 2026**
**Status: POST-DISCOVERY FINAL — SIAP DEVELOPMENT**

---

## Changelog v1.1 → v2.0

| Item | Perubahan |
|---|---|
| Rawat Inap | DITAMBAHKAN ke Module 01 (confirmed dari payroll + attendance) |
| B2C / Online Channel | DITAMBAHKAN ke Module 02 (WH B2C, WH ONLINE PDRY, WH ONLINE TKI) |
| Face Verification | DIPINDAH ke v2 — v1 attendance = geolokasi only |
| HRIS Dokter | Model multi-cabang — satu dokter bisa assigned ke beberapa klinik |
| Overtime / Lembur | DITAMBAHKAN — request + approval workflow (existing di GajiHub) |
| HPY Brand | DIKECUALIKAN dari scope — entitas terpisah (produk partner dijual di petshop) |
| Module Pembelian | DITAMBAHKAN sebagai modul terpisah (sebelumnya implisit) |
| Module Penjualan | DIPERBARUI — Komisi & Target sesuai UI reference Aldi |
| Finance Accounting Rules | DIPERLUAS — full double-entry journal rules per transaksi |
| Tier Downgrade Loyalty | Configurable rule dari Owner Dashboard |
| Branch / Warehouse | 22 cabang aktif, 26 gudang aktif (dari audit Accurate) |

---

## 01 · Pernyataan Masalah

Kamo Group mengoperasikan **22 lokasi aktif** (petshop, klinik, dan kombinasi keduanya) di Jawa Barat dan sekitarnya tanpa satu platform terpusat.

**Empat masalah utama:**

1. **Visibilitas lintas cabang nol.** Tidak ada dashboard tunggal yang menampilkan performa semua cabang secara real-time.
2. **Customer journey terputus.** Tidak ada koneksi antara kunjungan klinik, rawat inap, dan aktivitas petshop.
3. **Sistem terfragmentasi.** Accurate (finance) dan GajiHub (HR/payroll) berjalan terpisah tanpa integrasi otomatis.
4. **Komunikasi pelanggan manual.** Tidak ada notifikasi proaktif: vaksinasi, follow-up, grooming, rawat inap, birthday.

---

## 02 · Solusi

VetOS adalah platform manajemen klinik hewan berbasis web (SaaS internal) yang mengintegrasikan seluruh operasional Kamo Group — **menggantikan Accurate dan GajiHub sepenuhnya** pada saat full rollout.

---

## 03 · Scope Decisions — Final & Locked

| # | Keputusan | Status |
|---|---|---|
| 1 | Rawat Inap masuk scope v1 | ✅ LOCKED |
| 2 | B2C/Online channel diintegrasikan ke inventory | ✅ LOCKED |
| 3 | HPY brand dikecualikan (entitas terpisah) | ✅ LOCKED |
| 4 | Face verification defer ke v2 | ✅ LOCKED |
| 5 | Loyalty tier downgrade: configurable dari dashboard | ✅ LOCKED |
| 6 | Tech stack: Next.js 15 + TanStack Query + Vercel + Supabase | ✅ LOCKED |

---

## 04 · Tech Stack

| Layer | Teknologi | Alasan |
|---|---|---|
| Frontend | Next.js 15 App Router | SSR, routing, server actions |
| Data Fetching | TanStack Query (React Query v5) | Cache, optimistic update, invalidation |
| Backend / DB | Supabase (PostgreSQL) | RLS untuk isolasi data cabang |
| Auth | Supabase Auth | JWT + role-based access |
| Storage | Supabase Storage | Foto referensi karyawan (v2 face verify) |
| Hosting | Vercel | Edge deployment, CI/CD |
| WA API | Fonnte | WhatsApp Business gateway, 7 trigger |
| AI Dev | Claude + Context7 MCP (ctx7) | Real-time docs untuk Next.js, Supabase |

**Biaya Operasional Post Go-Live:**
- Vercel Pro: ~Rp 400.000/bulan
- Supabase Pro: ~Rp 400.000–500.000/bulan (tergantung storage)
- Fonnte: ~Rp 300.000–350.000/bulan
- Total: **Rp 1.100.000–1.250.000/bulan** (covered oleh retainer Rp 2.000.000)

---

## 05 · Struktur Cabang & Gudang (dari Audit Accurate)

### Tipe Cabang

| Kode | Tipe | Warehouse | Keterangan |
|---|---|---|---|
| BTKM, GRND, LOJI, MUAR, PDRY, SRKN, TKI, CMGG, CIAW, CMS | PETSHOP | WH [KODE] | Petshop saja atau kombinasi |
| VET CMGG, VET CMS, VET CIAW, VET PDRY, VET SRKN, VET TKI, VET GRDA, VET GRLG | KLINIK | WH VET [KODE] | Klinik hewan |
| DC LOJI, DC TKI | DISTRIBUTION CENTER | WH (khusus) | Central warehouse / distribusi |
| B2C, ONLINE PDRY, ONLINE TKI | ONLINE | WH ONLINE | Channel e-commerce |
| OFFICE | OFFICE | — | Kantor pusat, bukan transaksi |
| VET RE | NON-AKTIF | — | Skip migrasi |

**Skema:** Setiap lokasi yang memiliki petshop + klinik mempunyai **2 gudang terpisah** (WH retail + WH VET). Ini sudah berjalan di Accurate dan harus direplikasi di VetOS.

### Schema Database: Branches & Warehouses

```sql
-- branches
id uuid PK
code varchar(10) UNIQUE  -- 'BTKM', 'VET_CMGG', dll
name varchar(100)
type enum('PETSHOP','KLINIK','BOTH','DC','ONLINE','OFFICE')
is_active boolean
created_at timestamptz

-- warehouses
id uuid PK
branch_id uuid FK branches(id)
code varchar(15) UNIQUE  -- 'WH_BTKM', 'WH_VET_CMGG', dll
name varchar(100)
type enum('RETAIL','VET','EXPIRED','TRANSIT','ONLINE','DC')
is_active boolean
```

---

## 06 · MODULE 01 — Smart Clinic + Rawat Inap

### 6.1 Registrasi & Booking

- Search customer by nama / nomor HP (fuzzy search)
- Registrasi customer baru: nama pemilik, nomor HP, alamat, **tanggal lahir pemilik** (wajib untuk WA trigger #6)
- Registrasi hewan baru per customer: nama hewan, spesies, ras, jenis kelamin, **tanggal lahir hewan** (wajib untuk WA trigger #7), berat badan, foto
- Booking janji temu: pilih dokter, pilih slot waktu, cabang mana, tipe kunjungan (konsultasi / grooming / vaksinasi / rawat inap)
- Antrian digital real-time per cabang

### 6.2 Rekam Medis

- Setiap kunjungan = satu record medis baru, linked ke customer + hewan + dokter + cabang
- Field: tanggal, keluhan utama, anamnesis, pemeriksaan fisik (berat badan, suhu, HR, RR), diagnosis, tindakan, resep, biaya
- Riwayat vaksinasi: jenis vaksin, tanggal vaksin, tanggal jatuh tempo berikutnya (auto-populate WA trigger #3 & #4)
- Riwayat kunjungan lengkap per hewan (semua cabang)
- Rekam medis bisa diakses dokter dari cabang manapun yang assigned

### 6.3 Tindakan & Resep Elektronik

- Dokter input tindakan → sistem auto-potong stok obat dari WH VET cabang aktif
- e-Resep: generate PDF resep yang bisa diprint atau di-share ke pemilik
- Tindakan kategorisasi: Konsultasi / Vaksinasi / Operasi / Grooming / Rawat Inap / Lab
- Consent form digital untuk tindakan operasi/bedah

### 6.4 Rawat Inap (BARU v2.0)

**Admission:**
- Admission record: tanggal masuk, estimasi lama rawat, ruangan/kennel assigned, dokter PIC, diagnosis awal
- Status rawat inap: Aktif / Observasi / Siap Pulang / Selesai

**Daily Care:**
- Input catatan harian: kondisi, tindakan hari ini, obat yang diberikan (auto-potong stok WH VET)
- Tarif rawat inap: per malam (configurable per cabang)
- Dokter bisa input catatan dari luar cabang (floating dokter)

**Billing & Discharge:**
- Billing rawat inap = tarif per malam × jumlah hari + tindakan + obat selama rawat inap
- Semua biaya digabung ke satu invoice saat discharge
- Discharge summary: kondisi akhir, instruksi perawatan di rumah, obat pulang, follow-up plan

**Auto-Journal Rawat Inap (per hari saat billing):**
```
DR  Piutang Dagang         [110201]   (tarif × hari)
  CR  Pendapatan Rawat Inap [400002]
```
*(Dijurnal final saat discharge invoice dibuat)*

### 6.5 Pembayaran Klinik

- Kasir input pembayaran: tunai / QRIS / transfer bank / kartu (manual confirm)
- Multi-payment: bisa split (sebagian tunai + sebagian QRIS)
- Auto-generate faktur / kwitansi
- EDC: out of scope v1 — cashier input manual konfirmasi

---

## 07 · MODULE 02 — POS & Inventory (Petshop + Online)

### 7.1 Point of Sale

- Cari produk by nama / barcode (UPC/barcode dari Accurate)
- Multi-metode bayar: tunai, QRIS, transfer (EDC manual)
- Diskon per item atau per transaksi (fixed amount atau %)
- Bundle/paket produk (e.g., paket makanan + mainan)
- Member lookup: input nomor HP → tampil saldo poin + tier
- Redeem poin saat checkout (configurable: 1 poin = Rp X)
- Struk digital via WA atau print

### 7.2 Loyalty & Tier

**Earn Rate per Tier:**

| Tier | Syarat Akumulasi | Earn Rate | Diskon Member | Trigger WA |
|---|---|---|---|---|
| New | Registrasi awal | 1 poin / Rp 10.000 | — | Welcome message |
| Regular | ≥ 500 poin (Rp 5jt spending) | 1.2× | Early access promo | Notif naik tier |
| Silver | ≥ 1.500 poin (Rp 15jt spending) | 1.5× + diskon 5% | Diskon 5% | Notif naik tier |
| Gold | ≥ 3.000 poin (Rp 30jt spending) | 2× + diskon 8% | Diskon 8% + priority booking | Notif naik tier |
| VIP | ≥ 6.000 poin (Rp 60jt spending) | 3× + diskon 12% | Diskon 12% + home visit priority | Notif naik tier + WA khusus |

**Tier Downgrade Rule (configurable dari Owner Dashboard):**
- Owner bisa set: "Tier turun jika tidak ada transaksi dalam X hari"
- Default: tidak ada downgrade (freeze di tier yang dicapai)
- Jika downgrade diaktifkan: turun 1 level per periode inaktif

**Poin Expiry (configurable):**
- Default: poin tidak expired
- Jika diaktifkan: poin expired setelah X bulan

### 7.3 Inventory Management

- Stok real-time per gudang per item
- Item attributes: nama, kode, kategori, satuan, barcode, harga jual, harga beli, minimum stok
- **Expired date tracking:** field wajib saat penerimaan barang untuk kategori obat & pakan
- Batch/lot number: opsional, aktifkan per kategori
- **Reorder point alert:** notifikasi ke cabang + owner saat stok ≤ minimum stok
- Transfer stok antar gudang (dengan approval)

**Kategori Produk (dari audit Accurate):**
- Makanan / Pakan
- Obat & Suplemen (expired date wajib)
- Aksesoris
- Grooming Supplies
- Kupon / Voucher
- Jasa (non-inventory)

### 7.4 Online / B2C Channel (BARU v2.0)

- WH B2C, WH ONLINE PDRY, WH ONLINE TKI dikelola sebagai warehouse terpisah
- Sales dari Shopee/Tokopedia diinput sebagai Sales Order dengan channel "Online"
- Inventory deduction dari WH ONLINE yang relevan
- Tidak ada auto-sync Shopee/Tokopedia di v1 — input manual oleh admin online

### 7.5 Komisi Grooming

- Groomer punya skema komisi sendiri (configurable per karyawan)
- Jenis insentif grooming: % dari nilai jasa grooming per sesi
- Auto-calculate saat payroll run

---

## 08 · MODULE 03 — Pembelian (Purchasing)

### 8.1 Purchase Order (PO)

- Buat PO: pilih supplier, list item + qty + harga, gudang tujuan, tanggal dibutuhkan
- PO approval: manager/owner approve sebelum dikirim ke supplier
- PO auto-generate dari reorder point alert (dengan konfirmasi user)

**Auto-Journal PO:** Tidak ada jurnal — PO hanya dokumen komitmen, bukan transaksi akuntansi.

### 8.2 Penerimaan Barang (Goods Receipt)

- Penerimaan wajib referensi PO
- Input qty aktual yang diterima (bisa berbeda dari PO)
- Input expired date per batch (untuk obat & pakan — wajib)
- Input lot/batch number (opsional)
- Partial receipt: PO bisa diterima sebagian

**Auto-Journal Penerimaan Barang:**
```
DR  Persediaan             [110401]   (qty × harga beli)
  CR  Hutang Pembelian Belum Ditagih [210203]
```

### 8.3 Faktur Pembelian (Purchase Invoice)

- Matching: Faktur Pembelian harus match dengan Penerimaan Barang
- 3-way matching: PO → Penerimaan Barang → Faktur Pembelian
- Input nomor faktur supplier, tanggal faktur, tanggal jatuh tempo
- PPN Masukan: 11% jika supplier PKP (centang pada master supplier)

**Auto-Journal Faktur Pembelian (jika ada selisih dari GR):**
```
-- Jika ada selisih harga (PO vs actual invoice):
DR  Persediaan             [110401]   (selisih harga)
  CR  Hutang Dagang         [210201]
  CR  PPN Masukan           [110501]   (jika PKP)
```

*Catatan: Hutang Pembelian Belum Ditagih [210203] di-reverse saat faktur diinput:*
```
DR  Hutang Pembelian Belum Ditagih [210203]
  CR  Hutang Dagang               [210201]
```

### 8.4 Pembayaran Pembelian (Purchase Payment)

- Pilih faktur yang akan dibayar (bisa batch beberapa faktur ke satu supplier)
- Input metode bayar: transfer bank, tunai
- Partial payment support

**Auto-Journal Pembayaran:**
```
DR  Hutang Dagang    [210201]
  CR  Kas/Bank         [111101/111201]
```

### 8.5 Retur Pembelian

- Referensi ke Faktur Pembelian original
- Pilih item + qty yang diretur, alasan retur

**Auto-Journal Retur Pembelian:**
```
DR  Hutang Dagang    [210201]
  CR  Persediaan       [110401]   (at FIFO cost)
```

---

## 09 · MODULE 04 — Penjualan (Sales)

*Berdasarkan UI Reference Aldi — hanya fitur yang TIDAK dicoret.*

### 9.1 Fitur yang Dibangun (dari UI Reference)

**Dibangun:**
- Penawaran Penjualan (Sales Quote)
- Pesanan Penjualan (Sales Order)
- Pengiriman Pesanan (Delivery Order)
- Uang Muka Penjualan (Down Payment)
- Faktur Penjualan (Sales Invoice)
- Penerimaan Penjualan (Sales Receipt / Payment)
- Retur Penjualan (Sales Return)
- **Komisi Penjual** (CUSTOMIZED — lihat 9.2)
- **Target Penjualan** (CUSTOMIZED — lihat 9.3)
- SmartLink e-Commerce (B2C online channel)

**Tidak Dibangun (di-X oleh Aldi):**
- Kategori Pelanggan (dipindah ke CRM)
- Kategori Penjualan
- Penyesuaian Harga / Diskon (handled di POS)
- Check In
- Harga Pemasok, Transfer Pemasok (di Pembelian)

### 9.2 Komisi Penjual (3 Tipe Klausal)

Aldi request 3 tipe insentif yang bisa di-set per karyawan, importable dari Excel:

**Tipe 1 — % dari Jumlah Sales:**
- Insentif = Total penjualan karyawan × persentase (%)
- Contoh: Budi dapat 2% dari semua sales yang dia handle bulan ini

**Tipe 2 — Insentif Tetap per Produk:**
- Insentif = Qty terjual × nominal fixed per unit
- Contoh: Setiap 1 unit Dog Food Royal Canin terjual = Rp 5.000 insentif

**Tipe 3 — Insentif dari Kategori Target:**
- Insentif = Bonus jika target kategori produk tertentu tercapai
- Contoh: Jika total penjualan Grooming Supplies di atas Rp 5jt bulan ini = bonus Rp 200.000

**Implementasi:** Import klausal dari Excel template (karena banyak klausal berbeda per karyawan). Auto-calculate saat payroll run.

### 9.3 Target Penjualan (3 Dimensi)

1. **Target per Kategori Produk:** Owner set target revenue per kategori per bulan
2. **Target per Cabang:** Owner set target revenue total per cabang per bulan
3. **Target per Karyawan:** Manager set target personal per karyawan per bulan

Dashboard tracking: actual vs target (%), trend per minggu.

### 9.4 Auto-Journal Penjualan

**Sales Invoice (non-tunai):**
```
DR  Piutang Dagang         [110201]
  CR  Penjualan              [400001]
  CR  PPN Keluaran           [210401]   (jika PKP, 11%)

-- Simultan, HPP (FIFO):
DR  Beban Pokok Penjualan   [510101]
  CR  Persediaan              [110401]   (FIFO cost)
```

**Sales Invoice (tunai / lunas langsung):**
```
DR  Kas / Bank              [111101 / 111201]
  CR  Penjualan              [400001]
  CR  PPN Keluaran           [210401]

-- HPP:
DR  Beban Pokok Penjualan   [510101]
  CR  Persediaan              [110401]
```

**Penerimaan Pelunasan Piutang:**
```
DR  Kas / Bank              [111101 / 111201]
  CR  Piutang Dagang          [110201]
```

**Down Payment Penjualan (Uang Muka):**
```
DR  Kas / Bank              [111101]
  CR  Uang Muka Penjualan     [210101]

-- Saat invoice final, offset DP:
DR  Uang Muka Penjualan     [210101]
  CR  Piutang / Kas
```

**Retur Penjualan:**
```
DR  Retur Penjualan         [400003]
  CR  Piutang / Kas

-- Kembalikan stok (at original FIFO cost):
DR  Persediaan              [110401]
  CR  Beban Pokok Penjualan   [510101]
```

**Diskon Penjualan (jika ada):**
```
DR  Diskon Penjualan        [440101]
  CR  Piutang / Kas
```

---

## 10 · MODULE 05 — Advanced Finance & Accounting

**Ini module paling kritis. Semua kalkulasi harus zero-error.**
**Reference logic: ERPNext (frappe/erpnext) — `erpnext/accounts/` — reimplementasi di TypeScript/PostgreSQL.**

### 10.1 Chart of Accounts (CoA) — Struktur Standar SAK Indonesia

```
1 · ASET
  11 · Aset Lancar
    110101  Kas Kecil
    111101  Kas
    111201  Bank BCA [per cabang]
    110201  Piutang Dagang
    110301  Piutang Karyawan
    110401  Persediaan
    110402  Persediaan Terkirim
    110501  PPN Masukan
  12 · Aset Tidak Lancar
    120101  Peralatan & Mesin
    120102  Inventaris Kantor
    170101  Akumulasi Penyusutan Peralatan
    170102  Akumulasi Penyusutan Inventaris

2 · KEWAJIBAN
  21 · Kewajiban Lancar
    210101  Uang Muka Penjualan
    210201  Hutang Dagang
    210203  Hutang Pembelian Belum Ditagih
    210301  Hutang Gaji
    210401  PPN Keluaran
    210402  Hutang PPh 21
    210403  Hutang BPJS Kesehatan
    210404  Hutang BPJS Ketenagakerjaan (JHT)
    210405  Hutang BPJS Ketenagakerjaan (JP)
    210406  Hutang BPJS Ketenagakerjaan (JKK+JKM)

3 · EKUITAS
    310101  Modal Disetor
    320101  Laba Ditahan

4 · PENDAPATAN
    400001  Pendapatan Penjualan
    400002  Pendapatan Rawat Inap
    400003  Retur Penjualan (contra revenue)
    400004  Pendapatan Jasa Klinik
    400005  Pendapatan Grooming

5 · BEBAN POKOK
    510101  Beban Pokok Penjualan (HPP)

6 · BEBAN OPERASIONAL
    520101  Beban Gaji Pokok
    520102  Beban Tunjangan Karyawan
    520103  Beban Lembur
    520104  Beban Insentif / Komisi
    520105  Beban BPJS Kesehatan (Perusahaan)
    520106  Beban BPJS Ketenagakerjaan (Perusahaan)
    530101  Beban Penyusutan Aset Tetap
    540101  Beban Sewa Gedung
    540102  Beban Listrik & Air
    540103  Beban Pemeliharaan

4 · PENDAPATAN LAIN
    440101  Diskon Penjualan (contra)
    450101  Pendapatan Lain-lain

6 · BEBAN LAIN
    650101  Beban Lain-lain
    650201  Selisih Stok (Stock Adjustment)
```

### 10.2 HPP Calculation — Metode FIFO

**Prinsip FIFO:**
- Setiap penerimaan barang membuat "FIFO layer" dengan harga beli saat itu
- Saat barang dijual, ambil dari layer terlama (tertua) terlebih dahulu
- HPP = FIFO cost per unit × qty terjual

**Implementasi di Supabase:**

```sql
-- stock_ledger_entry: tracking setiap mutasi stok
CREATE TABLE stock_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid REFERENCES items(id),
  warehouse_id uuid REFERENCES warehouses(id),
  transaction_type varchar(30), -- 'RECEIPT','SALE','TRANSFER','ADJUSTMENT','RETURN'
  transaction_id uuid,           -- FK ke tabel transaksi asal
  qty_change decimal(15,4),      -- positif = masuk, negatif = keluar
  cost_per_unit decimal(15,4),   -- harga beli saat receipt; FIFO cost saat keluar
  valuation_rate decimal(15,4),  -- running average (untuk display)
  qty_after decimal(15,4),       -- running balance
  posting_date date,
  created_at timestamptz DEFAULT now()
);

-- fifo_stock_queue: queue FIFO per item per warehouse
CREATE TABLE fifo_stock_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid REFERENCES items(id),
  warehouse_id uuid REFERENCES warehouses(id),
  receipt_date date,
  qty_remaining decimal(15,4),
  cost_per_unit decimal(15,4),   -- harga beli original
  batch_no varchar(50),
  expiry_date date,
  receipt_entry_id uuid REFERENCES stock_ledger_entries(id)
);
```

**FIFO Depletion Logic (TypeScript):**

```typescript
async function depleteFIFO(
  itemId: string,
  warehouseId: string,
  qtyToSell: number,
  transactionId: string
): Promise<number> { // returns total cost (untuk HPP journal)
  
  const queue = await supabase
    .from('fifo_stock_queue')
    .select('*')
    .eq('item_id', itemId)
    .eq('warehouse_id', warehouseId)
    .gt('qty_remaining', 0)
    .order('receipt_date', { ascending: true }); // FIFO: oldest first

  let remainingToSell = qtyToSell;
  let totalCost = 0;

  for (const layer of queue.data) {
    if (remainingToSell <= 0) break;

    const consumed = Math.min(remainingToSell, layer.qty_remaining);
    totalCost += consumed * layer.cost_per_unit;
    remainingToSell -= consumed;

    await supabase
      .from('fifo_stock_queue')
      .update({ qty_remaining: layer.qty_remaining - consumed })
      .eq('id', layer.id);
  }

  if (remainingToSell > 0) {
    throw new Error(`Insufficient stock: ${remainingToSell} units short`);
  }

  return totalCost;
}
```

### 10.3 PPh 21 Calculation — Standar DJP 2024

**Tarif Progresif PPh 21 (Pasal 17 UU HPP):**

| PKP Setahun | Tarif |
|---|---|
| Rp 0 – 60.000.000 | 5% |
| Rp 60.000.001 – 250.000.000 | 15% |
| Rp 250.000.001 – 500.000.000 | 25% |
| Rp 500.000.001 – 5.000.000.000 | 30% |
| > Rp 5.000.000.000 | 35% |

**PTKP 2024 (Per Tahun):**

| Status | PTKP |
|---|---|
| TK/0 (Tidak Kawin, 0 tanggungan) | Rp 54.000.000 |
| K/0 (Kawin, 0 tanggungan) | Rp 58.500.000 |
| K/1 (Kawin, 1 tanggungan) | Rp 63.000.000 |
| K/2 (Kawin, 2 tanggungan) | Rp 67.500.000 |
| K/3 (Kawin, 3 tanggungan) | Rp 72.000.000 |

**Algoritma PPh 21 per Bulan:**

```typescript
function calculatePPh21(
  grossMonthly: number,
  bpjsEmployee: number,        // total BPJS potongan karyawan sebulan
  taxStatus: 'TK0'|'K0'|'K1'|'K2'|'K3'
): number {
  
  const PTKP: Record<string, number> = {
    TK0: 54_000_000, K0: 58_500_000,
    K1: 63_000_000,  K2: 67_500_000, K3: 72_000_000
  };

  const biayaJabatan = Math.min(grossMonthly * 0.05, 500_000); // max 500rb/bulan
  const penghasilanNeto = grossMonthly - bpjsEmployee - biayaJabatan;
  const penghasilanNetoAnnual = penghasilanNeto * 12;
  const pkpAnnual = Math.max(0, penghasilanNetoAnnual - PTKP[taxStatus]);

  let taxAnnual = 0;
  if (pkpAnnual > 5_000_000_000)      taxAnnual = progressiveTax(pkpAnnual);
  else if (pkpAnnual > 500_000_000)   taxAnnual = progressiveTax(pkpAnnual);
  else if (pkpAnnual > 250_000_000)   taxAnnual = progressiveTax(pkpAnnual);
  else if (pkpAnnual > 60_000_000)    taxAnnual = progressiveTax(pkpAnnual);
  else                                 taxAnnual = pkpAnnual * 0.05;

  return Math.round(taxAnnual / 12);
}

function progressiveTax(pkp: number): number {
  let tax = 0;
  if (pkp > 5_000_000_000) { tax += (pkp - 5_000_000_000) * 0.35; pkp = 5_000_000_000; }
  if (pkp > 500_000_000)   { tax += (pkp - 500_000_000) * 0.30;   pkp = 500_000_000; }
  if (pkp > 250_000_000)   { tax += (pkp - 250_000_000) * 0.25;   pkp = 250_000_000; }
  if (pkp > 60_000_000)    { tax += (pkp - 60_000_000) * 0.15;    pkp = 60_000_000; }
  tax += pkp * 0.05;
  return tax;
}
```

### 10.4 BPJS Calculation

**BPJS Kesehatan:**
- Batas gaji: Rp 12.000.000/bulan (gaji di atas ini tetap dihitung max 12jt)
- Perusahaan: 4% dari gaji (max Rp 480.000)
- Karyawan: 1% dari gaji (max Rp 120.000)

**BPJS Ketenagakerjaan:**
- Batas gaji JHT & JKK: tidak ada batas atas (gunakan gaji aktual)
- Batas gaji JP: Rp 9.077.600 (sesuai PP terbaru)

| Komponen | Perusahaan | Karyawan |
|---|---|---|
| JKK (Jaminan Kecelakaan Kerja) | 0.24% | — |
| JKM (Jaminan Kematian) | 0.30% | — |
| JHT (Jaminan Hari Tua) | 3.70% | 2.00% |
| JP (Jaminan Pensiun) | 2.00% | 1.00% (max gaji 9.077.600) |

**Total beban perusahaan per karyawan:**
- BPJS Kesehatan employer: 4% (max 480rb)
- JKK: 0.24%
- JKM: 0.30%
- JHT employer: 3.70%
- JP employer: 2.00% (max gaji 9.077.600 → max Rp 181.552)

### 10.5 Payroll Auto-Journal

```
-- Saat payroll run (per karyawan):
DR  Beban Gaji Pokok              [520101]   (gaji pokok)
DR  Beban Tunjangan               [520102]   (semua tunjangan)
DR  Beban Lembur                  [520103]   (uang lembur)
DR  Beban Insentif / Komisi       [520104]   (insentif + komisi)
DR  Beban BPJS Kesehatan (emp)    [520105]   (4%)
DR  Beban BPJS TK JKK             [520106a]  (0.24%)
DR  Beban BPJS TK JKM             [520106b]  (0.30%)
DR  Beban BPJS TK JHT (emp)       [520106c]  (3.70%)
DR  Beban BPJS TK JP (emp)        [520106d]  (2.00%)
  CR  Hutang Gaji                   [210301]   (take home pay)
  CR  Hutang PPh 21                 [210402]
  CR  Hutang BPJS Kesehatan (kary)  [210403]   (1%)
  CR  Hutang BPJS TK JHT (kary)    [210404a]  (2%)
  CR  Hutang BPJS TK JP (kary)     [210404b]  (1%)
  CR  Potongan Denda Keterlambatan  [Misc]
  CR  Potongan Kasbon               [110301]   (potong dari piutang karyawan)

-- Saat pembayaran gaji:
DR  Hutang Gaji                   [210301]
  CR  Bank (Gaji)                   [111201]

-- Saat setor PPh 21 ke DJP:
DR  Hutang PPh 21                 [210402]
  CR  Bank                          [111201]

-- Saat setor BPJS:
DR  Hutang BPJS Kesehatan         [210403]
DR  Hutang BPJS TK (semua komponen) [210404]
  CR  Bank                          [111201]
```

### 10.6 Penyusutan Aset Tetap (Straight-Line)

**Formula:** Beban Penyusutan per Bulan = (Harga Perolehan - Nilai Sisa) / (Umur Ekonomis × 12)

**Auto-run:** Cron job tanggal 1 setiap bulan.

**Auto-Journal Penyusutan:**
```
DR  Beban Penyusutan    [530101]
  CR  Akumulasi Penyusutan [170101/170102]
```

**Master Aset Tetap (dari Accurate audit — metode Garis Lurus):**
- Peralatan & Mesin: umur 5 tahun, nilai sisa 10%
- Inventaris Kantor: umur 4 tahun, nilai sisa 5%
- Kendaraan: umur 5 tahun, nilai sisa 20%

### 10.7 Stock Transfer Journal

```
DR  Persediaan [110401] — Gudang Tujuan
  CR  Persediaan [110401] — Gudang Asal
```
*(Tidak ada P&L impact. Ini BUKAN penjualan, hanya mutasi antar gudang.)*

### 10.8 Stock Opname Adjustment

**Selisih Lebih (stok fisik > sistem):**
```
DR  Persediaan          [110401]
  CR  Selisih Persediaan  [450101]   (pendapatan lain-lain)
```

**Selisih Kurang (stok fisik < sistem):**
```
DR  Selisih Persediaan  [650201]   (beban lain-lain)
  CR  Persediaan          [110401]
```

### 10.9 Laporan Keuangan

- **Laporan Laba Rugi:** per cabang + konsolidasi multi-cabang, real-time
- **Neraca (Balance Sheet):** snapshot posisi keuangan per tanggal
- **Arus Kas:** metode langsung (cash inflow / outflow)
- **Laporan Piutang (AR Aging):** current / 1-30 hari / 31-60 / 61-90 / >90 hari
- **Laporan Hutang (AP Aging):** sama dengan AR
- **Laporan HPP:** breakdown per item, per kategori, per cabang
- **Daily Digest ke WA Owner:** ringkasan keuangan harian jam 07:00 WIB
- Export: PDF + Excel

---

## 11 · MODULE 06 — HRIS

*Face Verification DEFER ke v2. v1 = geolokasi only.*

### 11.1 Master Karyawan

Field wajib dari GajiHub (siap migrasi):
- Nama, ID Karyawan, KTP, Tempat/Tanggal Lahir
- NPWP, Status Wajib Pajak (TK/K/K1/K2/K3)
- No. BPJS Kesehatan + Ketenagakerjaan
- Rekening bank + nama pemilik rekening
- Status karyawan: Tetap / Kontrak (dengan tanggal akhir kontrak)
- Jabatan, Departemen, Cabang

**Multi-Branch Assignment (BARU v2.0 — untuk dokter floating):**
- Satu karyawan bisa assigned ke beberapa cabang sekaligus
- `employee_branch_assignments`: employee_id, branch_id, role (PRIMARY/SECONDARY), effective_date

### 11.2 Komponen Gaji (dari GajiHub audit)

**Pendapatan:**
- Gaji Pokok
- Tunjangan 1, Tunjangan 2
- Uang Lembur (per jam × rate)
- Presensi per Klinik (untuk dokter floating — per-klinik attendance pay)
- Insentif per Klinik (untuk dokter — performance per lokasi)
- Insentif Achievement PIC
- Insentif Grooming
- Insentif Rawat Inap
- Komponen Manual (Training, dll)

**Potongan:**
- Denda Keterlambatan (Rp 20.000 per hari / configurable)
- Potongan Kasbon (potong dari piutang karyawan)
- Potongan Lainnya
- BPJS Kesehatan karyawan (1%)
- BPJS Ketenagakerjaan JHT karyawan (2%)
- BPJS JP karyawan (1%)
- PPh 21 (auto-calculate)

### 11.3 Absensi (Geolokasi v1)

- Check-in / Check-out via browser mobile (browser geolocation API)
- Sistem verifikasi: apakah koordinat GPS dalam radius X meter dari koordinat cabang
- Radius configurable per cabang (default 100m)
- Jika di luar radius: flagged sebagai "Di Luar Lokasi" — butuh approval manual
- History absensi per karyawan per hari

**Untuk Dokter Floating:**
- Saat check-in, sistem tanya "Check-in di klinik mana?" jika dokter assigned ke multi-cabang
- Presensi tercatat per klinik → otomatis masuk komponen "Presensi Vet [KODE]" di payroll

### 11.4 Shift Management

- Master shift: nama shift, jam masuk, jam keluar, istirahat
- Assign shift per karyawan per minggu / per bulan
- Flexible shift untuk dokter floating

### 11.5 Overtime / Lembur (BARU v2.0)

- Karyawan submit lembur request: tanggal, jam mulai, jam selesai, keterangan (contoh: "Operasi Emergency")
- Approval workflow: Manager/Direktur approve/reject
- Status: Menunggu Persetujuan / Disetujui / Ditolak (replicating GajiHub)
- Overtime yang disetujui → auto-masuk komponen "Uang Lembur" di payroll bulan ini
- Rate lembur: configurable (default 1.5× per jam atau flat per hari)

### 11.6 Cuti & Izin

- Jenis cuti: Cuti Tahunan, Cuti Sakit, Cuti Melahirkan, Cuti Khusus
- Saldo cuti per karyawan (opening balance dari GajiHub)
- Pengajuan cuti via mobile browser
- Approval: Manager approve / reject
- Auto-deduct saldo cuti

### 11.7 Payroll Run

1. Admin pilih periode (misal: 01 Mei – 31 Mei)
2. Pilih "Gaji Dokter Bogor" atau kelompok payroll lainnya
3. Sistem auto-calculate:
   - Rekapitulasi presensi per klinik per dokter
   - Insentif per klinik (berdasarkan formula yang di-set)
   - Komisi penjualan (Tipe 1/2/3 dari Module 04)
   - Lembur yang sudah disetujui
   - BPJS semua komponen
   - PPh 21 (progressive, auto-calculate)
   - Semua potongan
4. Review slip gaji per karyawan (Download Slip Gaji Massal)
5. Approve → jurnal otomatis ter-generate (lihat 10.5)
6. Export ke bank transfer format (BCA format)

### 11.8 KPI Tracking (dari GajiHub menu)

- Target KPI per jabatan / per karyawan
- Actual vs target per bulan
- Terhubung ke Insentif Achievement PIC

---

## 12 · MODULE 07 — CRM Layer

### 12.1 Customer Record

- Profil lengkap: nama, HP, email, alamat, tanggal lahir, tier loyalty, total poin, total spending
- Daftar hewan: per customer, link ke rekam medis
- Riwayat transaksi: semua cabang
- Riwayat kunjungan klinik + rawat inap
- Timeline interaksi: semua WA trigger yang pernah dikirim

### 12.2 Promo Management

- Buat promo: nama, periode, tipe (diskon %, diskon nominal, bonus poin, bundling)
- Target promo: semua customer / tier tertentu / cabang tertentu
- Distribusi via WA blast atau auto-trigger

### 12.3 Kategori Pelanggan (Loyalty Tier Management)

- Setting tier dari dashboard: nama tier, syarat poin, earn rate, benefit, trigger WA
- Tier downgrade rule (configurable, default off)
- Poin expiry (configurable, default off)
- Diskon member per tier (configurable)

### 12.4 Retention — WA Automation Engine

**7 Trigger Aktif (Fonnte API):**

| # | Trigger | Delay | Template |
|---|---|---|---|
| 01 | Post-Grooming | H+30 | "Halo kak [nama], sudah 30 hari sejak [hewan] grooming di [cabang]. Mau jadwalkan lagi?" |
| 02 | Post-Treatment | H+7 | "Halo kak [nama], sudah 7 hari sejak [hewan] berobat. Ada perkembangan?" |
| 03 | Vaksinasi Jatuh Tempo | H-30 | "Vaksinasi [hewan] akan jatuh tempo bulan depan. Mau booking sekarang?" |
| 04 | Vaksinasi Terlambat | H+7 | "Vaksinasi [hewan] sudah lewat jatuh tempo. Segera jadwalkan ya kak!" |
| 05 | Lama Tak Berkunjung | 60 hari | "Kami kangen [hewan]! Sudah 2 bulan tidak berkunjung." |
| 06 | Ulang Tahun Pemilik | Hari H 07:00 | "Selamat ulang tahun kak [nama]! Nikmati diskon [X]% untuk kunjungan hari ini." |
| 07 | Ulang Tahun Hewan | Hari H 08:00 | "Happy birthday [nama hewan]! Rayakan dengan grooming spesial di Kamo Group." |

**Cron Job:** Setiap hari 06:00 WIB (untuk trigger berbasis tanggal #3, #4, #5, #6, #7)
**Deduplication:** No double-send dalam 24 jam untuk trigger yang sama ke customer yang sama

**Retention Settings (per trigger):**
- Template pesan (customizable owner)
- Delay/timing (configurable)
- Persentase diskon birthday (configurable owner dari dashboard)
- Aktif / Non-aktif toggle per trigger

**History Log:**
- Semua pesan yang terkirim: timestamp, customer, trigger type, status (delivered/failed)
- Re-send manual jika gagal

### 12.5 Owner Dashboard

- Lapsed customer list (belum kunjungan X hari — configurable)
- Distribusi tier (berapa customer di setiap tier)
- Metrik retensi per cabang: churn rate, repeat visit rate
- Revenue per tier
- WA trigger performance: delivery rate, response rate

---

## 13 · Arsitektur Data — Overview Tabel Utama

```sql
-- Core entities
users            (id, email, role, branch_assignments)
branches         (id, code, name, type, is_active)
warehouses       (id, branch_id, code, name, type)
items            (id, code, name, category_id, upc, unit, sell_price, buy_price, min_stock)
item_categories  (id, name, track_expiry, track_batch)

-- Customer & Medical
customers        (id, name, phone, email, dob, address, tier, points, total_spending)
pets             (id, customer_id, name, species, breed, dob, gender, weight, photo_url)
medical_records  (id, pet_id, branch_id, doctor_id, visit_date, complaint, diagnosis, treatment, prescription)
vaccinations     (id, pet_id, vaccine_type, date_given, date_due, branch_id)
inpatient_admissions (id, pet_id, branch_id, doctor_id, admit_date, discharge_date, room, daily_rate, status)
inpatient_daily_notes (id, admission_id, date, notes, treatments, medications, doctor_id)

-- Inventory
stock_ledger_entries  (id, item_id, warehouse_id, type, qty_change, cost_per_unit, qty_after, date)
fifo_stock_queue      (id, item_id, warehouse_id, receipt_date, qty_remaining, cost_per_unit, expiry_date)
stock_transfers       (id, from_warehouse_id, to_warehouse_id, items, status, approved_by)

-- Purchasing
purchase_orders        (id, supplier_id, warehouse_id, branch_id, status, items, total)
goods_receipts         (id, po_id, received_by, items_received, notes)
purchase_invoices      (id, gr_id, supplier_invoice_no, invoice_date, due_date, total, ppn)
purchase_payments      (id, invoices, amount, method, bank_account, date)

-- Sales
sales_orders      (id, customer_id, branch_id, channel, items, discount, total)
delivery_orders   (id, so_id, warehouse_id, delivered_at)
sales_invoices    (id, so_id, customer_id, branch_id, items, subtotal, ppn, discount, total, status)
sales_receipts    (id, invoice_id, amount, method, received_at)
sales_returns     (id, invoice_id, items, reason, total)

-- Finance / Accounting
journal_entries   (id, date, description, reference_type, reference_id, branch_id)
journal_lines     (id, entry_id, account_id, debit, credit)
chart_of_accounts (id, code, name, type, parent_id, is_active)
fixed_assets      (id, name, purchase_date, cost, salvage_value, useful_life_months, accumulated_depreciation)
bank_statements   (id, account_id, date, amount, description, reconciled, reconciled_with)

-- HRIS
employees         (id, emp_code, name, ktp, npwp, tax_status, bpjs_kes, bpjs_tk, bank_account)
employee_branches (id, employee_id, branch_id, role, effective_date)
salary_components (id, employee_id, component_type, amount, formula)
attendance_logs   (id, employee_id, branch_id, check_in, check_out, lat, lng, is_verified)
overtime_requests (id, employee_id, date, start_time, end_time, reason, status, approved_by)
leave_requests    (id, employee_id, type, start_date, end_date, status, approved_by)
payroll_runs      (id, period_start, period_end, group_name, status, approved_by, journal_entry_id)
payroll_slips     (id, payroll_run_id, employee_id, gross, deductions, net, components_json)

-- CRM / WA
loyalty_tiers     (id, name, min_points, earn_multiplier, discount_pct, benefits)
wa_trigger_log    (id, customer_id, trigger_type, sent_at, status, message)
promo_campaigns   (id, name, type, period_start, period_end, target_tier, discount, is_active)
```

**Row Level Security (RLS) Rules:**
- Staff hanya bisa akses data branch yang di-assign
- Dokter floating: akses semua branch yang ada di `employee_branches`
- Owner / Admin pusat: akses semua branch
- Finance: read-only semua branch, write hanya untuk jurnal manual

---

## 14 · Testing Priorities

| Modul / Komponen | Tipe Test | Prioritas | Catatan |
|---|---|---|---|
| PPh 21 Calculation | Unit | CRITICAL | Test semua status pajak (TK0–K3), edge cases |
| BPJS Calculation | Unit | CRITICAL | Test salary cap, semua komponen |
| FIFO HPP | Unit + Integration | CRITICAL | Test partial layers, multi-layer depletion |
| Auto-Journal (semua transaksi) | Unit | CRITICAL | Setiap tipe transaksi harus balanced |
| Branch Data Isolation (RLS) | Integration | CRITICAL | Staf Cabang A tidak boleh lihat data Cabang B |
| WA Trigger Logic | Unit + Cron | HIGH | Deduplication, timing, no double-send |
| Payroll Run | Integration | HIGH | End-to-end dari input hingga jurnal |
| Rawat Inap Billing | Integration | HIGH | Akumulasi biaya multi-hari + discharge |
| POS Transaction + Stock Deduction | E2E | HIGH | Race condition saat stock mendekati 0 |
| Loyalty Points Earn + Redeem | Unit + E2E | MEDIUM | Tier upgrade trigger, poin expiry |

---

## 15 · Milestones & Deliverables (Referensi PKS/VetOS/2026/001)

| Fase | Deliverables | Target |
|---|---|---|
| **Fase 1** (current) | PRD v2.0 ✅, SOP Mapping, Supabase Schema, Prototype Auth | Selesai sebelum M2 |
| **Fase 2** | Smart Clinic + POS MVP, Finance Module core, HRIS dasar | M2 → M3 |
| **Fase 3** | UAT 1–2 cabang pilot, parallel run dengan Accurate | M3 → M4 |
| **Fase 4** | Full rollout semua cabang, sunsetting Accurate + GajiHub | M4 → Go-Live |

**Go-Live Target:** Oktober/November 2026

---

*VetOS Product Requirements Document v2.0*
*Gentanala Digital Advisory · PT Inovasi Kreasi Alam*
*Konfidensial — Hanya untuk internal Kamo Group dan Gentanala Digital Advisory*
