# Tier Otomatis & Kategori Pelanggan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make customer tier fully system-computed from combined petshop+klinik transaction totals (read-only everywhere), rename `keanggotaan`→`kategori` (admin-only edit, shown read-only on POS), and add an admin-only per-unit transaction breakdown.

**Architecture:** One migration renames the column, adds a single-row `tier_settings` table, and backfills existing customers. A pure `computeTier()` function + async `recomputeCustomerTier()` wrapper live in `src/lib/customer-tier.ts` and are called at the end of every petshop checkout and klinik payment/void. All manual tier/kategori pickers are removed from the 3 create forms; kategori becomes editable only via a role-gated CRM control.

**Tech Stack:** Next.js (App Router, RSC + server actions), Supabase (Postgres + RLS), TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-10-tier-kategori-otomatis-design.md`

**Decision locked:** Klinik invoices count toward tier **only when `paid_status = 'Lunas' AND voided_at IS NULL`**. DP / Belum Lunas = 0.

---

### Task 1: Migration — rename column, tier_settings table, backfill

**Files:**
- Create: `supabase/migrations/0042_tier_kategori_otomatis.sql`
- Modify: `supabase/seed.sql:74,81`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0042_tier_kategori_otomatis.sql`:

```sql
-- Tier otomatis & kategori pelanggan (spec 2026-07-10)

-- 1) rename keanggotaan -> kategori, ganti default & nilai existing
alter table customers rename column keanggotaan to kategori;
alter table customers alter column kategori set default 'Umum';
update customers set kategori = 'Umum' where kategori = 'Non Member';
-- nilai 'Member' tetap 'Member'

-- 2) settings tier — single row, threshold admin-editable (pola quest_settings)
create table tier_settings (
  id int primary key default 1 check (id = 1),
  bronze_min numeric not null default 1000000,
  silver_min numeric not null default 5000000,
  gold_min numeric not null default 15000000,
  platinum_min numeric not null default 50000000
);
insert into tier_settings default values;
alter table tier_settings enable row level security;
create policy tier_settings_read on tier_settings for select to authenticated using (true);
create policy tier_settings_write on tier_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- 3) backfill sekali: recompute total_spending & tier semua customer existing
--    (formula sama persis dgn recomputeCustomerTier: petshop sales + klinik invoices lunas)
with agg as (
  select c.id,
    coalesce((select sum(s.total) from sales s where s.customer_id = c.id), 0)
    + coalesce((select sum(i.total) from invoices i join visits v on v.id = i.visit_id
                where v.customer_id = c.id and i.paid_status = 'Lunas' and i.voided_at is null), 0) as combined
  from customers c
)
update customers c set
  total_spending = agg.combined,
  tier = case
    when agg.combined >= (select platinum_min from tier_settings) then 'Platinum'
    when agg.combined >= (select gold_min from tier_settings) then 'Gold'
    when agg.combined >= (select silver_min from tier_settings) then 'Silver'
    when agg.combined >= (select bronze_min from tier_settings) then 'Bronze'
    else 'New'
  end
from agg where agg.id = c.id;
```

- [ ] **Step 2: Fix seed.sql (rename column + values)**

In `supabase/seed.sql`, line 74 change the insert column list `keanggotaan` → `kategori`; line 81 change the `as v(...)` alias list `keanggotaan` → `kategori`. Then in the VALUES rows of that insert, replace any `'Non Member'` with `'Umum'` (keep `'Member'` as-is). Read the block first to see exact values:

Run: `sed -n '70,95p' supabase/seed.sql`

Apply the edits to the column list, the alias list, and each row's membership value.

- [ ] **Step 3: Verify SQL parses / apply locally if DB available**

Run (if local supabase running): `supabase db reset` — expect no errors, migration + seed apply clean.
If no local DB: eyeball that column names match across migration and seed. Skip apply.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0042_tier_kategori_otomatis.sql supabase/seed.sql
git commit -m "feat(db): rename keanggotaan->kategori, tier_settings, backfill tier"
```

---

### Task 2: Pure `computeTier()` + unit tests (TDD)

**Files:**
- Create: `src/lib/customer-tier.ts`
- Test: `src/lib/__tests__/customer-tier.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/customer-tier.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeTier, type TierThresholds } from "../customer-tier";

const T: TierThresholds = { bronze_min: 1_000_000, silver_min: 5_000_000, gold_min: 15_000_000, platinum_min: 50_000_000 };

describe("computeTier", () => {
  it("below bronze is New", () => {
    expect(computeTier(0, T)).toBe("New");
    expect(computeTier(999_999, T)).toBe("New");
  });
  it("exactly at a threshold takes that tier", () => {
    expect(computeTier(1_000_000, T)).toBe("Bronze");
    expect(computeTier(5_000_000, T)).toBe("Silver");
    expect(computeTier(15_000_000, T)).toBe("Gold");
    expect(computeTier(50_000_000, T)).toBe("Platinum");
  });
  it("between thresholds takes the lower tier", () => {
    expect(computeTier(4_999_999, T)).toBe("Bronze");
    expect(computeTier(49_999_999, T)).toBe("Gold");
  });
  it("above platinum stays Platinum", () => {
    expect(computeTier(999_000_000, T)).toBe("Platinum");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/customer-tier.test.ts`
Expected: FAIL — cannot resolve `../customer-tier`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/customer-tier.ts`:

```ts
export type TierThresholds = { bronze_min: number; silver_min: number; gold_min: number; platinum_min: number };

// Pure: map total transaksi gabungan -> tier. Boundary inklusif (>= threshold).
export function computeTier(combined: number, t: TierThresholds): string {
  if (combined >= t.platinum_min) return "Platinum";
  if (combined >= t.gold_min) return "Gold";
  if (combined >= t.silver_min) return "Silver";
  if (combined >= t.bronze_min) return "Bronze";
  return "New";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/customer-tier.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/customer-tier.ts src/lib/__tests__/customer-tier.test.ts
git commit -m "feat: computeTier pure function + tests"
```

---

### Task 3: `recomputeCustomerTier()` async wrapper

**Files:**
- Modify: `src/lib/customer-tier.ts`

- [ ] **Step 1: Append the async function**

Add to `src/lib/customer-tier.ts` (below `computeTier`):

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

// Hitung ulang total_spending (petshop sales + klinik invoices LUNAS) lalu set tier.
// Dipanggil server-side setelah tiap transaksi selesai / void. Absolut (bukan incremental)
// biar gak drift — sumber kebenaran selalu tabel sales + invoices.
export async function recomputeCustomerTier(supabase: SupabaseClient, customerId: string): Promise<void> {
  if (!customerId) return;

  const [{ data: sales }, { data: invs }, { data: cfg }] = await Promise.all([
    supabase.from("sales").select("total").eq("customer_id", customerId),
    supabase
      .from("invoices")
      .select("total, visits!inner(customer_id)")
      .eq("visits.customer_id", customerId)
      .eq("paid_status", "Lunas")
      .is("voided_at", null),
    supabase.from("tier_settings").select("bronze_min, silver_min, gold_min, platinum_min").eq("id", 1).maybeSingle(),
  ]);

  const petshop = (sales ?? []).reduce((a, s) => a + Number(s.total || 0), 0);
  const klinik = (invs ?? []).reduce((a, i) => a + Number(i.total || 0), 0);
  const combined = petshop + klinik;

  const thresholds: TierThresholds = cfg
    ? { bronze_min: Number(cfg.bronze_min), silver_min: Number(cfg.silver_min), gold_min: Number(cfg.gold_min), platinum_min: Number(cfg.platinum_min) }
    : { bronze_min: 1_000_000, silver_min: 5_000_000, gold_min: 15_000_000, platinum_min: 50_000_000 };

  await supabase.from("customers").update({ total_spending: combined, tier: computeTier(combined, thresholds) }).eq("id", customerId);
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i customer-tier || echo "OK no errors"`
Expected: `OK no errors`.

- [ ] **Step 3: Verify existing test still passes**

Run: `npx vitest run src/lib/__tests__/customer-tier.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/customer-tier.ts
git commit -m "feat: recomputeCustomerTier — combined petshop+klinik total drives tier"
```

---

### Task 4: Wire recompute into petshop checkout

**Files:**
- Modify: `src/app/kasir/checkout.ts:130` (the `customers.update({ points, total_spending })` line)

- [ ] **Step 1: Add import**

At the top of `src/app/kasir/checkout.ts`, after the existing imports, add:

```ts
import { recomputeCustomerTier } from "@/lib/customer-tier";
```

- [ ] **Step 2: Replace the manual total_spending update**

Find (around line 130, inside `if (customerId) { ... }`):

```ts
    await supabase.from("customers").update({ points: saldo, total_spending: custSpending + total }).eq("id", customerId);
```

Replace with (keep points update, drop manual total_spending, then recompute):

```ts
    await supabase.from("customers").update({ points: saldo }).eq("id", customerId);
    await recomputeCustomerTier(supabase, customerId);
```

The now-unused `custSpending` variable: leave the `let custSpending = 0` / `custSpending = Number(...)` reads as-is if other code uses them; if `custSpending` is now unused, remove its declaration and assignment to keep the build clean. Verify with grep in Step 3.

- [ ] **Step 3: Check for unused var + typecheck**

Run: `grep -n "custSpending" src/app/kasir/checkout.ts`
If it appears only at its declaration/assignment (no other read), delete those two lines.
Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i checkout.ts || echo "OK"`
Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add src/app/kasir/checkout.ts
git commit -m "feat(kasir): recompute tier after petshop checkout"
```

---

### Task 5: Wire recompute into klinik payment + void

**Files:**
- Modify: `src/app/(app)/klinik/pembayaran/[visitId]/actions.ts`

- [ ] **Step 1: Add import**

After the existing imports in `src/app/(app)/klinik/pembayaran/[visitId]/actions.ts`, add:

```ts
import { recomputeCustomerTier } from "@/lib/customer-tier";
```

- [ ] **Step 2: Fetch customer_id alongside branch_id in bayarVisit**

Find (around line 88):

```ts
  const { data: v } = await supabase.from("visits").select("branch_id").eq("id", visitId).maybeSingle();
```

Replace with:

```ts
  const { data: v } = await supabase.from("visits").select("branch_id, customer_id").eq("id", visitId).maybeSingle();
```

- [ ] **Step 3: Recompute before the EDIT-path success redirect**

Find the end of the EDIT branch (around line 145):

```ts
    await supabase.from("visits").update({ status: visitStatus }).eq("id", visitId);
    redirect(`${back}?success=edit`);
```

Replace with:

```ts
    await supabase.from("visits").update({ status: visitStatus }).eq("id", visitId);
    if (v?.customer_id) await recomputeCustomerTier(supabase, v.customer_id);
    redirect(`${back}?success=edit`);
```

- [ ] **Step 4: Recompute before the CREATE-path success redirect**

Find the end of `bayarVisit` (around line 179-180):

```ts
  // tetap di halaman pembayaran (read-only) supaya tombol Struk/Invoice langsung terlihat.
  redirect(`/klinik/pembayaran/${visitId}?success=bayar`);
```

Replace with:

```ts
  if (v?.customer_id) await recomputeCustomerTier(supabase, v.customer_id);
  // tetap di halaman pembayaran (read-only) supaya tombol Struk/Invoice langsung terlihat.
  redirect(`/klinik/pembayaran/${visitId}?success=bayar`);
```

- [ ] **Step 5: Recompute in voidAndReissue (void nurunin total lunas)**

In `voidAndReissue`, there is already `const { data: v } = await supabase.from("visits").select("branch_id").eq("id", visitId).maybeSingle();` (around line 211). Change its select to include `customer_id`:

```ts
  const { data: v } = await supabase.from("visits").select("branch_id, customer_id").eq("id", visitId).maybeSingle();
```

Then find the final redirect (around line 242):

```ts
  redirect(`${back}?success=reissue`);
```

Replace with:

```ts
  if (v?.customer_id) await recomputeCustomerTier(supabase, v.customer_id);
  redirect(`${back}?success=reissue`);
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "pembayaran" || echo "OK"`
Expected: `OK`. (Note: `redirect()` throws, so code after it never runs — that's why recompute is placed *before* each redirect.)

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/klinik/pembayaran/[visitId]/actions.ts"
git commit -m "feat(klinik): recompute tier after payment/edit/void"
```

---

### Task 6: Remove tier/kategori pickers from all 3 create forms

**Files:**
- Modify: `src/app/kasir/actions.ts` (`NewCustResult` type + `tambahCustomerKasir`)
- Modify: `src/app/kasir/KasirClient.tsx` (modal form fields + `CustRow` type + badge — badge done in Task 7)
- Modify: `src/app/(app)/crm/pelanggan/baru/actions.ts` + `page.tsx`
- Modify: `src/app/(app)/klinik/registrasi/actions.ts` + `RegistrasiForm.tsx`

- [ ] **Step 1: kasir/actions.ts — drop tier/keanggotaan from insert + type**

In `src/app/kasir/actions.ts`, change `NewCustResult` (line 8-10) `keanggotaan: string` → `kategori: string`:

```ts
export type NewCustResult =
  | { ok: true; customer: { id: string; name: string; phone: string; points: number; tier: string | null; kategori: string; trx: number } }
  | { ok: false; error: string };
```

Delete the `keanggotaan` and `tier` form reads (lines 23-24):

```ts
  const keanggotaan = String(formData.get("keanggotaan") ?? "Non Member");
  const tier = String(formData.get("tier") ?? "").trim() || null;
```

Change the insert + select (lines 34-37) to drop tier/kategori (rely on db defaults) and select `kategori`:

```ts
  const { data, error } = await supabase
    .from("customers")
    .insert({ name: nama, phone, email, dob, address: alamat, pekerjaan, sumber_info, catatan })
    .select("id, name, phone, points, tier, kategori")
    .single();
```

Also remove the now-stale comment `// tier: not-null di db...` above that insert.

- [ ] **Step 2: kasir/KasirClient.tsx — remove Keanggotaan/Tier fields from the modal form**

In the `showAddCust` modal form (the `frow` containing `select name="keanggotaan"` and `select name="tier"`), delete that entire `frow` block. Locate it:

Run: `grep -n 'name="keanggotaan"\|name="tier"' src/app/kasir/KasirClient.tsx`

Delete the `<div className="frow">…</div>` wrapping both selects (Keanggotaan + Kategori/Tier). Leave nama/phone/email/dob/alamat/pekerjaan/sumber_info/catatan fields intact.

- [ ] **Step 3: crm/pelanggan/baru/actions.ts — drop tier/keanggotaan**

In `src/app/(app)/crm/pelanggan/baru/actions.ts`, delete the `keanggotaan` and `tier` reads:

```ts
  const keanggotaan = String(formData.get("keanggotaan") ?? "Non Member");
  const tier = String(formData.get("tier") ?? "").trim() || null;
```

Remove `keanggotaan` and `tier` keys from the `.insert({...})` object (and drop the `// tier: not-null...` comment). Result insert:

```ts
  const { error } = await supabase.from("customers").insert({
    name: nama, phone, email, dob, address: alamat, pekerjaan, sumber_info, catatan,
  });
```

- [ ] **Step 4: crm/pelanggan/baru/page.tsx — remove the Keanggotaan section**

In `src/app/(app)/crm/pelanggan/baru/page.tsx`, delete the entire `{/* Section 02: Keanggotaan */}` `<div className="crm-sec">…</div>` (lines ~82-115) — it holds the Keanggotaan select, the Tier select, and the Catatan field. Move the **Catatan** field into Section 01 so it isn't lost: add this inside the Section 01 `crm-sec` div, after the pekerjaan/sumber_info `frow`:

```tsx
            <div className="fg">
              <label className="flab">Catatan</label>
              <textarea className="fi" name="catatan" placeholder="Catatan tambahan tentang pelanggan ini..." rows={5} style={{ resize: "vertical" }} />
            </div>
```

Since only one section remains, change the outer `<div className="grid2">` to a plain `<div>` (single column) so layout doesn't leave an empty half.

- [ ] **Step 5: klinik registrasi — drop tier picker + insert**

In `src/app/(app)/klinik/registrasi/RegistrasiForm.tsx`, delete the tier `<div>` (lines ~121-129) containing `<select name="tier">`. Since it shares a `frow` with the Email field, keep Email and replace the `frow` with a single `fg` for Email:

```tsx
          <div className="fg">
            <label className="flab">Email</label>
            <input className="fi" name="email" type="email" placeholder="susi@gmail.com" defaultValue={customer?.email ?? ""} key={`email-${customer?.id ?? "new"}`} />
          </div>
```

In `src/app/(app)/klinik/registrasi/actions.ts`, delete the tier read (line 18):

```ts
  const tier = String(formData.get("tier") ?? "New") || "New";
```

And remove `tier` from the customer insert (line 60):

```ts
    const { data: created, error } = await supabase
      .from("customers").insert({ name, phone, dob, email, address, catatan }).select("id").single();
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "kasir|pelanggan|registrasi" || echo "OK"`
Expected: `OK`. (KasirClient may still reference `keanggotaan` in the badge — that's fixed in Task 7; if tsc errors on it here, proceed to Task 7 which resolves it, but the `CustRow` type field rename in Task 7 Step 1 is what silences it. To keep this task self-contained, also apply Task 7 Step 1 now if tsc complains.)

- [ ] **Step 7: Commit**

```bash
git add src/app/kasir/actions.ts src/app/kasir/KasirClient.tsx "src/app/(app)/crm/pelanggan/baru/actions.ts" "src/app/(app)/crm/pelanggan/baru/page.tsx" "src/app/(app)/klinik/registrasi/actions.ts" "src/app/(app)/klinik/registrasi/RegistrasiForm.tsx"
git commit -m "feat: remove manual tier/kategori pickers from all 3 create forms"
```

---

### Task 7: Rename keanggotaan→kategori in reads + POS 2-badge split

**Files:**
- Modify: `src/app/kasir/page.tsx`, `src/app/kasir/KasirClient.tsx`
- Modify: `src/app/(app)/crm/pelanggan/page.tsx`

- [ ] **Step 1: kasir/KasirClient.tsx — CustRow type + selection wiring**

Change `CustRow` type (line ~11): `keanggotaan: string` → `kategori: string`.

Find where the POS customer panel renders the combined badge (around line 158-162, the `<span className="bge" …>` using `cust.keanggotaan === "Member" ? cust.tier ...`). Replace that single `<div>` badge block with two separate read-only badges:

```tsx
            <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "center" }}>
              <span className="bge" style={{ ...(TIER_BADGE[cust.tier ?? "New"] ?? { bg: "#f3f4f6", color: "#6b7280" }), fontSize: 11, padding: "3px 12px" }}>
                <i className="ti ti-award" style={{ marginRight: 4 }} />{cust.tier ?? "New"}
              </span>
              <span style={{ fontSize: 9, color: "var(--td)" }}>Tier</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "center" }}>
              <span className="bge" style={{ background: "#eff6ff", color: "#1d4ed8", fontSize: 11, padding: "3px 12px" }}>
                {cust.kategori}
              </span>
              <span style={{ fontSize: 9, color: "var(--td)" }}>Kategori</span>
            </div>
```

Add `New` to the `TIER_BADGE` map (line ~22-27) so it isn't a generic gray fallback:

```tsx
const TIER_BADGE: Record<string, { bg: string; color: string }> = {
  New: { bg: "#f1f5f9", color: "#475569" },
  Bronze: { bg: "#fef3c7", color: "#92400e" },
  Silver: { bg: "#f3f4f6", color: "#4b5563" },
  Gold: { bg: "#fef9c3", color: "#713f12" },
  Platinum: { bg: "#ede9fe", color: "#5b21b6" },
};
```

- [ ] **Step 2: kasir/page.tsx — select kategori, map to CustRow**

In `src/app/kasir/page.tsx`, change the customers select (line 28): `points, tier, keanggotaan` → `points, tier, kategori`.
Change the `custRows` map cast type (line 60): `keanggotaan: string` → `kategori: string`.

- [ ] **Step 3: crm/pelanggan/page.tsx — select kategori**

In `src/app/(app)/crm/pelanggan/page.tsx` line 14, change the select string `tier, keanggotaan, points` → `tier, kategori, points`.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "kasir|pelanggan" || echo "OK"`
Expected: still errors in `PelangganClient.tsx` (uses `keanggotaan` / `CustomerRow.keanggotaan`) — those are fixed in Task 8. `kasir` files should be clean. If any `kasir` error remains, fix before committing.

- [ ] **Step 5: Commit**

```bash
git add src/app/kasir/page.tsx src/app/kasir/KasirClient.tsx "src/app/(app)/crm/pelanggan/page.tsx"
git commit -m "feat(kasir): kategori rename + split tier/kategori badges on POS"
```

---

### Task 8: CRM — kategori admin edit + per-unit aggregate view

**Files:**
- Create: `src/app/(app)/crm/pelanggan/actions.ts`
- Modify: `src/app/(app)/crm/pelanggan/page.tsx`
- Modify: `src/app/(app)/crm/pelanggan/PelangganClient.tsx`

- [ ] **Step 1: Create the kategori update server action**

Create `src/app/(app)/crm/pelanggan/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const KATEGORI_OPTIONS = ["Umum", "Member", "B2B", "Rescuer"] as const;

// Kategori pelanggan hanya boleh diubah OWNER/ADMIN (pola crm/promo).
export async function updateKategoriPelanggan(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  if (!me || !["OWNER", "ADMIN"].includes(me.role)) {
    redirect(`/crm/pelanggan?error=${encodeURIComponent("Hanya owner/admin yang bisa mengubah kategori")}`);
  }

  const id = String(formData.get("id") ?? "");
  const kategori = String(formData.get("kategori") ?? "");
  if (!id || !KATEGORI_OPTIONS.includes(kategori as (typeof KATEGORI_OPTIONS)[number])) {
    redirect(`/crm/pelanggan?error=${encodeURIComponent("Kategori tidak valid")}`);
  }

  await supabase.from("customers").update({ kategori }).eq("id", id);
  revalidatePath("/crm/pelanggan");
}
```

- [ ] **Step 2: page.tsx — fetch role + per-unit aggregates, pass to client**

In `src/app/(app)/crm/pelanggan/page.tsx`, after fetching `customers`/`ids`, add: (a) current user role → `isAdmin`, (b) per-customer petshop & klinik aggregates. Add before the `return`:

```ts
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  const isAdmin = !!me && ["OWNER", "ADMIN"].includes(me.role);

  // Agregat per unit (admin view). Petshop: sales.total. Klinik: invoices lunas via visits.
  const statByCust: Record<string, { petshopCount: number; petshopTotal: number; klinikCount: number; klinikTotal: number }> = {};
  if (isAdmin && ids.length) {
    const [{ data: salesAgg }, { data: invAgg }] = await Promise.all([
      supabase.from("sales").select("customer_id, total").in("customer_id", ids),
      supabase.from("invoices").select("total, visits!inner(customer_id)").eq("paid_status", "Lunas").is("voided_at", null).in("visits.customer_id", ids),
    ]);
    for (const s of (salesAgg ?? []) as { customer_id: string; total: number }[]) {
      const st = (statByCust[s.customer_id] ??= { petshopCount: 0, petshopTotal: 0, klinikCount: 0, klinikTotal: 0 });
      st.petshopCount++; st.petshopTotal += Number(s.total || 0);
    }
    for (const iv of (invAgg ?? []) as { total: number; visits: { customer_id: string } | { customer_id: string }[] }[]) {
      const cid = Array.isArray(iv.visits) ? iv.visits[0]?.customer_id : iv.visits?.customer_id;
      if (!cid) continue;
      const st = (statByCust[cid] ??= { petshopCount: 0, petshopTotal: 0, klinikCount: 0, klinikTotal: 0 });
      st.klinikCount++; st.klinikTotal += Number(iv.total || 0);
    }
  }
```

Change the enriched map + render to include stats + isAdmin:

```ts
  const enriched = customers.map((c) => ({ ...c, purchases: purByCust[c.id] ?? [], ledger: ledByCust[c.id] ?? [], stat: statByCust[c.id] ?? null }));

  return <PelangganClient customers={enriched} isAdmin={isAdmin} />;
```

- [ ] **Step 3: PelangganClient.tsx — type changes**

In `src/app/(app)/crm/pelanggan/PelangganClient.tsx`:
- `CustomerRow`: `keanggotaan: string` → `kategori: string`; add `stat: UnitStat | null;`.
- Add type + import near top:

```ts
import { updateKategoriPelanggan, KATEGORI_OPTIONS } from "./actions";
export type UnitStat = { petshopCount: number; petshopTotal: number; klinikCount: number; klinikTotal: number };
```

- Change component signature: `export function PelangganClient({ customers, isAdmin }: { customers: CustomerRow[]; isAdmin: boolean })`.

- [ ] **Step 4: PelangganClient.tsx — replace keanggotaan reads**

Replace every `keanggotaan` reference with the new semantics:
- `TierBadge` (line ~58): tier no longer gated on Member — show tier directly: `const cfg = c.tier ? TIER_CFG[c.tier] : null;`.
- `MemberBadge` component → rename to `KategoriBadge`, render `c.kategori` (any of Umum/Member/B2B/Rescuer). Keep simple styling:

```tsx
function KategoriBadge({ v }: { v: string }) {
  return <span className="bge" style={{ background: "#eff6ff", color: "#1d4ed8" }}>{v}</span>;
}
```

- Aggregate stats block (lines ~129-132): replace `keanggotaan === "Member"` logic. Tier counts now count all customers by tier (not just members):

```ts
    const tierCounts: Record<string, number> = {};
    for (const k of TIER_ORDER) tierCounts[k] = customers.filter((c) => c.tier === k).length;
    return { total, tierCounts };
```

Remove `member` / `nonMember` from `agg` and any JSX that referenced them (member/non-member summary tiles). If a tile referenced `agg.member`, replace that tile's number with a kategori breakdown or delete it — keep it minimal: delete the member/nonMember tiles, keep tier tiles.
- Table header (line ~231) `<th>Keanggotaan</th>` → `<th>Kategori</th>` (and remove the now-duplicate second `<th>Kategori</th>` if the old layout had both Keanggotaan+Kategori columns). Cell (line ~247) `<MemberBadge v={c.keanggotaan} />` → `<KategoriBadge v={c.kategori} />`.
- Detail panel (line ~282) `<MemberBadge v={sel.keanggotaan} /><TierBadge c={sel} />` → `<KategoriBadge v={sel.kategori} /><TierBadge c={sel} />`.

- [ ] **Step 5: PelangganClient.tsx — admin kategori edit control in detail panel**

In the detail panel (near line ~282, after the badges row), add an admin-only kategori editor. Render only when `isAdmin`:

```tsx
                {isAdmin && (
                  <form action={updateKategoriPelanggan} style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="hidden" name="id" value={sel.id} />
                    <label style={{ fontSize: 10, color: "var(--tm)" }}>Ubah kategori:</label>
                    <select name="kategori" defaultValue={sel.kategori} className="fi" style={{ width: "auto", fontSize: 11, padding: "4px 8px" }} key={`kat-${sel.id}`}>
                      {KATEGORI_OPTIONS.map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                    <button type="submit" className="btn-acc" style={{ fontSize: 10, padding: "4px 10px" }}>Simpan</button>
                  </form>
                )}
```

- [ ] **Step 6: PelangganClient.tsx — admin per-unit aggregate view**

In the detail panel, after the info rows (near the `Total Pembelian` / `Poin Reward` block, around line ~292-303), add an admin-only breakdown:

```tsx
                {isAdmin && sel.stat && (
                  <div style={{ marginTop: 10, borderTop: ".5px solid var(--bd)", paddingTop: 10 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "var(--td)", marginBottom: 6 }}>RINCIAN TRANSAKSI (ADMIN)</div>
                    {[
                      { unit: "Petshop", count: sel.stat.petshopCount, total: sel.stat.petshopTotal },
                      { unit: "Klinik", count: sel.stat.klinikCount, total: sel.stat.klinikTotal },
                    ].map((u) => (
                      <div key={u.unit} style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--tm)", margin: "3px 0" }}>
                        <span>{u.unit}</span>
                        <span>{u.count}x · {rp(u.total)} · rata2 {rp(u.count ? u.total / u.count : 0)}</span>
                      </div>
                    ))}
                  </div>
                )}
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "pelanggan" || echo "OK"`
Expected: `OK`.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(app)/crm/pelanggan/actions.ts" "src/app/(app)/crm/pelanggan/page.tsx" "src/app/(app)/crm/pelanggan/PelangganClient.tsx"
git commit -m "feat(crm): admin-only kategori edit + per-unit transaction breakdown"
```

---

### Task 9: `/pengaturan/tier` — threshold settings page

**Files:**
- Create: `src/app/(app)/pengaturan/tier/page.tsx`
- Create: `src/app/(app)/pengaturan/tier/actions.ts`
- Modify: `src/lib/nav.ts:114` (wire the dead "Konfigurasi loyalty" tile)

- [ ] **Step 1: Create the update action**

Create `src/app/(app)/pengaturan/tier/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function updateTierSettings(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  if (!me || !["OWNER", "ADMIN"].includes(me.role)) {
    redirect(`/pengaturan/tier?error=${encodeURIComponent("Hanya owner/admin")}`);
  }

  const num = (k: string) => Math.max(0, Number(formData.get(k)) || 0);
  const bronze_min = num("bronze_min"), silver_min = num("silver_min"), gold_min = num("gold_min"), platinum_min = num("platinum_min");
  if (!(bronze_min < silver_min && silver_min < gold_min && gold_min < platinum_min)) {
    redirect(`/pengaturan/tier?error=${encodeURIComponent("Threshold harus naik: Bronze < Silver < Gold < Platinum")}`);
  }

  await supabase.from("tier_settings").update({ bronze_min, silver_min, gold_min, platinum_min }).eq("id", 1);
  revalidatePath("/pengaturan/tier");
  redirect("/pengaturan/tier?success=1");
}
```

- [ ] **Step 2: Create the page (admin-gated)**

Create `src/app/(app)/pengaturan/tier/page.tsx`:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { updateTierSettings } from "./actions";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export default async function TierSettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const { error, success } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  if (!me || !["OWNER", "ADMIN"].includes(me.role)) redirect("/pengaturan");

  const { data: cfg } = await supabase.from("tier_settings").select("bronze_min, silver_min, gold_min, platinum_min").eq("id", 1).maybeSingle();
  const c = cfg ?? { bronze_min: 1000000, silver_min: 5000000, gold_min: 15000000, platinum_min: 50000000 };

  const rows: { name: string; k: string; v: number }[] = [
    { name: "Bronze", k: "bronze_min", v: Number(c.bronze_min) },
    { name: "Silver", k: "silver_min", v: Number(c.silver_min) },
    { name: "Gold", k: "gold_min", v: Number(c.gold_min) },
    { name: "Platinum", k: "platinum_min", v: Number(c.platinum_min) },
  ];

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pengaturan" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Threshold Tier Pelanggan</span>
      </div>

      {error && <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c", marginBottom: 12 }}><i className="ti ti-alert-circle" /> {error}</div>}
      {success && <div className="p2ban" style={{ background: "#f0fdf4", border: ".5px solid #86efac", color: "#166534", marginBottom: 12 }}><i className="ti ti-check" /> Tersimpan</div>}

      <form action={updateTierSettings} className="crm-sec" style={{ maxWidth: 460 }}>
        <div style={{ fontSize: 11, color: "var(--td)", marginBottom: 10 }}>
          Minimum total transaksi (gabungan petshop + klinik) untuk tiap tier. Di bawah Bronze = New.
        </div>
        {rows.map((r) => (
          <div className="fg" key={r.k}>
            <label className="flab">{r.name} — minimum (Rp)</label>
            <input className="fi" name={r.k} type="number" min={0} defaultValue={r.v} />
            <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 2 }}>Saat ini: {rp(r.v)}</div>
          </div>
        ))}
        <button type="submit" className="btn-acc" style={{ marginTop: 6 }}>Simpan Threshold</button>
      </form>
    </>
  );
}
```

- [ ] **Step 3: Wire the nav tile**

In `src/lib/nav.ts` line 114, add `href: "/pengaturan/tier"` to the "Konfigurasi loyalty" tile:

```ts
    { label: "Konfigurasi loyalty", icon: "ti-star", ...A, href: "/pengaturan/tier" },
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "tier|nav" || echo "OK"`
Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/pengaturan/tier/page.tsx" "src/app/(app)/pengaturan/tier/actions.ts" src/lib/nav.ts
git commit -m "feat(pengaturan): tier threshold settings page (admin)"
```

---

### Task 10: Klinik RekamForm — fix mislabeled tier badge

**Files:**
- Modify: `src/app/(app)/klinik/rekam-medis/[visitId]/RekamForm.tsx:92`

- [ ] **Step 1: Relabel**

In `src/app/(app)/klinik/rekam-medis/[visitId]/RekamForm.tsx` line ~92, change:

```tsx
                <MiniKV k="Kategori" v={patient.tier} />
```

to:

```tsx
                <MiniKV k="Tier" v={patient.tier} />
```

(The `patient.tier` value is a tier — it was mislabeled "Kategori". Kategori is a separate concept now, not shown in klinik docs per spec.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "RekamForm" || echo "OK"`
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/klinik/rekam-medis/[visitId]/RekamForm.tsx"
git commit -m "fix(klinik): relabel mislabeled tier badge (was 'Kategori')"
```

---

### Task 11: Full-flow verification (browser)

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck + unit tests**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run src/lib/__tests__/customer-tier.test.ts`
Expected: no TS errors; tier tests PASS.

- [ ] **Step 2: Petshop flow raises tier**

Start dev (`preview_start` vetos-dev), login `staff@vetos.local` / `password123`, open `/kasir`. Add a high-price item, pick a customer, pay. Then open `/crm/pelanggan` as admin (`owner@vetos.local`), confirm that customer's `total_spending` grew and tier reflects the threshold. Confirm POS panel shows **two** badges (Tier + Kategori).

- [ ] **Step 3: Kategori is admin-only**

As STAFF, open `/crm/pelanggan` detail — no kategori edit control visible. As OWNER/ADMIN — control visible; change kategori, submit, confirm it persists and the per-unit breakdown block shows Petshop/Klinik counts + averages.

- [ ] **Step 4: No tier picker anywhere**

Confirm the POS "Customer Baru" modal, `/crm/pelanggan/baru`, and `/klinik/registrasi` forms have **no** tier or keanggotaan/kategori dropdown.

- [ ] **Step 5: Threshold page**

Open `/pengaturan/tier` as admin, change a threshold, save, confirm "Tersimpan". As STAFF, confirm redirect away from the page.

- [ ] **Step 6: Commit (if any verification fixups were needed)**

```bash
git add -A && git commit -m "fix: tier/kategori verification fixups" || echo "nothing to commit"
```
