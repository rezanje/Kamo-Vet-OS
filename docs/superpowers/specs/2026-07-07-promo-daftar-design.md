# Daftar Promo (per cabang, per hari) — Design

## Goal
Pusat (OWNER/ADMIN) sets promos targeting specific branches and date ranges. A kasir sees a **"Promo Hari Ini"** button in the DAFTAR PRODUK header that opens a read-only list of promos active today for their branch. The existing Reminder Promo popup is scoped the same way.

## Context
- `promos` table (migration 0027) has `name`, `promo_type` (`bundling`/`tebus_murah`/`diskon_produk`), `rule jsonb` (`suggest`, `discount_type`, `discount_value`, `min_qty`, `min_subtotal`, `trigger_item_ids`), `is_active`. **No branch targeting, no date validity.**
- No promo admin page exists. CRM nav tile "Promo" (`src/lib/nav.ts`) has no `href` — dead tile.
- Kasir already fetches promos in `src/app/kasir/page.tsx` and matches them in `KasirClient.tsx` (`matchPromos` → Reminder Promo popup). `src/lib/pos-calc.ts` holds `matchPromos` + `Promo` type.

## Architecture

### a) Schema — migration `0035_promo_branch_schedule.sql`
```sql
alter table promos
  add column branch_ids uuid[],      -- null/empty = semua cabang; else array of branch ids
  add column valid_from date,        -- null = tanpa batas awal
  add column valid_until date;       -- null = tanpa batas akhir
```
No new RLS — existing `promos_all` (relaxed, prototype) covers it. Seed: update the two existing demo promos with `valid_from = today`, `valid_until = today + 30`, `branch_ids = null` (all branches) so the kasir list is non-empty; add one branch-specific demo promo tied to the Kasir demo branch.

### b) Pure predicate — `src/lib/promo.ts`
```ts
export type PromoRow = {
  id: string; name: string; promo_type: string; rule: PromoRule;
  is_active: boolean; branch_ids: string[] | null; valid_from: string | null; valid_until: string | null;
};
export function promoActiveFor(p: PromoRow, branchId: string, today: string): boolean;
// is_active && (branch_ids null/empty || branchId in branch_ids)
//   && (valid_from null || today >= valid_from) && (valid_until null || today <= valid_until)
export function promoScheduleStatus(p: PromoRow, today: string): "aktif" | "terjadwal" | "kadaluarsa" | "nonaktif";
// nonaktif if !is_active; kadaluarsa if valid_until < today; terjadwal if valid_from > today; else aktif
```
Unit-tested (`src/lib/__tests__/promo.test.ts`): branch match/all/miss, date bounds (before/within/after/unbounded), schedule status buckets.

### c) Admin pusat — `/crm/promo`
- Wire the dead CRM "Promo" tile → `href: "/crm/promo"`.
- Page `src/app/(app)/crm/promo/page.tsx` + `actions.ts`. Role gate OWNER/ADMIN (mirror `/pos/quest` admin: a `requireManager()` helper redirecting non-managers).
- **Create form** (server action `createPromo`): nama, promo_type (select), suggest text (`rule.suggest`), optional discount (`rule.discount_type` percent/nominal + `rule.discount_value`), optional `min_qty` / `min_subtotal`, cabang (multi-select checkboxes; none checked = semua cabang → `branch_ids = null`), valid_from, valid_until. Assembles `rule` jsonb + `branch_ids` array.
- **List**: all promos with columns nama, tipe, cabang (names or "Semua"), berlaku (from–until), status badge via `promoScheduleStatus`, toggle aktif (server action `togglePromo`).
- Follows existing admin CRUD pattern from `src/app/(app)/pos/quest/page.tsx` + `actions.ts`.

### d) Kasir — "Promo Hari Ini" button + modal
- In `KasirClient.tsx`, DAFTAR PRODUK header (next to the `B2C`/branch label), add a button **"Promo Hari Ini"** with a count badge of active promos.
- Client state `showPromoList` toggles a modal (non-blocking overlay, reuse the Reminder-Promo visual style) listing today's active promos for the shift branch: name, type icon, `rule.suggest`, discount summary, validity dates. Read-only.
- `src/app/kasir/page.tsx` fetches promos with the new columns and passes `branchId` (shift branch) + `today` (WIB date). Filter to active promos via `promoActiveFor` for both the new list and the existing Reminder popup (currently `matchPromos` runs on all fetched promos — now pre-filter the fetched set to branch+today so both surfaces agree).

## Files
- Create: `supabase/migrations/0035_promo_branch_schedule.sql`
- Create: `src/lib/promo.ts`, `src/lib/__tests__/promo.test.ts`
- Create: `src/app/(app)/crm/promo/page.tsx`, `src/app/(app)/crm/promo/actions.ts`
- Modify: `src/lib/nav.ts` (CRM Promo tile href)
- Modify: `src/app/kasir/page.tsx` (fetch new columns, pre-filter branch+today, pass to client)
- Modify: `src/app/kasir/KasirClient.tsx` (button + modal; consume filtered promos)

## Non-goals
- No auto-apply of promos to the cart (stays a kasir reference / suggestion, consistent with existing Reminder Promo which is advisory only).
- No recurring day-of-week scheduling (date range only).
- No per-promo analytics/usage tracking.
- `promoActiveFor` is the single source of truth for "active today for this branch" — do not duplicate the logic inline.

## Testing
- `npm test` — `promoActiveFor` + `promoScheduleStatus` unit tests.
- Manual: as OWNER, open `/crm/promo`, create a branch-specific promo valid today; as `staff@vetos.local` open `/kasir`, click "Promo Hari Ini", confirm the promo appears; confirm a promo scoped to another branch does NOT appear; confirm an expired promo does NOT appear.
