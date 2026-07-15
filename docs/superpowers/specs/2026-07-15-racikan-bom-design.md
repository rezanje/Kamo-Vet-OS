# Racikan Obat ala BOM — Design Spec

**Tanggal:** 2026-07-15
**Modul:** Klinik → Rekam Medis (POS) + master bahan baku + worklist apoteker

## Masalah

Dokter meracik obat compound (sirup, puyer, salep, dll) dengan komposisi bahan yang
berbeda-beda tiap kali. Tiap bahan baku punya harga sendiri, sehingga harga racikan
selalu berbeda tergantung komposisi. Saat ini racikan (`compounding_recipes`) hanya
berupa instruksi racik tanpa harga dan dibuat manual — tidak terhubung ke penagihan
dan tidak menghitung biaya.

Yang diinginkan:
1. Dokter memilih bahan baku dari daftar SKU + set dosis tiap bahan.
2. Harga racikan dihitung otomatis realtime = Σ(harga bahan × dosis). Tanpa jasa/markup.
3. Racikan masuk keranjang POS sebagai 1 baris (nama + harga).
4. Racikan tetap masuk worklist apoteker (Racik Obat) untuk diracik fisik.
5. Di struk/invoice hanya muncul **nama racikan** — komponen bahan disembunyikan.
6. Stok bahan baku terpotong saat dokter menyimpan rekam medis.

## Keputusan (hasil brainstorming)

- Bahan baku = item di master `items`, ditandai flag `is_compound_material`. Obat jadi
  tetap dijual normal; bahan baku hanya muncul di builder racikan.
- Harga = Σ(`sell_price` × dosis). Tidak ada biaya jasa racik / markup.
- Racikan reuse tabel `compounding_recipes` + `compounding_ingredients` yang sudah ada
  (masuk worklist apoteker, status `pending`). Bentuk sediaan & langkah opsional.
- Stok bahan dipotong saat simpan rekam medis (konsisten dengan pola compounding lama).
- Struk name-only otomatis: racikan jadi `prescription_item` biasa; bahan tidak pernah
  jadi baris invoice.
- Tidak ada form master item di app (item hanya dari seed). Maka §5 = halaman toggle
  bahan baku ringan (bukan full CRUD barang).
- Di keranjang, bahan racikan bisa di-expand kecil untuk cek/hapus sebelum submit.

## Perubahan Data Model

### Migration `0042_racikan_bom.sql`

```sql
-- Flag bahan baku racikan di master barang.
alter table items add column is_compound_material boolean not null default false;

-- compounding_recipes: field instruksi jadi opsional + simpan total harga.
alter table compounding_recipes
  alter column dosage_instruction drop not null,
  alter column total_volume       drop not null,
  alter column dosage_form         drop not null,
  alter column compounding_steps   drop not null,
  add column total_price numeric(15,2) not null default 0;

-- compounding_ingredients: snapshot harga bahan saat racik.
alter table compounding_ingredients
  add column unit_price numeric(15,2) not null default 0;
```

Catatan: `dosage_form` punya CHECK constraint enum — drop-not-null aman, nilai boleh NULL.
`prescription_items.jenis` tetap dipakai; racikan pakai `jenis = "obat"` (aman ke invoice
split & struk existing, zero perubahan kasir).

## Komponen

### §1 — Halaman toggle bahan baku (master)
- Route: `/klinik/bahan-baku` (akses admin/owner; STAFF tidak).
- Server component: list semua `items` (aktif) + kolom toggle `is_compound_material`.
- Server action `toggleBahanBaku(itemId, value)` → update flag, `revalidatePath`.
- UI: tabel (Kode | Nama | Kategori | Harga jual | [toggle Bahan Baku]) + search.
- Tujuan: hanya menandai item existing sebagai bahan baku. Bukan CRUD barang.

### §2 — Builder Racikan (tab baru di POS Rekam Medis)
File: `RekamForm.tsx`.
- Tab POS jadi: Obat | Jasa | Paket | **Racikan**.
- Tab Obat existing di-filter `is_compound_material = false` (bahan baku tak muncul di obat jadi).
- Isi tab Racikan:
  - Input **Nama racikan** (wajib).
  - **Bentuk sediaan** (opsional dropdown: sirup/nebul/salep/puyer/kapsul/lainnya).
  - **Aturan pakai** (opsional).
  - Pencarian & pilih **bahan baku** (`is_compound_material = true`) → tambah baris
    `{item_id, nama, dosis(qty), satuan, harga(sell_price)}`.
  - **Estimasi total** realtime = Σ(harga × dosis).
  - Tombol **"Tambah racikan ke keranjang"** → push 1 `CartRow` jenis `"racikan"`:
    `{ key, nama_obat: nama racikan, qty: 1, harga: total, jenis: "racikan", ingredients: [...], dosage_form?, aturan_pakai? }`.
- Data source: page.tsx sudah query `items`; tambah field `is_compound_material` +
  pisahkan `obatItems` (flag false) dan `bahanItems` (flag true), kirim ke `RekamForm`.

### §3 — Keranjang: baris racikan
- Racikan tampil sebagai 1 baris (nama + total) dengan tag "racikan".
- Ada tombol **expand** kecil → tampilkan daftar bahan (nama, dosis, harga) + tombol hapus
  bahan (menghapus bahan → total racikan dihitung ulang; kalau bahan habis, baris racikan bisa dihapus).
- Bahan **tidak** dikirim ke invoice — hanya untuk builder + compounding record.

### §4 — Simpan (extend `simpanRekamMedis` di `actions.ts`)
Cart JSON sudah dikirim sebagai `resep`. Tambah handling per baris `jenis === "racikan"`:
1. Insert `prescription_items` → `{ nama_obat: nama racikan, qty: 1, harga: total, jenis: "obat", aturan_pakai }`.
   (jenis "obat" supaya alur invoice/struk tak berubah; nama-only otomatis.)
2. Insert `compounding_recipes` → `{ medical_record_id, recipe_name, dosage_form, dosage_instruction: aturan_pakai, total_price, status: "pending", created_by }`.
3. Insert `compounding_ingredients` (BOM) → tiap bahan `{ recipe_id, ingredient_name, item_id, quantity, unit, unit_price }`.
4. **Potong stok** tiap bahan di gudang cabang visit (pola `terimaBarang`/`checkout`:
   cari warehouse aktif branch → decrement `stock.qty`). Butuh `branch_id` dari visit.
- Baris `jenis` obat/jasa existing tetap seperti sekarang.

### §5 — Struk & Kasir
- **Zero perubahan.** Racikan sudah jadi `prescription_item` biasa → prefill invoice →
  invoice_items → struk/invoice render `deskripsi`(nama) + qty + harga. Bahan tak pernah
  masuk invoice. Requirement "struk nama-only" terpenuhi by construction.

## Data flow

```
Dokter (Rekam Medis, tab Racikan)
  → pilih bahan baku + dosis  → estimasi Σ(harga×dosis)
  → "Tambah ke keranjang"     → CartRow jenis "racikan" (+ ingredients)
  → Simpan Rekam Medis
      ├─ prescription_items (nama+harga, jenis obat)   → alur invoice/struk existing
      ├─ compounding_recipes + ingredients (BOM)        → worklist apoteker /klinik/racik
      └─ potong stok bahan @ gudang cabang
Kasir (Pembayaran) → invoice → struk: hanya nama racikan
Apoteker (/klinik/racik) → lihat BOM, racik, tandai ready/handed_over
```

## Error handling
- Nama racikan kosong / tanpa bahan → tolak tambah ke keranjang (validasi client).
- Stok bahan < dosis → tetap simpan tapi stok bisa minus? Ikuti pola existing (decrement
  apa adanya). Bila mau strict, tolak saat stok kurang — **default: ikuti pola existing
  (tidak blok)**, konsisten dengan checkout POS. Bisa dinaikkan bila diminta.
- Insert compounding gagal → rekam medis sudah tersimpan; racikan gagal disurface via
  `?error=`. (Non-atomik; sesuai pola action existing yang berurutan.)

## Testing
- Self-check builder: pilih 2 bahan (harga a, b; dosis x, y) → total = a·x + b·y. Assert.
- Verifikasi end-to-end di browser: buat racikan di rekam medis → cek muncul di keranjang
  (expand bahan) → simpan → cek prescription_item + compounding_recipes + stok bahan turun
  → lanjut ke kasir → struk hanya nama racikan.

## Out of scope
- Full CRUD master barang (hanya toggle flag).
- Jasa racik / markup harga (harga murni Σ bahan).
- Template racikan tersimpan (racikan dibangun ad-hoc tiap visit).
- Validasi stok keras (blok bila kurang) — ikuti pola existing dulu.
```
