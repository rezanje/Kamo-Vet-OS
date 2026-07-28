# Barang & Jasa ala Accurate — kelengkapan master + batch/expired + kartu stok (Design / Spec)

**Tanggal:** 2026-07-28
**Konteks:** Boss minta menu Persediaan → "Barang & Jasa" mengikuti form Accurate
(tab Umum: nama, kategori, jenis barang, kode, UPC/barcode, satuan + konversi, merek,
toggle No. Seri/Produksi) dan kartu stok yang biasa dipakai dari sana.
Audit gap: `docs/GAP-MENU-ACCURATE-2026-07.md` §7 (Persediaan 7/14).

Keputusan boss (sesi brainstorm 2026-07-28):
- Urutan ambil barang keluar = **FEFO** (expired terdekat duluan), bukan FIFO murni.
- Batch/expired **opsional per barang** (toggle ala Accurate), bukan wajib semua.
- `Jenis Barang` jadi **field sendiri**, dipisah dari kategori.
- Konversi satuan dipakai di **pembelian**.
- Form jadi **halaman detail bersub-tab**, bukan form inline.
- Kartu stok masuk sekarang (butuh ledger mutasi baru).
- Dikerjakan **bertahap**: tahap 1 dulu, dirilis, baru tahap berikutnya.

## 0. Status awal (yang sudah ada, jangan dikerjakan ulang)

- Menu & tile sudah bernama Persediaan → "Barang & Jasa" (`src/lib/nav.ts`).
- Tab dokumen ala Accurate sudah ada (`src/lib/tabs.ts` + `components/PageTabs.tsx`) —
  yang ditambah spec ini adalah **sub-tab di dalam halaman barang**, bukan tab dokumen.
- `items.upc` & `items.min_stock` sudah ada di DB (migrasi 0001) tapi belum dipakai form.
- `item_categories.track_batch` & `.track_expiry` sudah ada di DB, **belum dipakai kode
  mana pun**. Spec ini memilih toggle per-barang; kolom kategori itu dibiarkan
  (tidak dihapus, tidak dipakai) supaya migrasi tetap kecil.
- **Satuan berjenjang sudah selesai di luar spec ini** — `item_units` (migrasi 0063),
  `src/lib/satuan.ts` + test, dipakai POS/pembelian/rekam medis. Jadi konversi satuan
  **dicoret dari scope**; tinggal memastikan halaman detail baru memakainya.

## 1. Tahap 1 — kelengkapan master (rilis pertama)

### Migrasi
```
brands(id, name varchar(100) unique, is_active boolean default true, created_at)
  RLS: pola item_categories.

items + item_type varchar(16) not null default 'Persediaan'
        check (item_type in ('Persediaan','Jasa','Non-Persediaan'))
      + brand_id uuid references brands(id) on delete set null
backfill: item_type='Jasa' untuk items yang category_id-nya bernama 'Jasa'.
```

### Kode barang (bug)
`items.code` NOT NULL UNIQUE, tapi form membiarkan kosong dan action mengirim
`code || null` → error Postgres mentah ke user. Perbaikan: input `required` +
validasi action ("Kode barang wajib diisi") + tangkap unique violation jadi
"Kode barang sudah dipakai barang lain".

### Jenis Barang menggantikan kategori "Jasa"
Semua cek `kategori.name === "Jasa"` (mis. `pos/sku/actions.ts`) diganti
`item_type === 'Jasa'`. Aturan wajib-consent (`tindakan_kategori`) ikut menempel ke
`item_type`, bukan nama kategori — supaya kategori bebas dipakai ("Vaksin", "Grooming").

### UI
| Route | Isi |
|---|---|
| `/pos/sku` | daftar; judul jadi "BARANG & JASA"; kolom Merek; filter Jenis Barang |
| `/pos/sku/baru`, `/pos/sku/[id]` | halaman detail, sub-tab lewat `?tab=` (chip `Link`, server component — pola `/pos/stok`) |
| `/pos/merek` | CRUD kecil, pola `/pengaturan/tier`; isi tile nav "Merek Barang" |

Sub-tab tahap 1:
- **Umum** — nama, kategori, jenis barang, kode (wajib), UPC/barcode, satuan dasar +
  panel satuan berjenjang (komponen existing), merek, min stok, aktif/nonaktif.
- **Penjualan/Pembelian** — harga jual, harga beli, kategori tindakan (muncul kalau
  jenis = Jasa).

Tab **Stok** & **Mutasi** menyusul di tahap 2; sub-tab-nya belum dirender.

### Uji (vitest, fungsi murni di `src/lib/__tests__/`)
- validasi form master barang: kode kosong ditolak, jenis Jasa wajib kategori tindakan.

## 2. Tahap 2 — batch/expired + kartu stok

### Migrasi
```
items        + track_batch boolean not null default false

stock_layers + batch_no varchar(40), + expired_date date
             + index (item_id, warehouse_id, expired_date) where qty_left > 0

stock_moves(id, warehouse_id, item_id, tanggal date, arah varchar(3) check in ('IN','OUT'),
  qty numeric, unit_cost numeric, batch_no, expired_date,
  source varchar(24), source_ref varchar(40), created_at)
index (item_id, tanggal)
```
Seed `stock_moves`: 1 baris IN `saldo-awal` per `stock.qty > 0` — kartu stok mulai dari
tanggal migrasi, riwayat sebelumnya memang tidak bisa direkonstruksi (barang keluar tidak
pernah tercatat sebagai baris).

Satu baris `stock_moves` per **layer yang tersentuh**, bukan per panggilan — supaya batch
pada baris keluar akurat.

### lib/inventory.ts
- `stockIn` terima `batchNo`/`expiredDate` → simpan di layer + 1 baris `stock_moves` IN.
- `stockOut` urut **FEFO**: `expired_date asc nulls last, tanggal, created_at`.
  Urutan dipisah jadi fungsi murni `sortFefo()` supaya bisa dites.
  Tiap layer terkonsumsi → 1 baris OUT (qty, cost, batch layer itu).
  Shortfall → 1 baris OUT tanpa batch (perilaku harga `items.buy_price` tetap).
- `stockOut` mengembalikan `takes[]` (bukan hanya `cost`) supaya `transferStock`
  memindahkan batch **per layer**. Tanpa ini, transfer melebur jadi satu layer
  cost rata-rata dan batch-nya hilang.
- `consumeLayers` tidak berubah.

### Validasi
"Barang `track_batch` wajib isi batch + expired" ditegakkan di **server action form
penerimaan**, bukan di `inventory.ts` — mesin tetap bodoh supaya jalur internal
(racik, opname, pemindahan) tidak ikut terkunci.

Titik masuk stok yang menanyakan batch+expired: penerimaan PO (`/pembelian/[id]/terima`),
penerimaan permintaan, opname, tambah stok manual, retur penjualan.

### UI
- Sub-tab **Stok** — stok per gudang + rincian batch (`stock_layers` qty_left > 0),
  badge merah untuk lewat/dekat expired.
- Sub-tab **Mutasi** (kartu stok) — tanggal · dokumen · gudang · batch · masuk · keluar ·
  saldo berjalan; filter gudang + rentang tanggal. Saldo berjalan dihitung saat baca
  (fungsi murni `kartuStok()`), tidak disimpan.

### Uji
- `sortFefo()` — expired terdekat duluan, `null` paling belakang.
- `kartuStok()` — saldo berjalan benar untuk campuran IN/OUT lintas gudang.

## 3. Sengaja tidak dikerjakan (YAGNI)

- Halaman "Monitor Expired" tersendiri — badge expired di sub-tab Stok sudah menutup
  kebutuhannya; buat kalau memang diminta laporan terpisah.
- Tab Akun & Gambar ala Accurate (akun persediaan/penjualan/HPP per barang, foto barang).
- CRUD Kategori Barang & master Satuan global — kategori sudah ada tabelnya, satuan
  sudah per-barang lewat `item_units`.
- Nomor seri per unit (serial number, bukan batch) — Accurate menyatukan keduanya di satu
  toggle; kebutuhan klinik adalah batch + expired.
- Penomoran kode barang otomatis.

## 4. Catatan kerja

Saat spec ini ditulis, working tree berisi pekerjaan satuan berjenjang + penerimaan qty
yang belum di-commit dan menyentuh `pos/sku/*`. Tahap 1 menyentuh file yang sama, jadi
tunggu pekerjaan itu tersimpan dulu sebelum mulai.
