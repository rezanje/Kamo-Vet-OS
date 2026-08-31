# Accurate Migration Lanjutan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Melengkapi importer Accurate dengan upload multi-file, audit batch, master Grup, template komponen, keluarga Varian, dan saldo awal atomik per gudang.

**Architecture:** Parser murni membaca dan menggabungkan workbook tanpa menyentuh database. Server action membuat preview dan audit run; posting saldo awal dikerjakan satu RPC Postgres supaya `stock`, `stock_layers`, dan `stock_moves` tidak pernah setengah tersimpan. Grup memakai tabel existing, sedangkan Varian hanya mengelompokkan SKU mandiri.

**Tech Stack:** Next.js App Router 15, React 19, TypeScript, ExcelJS, Supabase/Postgres RLS, Vitest.

---

### Task 1: Parser multi-file dan tipe baris tambahan

**Files:**
- Create: `src/lib/impor-accurate-lanjutan.ts`
- Create: `src/lib/__tests__/impor-accurate-lanjutan.test.ts`
- Modify: `src/lib/impor-accurate.ts`

- [ ] **Step 1: Write failing tests for cross-file duplicates, Grup, stock rows, and component rows**

```ts
import { describe, expect, it } from "vitest";
import {
  gabungWorkbookAccurate,
  parseKomponenGrupRows,
  parseSaldoAwalRows,
} from "../impor-accurate-lanjutan";

describe("gabungWorkbookAccurate", () => {
  it("menolak kode kembar lintas-file", () => {
    const hasil = gabungWorkbookAccurate([
      { file: "1.xlsx", rows: [{ row_no: 2, code: "SKU-1", name: "A" }] },
      { file: "2.xlsx", rows: [{ row_no: 7, code: "sku-1", name: "B" }] },
    ]);
    expect(hasil.rows).toEqual([]);
    expect(hasil.rejected.map((r) => r.source)).toEqual(["1.xlsx:2", "2.xlsx:7"]);
  });
});

describe("parseSaldoAwalRows", () => {
  it("mewajibkan HPP dan data expiry untuk barang expiry", () => {
    expect(parseSaldoAwalRows([
      { row: 2, code: "EXP", warehouse: "GDG-1", qty: 2, unit: "PCS", unitCost: null, asOf: "2026-08-31", expDate: null },
    ], new Map([["EXP", { itemType: "Persediaan", unit: "PCS", trackExpiry: true }]]))).toMatchObject({ valid: [], rejected: [{ row: 2 }] });
  });
});

describe("parseKomponenGrupRows", () => {
  it("menolak Grup tanpa komponen dan Grup bertingkat", () => {
    const hasil = parseKomponenGrupRows([
      { row: 2, groupCode: "G1", componentCode: "G2", qty: 1, unit: "PCS", sortOrder: 1 },
    ], new Map([
      ["G1", { itemType: "Grup", unit: "PCS" }],
      ["G2", { itemType: "Grup", unit: "PCS" }],
    ]));
    expect(hasil.rejected[0].reason).toMatch(/Grup bertingkat/);
  });
});
```

- [ ] **Step 2: Run tests and verify missing module failure**

Run: `npm test -- src/lib/__tests__/impor-accurate-lanjutan.test.ts`

Expected: FAIL with `Cannot find module '../impor-accurate-lanjutan'`.

- [ ] **Step 3: Implement focused pure parsers**

```ts
export type SourceRow = { row_no: number; code: string; name: string };
export type FileRows = { file: string; rows: SourceRow[] };
export type RejectedSource = { source: string; code: string; reason: string };
export type RowIssue = { row: number; reason: string };
export type SaldoAwalDraft = {
  row: number; code: string; warehouse: string; qty: number; unit: string;
  unitCost: number | null; asOf: string; batchNo?: string | null; expDate?: string | null;
};
export type SaldoAwalValid = SaldoAwalDraft & { baseQty: number; baseUnitCost: number };
export type KomponenGrupDraft = {
  row: number; groupCode: string; componentCode: string; qty: number; unit: string; sortOrder: number;
};
export type ResolvedGroupComponent = {
  groupCode: string; componentId: string; qty: number; unit: string; factor: number; sortOrder: number;
};
export type GroupRpcRow = {
  component_item_id: string; qty: number; unit: string; sort_order: number;
};

export function gabungWorkbookAccurate(files: FileRows[]) {
  const count = new Map<string, number>();
  for (const file of files) for (const row of file.rows) {
    const key = row.code.trim().toLowerCase();
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  const duplicates = new Set([...count].filter(([, n]) => n > 1).map(([key]) => key));
  return {
    rows: files.flatMap((file) => file.rows.filter((row) => !duplicates.has(row.code.trim().toLowerCase()))),
    rejected: files.flatMap((file) => file.rows
      .filter((row) => duplicates.has(row.code.trim().toLowerCase()))
      .map((row) => ({ source: `${file.file}:${row.row_no}`, code: row.code, reason: "Kode kembar lintas-file" }))),
  };
}

type MasterLite = { itemType: string; unit: string; trackExpiry?: boolean; units?: { unit: string; factor: number }[] };
const factorFor = (item: MasterLite, unit: string) => unit === item.unit
  ? 1
  : item.units?.find((u) => u.unit.toLowerCase() === unit.toLowerCase())?.factor ?? null;

export function parseSaldoAwalRows(rows: SaldoAwalDraft[], master: Map<string, MasterLite>) {
  const valid: SaldoAwalValid[] = [], rejected: RowIssue[] = [];
  for (const row of rows) {
    const item = master.get(row.code.toUpperCase());
    const factor = item ? factorFor(item, row.unit) : null;
    const reason = !item ? "Kode barang tidak ditemukan"
      : item.itemType !== "Persediaan" ? "Saldo hanya untuk Persediaan"
      : !(row.qty >= 0) ? "Kuantitas tidak valid"
      : row.unitCost == null || row.unitCost < 0 ? "HPP wajib diisi"
      : !factor ? "Satuan tidak dikenal"
      : item.trackExpiry && row.qty > 0 && !row.expDate ? "Tanggal kedaluwarsa wajib" : null;
    if (reason) rejected.push({ row: row.row, reason });
    else valid.push({ ...row, baseQty: row.qty * factor!, baseUnitCost: row.unitCost! / factor! });
  }
  return { valid, rejected };
}
```

Keep these exported types in the same file so parser, actions, and tests share one contract.

- [ ] **Step 4: Change GROUP mapping in current parser**

In `src/lib/impor-accurate.ts`, widen `AccurateItem.item_type` to `ItemType`, map any `GROUP...` source to `Grup`, force `is_active: false`, and keep `VARIANT...` rejected with reason `Butuh contoh export Varian untuk mapping aman`.

```ts
function mapItemType(raw: string): ItemType | null {
  if (raw === "INV") return "Persediaan";
  if (raw === "SVC") return "Jasa";
  if (raw === "NON") return "Non-Persediaan";
  if (raw.startsWith("GROUP")) return "Grup";
  return null;
}
```

- [ ] **Step 5: Run focused tests**

Run: `npm test -- src/lib/__tests__/impor-accurate.test.ts src/lib/__tests__/impor-accurate-lanjutan.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/impor-accurate.ts src/lib/impor-accurate-lanjutan.ts src/lib/__tests__/impor-accurate.test.ts src/lib/__tests__/impor-accurate-lanjutan.test.ts
git commit -m "feat: parse extended Accurate migration files"
```

### Task 2: Audit runs, Varian family, and RLS

**Files:**
- Create: `supabase/migrations/20260831230000_accurate_import_runs.sql`
- Create: `src/lib/impor-run.ts`
- Create: `src/lib/__tests__/impor-run.test.ts`

- [ ] **Step 1: Write failing domain tests for duplicate hash and status transitions**

```ts
import { describe, expect, it } from "vitest";
import { bolehPostingRun, runKey } from "../impor-run";

describe("import run", () => {
  it("hash sama pada jenis sama menjadi key sama", () => {
    expect(runKey("master_accurate", "ABC")).toBe(runKey("master_accurate", "abc"));
  });
  it("hanya previewed boleh diposting", () => {
    expect(bolehPostingRun("previewed")).toBe(true);
    expect(bolehPostingRun("posted")).toBe(false);
    expect(bolehPostingRun("failed")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `npm test -- src/lib/__tests__/impor-run.test.ts`

Expected: FAIL with missing module.

- [ ] **Step 3: Add migration with exact constraints and branch RLS**

```sql
create table import_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('master_accurate','group_components','initial_stock')),
  source_name text not null,
  source_hash text not null,
  branch_id uuid references branches(id),
  warehouse_id uuid references warehouses(id),
  as_of_date date,
  status text not null default 'previewed' check (status in ('previewed','posted','failed')),
  summary jsonb not null default '{}'::jsonb,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  posted_at timestamptz,
  unique (kind, source_hash)
);

create table import_run_rows (
  id bigint generated always as identity primary key,
  run_id uuid not null references import_runs(id) on delete cascade,
  source_row int not null,
  source_code text,
  status text not null check (status in ('valid','same','skipped','rejected','posted')),
  reason text,
  payload jsonb not null default '{}'::jsonb
);

create table item_variant_families (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category_id uuid references item_categories(id),
  created_at timestamptz not null default now()
);

create table item_variant_members (
  family_id uuid not null references item_variant_families(id) on delete cascade,
  item_id uuid not null references items(id) on delete cascade,
  label text not null,
  sort_order int not null default 0,
  primary key (family_id, item_id),
  unique (item_id)
);
```

Enable RLS on all four tables. `import_runs` and rows use branch access when scoped; unscoped runs require OWNER/ADMIN profile. Variant tables follow master-data read and OWNER/ADMIN write. Use `TO authenticated`, `USING`, and `WITH CHECK`; do not create authenticated-wide `using (true)` policies.

Use these exact predicates:

```sql
alter table import_runs enable row level security;
alter table import_run_rows enable row level security;
alter table item_variant_families enable row level security;
alter table item_variant_members enable row level security;

create policy import_runs_select on import_runs for select to authenticated
  using ((branch_id is not null and public.user_can_access_branch(branch_id))
    or (branch_id is null and public.is_admin()));
create policy import_runs_write on import_runs for all to authenticated
  using (public.is_admin() and (branch_id is null or public.user_can_access_branch(branch_id)))
  with check (public.is_admin() and (branch_id is null or public.user_can_access_branch(branch_id)));

create policy import_run_rows_select on import_run_rows for select to authenticated
  using (exists (select 1 from import_runs r where r.id = run_id
    and ((r.branch_id is not null and public.user_can_access_branch(r.branch_id))
      or (r.branch_id is null and public.is_admin()))));
create policy import_run_rows_write on import_run_rows for all to authenticated
  using (public.is_admin() and exists (select 1 from import_runs r where r.id = run_id
    and (r.branch_id is null or public.user_can_access_branch(r.branch_id))))
  with check (public.is_admin() and exists (select 1 from import_runs r where r.id = run_id
    and (r.branch_id is null or public.user_can_access_branch(r.branch_id))));

create policy variant_families_read on item_variant_families for select to authenticated using (true);
create policy variant_families_write on item_variant_families for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy variant_members_read on item_variant_members for select to authenticated using (true);
create policy variant_members_write on item_variant_members for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
```

- [ ] **Step 4: Implement pure run helpers**

```ts
export type ImportRunStatus = "previewed" | "posted" | "failed";
export const runKey = (kind: string, hash: string) => `${kind}:${hash.trim().toLowerCase()}`;
export const bolehPostingRun = (status: ImportRunStatus) => status === "previewed";
```

- [ ] **Step 5: Verify migration and tests**

Run: `supabase db reset`

Expected: all migrations apply without SQL error.

Run: `npm test -- src/lib/__tests__/impor-run.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260831230000_accurate_import_runs.sql src/lib/impor-run.ts src/lib/__tests__/impor-run.test.ts
git commit -m "feat: add audited Accurate import runs"
```

### Task 3: Multi-file master preview and posting

**Files:**
- Modify: `src/app/(app)/pos/sku/impor/AccurateImportForm.tsx`
- Modify: `src/app/(app)/pos/sku/impor/actions.ts`
- Modify: `src/lib/impor-accurate-lanjutan.ts`

- [ ] **Step 1: Add failing test for deterministic file hash input**

Add to `src/lib/__tests__/impor-accurate-lanjutan.test.ts`:

```ts
it("mengurutkan file sebelum membuat fingerprint", () => {
  expect(fingerprintInput([{ name: "b.xlsx", size: 2 }, { name: "a.xlsx", size: 1 }]))
    .toBe("a.xlsx:1|b.xlsx:2");
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `npm test -- src/lib/__tests__/impor-accurate-lanjutan.test.ts`

Expected: FAIL because `fingerprintInput` is missing.

- [ ] **Step 3: Implement deterministic helper and multi-upload UI**

```ts
export const fingerprintInput = (files: { name: string; size: number }[]) => files
  .map((f) => `${f.name}:${f.size}`)
  .sort()
  .join("|");
```

Change form state to `const [files, setFiles] = useState<File[]>([])`, use `<input multiple>`, and append each selected file as `files`:

```ts
for (const selected of files) data.append("files", selected);
```

- [ ] **Step 4: Parse every upload and merge before preview/post**

In `actions.ts`, replace single `getUpload` with `getUploads`:

```ts
function getUploads(formData: FormData): File[] {
  const files = formData.getAll("files").filter((v): v is File => v instanceof File && v.size > 0);
  if (!files.length) throw new Error("Pilih minimal satu file Barang & Jasa.");
  if (files.some((f) => !f.name.toLowerCase().endsWith(".xlsx"))) throw new Error("Semua file harus .xlsx.");
  if (files.some((f) => f.size > MAX_XLSX_BYTES)) throw new Error("Ukuran tiap file maksimal 15 MB.");
  return files;
}
```

Parse with `Promise.all`, merge valid items by code, preserve `file:row` in issues, and create `import_runs` only after preview succeeds. On confirmation, recompute SHA-256 from exact bytes and require matching previewed run. Hash canonical input as `name + NUL + byteLength + NUL + file bytes`, sorted by filename, using Node `createHash("sha256")`; filename/size fingerprint is display metadata only.

- [ ] **Step 5: Run parser tests, lint, and typecheck through build**

Run: `npm test -- src/lib/__tests__/impor-accurate.test.ts src/lib/__tests__/impor-accurate-lanjutan.test.ts && npm run lint && npm run build`

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/(app)/pos/sku/impor/AccurateImportForm.tsx src/app/(app)/pos/sku/impor/actions.ts src/lib/impor-accurate-lanjutan.ts src/lib/__tests__/impor-accurate-lanjutan.test.ts
git commit -m "feat: import multiple Accurate item files"
```

### Task 4: Grup component template and activation gate

**Files:**
- Create: `src/app/(app)/pos/sku/impor/GroupComponentImport.tsx`
- Modify: `src/app/(app)/pos/sku/impor/actions.ts`
- Modify: `src/app/(app)/pos/sku/impor/page.tsx`
- Modify: `src/lib/impor-accurate-lanjutan.ts`
- Modify: `src/lib/__tests__/impor-accurate-lanjutan.test.ts`

- [ ] **Step 1: Add failing test for grouped replacement payload**

```ts
it("menyusun payload komponen per kode Grup", () => {
  expect(groupComponentPayload([
    { groupCode: "G1", componentId: "i1", qty: 2, unit: "PCS", factor: 1, sortOrder: 2 },
    { groupCode: "G1", componentId: "i2", qty: 1, unit: "PCS", factor: 1, sortOrder: 1 },
  ])).toEqual(new Map([["G1", [
    { component_item_id: "i2", qty: 1, unit: "PCS", sort_order: 1 },
    { component_item_id: "i1", qty: 2, unit: "PCS", sort_order: 2 },
  ]]]));
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `npm test -- src/lib/__tests__/impor-accurate-lanjutan.test.ts`

Expected: FAIL because helper is missing.

- [ ] **Step 3: Implement payload grouping and action**

```ts
export function groupComponentPayload(rows: ResolvedGroupComponent[]) {
  const out = new Map<string, GroupRpcRow[]>();
  for (const row of [...rows].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const list = out.get(row.groupCode) ?? [];
    list.push({ component_item_id: row.componentId, qty: row.qty, unit: row.unit, sort_order: row.sortOrder });
    out.set(row.groupCode, list);
  }
  return out;
}
```

Server action parses sheet `Rincian Grup`, resolves codes and unit factors from database, calls existing `replace_item_group_components`, then activates only successfully completed Grup.

- [ ] **Step 4: Add preview UI**

`GroupComponentImport.tsx` must show counts for Grup complete, incomplete, rejected, and unknown component codes. Confirmation button stays disabled when any row is rejected. Add component under current Accurate master form, not as new module.

- [ ] **Step 5: Run tests and build**

Run: `npm test -- src/lib/__tests__/grup-barang.test.ts src/lib/__tests__/impor-accurate-lanjutan.test.ts && npm run build`

Expected: PASS and build exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/(app)/pos/sku/impor/GroupComponentImport.tsx src/app/(app)/pos/sku/impor/actions.ts src/app/(app)/pos/sku/impor/page.tsx src/lib/impor-accurate-lanjutan.ts src/lib/__tests__/impor-accurate-lanjutan.test.ts
git commit -m "feat: import Accurate group components"
```

### Task 5: Atomic initial-stock RPC

**Files:**
- Create: `supabase/migrations/20260831231000_accurate_initial_stock.sql`
- Create: `src/lib/__tests__/impor-saldo-accurate.test.ts`
- Create: `src/lib/impor-saldo-accurate.ts`

- [ ] **Step 1: Write failing tests for base-unit conversion and reconciliation**

```ts
import { describe, expect, it } from "vitest";
import { reconcileInitialStock, toBaseStock } from "../impor-saldo-accurate";

describe("toBaseStock", () => {
  it("mengubah qty dan HPP ke satuan dasar tanpa mengubah nilai", () => {
    expect(toBaseStock({ qty: 2, factor: 25, unitCost: 450_000 }))
      .toEqual({ baseQty: 50, baseUnitCost: 18_000, value: 900_000 });
  });
});

describe("reconcileInitialStock", () => {
  it("mendeteksi selisih qty, layer, move, dan nilai", () => {
    expect(reconcileInitialStock({ sourceQty: 10, stockQty: 10, layerQty: 9, moveQty: 10, sourceValue: 1000, layerValue: 900 }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `npm test -- src/lib/__tests__/impor-saldo-accurate.test.ts`

Expected: FAIL with missing module.

- [ ] **Step 3: Implement pure helpers**

```ts
export function toBaseStock(input: { qty: number; factor: number; unitCost: number }) {
  const baseQty = input.qty * input.factor;
  const baseUnitCost = input.unitCost / input.factor;
  return { baseQty, baseUnitCost, value: baseQty * baseUnitCost };
}

export function reconcileInitialStock(v: ReconcileInput) {
  const differences = {
    stock: v.stockQty - v.sourceQty,
    layers: v.layerQty - v.sourceQty,
    moves: v.moveQty - v.sourceQty,
    value: v.layerValue - v.sourceValue,
  };
  return { ok: Object.values(differences).every((n) => Math.abs(n) < 0.000001), differences };
}
```

Define contracts in the same module:

```ts
export type ReconcileInput = {
  sourceQty: number; stockQty: number; layerQty: number; moveQty: number;
  sourceValue: number; layerValue: number;
};
export type StockKeyRow = {
  row: number; warehouseId: string; itemId: string; batchNo?: string | null; expDate?: string | null;
};
```

- [ ] **Step 4: Create transactional RPC**

Migration procedure `post_accurate_initial_stock(p_run_id uuid)` must declare `v_run import_runs%rowtype; v_row record;` and use this transaction body. Preview payload fields are `warehouse_id`, `item_id`, `base_qty`, `base_unit_cost`, `as_of`, and `exp_date`:

```sql
-- Lock run and prevent replay.
select * into v_run from import_runs where id = p_run_id for update;
if v_run.status <> 'previewed' or v_run.kind <> 'initial_stock' then
  raise exception 'Batch saldo awal tidak dapat diposting';
end if;

-- Validate current user and branch inside function before writes.
if not user_can_access_branch(v_run.branch_id) then
  raise exception 'Tidak punya akses cabang';
end if;

if exists (
  select 1 from stock_moves
  where source = 'saldo-awal-accurate' and source_ref = p_run_id::text
) then
  raise exception 'Batch saldo awal sudah pernah diposting';
end if;

for v_row in
  select payload from import_run_rows
  where run_id = p_run_id and status = 'valid'
  order by source_row
loop
  if (v_row.payload->>'warehouse_id')::uuid <> v_run.warehouse_id then
    raise exception 'Gudang baris tidak cocok dengan batch';
  end if;
  if not exists (
    select 1 from items i
    where i.id = (v_row.payload->>'item_id')::uuid and i.item_type = 'Persediaan'
  ) then
    raise exception 'Barang saldo awal tidak valid';
  end if;
  if exists (
    select 1 from stock s
    where s.warehouse_id = v_run.warehouse_id
      and s.item_id = (v_row.payload->>'item_id')::uuid
      and s.qty <> 0
  ) or exists (
    select 1 from stock_moves sm
    where sm.warehouse_id = v_run.warehouse_id
      and sm.item_id = (v_row.payload->>'item_id')::uuid
  ) then
    raise exception 'Saldo awal hanya boleh untuk barang tanpa riwayat stok';
  end if;

  insert into stock (warehouse_id, item_id, qty, updated_at)
  values (v_run.warehouse_id, (v_row.payload->>'item_id')::uuid,
    (v_row.payload->>'base_qty')::numeric, now())
  on conflict (warehouse_id, item_id) do update
    set qty = excluded.qty, updated_at = excluded.updated_at;

  if (v_row.payload->>'base_qty')::numeric > 0 then
    insert into stock_layers (
      warehouse_id, item_id, tanggal, qty_in, qty_left, unit_cost,
      source, source_ref, exp_date
    ) values (
      v_run.warehouse_id, (v_row.payload->>'item_id')::uuid,
      (v_row.payload->>'as_of')::date, (v_row.payload->>'base_qty')::numeric,
      (v_row.payload->>'base_qty')::numeric, (v_row.payload->>'base_unit_cost')::numeric,
      'saldo-awal-accurate', p_run_id::text, nullif(v_row.payload->>'exp_date', '')::date
    );
  end if;

  insert into stock_moves (
    tanggal, warehouse_id, item_id, qty, unit_cost, source, source_ref
  ) values (
    (v_row.payload->>'as_of')::date, v_run.warehouse_id,
    (v_row.payload->>'item_id')::uuid, (v_row.payload->>'base_qty')::numeric,
    (v_row.payload->>'base_unit_cost')::numeric, 'saldo-awal-accurate', p_run_id::text
  );
end loop;

update import_run_rows set status = 'posted'
where run_id = p_run_id and status = 'valid';
update import_runs set status = 'posted', posted_at = now() where id = p_run_id;
```

Use `SECURITY INVOKER`. Revoke execute from `PUBLIC`, grant only `authenticated`. Keep stock, layer, move, row status, and run status in one Postgres transaction.

- [ ] **Step 5: Verify migration and unit tests**

Run: `supabase db reset && npm test -- src/lib/__tests__/impor-saldo-accurate.test.ts`

Expected: migration succeeds and tests PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260831231000_accurate_initial_stock.sql src/lib/impor-saldo-accurate.ts src/lib/__tests__/impor-saldo-accurate.test.ts
git commit -m "feat: post Accurate initial stock atomically"
```

### Task 6: Initial-stock preview, posting, and reconciliation UI

**Files:**
- Create: `src/app/(app)/pos/sku/impor/InitialStockImport.tsx`
- Modify: `src/app/(app)/pos/sku/impor/actions.ts`
- Modify: `src/app/(app)/pos/sku/impor/page.tsx`
- Modify: `src/lib/impor-saldo-accurate.ts`

- [ ] **Step 1: Add failing test for duplicate warehouse/item/batch rows**

```ts
it("menolak baris saldo kembar pada gudang, barang, batch, dan expiry sama", () => {
  const issues = duplicateStockKeys([
    { row: 2, warehouseId: "w", itemId: "i", batchNo: "B1", expDate: "2027-01-01" },
    { row: 3, warehouseId: "w", itemId: "i", batchNo: "B1", expDate: "2027-01-01" },
  ]);
  expect(issues.map((i) => i.row)).toEqual([2, 3]);
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `npm test -- src/lib/__tests__/impor-saldo-accurate.test.ts`

Expected: FAIL because helper is missing.

- [ ] **Step 3: Implement duplicate detection and server actions**

`previewSaldoAwalAccurate` parses sheet `Saldo Awal`, resolves item/unit/warehouse server-side, writes preview rows to `import_run_rows`, and returns totals per warehouse. `postSaldoAwalAccurate` calls only `post_accurate_initial_stock(run_id)`; it must not loop `stockIn()` in JavaScript.

```ts
export const stockKey = (r: StockKeyRow) => [r.warehouseId, r.itemId, r.batchNo ?? "", r.expDate ?? ""].join("|");
```

- [ ] **Step 4: Build UI with explicit safety gate**

UI requires branch, warehouse, as-of date, and file. Show source qty/value, rejected rows, expiry problems, and duplicate hash. Confirmation requires checkbox `Saya sudah mencocokkan gudang dan tanggal saldo` plus exact run ID hidden field.

- [ ] **Step 5: Add post-result reconciliation**

After RPC success, query source totals against `stock`, open `stock_layers`, and `stock_moves` by run reference. Display four independent statuses: qty stock, qty layer, qty kartu, and value layer. Any mismatch renders red and blocks `Selesai` state.

- [ ] **Step 6: Run full importer regression**

Run: `npm test -- src/lib/__tests__/impor-accurate.test.ts src/lib/__tests__/impor-accurate-lanjutan.test.ts src/lib/__tests__/impor-saldo-accurate.test.ts src/lib/__tests__/inventory.test.ts src/lib/__tests__/stock-recon.test.ts && npm run lint && npm run build`

Expected: all exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/app/(app)/pos/sku/impor/InitialStockImport.tsx src/app/(app)/pos/sku/impor/actions.ts src/app/(app)/pos/sku/impor/page.tsx src/lib/impor-saldo-accurate.ts src/lib/__tests__/impor-saldo-accurate.test.ts
git commit -m "feat: preview and reconcile Accurate opening stock"
```

### Task 7: Varian family management

**Files:**
- Create: `src/lib/varian.ts`
- Create: `src/lib/__tests__/varian.test.ts`
- Create: `src/app/(app)/pos/sku/varian/page.tsx`
- Create: `src/app/(app)/pos/sku/varian/actions.ts`
- Modify: `src/lib/nav.ts`

- [ ] **Step 1: Write failing tests for independent SKU membership**

```ts
import { describe, expect, it } from "vitest";
import { validateVariantMembers } from "../varian";

it("menolak SKU kembar dan Grup sebagai anggota", () => {
  expect(validateVariantMembers([
    { itemId: "i1", itemType: "Persediaan", label: "400 gr" },
    { itemId: "i1", itemType: "Persediaan", label: "800 gr" },
  ])).toMatch(/SKU hanya boleh sekali/);
  expect(validateVariantMembers([{ itemId: "g1", itemType: "Grup", label: "Paket" }]))
    .toMatch(/Grup/);
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `npm test -- src/lib/__tests__/varian.test.ts`

Expected: FAIL with missing module.

- [ ] **Step 3: Implement domain validation**

```ts
export function validateVariantMembers(rows: VariantMemberDraft[]): string | null {
  if (rows.length < 2) return "Keluarga Varian minimal dua SKU";
  if (new Set(rows.map((r) => r.itemId)).size !== rows.length) return "SKU hanya boleh sekali";
  if (rows.some((r) => r.itemType === "Grup")) return "Grup tidak boleh menjadi anggota Varian";
  if (rows.some((r) => !r.label.trim())) return "Label Varian wajib diisi";
  return null;
}
```

Define `VariantMemberDraft` in the same module:

```ts
export type VariantMemberDraft = { itemId: string; itemType: string; label: string };
```

- [ ] **Step 4: Create OWNER/ADMIN page and actions**

Page lists families and their SKU members. Actions load actual item types, call `validateVariantMembers`, then replace member rows in one database transaction/RPC. UI states explicitly: `Harga dan stok tetap milik tiap SKU`.

- [ ] **Step 5: Add navigation and verify**

Add tile `Keluarga Varian` under Persediaan in `src/lib/nav.ts` pointing to `/pos/sku/varian`.

Run: `npm test -- src/lib/__tests__/varian.test.ts && npm run build`

Expected: PASS and build exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/varian.ts src/lib/__tests__/varian.test.ts src/app/(app)/pos/sku/varian/page.tsx src/app/(app)/pos/sku/varian/actions.ts src/lib/nav.ts
git commit -m "feat: manage independent SKU variant families"
```

### Task 8: Final migration verification

**Files:**
- Modify: `docs/PAPAN-KERJA.md`

- [ ] **Step 1: Run all automated checks**

Run: `npm test && npm run lint && npm run build`

Expected: all exit 0.

- [ ] **Step 2: Run local database security verification**

Run: `supabase db reset`

Expected: all migrations apply.

Using two test users, verify branch-scoped user cannot select or post another branch's `import_runs`; OWNER can preview unscoped master runs. Expected unauthorized result: zero rows or permission error, never foreign data.

- [ ] **Step 3: Manual browser smoke test**

Run: `npm run dev`

Verify `/pos/sku/impor`: five master files preview as one batch; duplicate code lint appears; Grup remains inactive until component import; stock run cannot post twice; reconciliation shows four green checks.

- [ ] **Step 4: Update project board with evidence**

Add completed task and exact commands to `docs/PAPAN-KERJA.md`. Keep data-source gates explicit: remaining four exports, stock file, component file, and real Varian sample.

- [ ] **Step 5: Commit**

```bash
git add docs/PAPAN-KERJA.md
git commit -m "docs: record Accurate migration verification"
```
