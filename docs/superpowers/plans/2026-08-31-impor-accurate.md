# Impor Accurate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menambah impor khusus file Excel `Barang & Jasa` dari Accurate dengan preview, upsert berdasarkan kode, pembuatan master terkait saat konfirmasi, dan jaminan saldo stok tidak disentuh.

**Architecture:** Parser `.xlsx` berjalan server-side memakai ExcelJS dan mengubah worksheet ke model kanonik tanpa akses database. Preview membandingkan model itu dengan master VetOS dan memberi status `Baru`, `Update`, `Sama`, `Dilewati`, atau `Ditolak`; konfirmasi mengunggah file yang sama lagi dan mengulang seluruh validasi agar payload browser tidak dipercaya. Jalur ini terpisah dari impor CSV lama: CSV tetap strict, sedangkan Accurate boleh membuat kategori, merek, satuan, dan pemasok yang belum ada saat konfirmasi.

**Tech Stack:** Next.js 15 server actions, React 19, TypeScript, ExcelJS 4.4.0, Supabase/Postgres, Vitest.

---

## File map

- Modify `package.json` dan lockfile: dependency runtime `exceljs@4.4.0`.
- Create `src/lib/impor-accurate.ts`: schema header, parser workbook, normalisasi, status preview, dan diff field.
- Create `src/lib/__tests__/impor-accurate.test.ts`: workbook buatan in-memory, mapping, skip, reject, dan idempotensi.
- Create `src/app/(app)/pos/sku/impor/AccurateImportForm.tsx`: upload `.xlsx`, preview table, konfirmasi.
- Modify `src/app/(app)/pos/sku/impor/page.tsx`: pisahkan panel `CSV VetOS` dan `Excel Accurate`.
- Modify `src/app/(app)/pos/sku/impor/actions.ts`: action preview + confirm, master creation, upsert item/unit/tier.
- Preserve `src/lib/impor-barang.ts` dan perilaku `ImporForm.tsx` existing.

## Mapping kontrak

| Accurate | VetOS | Aturan |
|---|---|---|
| `Kode Barang` | `items.code` | kunci upsert, trim, case-sensitive saat simpan, pembanding lowercase |
| `Nama Barang` | `items.name` | wajib |
| `Jenis Barang` `INV/SVC/NON` | `Persediaan/Jasa/Non-Persediaan` | tipe lain dilewati |
| `Kategori Barang` | `item_categories.name` | buat kategori root bila belum ada |
| `Merek Barang` | `brands.name` | opsional, buat bila belum ada |
| `Satuan` | `items.unit` | wajib; buat master unit bila belum ada |
| `Satuan #2..#5` + `Rasio` | `item_units` | faktor > 0; abaikan pasangan kosong |
| `Def. Hrg. Jual Satuan #1` | `items.sell_price` | default 0 |
| `Def. Hrg. Jual Satuan #2..#5` | `item_units.sell_price` | default 0 |
| `Harga Beli` | `items.buy_price` | default 0 |
| `Pemasok Utama` | `suppliers.nama` + `items.supplier_id` | buat pemasok bila belum ada |
| `Satuan Beli` | `items.buy_unit` | kosong berarti satuan dasar |
| `Minimum Beli` | `items.min_buy` | clamp minimum 0 |
| `Batas Minimum Stok` | `items.min_stock` | hanya INV; tipe lain 0 |
| `UPC/Barcode` | `items.upc` | kosong menjadi null |
| `Pakai tanggal kadaluarsa` | `items.track_expiry` | `YA` true |
| `Default Diskon (%)` | `items.default_discount` | clamp 0..100 |
| `Non Aktif` | `items.is_active` | `YA` menjadi false |

Kolom saldo awal, gudang, kuantitas, nilai, akun, pajak, nomor seri, dimensi, catatan, karakter/angka/tanggal custom, dan cabang sengaja tidak diimpor. Jenis `GROUP (barang tipe grup tidak dapat diimport ulang)` dilewati karena file tidak memuat rincian komponen. Varian juga dilewati; file contoh memiliki 0 varian dan VetOS saat ini memakai SKU terpisah.

### Task 1: Pasang parser XLSX

**Files:**
- Modify: `package.json`
- Modify: lockfile aktif repo.

- [ ] **Step 1: Verifikasi package resmi**

Run: `npm view exceljs@4.4.0 version license repository.url`

Expected: version `4.4.0`, license `MIT`, repository `github.com/exceljs/exceljs`.

- [ ] **Step 2: Install dependency exact**

Run: `npm install --save-exact exceljs@4.4.0`

Expected: `package.json` memuat `"exceljs": "4.4.0"` dan lockfile berubah.

- [ ] **Step 3: Jalankan baseline**

Run: `npm test && npx tsc --noEmit`

Expected: seluruh test existing PASS; typecheck exit 0.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add ExcelJS importer dependency"
```

### Task 2: Parser workbook Accurate

**Files:**
- Create: `src/lib/impor-accurate.ts`
- Create: `src/lib/__tests__/impor-accurate.test.ts`

- [ ] **Step 1: Tulis failing test workbook minimum**

```ts
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { bacaWorkbookAccurate } from "../impor-accurate";

async function workbook(rows: unknown[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Barang & Jasa");
  rows.forEach((row) => ws.addRow(row));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

it("memetakan INV beserta satuan kedua", async () => {
  const bytes = await workbook([
    ["Kode Barang", "Nama Barang", "Jenis Barang", "Kategori Barang", "Satuan", "Satuan #2", "Rasio Satuan #2", "Def. Hrg. Jual Satuan #1", "Def. Hrg. Jual Satuan #2", "Non Aktif"],
    ["ANC0001", "ANC Adult 375gr", "INV", "WET CAN CAT", "PCS", "DUS", "24.000000", "13000", "312000", "TIDAK"],
  ]);
  const hasil = await bacaWorkbookAccurate(bytes);
  expect(hasil.rows[0]).toMatchObject({
    code: "ANC0001", name: "ANC Adult 375gr", item_type: "Persediaan",
    category_name: "WET CAN CAT", unit: "PCS", sell_price: 13000, is_active: true,
    units: [{ unit: "DUS", factor: 24, sell_price: 312000 }],
  });
});
```

- [ ] **Step 2: Jalankan test dan pastikan merah**

Run: `npm test -- src/lib/__tests__/impor-accurate.test.ts`

Expected: FAIL karena modul belum ada.

- [ ] **Step 3: Implement loader sheet dan cell normalizer**

```ts
import ExcelJS from "exceljs";

const text = (v: unknown) => String(v ?? "").trim();
const number = (v: unknown) => {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const yes = (v: unknown) => text(v).toUpperCase() === "YA";

export async function bacaWorkbookAccurate(bytes: Uint8Array) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes));
  const ws = wb.getWorksheet("Barang & Jasa");
  if (!ws) return { rows: [], errors: ["Sheet Barang & Jasa tidak ditemukan"] };
  // bangun map header dari row 1; iterasi row 2..rowCount
}
```

- [ ] **Step 4: Tambah test jenis, skip, dan header wajib**

```ts
it.each([["SVC", "Jasa"], ["NON", "Non-Persediaan"]])(
  "memetakan %s", async (source, expected) => {
    const bytes = await workbook([
      ["Kode Barang", "Nama Barang", "Jenis Barang", "Kategori Barang", "Satuan"],
      ["X1", "Contoh", source, "UMUM", "PCS"],
    ]);
    expect((await bacaWorkbookAccurate(bytes)).rows[0].item_type).toBe(expected);
  },
);

it("melewati GROUP dengan alasan eksplisit", async () => {
  const bytes = await workbook([
    ["Kode Barang", "Nama Barang", "Jenis Barang", "Kategori Barang", "Satuan"],
    ["G1", "Paket", "GROUP (barang tipe grup tidak dapat diimport ulang)", "PROMO", "PCS"],
  ]);
  expect((await bacaWorkbookAccurate(bytes)).skipped[0].reason).toContain("rincian komponen");
});

it("menerima alias header lama dengan normalisasi spasi dan kapital", async () => {
  const bytes = await workbook([
    [" kode barang ", "NAMA BARANG", "Jenis Barang", "Kategori Barang", "Satuan"],
    ["X2", "Contoh Alias", "INV", "UMUM", "PCS"],
  ]);
  expect((await bacaWorkbookAccurate(bytes)).rows[0].code).toBe("X2");
});
```

- [ ] **Step 5: Implement mapping lengkap**

Model kanonik:

```ts
export type AccurateItem = {
  row_no: number;
  code: string;
  name: string;
  item_type: "Persediaan" | "Jasa" | "Non-Persediaan";
  category_name: string;
  brand_name: string | null;
  unit: string;
  sell_price: number;
  buy_price: number;
  min_stock: number;
  supplier_name: string | null;
  buy_unit: string | null;
  min_buy: number;
  upc: string | null;
  track_expiry: boolean;
  default_discount: number;
  is_active: boolean;
  units: { unit: string; factor: number; sell_price: number; buy_price: number }[];
};
```

Wajib: kode, nama, jenis dikenal, kategori, satuan. Duplikat kode dalam file menjadi error per baris. Harga/faktor negatif ditolak. Empty rows diabaikan.

- [ ] **Step 6: Test buffer invalid dan file nyata lokal**

```ts
it("menolak bytes yang bukan workbook", async () => {
  await expect(bacaWorkbookAccurate(Buffer.from("bukan xlsx"))).rejects.toThrow();
});
```

Run: `npm test -- src/lib/__tests__/impor-accurate.test.ts`

Expected: PASS.

Run: `node scripts/inspect-accurate-import.mjs /Users/rezanje/Downloads/daftar-barang.xlsx`

Expected manual check: 638 INV, 29 SVC, 12 NON, 321 GROUP dilewati; script inspeksi tidak disimpan setelah check bila hanya diagnostic.

- [ ] **Step 7: Commit**

```bash
git add src/lib/impor-accurate.ts src/lib/__tests__/impor-accurate.test.ts
git commit -m "feat: parse Accurate item workbooks"
```

### Task 3: Preview dan diff idempotent

**Files:**
- Modify: `src/lib/impor-accurate.ts`
- Modify: `src/lib/__tests__/impor-accurate.test.ts`

- [ ] **Step 1: Tulis failing tests status**

```ts
it("membedakan Baru, Update, Sama, Dilewati, dan Ditolak", () => {
  const preview = buatPreviewAccurate(sourceRows, {
    itemsByCode: new Map([
      ["same", existingSame],
      ["changed", existingChanged],
    ]),
  });
  expect(preview.map((r) => r.status)).toEqual([
    "Baru", "Sama", "Update", "Dilewati", "Ditolak",
  ]);
});
```

- [ ] **Step 2: Implement normalized comparison**

Bandingkan string trim/lowercase untuk referensi nama dan `Number()` untuk angka. `changed_fields` hanya berisi field yang benar-benar beda. Urutan unit tidak memengaruhi hasil; key unit lowercase. Item existing identik harus `Sama`, sehingga confirm kedua tidak menghasilkan update kosong.

- [ ] **Step 3: Tambah test proteksi stok**

```ts
it("payload upsert tidak pernah memuat saldo stok Accurate", () => {
  const payload = payloadItemAccurate(sourceRows[0], ids);
  expect(payload).not.toHaveProperty("qty");
  expect(payload).not.toHaveProperty("opening_balance");
  expect(payload).not.toHaveProperty("warehouse_id");
});
```

- [ ] **Step 4: Verify dan commit**

Run: `npm test -- src/lib/__tests__/impor-accurate.test.ts && npx tsc --noEmit`

```bash
git add src/lib/impor-accurate.ts src/lib/__tests__/impor-accurate.test.ts
git commit -m "feat: preview Accurate import changes"
```

### Task 4: Server actions preview dan confirm

**Files:**
- Modify: `src/app/(app)/pos/sku/impor/actions.ts`
- Test: `src/lib/__tests__/impor-accurate.test.ts`

- [ ] **Step 1: Tambahkan shared file guard**

`assertBolehKelola()` tetap dipakai. Guard file: instance `File`, ekstensi `.xlsx`, ukuran 1 byte sampai 15 MB. Preview dan confirm sama-sama membaca `await file.arrayBuffer()` dan memanggil parser lagi.

- [ ] **Step 2: Implement `previewAccurate`**

Return serializable state:

```ts
export type PreviewAccurateState = {
  ok: boolean;
  message: string;
  summary: Record<"Baru" | "Update" | "Sama" | "Dilewati" | "Ditolak", number>;
  new_masters: { categories: string[]; brands: string[]; units: string[]; suppliers: string[] };
  rows: { row_no: number; code: string; name: string; status: string; changed_fields: string[]; reason?: string }[];
};
```

Load existing item by all codes plus `item_units`; load master kategori/merek/satuan/pemasok. Jangan menulis database.

- [ ] **Step 3: Implement master get-or-create pada confirm**

Untuk setiap nama unik yang dibutuhkan, cari case-insensitive dari map hasil load; bila belum ada insert satu kali dan simpan id ke map. Kategori dibuat root (`parent_id = null`, `is_active = true`), merek/unit aktif, pemasok memakai field wajib existing dengan default aman sesuai schema repo.

- [ ] **Step 4: Implement upsert item per kode**

`Baru` insert, `Update` update by exact existing id, `Sama` no-op, `Dilewati/Ditolak` no-op. Untuk item tersimpan, replace-all `item_units` dari unit #2..#5 setelah seluruh payload lolos validasi. Jangan menulis tabel `stock`, `stock_layers`, `stock_moves`, atau saldo awal.

- [ ] **Step 5: Tangani error per baris dan hasil akhir**

Baris gagal dicatat sebagai Ditolak; baris lain lanjut. Return summary import. Revalidate `/pos/sku` dan `/pos/sku/impor`; jangan redirect dari helper yang perlu mengembalikan preview JSON.

- [ ] **Step 6: Verify dan commit**

Run: `npm test -- src/lib/__tests__/impor-accurate.test.ts && npm run lint && npx tsc --noEmit`

```bash
git add 'src/app/(app)/pos/sku/impor/actions.ts' src/lib/__tests__/impor-accurate.test.ts
git commit -m "feat: upsert Accurate item imports"
```

### Task 5: UI preview dan konfirmasi

**Files:**
- Create: `src/app/(app)/pos/sku/impor/AccurateImportForm.tsx`
- Modify: `src/app/(app)/pos/sku/impor/page.tsx`
- Preserve: `src/app/(app)/pos/sku/impor/ImporForm.tsx`

- [ ] **Step 1: Buat form dua tahap**

Gunakan `<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">`. Simpan `File` di state/ref. Tombol pertama membangun `FormData` dan memanggil `previewAccurate`; tombol kedua mengirim file sama ke `confirmAccurate`. Disable confirm jika file berubah setelah preview.

- [ ] **Step 2: Render summary dan tabel**

Summary badge untuk lima status. Tabel menampilkan baris, kode, nama, status, field berubah/alasan. Default filter hanya `Baru`, `Update`, `Dilewati`, `Ditolak`; `Sama` bisa dibuka agar 1.000 baris tidak memenuhi layar.

- [ ] **Step 3: Tampilkan batasan eksplisit**

Copy UI:

```text
Impor ini tidak mengubah stok/saldo awal. Grup dan varian dilewati karena export Barang & Jasa tidak membawa rincian komponennya. Kategori, merek, satuan, dan pemasok baru dibuat hanya setelah konfirmasi.
```

- [ ] **Step 4: Pertahankan jalur CSV**

`ImporForm` existing tetap tersedia di panel `CSV VetOS`; perilaku strict dan pesan “master harus sudah terdaftar” tidak diubah.

- [ ] **Step 5: Verify dan commit**

Run: `npm run lint && npx tsc --noEmit && npm run build`

```bash
git add 'src/app/(app)/pos/sku/impor/AccurateImportForm.tsx' 'src/app/(app)/pos/sku/impor/page.tsx'
git commit -m "feat: add Accurate import preview UI"
```

### Task 6: Data verification dengan export client

**Files:**
- Modify only files required by failures found during verification.

- [ ] **Step 1: Jalankan full automated checks**

Run: `npm test && npm run lint && npx tsc --noEmit && npm run build`

Expected: seluruh command exit 0.

- [ ] **Step 2: Preview file client tanpa konfirmasi**

Gunakan `/Users/rezanje/Downloads/daftar-barang.xlsx`. Expected source counts: 638 INV, 29 SVC, 12 NON, 321 GROUP skipped; total tepat 1.000 baris terklasifikasi tanpa hilang diam-diam.

- [ ] **Step 3: Verifikasi sample mapping**

1. `ANC0001` memuat PCS + DUS faktor 24, harga 13.000 dan 312.000.
2. `100532 Add On Treatment Jamur` berstatus Dilewati dengan alasan resep grup tidak tersedia.
3. `ONG005 Antar Jemput A` menjadi Jasa.
4. `100212 Bakpao Isi 3` menjadi Non-Persediaan dan nonaktif.
5. Tidak ada payload `stock`, `stock_layers`, `stock_moves`, gudang saldo awal, atau akun.

- [ ] **Step 4: Uji idempotensi pada database lokal**

Import fixture kecil sekali: status `Baru`. Preview file sama lagi: semua item menjadi `Sama`. Ubah satu harga: hanya baris itu `Update` dengan `changed_fields = ["sell_price"]`.

- [ ] **Step 5: Jalankan advisor Supabase setelah confirm lokal**

Run: `npx supabase@2.115.0 inspect db table-sizes && npx supabase@2.115.0 db lint --level warning`

Expected: tidak ada finding baru akibat importer.

- [ ] **Step 6: Commit perbaikan verifikasi bila ada**

Gunakan `git status --short`, stage hanya file yang benar-benar diperbaiki, lalu:

```bash
git commit -m "fix: harden Accurate item import"
```
