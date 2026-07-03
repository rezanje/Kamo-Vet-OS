# VetOS Spec Addendum v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all 8 sections of `Dokumen/update/VetOS_Spec_Addendum_v1.md` (shift reconciliation, racikan, rawat inap, antrian realtime, stock approval, POS item discount, invoice edit audit, staff quest) matching the visual references in `design-reference/`.

**Architecture:** Extend the existing prototype in place. Spec table names map onto existing schema: `pos_shifts`→`cashier_shifts` (extend), `pos_transactions`→`sales`, `pos_transaction_items`→`sale_items`, `staff`→`profiles`, `inventory_items`→`items`. New tables (racikan, rawat inap, receipts, quest) follow the existing RLS pattern (`public.user_can_access_branch`) with the same demo-relax caveats already used in migrations 0024/0025. All mutations via Server Actions; business logic extracted to pure functions in `src/lib/` with vitest unit tests.

**Tech Stack:** Next.js 15 App Router, Supabase (Postgres+RLS, MCP `apply_migration` to hosted project + file in `supabase/migrations/`), TanStack Query v5 (reads), Tailwind v4 + existing utility classes (`card`, `fi`, `flab`, `tbl`, `bge`, `btn-acc`, `pay-btn`, tabler icons `ti ti-*`), vitest (new devDep).

## Global Constraints

- Money columns: `numeric(15,2)` for new columns (spec §0). Existing plain `numeric` columns stay.
- Naming: `snake_case`, English for new tables/columns (spec §0) — matches existing core schema; UI copy in Bahasa Indonesia like the rest of the app.
- All new transactional tables: `created_at timestamptz default now()`, `created_by uuid references profiles(id)` where meaningful.
- RLS on every new table, following `user_can_access_branch` or parent-join pattern from migrations 0005–0014. Tables consumed inside the `/kasir` demo world may get the 0025-style relax with the standard `ponytail: PROTOTYPE ONLY` comment.
- Mutations = Server Actions only (existing pattern: colocated `actions.ts` / `checkout.ts` with `"use server"`).
- Every section ships unit tests for its pure business logic (spec §0) — vitest, colocated in `src/lib/__tests__/`.
- Visual layout of new screens follows the PNG in `design-reference/` for that screen (Read the PNG before building the screen). Colors/typography: reuse the app's existing CSS vars/classes, NOT the raw mockup tokens (README.md flags mockup tokens as non-final; app theme already established).
- Migrations: sequential files `0026_…` onward; apply each via supabase MCP `apply_migration` with the same name as the file.
- Execution order (spec §Urutan): Task 1 → Tasks 2+3 → Tasks 4+5 → Task 6 → Task 7 → Task 8 (quest LAST).
- Commit after each task. Format: `feat(scope): …` + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 0: Test infrastructure

**Files:**
- Modify: `package.json` (add `vitest` devDep + `"test": "vitest run"` script)

**Steps:**
- [ ] `npm i -D vitest`
- [ ] Add `"test": "vitest run"` to scripts.
- [ ] Smoke: create then delete a trivial test, or fold verification into Task 1's first test run.
- [ ] Commit `chore: add vitest for business-logic unit tests`

---

### Task 1: Section 1 — Shift completion (per-method closing, klinik gate, force-close, shift report)

**Design refs:** `design-reference/petshop/01-shift-start.png`, `design-reference/klinik/01-shift-start.png`

**Files:**
- Create: `supabase/migrations/0026_shift_type_breakdown.sql`
- Create: `src/lib/shift-calc.ts`, `src/lib/__tests__/shift-calc.test.ts`
- Create: `src/app/kasir/tutup/TutupForm.tsx` (client comp: live selisih while typing)
- Create: `src/app/(app)/klinik/shift/page.tsx` + `actions.ts` (klinik "Mulai Shift" gate screen)
- Create: `src/app/(app)/pos/shift/[id]/page.tsx` (printable laporan shift)
- Modify: `src/app/kasir/tutup/page.tsx` (per-method breakdown Tunai/Debit/Kredit/QRIS/E-Wallet)
- Modify: `src/app/kasir/actions.ts` (`tutupShiftKasir`: store breakdown jsonb; `mulaiShiftKasir`: shift_type='petshop')
- Modify: `src/app/(app)/pos/shift/page.tsx` (variance column, force-close >24h button w/ OWNER/ADMIN role check)
- Modify: `src/app/(app)/klinik/pembayaran/[visitId]/page.tsx` + `actions.ts` (gate on open klinik shift; record `shift_id` on invoice)
- Modify: `src/lib/shift.ts` (`getOpenShift` gains `shiftType` param)

**Migration 0026:**
```sql
-- Addendum §1: shift per tipe (klinik/petshop) + breakdown metode bayar saat closing.
alter table cashier_shifts
  add column shift_type text not null default 'petshop' check (shift_type in ('klinik','petshop')),
  add column closing_breakdown jsonb;          -- {"Tunai": 120000, "QRIS": 50000, ...} snapshot saat tutup

-- satu shift open per staff per shift_type (spec §1), gantikan index lama per cabang.
drop index if exists cashier_shifts_one_open;
create unique index cashier_shifts_one_open on cashier_shifts(opened_by, shift_type) where status = 'open';

alter table invoices add column shift_id uuid references cashier_shifts(id) on delete set null;
```

**`src/lib/shift-calc.ts` (pure):**
```ts
export const PAYMENT_METHODS = ["Tunai", "Debit", "Kredit", "QRIS", "E-Wallet"] as const;

export function methodBreakdown(sales: { total: number; metode_bayar: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of PAYMENT_METHODS) out[m] = 0;
  for (const s of sales) out[s.metode_bayar] = (out[s.metode_bayar] ?? 0) + Number(s.total);
  return out;
}
export function expectedCash(openingBalance: number, breakdown: Record<string, number>): number {
  return openingBalance + (breakdown["Tunai"] ?? 0);
}
export function cashVariance(actual: number, expected: number): number {
  return actual - expected;
}
```

**Tests (`shift-calc.test.ts`):** breakdown groups per method incl. unknown method key; expectedCash = opening + Tunai only; variance signs (short/over/zero).

**Logic notes:**
- `tutupShiftKasir`: compute breakdown via `methodBreakdown`, persist `closing_breakdown`, keep existing selisih journal.
- Force-close (pos/shift): server action, role check `profiles.role in ('OWNER','ADMIN')`, only shifts `opened_at < now()-24h`, closes with `closing_balance = expected` and note; spec edge case §1.
- Klinik gate: `/klinik/pembayaran/**` redirects to `/klinik/shift` when no open shift with `shift_type='klinik'` for the user. Payment methods on both worlds: Tunai/Debit/Kredit/QRIS/E-Wallet (extend the metode dropdowns where narrower).
- After close, redirect to `/pos/shift/[id]` laporan (breakdown, grand total, variance, PrintButton) — spec "laporan shift masuk dashboard manajer".

---

### Task 2: Section 6 — POS item-level discount + promo reminder + struk breakdown

**Design refs:** `petshop/02-kasir-pos-main.png`, `petshop/03-kasir-reminder-promo-base.png`, `petshop/03-kasir-reminder-promo-popup.png`

**Files:**
- Create: `supabase/migrations/0027_item_discount_promos.sql`
- Create: `src/lib/pos-calc.ts`, `src/lib/__tests__/pos-calc.test.ts`
- Modify: `src/app/kasir/KasirClient.tsx` (per-item "Pot." input nominal/persen; promo reminder popup non-blocking on cart change)
- Modify: `src/app/kasir/checkout.ts` (per-line discounts server-validated; calc via pos-calc; persist columns)
- Modify: `src/app/kasir/page.tsx` (fetch active promos, pass to client)
- Modify: `src/app/kasir/struk/[saleId]/page.tsx` (per-item discount line + section "Promo & Potongan" breakdown: diskon item total, diskon transaksi, voucher, poin)

**Migration 0027:**
```sql
-- Addendum §6: diskon per item + promo terdaftar.
alter table sale_items
  add column item_discount_type text check (item_discount_type in ('nominal','percent')),
  add column item_discount_value numeric(15,2) not null default 0,
  add column promo_id uuid;

create table promos (
  id uuid primary key default gen_random_uuid(),
  name varchar(120) not null,
  promo_type text not null check (promo_type in ('bundling','tebus_murah','diskon_produk')),
  -- rule: {"trigger_item_ids": [..], "min_qty": 2, "suggest": "Beli 2 gratis 1", "discount_type": "percent", "discount_value": 10, "target_item_ids": [..]}
  rule jsonb not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table sale_items add constraint sale_items_promo_fk foreign key (promo_id) references promos(id) on delete set null;
alter table promos enable row level security;
-- ponytail: PROTOTYPE ONLY — kasir world butuh baca promo lintas cabang (pola 0025).
create policy promos_all on promos for all to authenticated using (true) with check (true);

insert into promos (name, promo_type, rule) values
  ('Bundling Royal Canin', 'bundling', '{"min_qty":2,"suggest":"Beli 2 Royal Canin, diskon 10% item kedua","discount_type":"percent","discount_value":10}'),
  ('Tebus Murah Vitamin', 'tebus_murah', '{"min_subtotal":100000,"suggest":"Belanja ≥ Rp100rb bisa tebus murah vitamin Rp5.000","discount_type":"nominal","discount_value":5000}');
```

**`src/lib/pos-calc.ts` (pure) — calc order documented (spec §6 edge case): item discount → transaction discount (manual+voucher) → poin.**
```ts
export type CartLine = { qty: number; harga: number; item_discount_type?: "nominal" | "percent" | null; item_discount_value?: number };

export function lineDiscount(l: CartLine): number {
  const raw = l.item_discount_type === "percent"
    ? Math.round((l.qty * l.harga * (l.item_discount_value ?? 0)) / 100)
    : (l.item_discount_value ?? 0);
  return Math.min(Math.max(0, raw), l.qty * l.harga);
}
export function lineSubtotal(l: CartLine): number { return l.qty * l.harga - lineDiscount(l); }

// URUTAN KALKULASI (jangan diubah): 1) diskon item, 2) diskon transaksi + voucher, 3) poin.
export function computeTotals(lines: CartLine[], txnDiscount: number, voucherValue: number, poinValue: number) {
  const itemsGross = lines.reduce((a, l) => a + l.qty * l.harga, 0);
  const itemDiscountTotal = lines.reduce((a, l) => a + lineDiscount(l), 0);
  const afterItems = itemsGross - itemDiscountTotal;
  const txnLevel = Math.min(afterItems, Math.max(0, txnDiscount) + Math.max(0, voucherValue));
  const afterTxn = afterItems - txnLevel;
  const poin = Math.min(afterTxn, Math.max(0, poinValue));
  return { itemsGross, itemDiscountTotal, afterItems, txnLevel, poin, total: afterTxn - poin };
}
export function matchPromos(promos: { id: string; name: string; rule: Record<string, unknown> }[], cart: { item_id: string; qty: number; harga: number }[]) {
  const subtotal = cart.reduce((a, l) => a + l.qty * l.harga, 0);
  const totalQty = cart.reduce((a, l) => a + l.qty, 0);
  return promos.filter((p) => {
    const r = p.rule as { min_qty?: number; min_subtotal?: number; trigger_item_ids?: string[] };
    if (r.trigger_item_ids?.length) {
      const qty = cart.filter((c) => r.trigger_item_ids!.includes(c.item_id)).reduce((a, c) => a + c.qty, 0);
      return qty >= (r.min_qty ?? 1);
    }
    if (r.min_subtotal) return subtotal >= r.min_subtotal;
    if (r.min_qty) return totalQty >= r.min_qty;
    return false;
  });
}
```

**Tests:** percent vs nominal line discount, clamp at line gross; computeTotals ordering (item first, txn capped at remainder, poin capped last, never negative total); matchPromos by trigger items / min_subtotal / min_qty.

**UI notes:** popup = non-blocking card overlay bottom-right listing matched promo `suggest` strings, dismissable, "rekomendasi kasir" only — no auto-apply. Struk digital & print show per-item "Pot." and separate section for transaction-level cuts.

---

### Task 3: Section 7 — Invoice editability + audit log + void & reissue

**Design refs:** `klinik/12-invoice-pembayaran-a.png`, `klinik/12-invoice-pembayaran-b.png`

**Files:**
- Create: `supabase/migrations/0028_invoice_edit_log.sql`
- Create: `src/lib/invoice-diff.ts`, `src/lib/__tests__/invoice-diff.test.ts`
- Modify: `src/app/(app)/klinik/pembayaran/[visitId]/actions.ts` (`bayarVisit`: replace delete+reinsert with logged edit for non-Lunas; new `voidAndReissue` for Lunas; adjustment journal on edit)
- Modify: `src/app/(app)/klinik/pembayaran/[visitId]/page.tsx` (badge "Diedit", riwayat perubahan section, tombol Void & Terbitkan Ulang when Lunas)
- Modify: `src/app/(app)/klinik/pembayaran/[visitId]/PembayaranForm.tsx` (edit mode prefill from existing invoice; reason field wajib when totals change)

**Migration 0028:**
```sql
-- Addendum §7: audit log edit invoice + void & reissue.
create table invoice_edit_log (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  edited_by uuid references profiles(id) on delete set null,
  field_changed text not null,
  old_value text,
  new_value text,
  reason text,
  edited_at timestamptz not null default now()
);
create index on invoice_edit_log(invoice_id);
alter table invoice_edit_log enable row level security;
create policy iel_all on invoice_edit_log for select to authenticated using (true);
create policy iel_ins on invoice_edit_log for insert to authenticated with check (true);
-- append-only: sengaja tanpa policy update/delete.

alter table invoices
  add column voided_at timestamptz,
  add column reissued_from uuid references invoices(id) on delete set null;
-- void&reissue butuh >1 invoice per visit; ganti unique jadi partial (aktif saja yang unik).
alter table invoices drop constraint invoices_visit_id_key;
create unique index invoices_visit_active_key on invoices(visit_id) where voided_at is null;
```

**`src/lib/invoice-diff.ts` (pure):**
```ts
export type InvoiceSnapshot = { subtotal: number; discount: number; tax: number; total: number; paid_status: string; metode_bayar: string; items: { deskripsi: string; qty: number; harga: number }[] };
export function diffInvoice(oldInv: InvoiceSnapshot, newInv: InvoiceSnapshot): { field_changed: string; old_value: string; new_value: string }[] {
  const out: { field_changed: string; old_value: string; new_value: string }[] = [];
  for (const f of ["subtotal", "discount", "tax", "total", "paid_status", "metode_bayar"] as const) {
    if (String(oldInv[f]) !== String(newInv[f])) out.push({ field_changed: f, old_value: String(oldInv[f]), new_value: String(newInv[f]) });
  }
  const ser = (items: InvoiceSnapshot["items"]) => items.map((i) => `${i.deskripsi} x${i.qty} @${i.harga}`).join("; ");
  if (ser(oldInv.items) !== ser(newInv.items)) out.push({ field_changed: "items", old_value: ser(oldInv.items), new_value: ser(newInv.items) });
  return out;
}
```

**Tests:** no-change → empty diff; single field; items diff serialization; multiple fields.

**Logic notes:**
- Non-Lunas edit: fetch old snapshot server-side, diff, block when diff nonempty & no log write (server generates log — never trust client), update rows in place (delete+reinsert items OK but log the item diff), post adjustment journal for `total` delta (source `klinik-edit`, reverse sign lines of the original posting pattern) — spec edge case: ledger must re-sync.
- Lunas: direct edit rejected server-side. `voidAndReissue`: set `voided_at`, post full reversal journal of old invoice, insert new invoice (`reissued_from`, status Belum Lunas, copied items), log `field_changed='voided'`.
- All invoice queries filter `voided_at is null` for the active invoice (page + struk + laporan).

---

### Task 4: Section 2 — Racik Obat (compounding)

**Design refs:** `klinik/11-racik-obat.png`, `klinik/06-rekam-medis-pasien-b-annotated.png`

**Files:**
- Create: `supabase/migrations/0029_compounding.sql`
- Create: `src/lib/compounding.ts`, `src/lib/__tests__/compounding.test.ts`
- Create: `src/app/(app)/klinik/racik/page.tsx` (PCA worklist: pending/ready per branch) + `actions.ts`
- Create: `src/app/(app)/klinik/racik/[recipeId]/page.tsx` (detail: pasien, resep dokter, komposisi, steps, tombol status)
- Create: `src/app/(app)/klinik/rekam-medis/[visitId]/racikan/page.tsx` + `actions.ts` (form buat racikan: nama, dosis, volume, bentuk, steps, ingredient rows w/ item picker)
- Modify: `src/app/(app)/klinik/rekam-medis/[visitId]/page.tsx` (list racikan for the MR + link "+ Racikan")
- Modify: `src/lib/nav.ts` (klinik tile "e-Resep" → href `/klinik/racik`, label "Racik obat")

**Migration 0029:**
```sql
-- Addendum §2: racik obat (compounding).
create table compounding_recipes (
  id uuid primary key default gen_random_uuid(),
  medical_record_id uuid not null references medical_records(id) on delete cascade,
  recipe_name text not null,
  dosage_instruction text not null,
  total_volume text not null,
  dosage_form text not null check (dosage_form in ('sirup','nebul','salep','puyer','kapsul','lainnya')),
  compounding_steps text not null,
  prepared_by uuid references profiles(id) on delete set null,
  prepared_at timestamptz,
  status text not null default 'pending' check (status in ('pending','ready','handed_over','void')),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on compounding_recipes(medical_record_id);

create table compounding_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references compounding_recipes(id) on delete cascade,
  ingredient_name text not null,
  item_id uuid references items(id) on delete set null,
  quantity numeric not null,
  unit text not null
);
create index on compounding_ingredients(recipe_id);

alter table compounding_recipes enable row level security;
alter table compounding_ingredients enable row level security;
-- gate lewat medical_records -> visits.branch_id (pola 0006).
create policy cr_all on compounding_recipes for all to authenticated
  using (exists (select 1 from medical_records m join visits v on v.id = m.visit_id
                 where m.id = compounding_recipes.medical_record_id and public.user_can_access_branch(v.branch_id)))
  with check (exists (select 1 from medical_records m join visits v on v.id = m.visit_id
                 where m.id = compounding_recipes.medical_record_id and public.user_can_access_branch(v.branch_id)));
create policy ci_all on compounding_ingredients for all to authenticated
  using (exists (select 1 from compounding_recipes r join medical_records m on m.id = r.medical_record_id
                 join visits v on v.id = m.visit_id
                 where r.id = compounding_ingredients.recipe_id and public.user_can_access_branch(v.branch_id)))
  with check (exists (select 1 from compounding_recipes r join medical_records m on m.id = r.medical_record_id
                 join visits v on v.id = m.visit_id
                 where r.id = compounding_ingredients.recipe_id and public.user_can_access_branch(v.branch_id)));
```

**`src/lib/compounding.ts` (pure):**
```ts
export type RecipeStatus = "pending" | "ready" | "handed_over" | "void";
export function canEditRecipe(status: RecipeStatus): boolean { return status === "pending"; }
export function nextStatus(s: RecipeStatus): RecipeStatus | null {
  return s === "pending" ? "ready" : s === "ready" ? "handed_over" : null;
}
// baris update stok: kurangi qty bahan (bukan obat jadi) dari gudang cabang.
export function stockDeductions(ings: { item_id: string | null; quantity: number }[]): { item_id: string; qty: number }[] {
  const map = new Map<string, number>();
  for (const i of ings) if (i.item_id) map.set(i.item_id, (map.get(i.item_id) ?? 0) + Number(i.quantity));
  return [...map.entries()].map(([item_id, qty]) => ({ item_id, qty }));
}
```

**Tests:** canEditRecipe only pending; nextStatus chain pending→ready→handed_over→null; stockDeductions aggregates duplicate items, skips null item_id.

**Logic notes:**
- Create action: insert recipe+ingredients, deduct stock per `stockDeductions` from branch warehouse (same pattern as `checkout.ts` stock loop).
- Edit blocked when `!canEditRecipe(status)` — server returns error "Racikan sudah diproses — void lalu buat baru"; void action sets `status='void'` and restores stock.
- Multiple racikan per medical_record supported by schema (no unique) — rawat inap daily racikan (spec edge case).
- "Obat Siap Diserahkan" button = pending→ready; serah = ready→handed_over (set prepared_by/prepared_at on ready).

---

### Task 5: Section 3 — Rawat Inap module (4 condition states, daily log, WA review)

**Design refs:** `klinik/07-rekam-medis-rawat-inap-popup.png`, `klinik/08-status-rawat-inap-dashboard.png`, `klinik/09-laporan-rawat-inap.png`, `klinik/10-rawat-inap-form.png`

**Files:**
- Create: `supabase/migrations/0030_inpatient.sql`
- Create: `src/lib/inpatient.ts`, `src/lib/__tests__/inpatient.test.ts`
- Create: `src/lib/fonnte.ts` (WA send helper, FONNTE_TOKEN env, no-op+console.warn if missing)
- Create: `src/app/(app)/klinik/rawat-inap/page.tsx` (dashboard: cards Total/Hari Ini/Sembuh/Kritis + dropdown "Semua Cabang" filter + tabel aktif) + `actions.ts`
- Create: `src/app/(app)/klinik/rawat-inap/[id]/page.tsx` (detail: daily log form append-only, riwayat harian, ubah kondisi, WA review panel saat rip)
- Modify: `src/app/(app)/klinik/rekam-medis/[visitId]/page.tsx` (+ tombol "Rawat Inap" → admit form popup/page per design 07)
- Modify: `src/lib/nav.ts` (klinik tile "Rawat inap" → href `/klinik/rawat-inap`)

**Migration 0030:**
```sql
-- Addendum §3: rawat inap dgn 4 kondisi + log status + laporan harian append-only.
create table inpatient_records (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id) on delete restrict,
  visit_id uuid not null references visits(id) on delete cascade,
  medical_record_id uuid references medical_records(id) on delete set null,
  doctor_id uuid references profiles(id) on delete set null,
  treatment_plan text,                 -- rencana tindakan dokter PIC (popup design 07)
  condition_status text not null default 'stabil' check (condition_status in ('stabil','kritis','sembuh','rip')),
  admitted_at timestamptz not null default now(),
  discharged_at timestamptz,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on inpatient_records(branch_id);

create table inpatient_status_log (
  id uuid primary key default gen_random_uuid(),
  inpatient_record_id uuid not null references inpatient_records(id) on delete cascade,
  previous_status text,
  new_status text not null,
  changed_by uuid not null references profiles(id) on delete restrict,
  notes text,
  changed_at timestamptz not null default now()
);
create index on inpatient_status_log(inpatient_record_id);

-- laporan harian append-only (tanpa policy update/delete).
create table inpatient_daily_logs (
  id uuid primary key default gen_random_uuid(),
  inpatient_record_id uuid not null references inpatient_records(id) on delete cascade,
  log_date date not null default current_date,
  condition_note text not null,
  tindakan text,
  keterangan text,
  doctor_name varchar(100),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on inpatient_daily_logs(inpatient_record_id);

alter table inpatient_records enable row level security;
alter table inpatient_status_log enable row level security;
alter table inpatient_daily_logs enable row level security;
create policy ir_all on inpatient_records for all to authenticated
  using (public.user_can_access_branch(branch_id))
  with check (public.user_can_access_branch(branch_id));
create policy isl_sel on inpatient_status_log for select to authenticated using (true);
create policy isl_ins on inpatient_status_log for insert to authenticated with check (true);
create policy idl_sel on inpatient_daily_logs for select to authenticated using (true);
create policy idl_ins on inpatient_daily_logs for insert to authenticated with check (true);
```

**`src/lib/inpatient.ts` (pure):**
```ts
export type Condition = "stabil" | "kritis" | "sembuh" | "rip";
export type Role = "OWNER" | "ADMIN" | "FINANCE" | "STAFF" | "DOCTOR";
// spec §3: transisi ke 'rip' hanya dokter (server-side). default: single doctor approval + review WA sebelum kirim.
export function canTransition(role: Role, to: Condition): boolean {
  if (to === "rip") return role === "DOCTOR";
  return true;
}
export function isTerminal(c: Condition): boolean { return c === "sembuh" || c === "rip"; }
export function ripWaMessage(petName: string, ownerName: string, branchName: string): string {
  return `Kepada Yth. ${ownerName},\n\nDengan berat hati kami menyampaikan bahwa ${petName} telah berpulang saat perawatan di ${branchName}. ` +
    `Tim dokter kami telah memberikan perawatan terbaik hingga akhir.\n\nKami turut berduka cita. Silakan hubungi klinik untuk informasi selanjutnya.\n\n— KAMO PET CARE`;
}
```

**Tests:** canTransition — rip requires DOCTOR (all other roles false), non-rip allowed for STAFF; isTerminal; ripWaMessage contains pet+owner+branch.

**Logic notes:**
- Every condition change: insert `inpatient_status_log` (siapa/kapan/notes) then update record.
- `rip`: role check via `profiles.role` server-side; set `discharged_at`; record leaves active dashboard; invoice generation NOT blocked (pembayaran flow untouched); WA = review screen showing `ripWaMessage` with explicit "Kirim WA" button (spec default: review before send, no auto-send) → `sendWA` via `src/lib/fonnte.ts` (`POST https://api.fonnte.com/send`, header `Authorization: FONNTE_TOKEN`; no token → return `{ok:false,reason:"FONNTE_TOKEN missing"}`).
- `sembuh`: set `discharged_at`, banner "Boleh pulang — lanjut pembayaran" linking to `/klinik/pembayaran/[visitId]` (existing invoice flow).
- Dashboard counters: Total Rawat Inap (aktif), Hari Ini (admitted today), Sembuh/Boleh Pulang, Kritis; `?branch=` filter dropdown "Semua Cabang".
- Daily report table per design 09: tanggal, kondisi, tindakan, keterangan, dokter — append-only (no edit/delete UI, no RLS update policy).

---

### Task 6: Section 4 — Antrian realtime (queue numbers, panggil, live updates)

**Design refs:** `klinik/04-antrian-pasien.png`

**Files:**
- Create: `supabase/migrations/0031_queue_realtime.sql`
- Create: `src/lib/queue.ts`, `src/lib/__tests__/queue.test.ts`
- Create: `src/app/(app)/klinik/antrian/LiveRefresh.tsx` (client: Supabase Realtime channel per branch → router.refresh())
- Modify: `src/app/(app)/klinik/registrasi/actions.ts` (assign queue_number at registration)
- Modify: `src/app/(app)/klinik/antrian/page.tsx` (tabs Semua/Menunggu/Sedang Diperiksa/Selesai; panel "Panggilan Berikutnya" + big "Panggil Sekarang"; kolom no antrian + estimasi tunggu)
- Modify: `src/app/(app)/klinik/antrian/actions.ts` (Panggil sets called_at)
- Modify: `src/app/(app)/klinik/page.tsx` (card "Informasi Poli": count menunggu per poli)

**Migration 0031:**
```sql
-- Addendum §4: antrian real-time.
alter table visits
  add column queue_number varchar(8),
  add column called_at timestamptz;
-- realtime broadcast perubahan antrian.
alter publication supabase_realtime add table visits;
```

**`src/lib/queue.ts` (pure):**
```ts
// nomor antrian [Huruf][3 digit] per cabang per hari; huruf dari inisial poli (Poli Umum → 'A' default).
export function queueLetter(poli: string): string {
  const m: Record<string, string> = { "Poli Umum": "A", "Poli Bedah": "B", "Grooming": "G", "Vaksinasi": "V" };
  return m[poli] ?? "A";
}
export function nextQueueNumber(poli: string, existingToday: string[]): string {
  const letter = queueLetter(poli);
  const max = existingToday.filter((q) => q?.startsWith(letter)).reduce((a, q) => Math.max(a, parseInt(q.slice(1), 10) || 0), 0);
  return `${letter}${String(max + 1).padStart(3, "0")}`;
}
export const AVG_EXAM_MINUTES = 20; // v1 hardcode (spec: jangan over-engineer)
export function estimatedWaitMinutes(positionInQueue: number): number { return positionInQueue * AVG_EXAM_MINUTES; }
```

**Tests:** first number A001; increments to A002; separate letter sequences; gap tolerance (max not count); wait = position×20.

**Logic notes:** registration action queries today's queue_numbers for the branch, assigns `nextQueueNumber` (count reset per day comes free — filter created_at ≥ startOfDay). LiveRefresh subscribes `postgres_changes` on `visits` filtered `branch_id=eq.<branch>`; on event → `router.refresh()` (server components re-render; no polling). Panel Panggilan Berikutnya = oldest Menunggu; Panggil button = existing updateVisitStatus + `called_at=now()`.

---

### Task 7: Section 5 — Stock request approval chain + receipts reconciliation

**Design refs:** `petshop/05-persediaan-permintaan-list.png`, `petshop/06-buat-permintaan-barang.png`, `petshop/07-penerimaan-barang.png`, `klinik/14-permintaan-barang.png`

**Files:**
- Create: `supabase/migrations/0032_stock_receipts.sql`
- Create: `src/lib/stock-recon.ts`, `src/lib/__tests__/stock-recon.test.ts`
- Modify: `src/app/(app)/pos/permintaan/page.tsx` (badges per status; Setujui/Tolak/Kirim actions w/ role check)
- Create: `src/app/(app)/pos/permintaan/actions.ts` (approve/reject/ship transitions)
- Modify: `src/app/kasir/persediaan/baru/*` (priority normal/tinggi + catatan per item; nomor PRM-YYMMDD-NNN)
- Modify: `src/app/kasir/persediaan/terima/[id]/*` (TerimaForm → creates stock_receipts + items; dipesan vs diterima side-by-side; kondisi dropdown; footer total dipesan/diterima/selisih; barcode input lookup by `items.upc`)
- Modify: `src/app/kasir/persediaan/page.tsx` (list shows priority + receipt numbers)

**Migration 0032:**
```sql
-- Addendum §5: approval chain + penerimaan barang terpisah (rekonsiliasi dipesan vs diterima).
alter table stock_requests
  add column priority text not null default 'normal' check (priority in ('normal','tinggi')),
  add column requested_by uuid references profiles(id) on delete set null,
  add column approved_by uuid references profiles(id) on delete set null;
alter table stock_request_items add column catatan text;

create table stock_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_number varchar(24) unique not null,           -- TRM-YYMMDD-NNN
  stock_request_id uuid not null references stock_requests(id) on delete cascade,
  received_by uuid references profiles(id) on delete set null,
  received_at timestamptz not null default now(),
  attachment_url text
);
create index on stock_receipts(stock_request_id);

create table stock_receipt_items (
  id uuid primary key default gen_random_uuid(),
  stock_receipt_id uuid not null references stock_receipts(id) on delete cascade,
  item_id uuid references items(id) on delete set null,
  nama varchar(160) not null,
  qty_ordered numeric not null default 0,
  qty_received numeric not null default 0,
  condition text not null default 'baik' check (condition in ('baik','rusak','kurang')),
  notes text
);
create index on stock_receipt_items(stock_receipt_id);

alter table stock_receipts enable row level security;
alter table stock_receipt_items enable row level security;
-- ponytail: PROTOTYPE ONLY — ikut pola relax 0025 (kasir world lintas cabang demo).
create policy srec_all on stock_receipts for all to authenticated using (true) with check (true);
create policy sreci_all on stock_receipt_items for all to authenticated using (true) with check (true);
```

**`src/lib/stock-recon.ts` (pure):**
```ts
export const REQUEST_FLOW = ["Menunggu Persetujuan", "Disetujui", "Dikirim", "Selesai"] as const;
export function canTransitionRequest(from: string, to: string): boolean {
  if (to === "Ditolak") return from === "Menunggu Persetujuan";
  const i = REQUEST_FLOW.indexOf(from as never), j = REQUEST_FLOW.indexOf(to as never);
  return i >= 0 && j === i + 1;
}
export function receiptSummary(items: { qty_ordered: number; qty_received: number }[]) {
  const ordered = items.reduce((a, i) => a + Number(i.qty_ordered), 0);
  const received = items.reduce((a, i) => a + Number(i.qty_received), 0);
  return { ordered, received, selisih: received - ordered };
}
```

**Tests:** linear flow only (skip forbidden, backward forbidden, Ditolak only from Menunggu); receiptSummary totals + selisih sign.

**Logic notes:** approval action role check `OWNER`/`ADMIN` (= Kepala Gudang/Manajer). Receipt action: number `TRM-YYMMDD-NNN` (count-based like no_struk), insert receipt+items, stock upsert += `qty_received` (NOT qty_ordered) into branch's warehouse, mark request Selesai; keep writing legacy `qty_diterima`/`kondisi` on request items for the existing list UI. Selisih badge "Selisih: X" per item when ordered≠received. Barcode: text input; on Enter, lookup cart row by `items.upc` fetched server-side into the form data set. Badge colors per spec (biru/hijau/orange/hijau tua/merah).

---

### Task 8: Section 8 — Staff Quest (gamification) — LAST

**Design refs:** `petshop/08-quest-dashboard.png`

**Files:**
- Create: `supabase/migrations/0033_staff_quest.sql`
- Create: `src/lib/quest-logic.ts`, `src/lib/__tests__/quest-logic.test.ts`
- Create: `src/lib/quest-hook.ts` (server helper `processQuestProgress(supabase, saleId)` called after checkout)
- Create: `src/app/kasir/quest/page.tsx` + `actions.ts` (staff dashboard: 4 cards, tab daily/monthly, progress bars, Klaim, kalender streak mingguan, leaderboard top-3+list, katalog reward w/ Tukar)
- Create: `src/app/(app)/pos/quest/page.tsx` + `actions.ts` (admin config: CRUD quest definitions + reward catalog + fulfillment list; role OWNER/ADMIN)
- Modify: `src/app/kasir/checkout.ts` (after successful sale: `await processQuestProgress(...)` best-effort try/catch — never blocks checkout)
- Modify: `src/app/kasir/PosNav.tsx` (+ menu Quest)
- Modify: `src/lib/nav.ts` (pos tile "Quest staff" → `/pos/quest`)

**Migration 0033:** all tables per spec §8 verbatim with `staff→profiles`, `inventory_items→items`, plus `quest_settings`:
```sql
-- Addendum §8: gamifikasi staff (currency terpisah dari poin customer — JANGAN digabung).
create table staff_quest_definitions (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references branches(id) on delete cascade,   -- null = semua cabang
  quest_type text not null check (quest_type in ('daily','monthly')),
  title text not null,
  target_kind text not null check (target_kind in ('product_qty','category_qty','total_sales_amount')),
  target_ref_id uuid,
  target_value numeric not null,
  points_reward int not null,
  is_active boolean not null default true,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create table staff_quest_progress (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references profiles(id) on delete cascade,
  quest_definition_id uuid not null references staff_quest_definitions(id) on delete cascade,
  period_key text not null,
  current_value numeric not null default 0,
  status text not null default 'in_progress' check (status in ('in_progress','completed','claimed')),
  completed_at timestamptz,
  claimed_at timestamptz,
  unique (staff_id, quest_definition_id, period_key)
);
create table staff_points (
  staff_id uuid primary key references profiles(id) on delete cascade,
  total_points int not null default 0,
  updated_at timestamptz not null default now()
);
create table staff_points_ledger (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references profiles(id) on delete cascade,
  points_delta int not null,
  source_type text not null check (source_type in ('quest_completion','streak_bonus','reward_redemption','manual_adjustment')),
  source_id uuid,
  branch_id uuid references branches(id) on delete set null,  -- leaderboard per cabang (branch transaksi)
  notes text,
  created_at timestamptz not null default now()
);
create table staff_streaks (
  staff_id uuid primary key references profiles(id) on delete cascade,
  current_streak_days int not null default 0,
  longest_streak_days int not null default 0,
  last_active_date date,
  updated_at timestamptz not null default now()
);
create table staff_reward_catalog (
  id uuid primary key default gen_random_uuid(),
  reward_name text not null,
  reward_type text not null check (reward_type in ('discount_voucher','free_shipping','free_product','bonus_points')),
  points_cost int not null,
  reward_value jsonb,
  is_active boolean not null default true
);
create table staff_reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references profiles(id) on delete cascade,
  reward_catalog_id uuid not null references staff_reward_catalog(id) on delete restrict,
  points_spent int not null,
  status text not null default 'pending_fulfillment' check (status in ('pending_fulfillment','fulfilled','cancelled')),
  redeemed_at timestamptz not null default now(),
  fulfilled_by uuid references profiles(id) on delete set null,
  fulfilled_at timestamptz
);
-- bonus streak configurable (spec: jangan hardcode).
create table quest_settings (
  id int primary key default 1 check (id = 1),
  streak_bonus_every_days int not null default 5,
  streak_bonus_points int not null default 50
);
insert into quest_settings default values;

alter table staff_quest_definitions enable row level security;
alter table staff_quest_progress enable row level security;
alter table staff_points enable row level security;
alter table staff_points_ledger enable row level security;
alter table staff_streaks enable row level security;
alter table staff_reward_catalog enable row level security;
alter table staff_reward_redemptions enable row level security;
alter table quest_settings enable row level security;
-- ponytail: PROTOTYPE ONLY relax (kasir world), KECUALI ledger yang immutable by design.
create policy sqd_all on staff_quest_definitions for all to authenticated using (true) with check (true);
create policy sqp_all on staff_quest_progress for all to authenticated using (true) with check (true);
create policy sp_all on staff_points for all to authenticated using (true) with check (true);
create policy spl_sel on staff_points_ledger for select to authenticated using (true);
create policy spl_ins on staff_points_ledger for insert to authenticated with check (true);
-- spec §8 edge case: ledger immutable — sengaja tanpa update/delete policy (jejak audit anti-kolusi).
create policy ss_all on staff_streaks for all to authenticated using (true) with check (true);
create policy src_all on staff_reward_catalog for all to authenticated using (true) with check (true);
create policy srr_all on staff_reward_redemptions for all to authenticated using (true) with check (true);
create policy qs_all on quest_settings for all to authenticated using (true) with check (true);
```

**`src/lib/quest-logic.ts` (pure) — signatures + tests:**
```ts
export function periodKey(questType: "daily" | "monthly", now: Date): string; // 'YYYY-MM-DD' | 'YYYY-MM' (WIB)
export function saleContribution(
  quest: { target_kind: string; target_ref_id: string | null },
  saleLines: { item_id: string | null; category_id: string | null; qty: number }[],
  saleTotal: number,
): number; // product_qty: sum qty matching item; category_qty: sum qty matching category; total_sales_amount: saleTotal
export function isCompleted(currentValue: number, targetValue: number): boolean; // >=
export function applyStreak(
  lastActiveDate: string | null, today: string, current: number, longest: number,
): { current: number; longest: number; changed: boolean }; // kemarin→+1; bolong→reset 1; hari sama→no-op
export function streakBonusDue(streakDays: number, everyDays: number): boolean; // kelipatan
export function monthlyLeaderboard(
  ledger: { staff_id: string; points_delta: number; source_type: string; created_at: string }[], month: string,
): { staff_id: string; points: number }[]; // sum quest_completion bulan itu, desc — BUKAN lifetime total
export function canRedeem(totalPoints: number, cost: number): boolean;
```

**Tests:** periodKey daily/monthly; saleContribution per target_kind (match/non-match/mixed cart); isCompleted boundary (== target); applyStreak (consecutive +1, gap reset 1, same-day no-op, longest tracks max); streakBonusDue multiples only; monthlyLeaderboard filters month + source_type and sorts desc; canRedeem boundary.

**Logic notes:**
- `processQuestProgress`: load active defs (branch of sale OR null), upsert progress row per (staff, def, period_key), add `saleContribution`; on cross to completed: status='completed', ledger +points_reward (auto-award), staff_points +=; staff clicks "Klaim" → status='claimed' only (UI moment, points already credited — matches spec: auto-award + klik Klaim pindah status).
- Streak: inside same hook, first paid sale of the day per staff → applyStreak; bonus when `streakBonusDue` → ledger `streak_bonus` + points (values from `quest_settings`).
- Ledger rows record `branch_id` of the sale (spec edge case: staff pindah cabang → progress nempel cabang transaksi).
- Redeem: server action validates `staff_points.total_points >= points_cost`, insert redemption + ledger −cost + update staff_points. Manager fulfillment list in admin page (pending_fulfillment → fulfilled).
- Countdown "Reset dalam HH:MM:SS" to midnight WIB — small client component.
- Void/refund decrement: POS has no void/refund feature yet → not implementable; documented here as out of scope until void exists.
- Reward voucher recipient ambiguity (staff pribadi vs customer): spec says confirm with Aldi — v1 stores redemption only (no auto voucher issuance), noted in admin UI helper text.

---

## Self-Review Notes

- Spec §1 edge "refund/void ke shift baru" and §8 "void decrement" both depend on a void/refund feature that does not exist anywhere in the codebase — flagged in final report, not built (YAGNI until void ships).
- Spec §3 dual-approval rip: default single-doctor + WA review screen per spec's own default assumption.
- Spec §4 display terpisah (layar tunggu): spec itself says dashboard update is enough when no separate display requirement — skipped.
- Spec §6 struk breakdown covered in Task 2 struk page; §6 promos configurable admin UI not required by spec (only quest/reward config is, Task 8 covers those).
- Types consistent: `profiles.role` values from 0001 (`OWNER ADMIN FINANCE STAFF DOCTOR`) used in Tasks 1, 5, 7, 8.
