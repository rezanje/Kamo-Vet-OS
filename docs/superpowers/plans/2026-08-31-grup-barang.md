# Grup Barang Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menambah jenis barang `Grup` dengan komponen tetap, harga jual milik grup, pemotongan stok komponen saat checkout, snapshot komponen di struk, dan pembalikan komponen proporsional saat retur.

**Architecture:** Master grup tetap memakai tabel `items`; relasi resep disimpan di `item_group_components`. Domain murni di `src/lib/grup-barang.ts` memvalidasi, mengagregasi kebutuhan stok, dan menghitung pembalikan retur. Checkout memuat resep dari server, melakukan preflight komponen Persediaan sebelum membuat `sales`, lalu menyimpan snapshot per `sale_item` supaya struk dan retur tidak berubah ketika resep master diedit.

**Tech Stack:** Next.js 15 App Router/server actions, React 19, TypeScript, Supabase/Postgres RLS, Vitest.

---

## File map

- Create `src/lib/grup-barang.ts`: tipe dan fungsi domain murni untuk validasi, agregasi kebutuhan, ketersediaan, dan pembalikan retur.
- Create `src/lib/__tests__/grup-barang.test.ts`: kontrak domain grup.
- Create migration melalui `npx supabase migration new grup_barang`: enum/check `items.item_type`, tabel resep, tabel snapshot, index, constraint, RLS.
- Modify `src/lib/barang.ts`: tambahkan `Grup` dan aturan field per jenis.
- Modify `src/app/(app)/pos/sku/BarangForm.tsx`: tab `Rincian Grup`, editor komponen, hidden payload.
- Modify `src/app/(app)/pos/sku/data.ts`: kandidat komponen dan resep tersimpan.
- Modify `src/app/(app)/pos/sku/actions.ts`: validasi dan replace-all resep dengan rollback eksplisit.
- Modify page baru/edit SKU: teruskan kandidat komponen.
- Modify `src/app/kasir/page.tsx`: muat detail grup dan stok efektif.
- Modify `src/app/kasir/KasirClient.tsx`: tampilkan rincian grup di katalog/keranjang.
- Modify `src/app/kasir/checkout.ts`: resolve resep server-side, preflight, mutasi stok komponen, dan snapshot.
- Modify `src/app/kasir/struk/[saleId]/page.tsx`: tampilkan komponen menjorok tanpa harga.
- Modify retur penjualan page/form/action: pilih grup sebagai baris refund, kembalikan komponen Persediaan proporsional dari snapshot.
- Modify `src/lib/retur.ts` dan tesnya: alokasi snapshot dan HPP retur grup.

### Task 1: Domain grup murni

**Files:**
- Create: `src/lib/grup-barang.ts`
- Create: `src/lib/__tests__/grup-barang.test.ts`

- [ ] **Step 1: Tulis failing tests validasi resep**

```ts
import { describe, expect, it } from "vitest";
import { validasiKomponenGrup } from "../grup-barang";

describe("validasiKomponenGrup", () => {
  it("menolak resep kosong, komponen grup, duplikat item+satuan, dan qty nol", () => {
    expect(validasiKomponenGrup([], new Map())).toContain("minimal 1");
    expect(validasiKomponenGrup([
      { component_item_id: "a", qty: 1, unit: "PCS", factor: 1 },
    ], new Map([["a", "Grup"]]))).toContain("tidak boleh Grup");
    expect(validasiKomponenGrup([
      { component_item_id: "a", qty: 1, unit: "PCS", factor: 1 },
      { component_item_id: "a", qty: 2, unit: "PCS", factor: 1 },
    ], new Map([["a", "Persediaan"]]))).toContain("kembar");
    expect(validasiKomponenGrup([
      { component_item_id: "a", qty: 0, unit: "PCS", factor: 1 },
    ], new Map([["a", "Persediaan"]]))).toContain("lebih dari 0");
  });
});
```

- [ ] **Step 2: Jalankan test dan pastikan merah**

Run: `npm test -- src/lib/__tests__/grup-barang.test.ts`

Expected: FAIL karena `../grup-barang` belum ada.

- [ ] **Step 3: Implement tipe dan validasi minimum**

```ts
export type JenisKomponen = "Persediaan" | "Jasa" | "Non-Persediaan" | "Grup";

export type KomponenGrupDraft = {
  component_item_id: string;
  qty: number;
  unit: string;
  factor: number;
};

export function validasiKomponenGrup(
  rows: KomponenGrupDraft[],
  jenis: Map<string, JenisKomponen>,
): string | null {
  if (rows.length === 0) return "Grup wajib punya minimal 1 komponen";
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.component_item_id) return "Komponen wajib dipilih";
    if (!Number.isFinite(row.qty) || row.qty <= 0) return "Qty komponen harus lebih dari 0";
    if (!Number.isFinite(row.factor) || row.factor <= 0) return "Faktor satuan harus lebih dari 0";
    if (jenis.get(row.component_item_id) === "Grup") return "Komponen tidak boleh Grup";
    const key = `${row.component_item_id}:${row.unit.trim().toLowerCase()}`;
    if (seen.has(key)) return "Komponen dan satuan kembar tidak diperbolehkan";
    seen.add(key);
  }
  return null;
}
```

- [ ] **Step 4: Tambah failing tests agregasi dan stok efektif**

```ts
import { agregasiKebutuhanGrup, stokEfektifGrup } from "../grup-barang";

it("mengagregasi komponen sama dari grup dan barang langsung", () => {
  expect(agregasiKebutuhanGrup([
    { item_id: "food", qty_dasar: 2, item_type: "Persediaan", source_sale_item: "direct" },
    { item_id: "food", qty_dasar: 6, item_type: "Persediaan", source_sale_item: "group" },
    { item_id: "svc", qty_dasar: 1, item_type: "Jasa", source_sale_item: "group" },
  ])).toEqual([{ item_id: "food", qty_dasar: 8 }]);
});

it("mengambil floor stok terkecil komponen persediaan", () => {
  expect(stokEfektifGrup([
    { item_id: "a", qty_per_group: 2, item_type: "Persediaan" },
    { item_id: "b", qty_per_group: 3, item_type: "Persediaan" },
    { item_id: "svc", qty_per_group: 1, item_type: "Jasa" },
  ], new Map([["a", 9], ["b", 11]]))).toBe(3);
});
```

- [ ] **Step 5: Implement agregasi dan stok efektif**

```ts
export function agregasiKebutuhanGrup(rows: {
  item_id: string; qty_dasar: number; item_type: JenisKomponen; source_sale_item: string;
}[]) {
  const total = new Map<string, number>();
  for (const row of rows) {
    if (row.item_type !== "Persediaan") continue;
    total.set(row.item_id, (total.get(row.item_id) ?? 0) + row.qty_dasar);
  }
  return [...total].map(([item_id, qty_dasar]) => ({ item_id, qty_dasar }));
}

export function stokEfektifGrup(rows: {
  item_id: string; qty_per_group: number; item_type: JenisKomponen;
}[], stok: Map<string, number>): number {
  const tracked = rows.filter((r) => r.item_type === "Persediaan");
  if (!tracked.length) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.min(...tracked.map((r) =>
    Math.floor((stok.get(r.item_id) ?? 0) / r.qty_per_group),
  )));
}
```

- [ ] **Step 6: Jalankan test, typecheck, commit**

Run: `npm test -- src/lib/__tests__/grup-barang.test.ts && npx tsc --noEmit`

Expected: PASS dan exit 0.

```bash
git add src/lib/grup-barang.ts src/lib/__tests__/grup-barang.test.ts
git commit -m "feat: add group item domain rules"
```

### Task 2: Schema resep dan snapshot transaksi

**Files:**
- Create: file hasil `npx supabase migration new grup_barang`

- [ ] **Step 1: Baca changelog Supabase/Postgres yang relevan dan CLI help**

Run: `npx supabase@2.115.0 migration new --help`

Expected: usage `supabase migration new <migration name>`.

- [ ] **Step 2: Buat migration lewat CLI**

Run: `npx supabase@2.115.0 migration new grup_barang`

Expected: satu file baru di `supabase/migrations/` dengan akhiran `_grup_barang.sql`.

- [ ] **Step 3: Isi migration**

```sql
alter table items drop constraint if exists items_item_type_check;
alter table items add constraint items_item_type_check
  check (item_type in ('Persediaan', 'Jasa', 'Non-Persediaan', 'Grup'));

create table item_group_components (
  id uuid primary key default gen_random_uuid(),
  group_item_id uuid not null references items(id) on delete cascade,
  component_item_id uuid not null references items(id) on delete restrict,
  qty numeric(15,4) not null check (qty > 0),
  unit varchar(20) not null,
  factor numeric(15,4) not null check (factor > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_item_id, component_item_id, unit),
  check (group_item_id <> component_item_id)
);
create index item_group_components_group_idx on item_group_components(group_item_id, sort_order);
create index item_group_components_component_idx on item_group_components(component_item_id);

create table sale_item_group_components (
  id uuid primary key default gen_random_uuid(),
  sale_item_id uuid not null references sale_items(id) on delete cascade,
  component_item_id uuid references items(id) on delete set null,
  component_code varchar(80),
  component_name varchar(160) not null,
  item_type varchar(16) not null check (item_type in ('Persediaan', 'Jasa', 'Non-Persediaan')),
  qty_per_group numeric(15,4) not null check (qty_per_group > 0),
  unit varchar(20) not null,
  factor numeric(15,4) not null check (factor > 0),
  total_base_qty numeric(15,4) not null check (total_base_qty > 0),
  hpp numeric(15,2) not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index sale_item_group_components_sale_item_idx
  on sale_item_group_components(sale_item_id, sort_order);

alter table item_group_components enable row level security;
alter table sale_item_group_components enable row level security;

create policy item_group_components_read on item_group_components
  for select to authenticated using (true);
create policy item_group_components_write on item_group_components
  for all to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('OWNER', 'ADMIN')))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('OWNER', 'ADMIN')));
create policy sale_item_group_components_access on sale_item_group_components
  for all to authenticated
  using (exists (
    select 1 from sale_items si join sales s on s.id = si.sale_id
    where si.id = sale_item_group_components.sale_item_id
      and public.user_can_access_branch(s.branch_id)
  ))
  with check (exists (
    select 1 from sale_items si join sales s on s.id = si.sale_id
    where si.id = sale_item_group_components.sale_item_id
      and public.user_can_access_branch(s.branch_id)
  ));
```

- [ ] **Step 4: Tambah DB trigger yang menolak resep invalid**

```sql
create or replace function public.validate_item_group_component()
returns trigger language plpgsql set search_path = public as $$
declare
  group_type text;
  component_type text;
  component_base_unit text;
  official_factor numeric;
begin
  select item_type into group_type from items where id = new.group_item_id;
  select item_type, unit into component_type, component_base_unit
    from items where id = new.component_item_id and is_active = true;
  if group_type <> 'Grup' then raise exception 'group_item_id bukan Grup'; end if;
  if component_type is null or component_type = 'Grup' then
    raise exception 'komponen harus item aktif non-Grup';
  end if;
  if lower(new.unit) = lower(component_base_unit) then
    official_factor := 1;
  else
    select factor into official_factor from item_units
      where item_id = new.component_item_id and lower(unit) = lower(new.unit);
  end if;
  if official_factor is null or official_factor <> new.factor then
    raise exception 'satuan/faktor komponen tidak cocok master';
  end if;
  return new;
end $$;

create trigger item_group_components_validate
before insert or update on item_group_components
for each row execute function public.validate_item_group_component();
```

- [ ] **Step 5: Uji migration lokal**

Run: `npx supabase@2.115.0 db reset`

Expected: semua migration selesai tanpa error.

Run: `npx supabase@2.115.0 db lint --level warning`

Expected: tidak ada finding baru untuk dua tabel baru.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/*_grup_barang.sql
git commit -m "feat: add group item schema"
```

### Task 3: Master Grup Barang

**Files:**
- Modify: `src/lib/barang.ts`
- Modify: `src/app/(app)/pos/sku/BarangForm.tsx`
- Modify: `src/app/(app)/pos/sku/data.ts`
- Modify: `src/app/(app)/pos/sku/actions.ts`
- Modify: `src/app/(app)/pos/sku/baru/page.tsx`
- Modify: `src/app/(app)/pos/sku/[id]/page.tsx`
- Test: `src/lib/__tests__/barang.test.ts`

- [ ] **Step 1: Tulis failing test jenis Grup**

```ts
import { describe, expect, it } from "vitest";
import { ITEM_TYPES, fieldBarangMenurutJenis } from "../barang";

describe("Grup", () => {
  it("terdaftar dan tidak punya stok/pembelian sendiri", () => {
    expect(ITEM_TYPES).toContain("Grup");
    expect(fieldBarangMenurutJenis("Grup")).toEqual({ punyaStok: false, bolehDibeli: false });
  });
});
```

- [ ] **Step 2: Jalankan test dan pastikan merah**

Run: `npm test -- src/lib/__tests__/barang.test.ts`

Expected: FAIL karena `Grup` dan helper belum ada.

- [ ] **Step 3: Tambahkan jenis dan helper**

```ts
export const ITEM_TYPES = ["Persediaan", "Jasa", "Non-Persediaan", "Grup"] as const;
export function fieldBarangMenurutJenis(t: ItemType) {
  return { punyaStok: t === "Persediaan", bolehDibeli: t === "Persediaan" || t === "Non-Persediaan" };
}
```

- [ ] **Step 4: Muat kandidat dan resep**

`siapkanFormBarang()` memuat item aktif maksimal 4.500 dengan `id, code, name, unit, item_type`, mengecualikan `Grup`. `loadBarang()` memuat `item_group_components` beserta snapshot nama/kode/unit dari relasi `items`, lalu memetakan angka dengan `Number()`.

- [ ] **Step 5: Tambahkan tab `Rincian Grup`**

Tab hanya muncul saat `itemType === "Grup"`. Setiap baris memilih komponen, qty, dan satuan resmi komponen. Hidden input:

```tsx
<input type="hidden" name="group_components" value={JSON.stringify(groupComponents)} />
```

Grup tetap punya kategori, kode, satuan `PCS`, dan harga jual. Sembunyikan harga beli, stok minimum, expiry, pemasok, substitusi, satuan berjenjang, dan harga bertingkat.

- [ ] **Step 6: Simpan resep server-side**

Parse payload, reload kandidat beserta `item_type` dan unit resmi, panggil `validasiKomponenGrup`, lalu replace-all `item_group_components`. Bila insert resep gagal setelah item baru dibuat, hapus item baru. Bila edit gagal, jangan menghapus resep lama sebelum payload lolos validasi.

- [ ] **Step 7: Jalankan unit test, lint, typecheck**

Run: `npm test -- src/lib/__tests__/barang.test.ts src/lib/__tests__/grup-barang.test.ts && npm run lint && npx tsc --noEmit`

Expected: seluruh command exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/lib/barang.ts src/lib/__tests__/barang.test.ts src/app/\(app\)/pos/sku
git commit -m "feat: manage group item recipes"
```

### Task 4: Katalog dan keranjang POS

**Files:**
- Modify: `src/app/kasir/page.tsx`
- Modify: `src/app/kasir/KasirClient.tsx`
- Test: `src/lib/__tests__/grup-barang.test.ts`

- [ ] **Step 1: Tambah test stok efektif tanpa komponen Persediaan**

```ts
it("grup jasa selalu tersedia secara stok", () => {
  expect(stokEfektifGrup([
    { item_id: "svc", qty_per_group: 1, item_type: "Jasa" },
  ], new Map())).toBe(Number.MAX_SAFE_INTEGER);
});
```

- [ ] **Step 2: Muat detail grup dan saldo komponen**

Query katalog menambah `item_type`; query `item_group_components` hanya untuk id grup. Ambil saldo `stock` gudang cabang untuk component ids. Hitung `stokEfektifGrup`, dan bentuk `groupComponents: {name, qty, unit}[]`.

- [ ] **Step 3: Tampilkan detail**

Di katalog, label `Grup` dan ringkasan `isi: 2 × ...`. Di keranjang, komponen tampil menjorok, read-only, tanpa harga. Harga dan diskon hanya berada pada baris grup.

- [ ] **Step 4: Verify dan commit**

Run: `npm test -- src/lib/__tests__/grup-barang.test.ts && npm run lint && npx tsc --noEmit`

```bash
git add src/app/kasir/page.tsx src/app/kasir/KasirClient.tsx src/lib/__tests__/grup-barang.test.ts
git commit -m "feat: show group details in POS"
```

### Task 5: Checkout grup dan snapshot

**Files:**
- Modify: `src/lib/grup-barang.ts`
- Modify: `src/lib/__tests__/grup-barang.test.ts`
- Modify: `src/app/kasir/checkout.ts`

- [ ] **Step 1: Tulis failing test ekspansi baris jual**

```ts
it("mengalikan qty grup, qty komponen, dan faktor satuan", () => {
  expect(expandBarisGrup({ item_id: "g", qty: 3 }, [{
    component_item_id: "a", item_type: "Persediaan", qty: 2, factor: 0.5,
    unit: "1/2KG", name: "Bolt Dog", code: "BD", sort_order: 0,
  }])[0].total_base_qty).toBe(3);
});
```

- [ ] **Step 2: Implement `expandBarisGrup` dan jalankan test**

Rumus: `total_base_qty = groupQty * component.qty * component.factor`. Snapshot mempertahankan `qty_per_group`, `unit`, `factor`, urutan, nama, kode, jenis.

Run: `npm test -- src/lib/__tests__/grup-barang.test.ts`

Expected: PASS.

- [ ] **Step 3: Resolve semua item dari server**

Query `items` menambah `item_type`; untuk Grup, abaikan `factor` buatan klien dan pakai faktor 1. Load resep + item komponen. Tolak grup kosong, komponen Grup, komponen nonaktif, atau resep berubah invalid.

- [ ] **Step 4: Preflight sebelum insert `sales`**

Gabungkan kebutuhan Persediaan dari barang langsung dan seluruh grup. Query `stock` di gudang aktif. Jika `available < required`, redirect dengan nama komponen dan kekurangan. Jasa/Non-Persediaan tidak ikut preflight.

- [ ] **Step 5: Mutasi stok dan simpan sale item per baris**

Setelah preflight, buat sale. Untuk barang langsung panggil `stockOut` seperti sekarang. Untuk Grup, panggil `stockOut` per komponen Persediaan; bagi HPP per snapshot komponen. Insert tiap `sale_items` dengan `.select("id")`, simpan `sale_items.hpp = total HPP komponen`, lalu insert snapshot memakai id tersebut. Komponen Jasa/Non-Persediaan tetap masuk snapshot dengan HPP 0.

- [ ] **Step 6: Gagal keras dan bersihkan dokumen parsial**

Jika mutasi/sale item/snapshot gagal, log error, hapus `sales` yang baru dibuat, dan redirect error. Catat bahwa mutasi stok JS belum transaksional; jangan mengklaim rollback stok. Buat issue/follow-up hanya bila pengujian membuktikan jalur gagal nyata. Jangan menelan error seperti loop lama.

- [ ] **Step 7: Tambah regression test barang biasa**

Ekstrak pembentukan kebutuhan checkout ke helper murni. Test harus membuktikan baris Persediaan biasa tetap menghasilkan satu kebutuhan `qty × faktor`, sedangkan Jasa/Non-Persediaan tetap tanpa kebutuhan stok.

- [ ] **Step 8: Verify dan commit**

Run: `npm test -- src/lib/__tests__/grup-barang.test.ts && npm run lint && npx tsc --noEmit`

```bash
git add src/lib/grup-barang.ts src/lib/__tests__/grup-barang.test.ts src/app/kasir/checkout.ts
git commit -m "feat: expand group stock at checkout"
```

### Task 6: Struk grup

**Files:**
- Modify: `src/app/kasir/struk/[saleId]/page.tsx`

- [ ] **Step 1: Tambahkan snapshot ke query struk**

Select `sale_item_group_components(component_name, qty_per_group, unit, sort_order)` dan urutkan sisi aplikasi berdasarkan `sort_order`.

- [ ] **Step 2: Render komponen tanpa harga**

Di bawah nama grup:

```tsx
{components.map((c) => (
  <div key={`${c.sort_order}-${c.component_name}`} style={{ paddingLeft: 10, fontSize: 9.5 }}>
    ↳ {c.qty_per_group} {c.unit} {c.component_name}
  </div>
))}
```

- [ ] **Step 3: Verify dan commit**

Run: `npm run lint && npx tsc --noEmit`

```bash
git add 'src/app/kasir/struk/[saleId]/page.tsx'
git commit -m "feat: print group components on receipts"
```

### Task 7: Retur grup proporsional

**Files:**
- Modify: `src/lib/retur.ts`
- Modify: `src/lib/__tests__/retur.test.ts`
- Modify: `src/app/(app)/penjualan/retur/baru/page.tsx`
- Modify: `src/app/(app)/penjualan/retur/baru/ReturJualForm.tsx`
- Modify: `src/app/(app)/penjualan/retur/actions.ts`
- Modify: jalur kasir retur yang memakai loader/form sama bila querynya terpisah.

- [ ] **Step 1: Tulis failing test alokasi retur grup**

```ts
it("retur setengah grup mengembalikan setengah qty dan HPP setiap komponen", () => {
  expect(alokasiReturGrup(1, 2, [{
    component_item_id: "a", item_type: "Persediaan", total_base_qty: 8, hpp: 40000,
  }])).toEqual([{ component_item_id: "a", qty: 4, hpp: 20000 }]);
});
```

- [ ] **Step 2: Implement helper dan pastikan test hijau**

`ratio = qtyRetur / qtyTerjual`; hasil qty dan HPP dikali ratio. Tolak `qtyRetur > qtyTerjual` dan angka negatif.

- [ ] **Step 3: Tampilkan grup sebagai baris refund**

Form tetap memilih grup, bukan komponen. Komponen snapshot tampil menjorok sebagai informasi. Kondisi `baik/rusak` berlaku ke seluruh komponen Persediaan dalam grup. Harga refund tetap berdasarkan harga grup dan rasio pembayaran struk.

- [ ] **Step 4: Kembalikan stok dari snapshot**

Action memuat `sale_items.id` dan snapshots. Hitung sisa retur per item grup seperti sekarang, lalu alokasikan qty retur ke sale item asal berurutan. `stockIn` hanya untuk snapshot `Persediaan` kondisi baik; unit cost = `snapshot.hpp / snapshot.total_base_qty`. Jurnal HPP memakai HPP snapshot proporsional; Jasa/Non-Persediaan tidak masuk stok/HPP.

- [ ] **Step 5: Verify dan commit**

Run: `npm test -- src/lib/__tests__/retur.test.ts src/lib/__tests__/grup-barang.test.ts && npm run lint && npx tsc --noEmit`

```bash
git add src/lib/retur.ts src/lib/__tests__/retur.test.ts src/app/\(app\)/penjualan/retur src/app/kasir/retur
git commit -m "feat: return group components proportionally"
```

### Task 8: End-to-end verification

**Files:**
- Modify only files required by failures found during verification.

- [ ] **Step 1: Jalankan full test**

Run: `npm test`

Expected: seluruh test PASS.

- [ ] **Step 2: Jalankan static checks dan production build**

Run: `npm run lint && npx tsc --noEmit && npm run build`

Expected: seluruh command exit 0.

- [ ] **Step 3: Jalankan Supabase checks**

Run: `npx supabase@2.115.0 db reset && npx supabase@2.115.0 db lint --level warning`

Expected: migration bersih, tidak ada finding baru.

- [ ] **Step 4: Smoke test manual**

1. Buat grup `Promo Bolt Ikan 6 Pcs`, komponen `Bolt Ikan 800gr`, qty 6 PCS.
2. Pastikan katalog menampilkan stok efektif dan rincian.
3. Jual qty 2; pastikan stok Bolt berkurang 12, grup tidak punya saldo stok.
4. Pastikan struk menampilkan grup berharga dan komponen tanpa harga.
5. Retur qty 1 kondisi baik; pastikan stok Bolt bertambah 6 dan HPP balik proporsional.
6. Edit resep grup, buka struk lama; pastikan snapshot lama tidak berubah.

- [ ] **Step 5: Commit perbaikan verifikasi bila ada**

Jalankan `git status --short`, stage hanya file yang diperbaiki selama verifikasi, lalu commit:

```bash
git commit -m "fix: harden group item flow"
```
