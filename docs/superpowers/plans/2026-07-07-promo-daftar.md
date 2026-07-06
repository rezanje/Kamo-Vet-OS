# Daftar Promo (per cabang, per hari) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pusat (OWNER/ADMIN) sets promos per branch + date range at `/crm/promo`; a kasir opens a "Promo Hari Ini" list in the DAFTAR PRODUK header showing promos active today for their branch.

**Architecture:** Migration `0035` adds `branch_ids uuid[]`, `valid_from`, `valid_until` to `promos`. A pure `promoActiveFor` predicate (unit-tested) is the single source of truth for "active today for this branch". `/crm/promo` is an OWNER/ADMIN CRUD page mirroring the `/pos/quest` admin pattern. The kasir page pre-filters fetched promos through `promoActiveFor` server-side, then `KasirClient` renders both the existing Reminder popup and a new "Promo Hari Ini" modal from that filtered set.

**Tech Stack:** Next.js 15 App Router (server components + server actions), Supabase (Postgres + existing relaxed `promos_all` RLS), vitest, plain CSS classes from `globals.css` (`.card`, `.fi`, `.flab`, `.tbl`, `.bge`, `.btn-acc`, `.btn-def`), tabler icons.

## Global Constraints
- New columns `snake_case`, English; UI copy Bahasa Indonesia.
- Mutations via Server Actions (`"use server"`); reads via server components.
- No new RLS — existing `promos_all` (prototype relax) covers `promos`.
- Admin actions gated to roles `OWNER`/`ADMIN` (`profiles.role`), mirroring `/pos/quest`.
- Migration file `0035_*` applied via supabase MCP `apply_migration`, same name as file.
- Business logic unit-tested in `src/lib/__tests__/`.
- `promoActiveFor` is the ONLY place the "active today for branch" rule lives — never inline it.
- Commit after each task: `feat(promo): …` / `docs: …` + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Branch `feat/promo-daftar` (already created).

## File Structure
- `supabase/migrations/0035_promo_branch_schedule.sql` — columns + demo seed.
- `src/lib/promo.ts` — `PromoRow` type, `promoActiveFor`, `promoScheduleStatus`.
- `src/lib/__tests__/promo.test.ts` — tests.
- `src/app/(app)/crm/promo/page.tsx` + `actions.ts` — admin CRUD (OWNER/ADMIN).
- `src/lib/nav.ts` — CRM "Promo" tile gains `href: "/crm/promo"`.
- `src/app/kasir/page.tsx` — fetch new columns, pre-filter branch+today.
- `src/app/kasir/KasirClient.tsx` — "Promo Hari Ini" button + modal.

---

### Task 1: promoActiveFor predicate + tests

**Files:**
- Create: `src/lib/promo.ts`
- Test: `src/lib/__tests__/promo.test.ts`

**Interfaces:**
- Produces: type `PromoRule`, type `PromoRow = { id: string; name: string; promo_type: string; rule: PromoRule; is_active: boolean; branch_ids: string[] | null; valid_from: string | null; valid_until: string | null }`; `promoActiveFor(p: PromoRow, branchId: string, today: string): boolean`; `promoScheduleStatus(p: PromoRow, today: string): "aktif" | "terjadwal" | "kadaluarsa" | "nonaktif"`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/promo.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { promoActiveFor, promoScheduleStatus, type PromoRow } from "../promo";

const base: PromoRow = {
  id: "p1", name: "Promo", promo_type: "diskon_produk", rule: {},
  is_active: true, branch_ids: null, valid_from: null, valid_until: null,
};

describe("promoActiveFor", () => {
  it("all-branch, unbounded dates → active for any branch/today", () => {
    expect(promoActiveFor(base, "B1", "2026-07-07")).toBe(true);
  });
  it("inactive → never active", () => {
    expect(promoActiveFor({ ...base, is_active: false }, "B1", "2026-07-07")).toBe(false);
  });
  it("branch match by array membership", () => {
    expect(promoActiveFor({ ...base, branch_ids: ["B1", "B2"] }, "B1", "2026-07-07")).toBe(true);
    expect(promoActiveFor({ ...base, branch_ids: ["B2"] }, "B1", "2026-07-07")).toBe(false);
  });
  it("empty branch_ids array = all branches", () => {
    expect(promoActiveFor({ ...base, branch_ids: [] }, "B1", "2026-07-07")).toBe(true);
  });
  it("before valid_from → inactive", () => {
    expect(promoActiveFor({ ...base, valid_from: "2026-07-08" }, "B1", "2026-07-07")).toBe(false);
  });
  it("after valid_until → inactive", () => {
    expect(promoActiveFor({ ...base, valid_until: "2026-07-06" }, "B1", "2026-07-07")).toBe(false);
  });
  it("within date range → active", () => {
    expect(promoActiveFor({ ...base, valid_from: "2026-07-01", valid_until: "2026-07-31" }, "B1", "2026-07-07")).toBe(true);
  });
});

describe("promoScheduleStatus", () => {
  it("nonaktif when is_active false", () => {
    expect(promoScheduleStatus({ ...base, is_active: false }, "2026-07-07")).toBe("nonaktif");
  });
  it("kadaluarsa when valid_until before today", () => {
    expect(promoScheduleStatus({ ...base, valid_until: "2026-07-06" }, "2026-07-07")).toBe("kadaluarsa");
  });
  it("terjadwal when valid_from after today", () => {
    expect(promoScheduleStatus({ ...base, valid_from: "2026-07-10" }, "2026-07-07")).toBe("terjadwal");
  });
  it("aktif when within / unbounded", () => {
    expect(promoScheduleStatus(base, "2026-07-07")).toBe("aktif");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/promo.test.ts`
Expected: FAIL — cannot find module `../promo`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/promo.ts`:
```ts
// Promo per cabang + masa berlaku (pure). promoActiveFor = satu-satunya sumber
// kebenaran "aktif hari ini untuk cabang X" — jangan diduplikasi inline.
export type PromoRule = {
  trigger_item_ids?: string[];
  min_qty?: number;
  min_subtotal?: number;
  suggest?: string;
  discount_type?: string;
  discount_value?: number;
};

export type PromoRow = {
  id: string;
  name: string;
  promo_type: string;
  rule: PromoRule;
  is_active: boolean;
  branch_ids: string[] | null; // null / kosong = semua cabang
  valid_from: string | null;   // 'YYYY-MM-DD', null = tanpa batas awal
  valid_until: string | null;  // 'YYYY-MM-DD', null = tanpa batas akhir
};

export function promoActiveFor(p: PromoRow, branchId: string, today: string): boolean {
  if (!p.is_active) return false;
  if (p.branch_ids && p.branch_ids.length > 0 && !p.branch_ids.includes(branchId)) return false;
  if (p.valid_from && today < p.valid_from) return false;
  if (p.valid_until && today > p.valid_until) return false;
  return true;
}

export function promoScheduleStatus(p: PromoRow, today: string): "aktif" | "terjadwal" | "kadaluarsa" | "nonaktif" {
  if (!p.is_active) return "nonaktif";
  if (p.valid_until && p.valid_until < today) return "kadaluarsa";
  if (p.valid_from && p.valid_from > today) return "terjadwal";
  return "aktif";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/promo.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/promo.ts src/lib/__tests__/promo.test.ts
git commit -m "feat(promo): promoActiveFor predicate (branch + date) — pure + tested

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Migration — promos branch + schedule columns + seed

**Files:**
- Create: `supabase/migrations/0035_promo_branch_schedule.sql`

**Interfaces:**
- Produces: `promos.branch_ids uuid[]`, `promos.valid_from date`, `promos.valid_until date`. Existing two demo promos become active today (all branches); one branch-specific demo promo added for the Kasir demo branch (the branch of the employee linked to `staff@vetos.local`).

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/0035_promo_branch_schedule.sql`:
```sql
-- Daftar Promo: target cabang + masa berlaku. null/empty branch_ids = semua cabang.
alter table promos
  add column branch_ids uuid[],
  add column valid_from date,
  add column valid_until date;

-- Demo: dua promo existing berlaku hari ini utk semua cabang selama 30 hari.
update promos set valid_from = current_date, valid_until = current_date + 30
where valid_from is null and valid_until is null;

-- Demo: satu promo khusus cabang tempat karyawan tertaut staff@vetos.local bertugas.
insert into promos (name, promo_type, rule, is_active, branch_ids, valid_from, valid_until)
select 'Diskon Grooming Cabang', 'diskon_produk',
  '{"suggest":"Diskon 15% jasa grooming hari ini di cabang ini","discount_type":"percent","discount_value":15}'::jsonb,
  true, array[e.branch_id], current_date, current_date + 7
from employees e
where e.profile_id = (select id from auth.users where email = 'staff@vetos.local')
  and e.branch_id is not null
  and not exists (select 1 from promos where name = 'Diskon Grooming Cabang');
```

- [ ] **Step 2: Apply the migration**

Apply via supabase MCP `apply_migration` with name `0035_promo_branch_schedule` and the query above.

- [ ] **Step 3: Verify columns + seed**

Run via supabase MCP `execute_sql`:
```sql
select name, is_active, branch_ids, valid_from, valid_until from promos order by name;
```
Expected: existing promos have `valid_from`/`valid_until` set, `branch_ids` null; the "Diskon Grooming Cabang" row has a one-element `branch_ids` array.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0035_promo_branch_schedule.sql
git commit -m "feat(promo): branch_ids + valid_from/valid_until columns + demo seed

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: /crm/promo admin (OWNER/ADMIN CRUD) + nav tile

**Files:**
- Create: `src/app/(app)/crm/promo/actions.ts`
- Create: `src/app/(app)/crm/promo/page.tsx`
- Modify: `src/lib/nav.ts` (CRM "Promo" tile href)

**Interfaces:**
- Consumes: `promoScheduleStatus` (Task 1), `promos` columns (Task 2).
- Produces: route `/crm/promo`; server actions `createPromo(formData)`, `togglePromo(formData)`.

- [ ] **Step 1: Create the server actions**

Create `src/app/(app)/crm/promo/actions.ts`:
```ts
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Konfigurasi promo dari pusat — khusus OWNER/ADMIN.
async function requireManager() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  if (!me || !["OWNER", "ADMIN"].includes(me.role)) {
    redirect(`/crm/promo?error=${encodeURIComponent("Hanya owner/manajer yang bisa mengatur promo")}`);
  }
  return { supabase };
}

export async function createPromo(formData: FormData) {
  const { supabase } = await requireManager();
  const name = String(formData.get("name") ?? "").trim();
  const promoType = String(formData.get("promo_type") ?? "diskon_produk");
  const suggest = String(formData.get("suggest") ?? "").trim();
  const discountType = String(formData.get("discount_type") ?? "") || null;
  const discountValue = formData.get("discount_value") ? Number(formData.get("discount_value")) : null;
  const minQty = formData.get("min_qty") ? Number(formData.get("min_qty")) : null;
  const minSubtotal = formData.get("min_subtotal") ? Number(formData.get("min_subtotal")) : null;
  const validFrom = String(formData.get("valid_from") ?? "").trim() || null;
  const validUntil = String(formData.get("valid_until") ?? "").trim() || null;
  const branchIds = formData.getAll("branch_ids").map(String).filter(Boolean);

  if (!name || !suggest) redirect(`/crm/promo?error=${encodeURIComponent("Nama & teks saran wajib diisi")}`);

  // rakit rule jsonb dari field opsional.
  const rule: Record<string, unknown> = { suggest };
  if (discountType) rule.discount_type = discountType;
  if (discountValue != null) rule.discount_value = discountValue;
  if (minQty != null) rule.min_qty = minQty;
  if (minSubtotal != null) rule.min_subtotal = minSubtotal;

  await supabase.from("promos").insert({
    name, promo_type: promoType, rule,
    branch_ids: branchIds.length ? branchIds : null, // kosong = semua cabang
    valid_from: validFrom, valid_until: validUntil, is_active: true,
  });
  revalidatePath("/crm/promo");
  redirect("/crm/promo?success=1");
}

export async function togglePromo(formData: FormData) {
  const { supabase } = await requireManager();
  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("active") ?? "") === "1";
  await supabase.from("promos").update({ is_active: active }).eq("id", id);
  revalidatePath("/crm/promo");
  redirect("/crm/promo");
}
```

- [ ] **Step 2: Create the page**

Create `src/app/(app)/crm/promo/page.tsx`:
```tsx
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { promoScheduleStatus, type PromoRow } from "@/lib/promo";
import { createPromo, togglePromo } from "./actions";

const STATUS_BADGE: Record<string, string> = { aktif: "g", terjadwal: "b", kadaluarsa: "x", nonaktif: "r" };
const STATUS_LABEL: Record<string, string> = { aktif: "Aktif hari ini", terjadwal: "Terjadwal", kadaluarsa: "Kadaluarsa", nonaktif: "Nonaktif" };

export default async function PromoAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const supabase = await createClient();
  const today = new Date(new Date().getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);

  const [{ data: promos }, { data: branches }] = await Promise.all([
    supabase.from("promos").select("id, name, promo_type, rule, is_active, branch_ids, valid_from, valid_until").order("created_at", { ascending: false }),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
  ]);
  const branchName = new Map((branches ?? []).map((b) => [b.id, b.name]));
  const rows = (promos ?? []) as PromoRow[];

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/crm" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Promo — Konfigurasi Pusat</span>
      </div>

      {error && <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}><i className="ti ti-alert-circle" /> {error}</div>}
      {success && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> Promo baru dibuat.</div>}

      <div className="crm-sec">
        <SecHeader num="01" title="BUAT PROMO" desc="Set promo per cabang + masa berlaku. Kosongkan cabang = berlaku semua cabang." />
        <form action={createPromo} style={{ display: "grid", gridTemplateColumns: "2fr 1.3fr 1fr 1fr", gap: 8, alignItems: "flex-end" }}>
          <div style={{ gridColumn: "1 / -1" }}>
            <label className="flab">Nama promo *</label>
            <input className="fi" name="name" required placeholder="mis. Diskon Lebaran Royal Canin" />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label className="flab">Teks saran untuk kasir *</label>
            <input className="fi" name="suggest" required placeholder="mis. Beli 2 Royal Canin diskon 10% item kedua" />
          </div>
          <div>
            <label className="flab">Tipe</label>
            <select className="fi" name="promo_type" defaultValue="diskon_produk">
              <option value="diskon_produk">Diskon Produk</option>
              <option value="bundling">Bundling</option>
              <option value="tebus_murah">Tebus Murah</option>
            </select>
          </div>
          <div>
            <label className="flab">Jenis diskon</label>
            <select className="fi" name="discount_type" defaultValue="">
              <option value="">—</option>
              <option value="percent">Persen</option>
              <option value="nominal">Nominal</option>
            </select>
          </div>
          <div>
            <label className="flab">Nilai diskon</label>
            <input className="fi" name="discount_value" type="number" min={0} step="any" placeholder="0" />
          </div>
          <div>
            <label className="flab">Min. subtotal</label>
            <input className="fi" name="min_subtotal" type="number" min={0} step="any" placeholder="0" />
          </div>
          <div>
            <label className="flab">Berlaku dari</label>
            <input className="fi" name="valid_from" type="date" defaultValue={today} />
          </div>
          <div>
            <label className="flab">Berlaku s/d</label>
            <input className="fi" name="valid_until" type="date" />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label className="flab">Cabang (kosongkan = semua cabang)</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", maxHeight: 96, overflowY: "auto", border: ".5px solid var(--bd)", borderRadius: 7, padding: "8px 10px" }}>
              {(branches ?? []).map((b) => (
                <label key={b.id} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11 }}>
                  <input type="checkbox" name="branch_ids" value={b.id} /> {b.name}
                </label>
              ))}
            </div>
          </div>
          <button type="submit" className="btn-acc" style={{ gridColumn: "1 / -1", justifyContent: "center" }}>
            <i className="ti ti-plus" /> Buat Promo
          </button>
        </form>
      </div>

      <div className="crm-sec">
        <SecHeader num="02" title="DAFTAR PROMO" desc="Semua promo terdaftar + status masa berlaku." />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 760 }}>
            <thead>
              <tr><th>Nama</th><th>Tipe</th><th>Cabang</th><th>Berlaku</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const st = promoScheduleStatus(p, today);
                const cabang = !p.branch_ids || p.branch_ids.length === 0
                  ? "Semua cabang"
                  : p.branch_ids.map((id) => branchName.get(id) ?? "—").join(", ");
                return (
                  <tr key={p.id} style={{ opacity: p.is_active ? 1 : 0.55 }}>
                    <td style={{ fontWeight: 500 }}>{p.name}</td>
                    <td style={{ fontSize: 11, textTransform: "capitalize" }}>{p.promo_type.replace("_", " ")}</td>
                    <td style={{ fontSize: 11 }}>{cabang}</td>
                    <td style={{ fontSize: 11 }}>{p.valid_from ?? "—"} s/d {p.valid_until ?? "∞"}</td>
                    <td><span className={`bge ${STATUS_BADGE[st]}`}>{STATUS_LABEL[st]}</span></td>
                    <td>
                      <form action={togglePromo}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="active" value={p.is_active ? "0" : "1"} />
                        <button type="submit" className="btn-def" style={{ padding: "3px 10px", fontSize: 10 }}>
                          {p.is_active ? "Nonaktifkan" : "Aktifkan"}
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>Belum ada promo.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 3: Wire the CRM Promo tile**

In `src/lib/nav.ts`, the `crm` array has `{ label: "Promo", icon: "ti-speakerphone", ...A }`. Add an href:
```ts
    { label: "Promo", icon: "ti-speakerphone", ...A, href: "/crm/promo" },
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: `No errors found`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/crm/promo" src/lib/nav.ts
git commit -m "feat(promo): /crm/promo admin config (per cabang + masa berlaku, OWNER/ADMIN)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Kasir "Promo Hari Ini" button + modal

**Files:**
- Modify: `src/app/kasir/page.tsx`
- Modify: `src/app/kasir/KasirClient.tsx`

**Interfaces:**
- Consumes: `promoActiveFor` (Task 1), promos with new columns (Task 2), `shift.branch_id`.
- Produces: filtered promos passed to `KasirClient`; a "Promo Hari Ini" button + modal in the DAFTAR PRODUK header.

- [ ] **Step 1: Fetch new columns + pre-filter in the page**

In `src/app/kasir/page.tsx`, change the promos fetch line inside the `Promise.all` from:
```ts
    supabase.from("promos").select("id, name, promo_type, rule").eq("is_active", true),
```
to:
```ts
    supabase.from("promos").select("id, name, promo_type, rule, is_active, branch_ids, valid_from, valid_until").eq("is_active", true),
```

Then, immediately after the `Promise.all([...])` destructuring block (before the `return`), add the import at the top of the file:
```ts
import { promoActiveFor, type PromoRow as PromoFull } from "@/lib/promo";
```
and add the filter just above the `return (`:
```ts
  // Addendum: promo yang aktif hari ini untuk cabang shift (branch + tanggal).
  const wibToday = new Date(new Date().getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const promosActive = ((promos ?? []) as unknown as PromoFull[]).filter((p) => promoActiveFor(p, shift.branch_id, wibToday));
```

Change the `promos={...}` prop passed to `<KasirClient>` from:
```tsx
      promos={(promos ?? []) as unknown as PromoRow[]}
```
to:
```tsx
      promos={promosActive as unknown as PromoRow[]}
```

- [ ] **Step 2: Extend the client PromoRow to carry validity**

In `src/app/kasir/KasirClient.tsx`, the current type alias is `export type PromoRow = Promo;` (where `Promo` is imported from `@/lib/pos-calc`). Replace it with an extended shape so the modal can show validity:
```ts
export type PromoRow = Promo & { valid_from?: string | null; valid_until?: string | null };
```
(`matchPromos` only reads `id`/`name`/`promo_type`/`rule`, so the extra optional fields are inert for the existing Reminder popup.)

- [ ] **Step 3: Add modal state + button + modal markup**

In `KasirClient.tsx`, add state near the other `useState` hooks (e.g. after `const [dismissedAtCartLen, setDismissedAtCartLen] = useState<number | null>(null);`):
```ts
  const [showPromoList, setShowPromoList] = useState(false);
```

In the DAFTAR PRODUK header, the block currently reads:
```tsx
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--posb)", letterSpacing: ".03em" }}>DAFTAR PRODUK</span>
            <span style={{ fontSize: 9.5, color: "var(--td)" }}>{branchName}</span>
```
Insert a button right after the branchName span:
```tsx
            <span style={{ fontSize: 9.5, color: "var(--td)" }}>{branchName}</span>
            <button type="button" onClick={() => setShowPromoList(true)}
              className="btn-def" style={{ padding: "4px 11px", fontSize: 10.5, display: "inline-flex", alignItems: "center", gap: 5, borderColor: "var(--posb)", color: "var(--posb)" }}>
              <i className="ti ti-speakerphone" /> Promo Hari Ini
              {promos.length > 0 && (
                <span style={{ background: "var(--posb)", color: "#fff", borderRadius: 999, fontSize: 9, fontWeight: 700, padding: "1px 6px" }}>{promos.length}</span>
              )}
            </button>
```

Add the modal near the end of the component, just before the closing `</>` (alongside the existing Reminder Promo overlay):
```tsx
      {/* Daftar Promo Hari Ini — referensi kasir (read-only), diset dari pusat per cabang. */}
      {showPromoList && (
        <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
          onClick={() => setShowPromoList(false)}>
          <div style={{ width: 460, maxHeight: "80vh", overflowY: "auto", background: "#fff", borderRadius: 12, overflow: "hidden" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ background: "var(--posb)", color: "#fff", padding: "11px 14px", display: "flex", alignItems: "center", gap: 8 }}>
              <i className="ti ti-speakerphone" />
              <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>Promo Hari Ini · {branchName}</span>
              <i className="ti ti-x" style={{ cursor: "pointer" }} onClick={() => setShowPromoList(false)} />
            </div>
            <div style={{ padding: "12px 14px" }}>
              {promos.length === 0 ? (
                <div style={{ fontSize: 11.5, color: "var(--td)", textAlign: "center", padding: "16px 0" }}>Tidak ada promo aktif hari ini untuk cabang ini.</div>
              ) : (
                promos.map((p) => (
                  <div key={p.id} style={{ padding: "9px 0", borderBottom: ".5px dashed var(--bd)" }}>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>
                      <i className={`ti ${p.promo_type === "bundling" ? "ti-gift" : p.promo_type === "tebus_murah" ? "ti-tag" : "ti-discount-2"}`} style={{ marginRight: 5, color: "var(--posb)" }} />
                      {p.name}
                    </div>
                    {p.rule?.suggest && <div style={{ fontSize: 11, color: "var(--tm)", marginTop: 2 }}>{p.rule.suggest}</div>}
                    <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
                      {p.rule?.discount_value != null && <span>Diskon {p.rule.discount_value}{p.rule.discount_type === "percent" ? "%" : " Rp"} · </span>}
                      Berlaku {p.valid_from ?? "—"} s/d {p.valid_until ?? "∞"}
                    </div>
                  </div>
                ))
              )}
              <div style={{ fontSize: 9, color: "var(--td)", marginTop: 10 }}>
                Diset dari pusat untuk cabang ini. Tawarkan ke customer — terapkan manual via potongan item / diskon.
              </div>
            </div>
          </div>
        </div>
      )}
    </>
```

- [ ] **Step 4: Typecheck + tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: `No errors found`; all tests PASS (promo tests included).

- [ ] **Step 5: Commit**

```bash
git add src/app/kasir/page.tsx src/app/kasir/KasirClient.tsx
git commit -m "feat(promo): kasir Promo Hari Ini button + modal, filtered branch+today

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: End-to-end verification + build

**Files:** none (verification only).

- [ ] **Step 1: Production build**

Run: `npm run build`
Expected: compiles successfully, `/crm/promo` in the route list, no lint/type errors.

- [ ] **Step 2: Manual browser check (preview tools)**

1. As `owner@vetos.local` / `password123`: open `/crm/promo`. Create a promo — name "Test Cabang X", suggest text, pick ONE branch that is NOT the Kasir demo branch, valid_from today, valid_until today. Confirm it lands in the list with status "Aktif hari ini".
2. Create a second promo scoped to the Kasir demo branch (the branch of Siti / staff@vetos.local), valid today. Confirm listed.
3. As `staff@vetos.local` / `password123`: open `/kasir`. Click "Promo Hari Ini". Confirm the modal shows the branch-scoped promo #2 AND the all-branch seeded promos, but NOT promo #1 (other branch). Screenshot as proof.
4. Confirm the header button badge count equals the number of rows in the modal.

- [ ] **Step 3: Clean up test data**

Via supabase MCP `execute_sql`, delete the two promos created during the manual check (`delete from promos where name in ('Test Cabang X', '<name of promo #2>')`), leaving the migration's seeded demo promos intact.

- [ ] **Step 4: No commit** (verification only).

---

## Self-Review Notes
- Spec (a) schema → Task 2. (b) predicate → Task 1. (c) admin `/crm/promo` + nav tile → Task 3. (d) kasir button/modal + branch+today filter → Task 4. Manual verify covers cross-branch + expiry exclusion → Task 5.
- Type consistency: `PromoRow` in `src/lib/promo.ts` (full shape with branch_ids/valid_from/valid_until) is used by the admin page (Task 3) and the kasir page filter (Task 4, imported as `PromoFull`). `KasirClient`'s own `PromoRow` is `Promo & { valid_from?, valid_until? }` — deliberately a lighter client shape; the page casts the filtered full rows to it (extra fields are compatible, missing `is_active`/`branch_ids` are unused client-side). `promoActiveFor(p, branchId, today)` and `promoScheduleStatus(p, today)` signatures match across Tasks 1/3/4.
- WIB (UTC+7) today string used consistently (admin default date, kasir filter) matching the rest of the app.
- `promoActiveFor` is the only "active today for branch" implementation; admin uses `promoScheduleStatus` for display only, kasir filter uses `promoActiveFor`. No duplication of the rule.
- No new RLS — `promos_all` prototype policy already permits authenticated read/write; admin actions add the role gate in app code (consistent with `/pos/quest`).
