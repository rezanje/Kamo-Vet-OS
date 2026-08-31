# Dashboard Operation & Sales Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menyediakan cockpit `/laporan/operasional-penjualan` yang menyatukan KPI sales, cabang, customer, stok, purchasing, dan klinik dengan definisi teruji serta drill-down ke laporan existing.

**Architecture:** Pure metric layer menghitung DTO teragregasi dari baris server. Collector server menerapkan periode, kanal, dan branch scope sebelum data dibaca. Halaman server memuat blok independen; blok gagal menampilkan correlation ID tanpa mengubah kegagalan menjadi angka nol.

**Tech Stack:** Next.js App Router 15, React 19, TypeScript, Supabase/Postgres RLS, Vitest.

---

### Task 1: Filter period and shared sales metric contracts

**Files:**
- Create: `src/lib/operation-sales.ts`
- Create: `src/lib/__tests__/operation-sales.test.ts`

- [ ] **Step 1: Read current query sources and installed Next.js docs**

Read completely before editing:

```bash
sed -n '1,260p' src/lib/laporan-transaksi.ts
sed -n '1,260p' src/lib/laporan-transaksi-server.ts
sed -n '1,260p' src/lib/komisi-data.ts
rg --files node_modules/next/dist/docs | rg 'data-fetching|caching|page' | head -20
```

- [ ] **Step 2: Write failing tests for period comparison and formulas**

```ts
import { describe, expect, it } from "vitest";
import { buildPeriod, salesMetrics } from "../operation-sales";

it("MTD membandingkan hari setara bulan sebelumnya", () => {
  expect(buildPeriod({ preset: "mtd", now: "2026-08-31" })).toEqual({
    from: "2026-08-01", to: "2026-08-31",
    previousFrom: "2026-07-01", previousTo: "2026-07-31",
  });
});

it("menghitung net sales, transaksi, ATV, UPT, dan margin dari transaksi valid", () => {
  const result = salesMetrics([
    { saleId: "s1", qty: 2, net: 100_000, cost: 60_000, status: "paid" },
    { saleId: "s1", qty: 1, net: 50_000, cost: 20_000, status: "paid" },
    { saleId: "s2", qty: 1, net: 90_000, cost: 40_000, status: "void" },
  ]);
  expect(result).toEqual({ sales: 150_000, transactions: 1, units: 3, atv: 150_000, upt: 3, grossMargin: 70_000 });
});
```

- [ ] **Step 3: Run test and verify missing-module failure**

Run: `npm test -- src/lib/__tests__/operation-sales.test.ts`

Expected: FAIL with missing module.

- [ ] **Step 4: Implement typed filters and pure metrics**

```ts
export type Channel = "all" | "pos" | "online" | "reseller" | "klinik";
export type DashboardFilter = { from: string; to: string; branchIds: string[]; channel: Channel };
export type SalesMetricRow = {
  saleId: string; qty: number; net: number; cost: number; status: string;
};
export type SalesMetric = {
  sales: number; transactions: number; units: number; atv: number | null;
  upt: number | null; grossMargin: number;
};

export function salesMetrics(rows: SalesMetricRow[]): SalesMetric {
  const valid = rows.filter((r) => !["void", "batal", "cancelled"].includes(r.status.toLowerCase()));
  const transactions = new Set(valid.map((r) => r.saleId)).size;
  const sales = valid.reduce((n, r) => n + r.net, 0);
  const units = valid.reduce((n, r) => n + r.qty, 0);
  const cost = valid.reduce((n, r) => n + r.cost, 0);
  return {
    sales, transactions, units,
    atv: transactions ? sales / transactions : null,
    upt: transactions ? units / transactions : null,
    grossMargin: sales - cost,
  };
}
```

Implement `buildPeriod`, `growthPercent`, and `targetAchievement`. Growth returns `null` when comparison is unavailable or prior value is zero; target achievement returns `null` when no applicable target.

- [ ] **Step 5: Test and commit**

Run: `npm test -- src/lib/__tests__/operation-sales.test.ts`

Expected: PASS.

```bash
git add src/lib/operation-sales.ts src/lib/__tests__/operation-sales.test.ts
git commit -m "feat: define operation sales metrics"
```

### Task 2: Branch, customer, stock, and purchase metrics

**Files:**
- Modify: `src/lib/operation-sales.ts`
- Modify: `src/lib/__tests__/operation-sales.test.ts`

- [ ] **Step 1: Add failing tests for business definitions**

Cover exact rules:

- target: company target wins; otherwise sum branch targets only; never employee/category target;
- new customer: first valid transaction inside period;
- repeat customer: at least two lifetime valid transactions and one in period;
- active customer: last valid transaction within configured dormancy days;
- dormant: historical transaction but last one older than threshold;
- fast-moving: top `ceil(20% * sold SKU count)` by 90-day qty;
- slow-moving: positive stock and no sale during threshold;
- stock value: sum `qty_left * unit_cost` from open layers;
- coverage: available base qty / average daily usage 90 days; no usage gives `null`;
- outstanding PO: ordered base qty minus received base qty, floored at zero;
- supplier lead time: receipt date minus PO date; promised-delivery metric excluded.

- [ ] **Step 2: Implement pure functions with explicit DTOs**

Export:

```ts
export type MetricValue = { status: "ready"; value: number } | { status: "missing"; reason: string };
export type BranchPerformance = {
  branchId: string; branchName: string; sales: number; achievement: number | null;
  growth: number | null; transactions: number; atv: number | null;
  grossMargin: number; uniqueCustomers: number;
};
```

Implement `resolveSalesTarget`, `classifyCustomers`, `rankMovement`, `stockValue`, `stockCoverage`, `outstandingPoQty`, and `supplierPerformance`. All monetary calculations use numbers already normalized to rupiah; DB numeric parsing occurs at collector boundary.

- [ ] **Step 3: Run tests and commit**

Run: `npm test -- src/lib/__tests__/operation-sales.test.ts`

Expected: PASS.

```bash
git add src/lib/operation-sales.ts src/lib/__tests__/operation-sales.test.ts
git commit -m "feat: add operation dashboard business metrics"
```

### Task 3: Branch-scoped server collector

**Files:**
- Create: `src/lib/operation-sales-server.ts`
- Create: `src/lib/__tests__/operation-sales-server.test.ts`
- Modify: `src/lib/laporan-transaksi-server.ts`

- [ ] **Step 1: Write failing collector tests with fake Supabase client**

Tests must prove:

- requested foreign branch ID is rejected before query execution;
- date bounds and accessible branch IDs are present on each sales, stock, purchase, booking, visit, and referral query;
- collector returns aggregate DTO, not raw transaction/customer rows;
- one block query failure returns `{ status: "error", correlationId }` while other blocks remain ready.

- [ ] **Step 2: Implement access resolution first**

`resolveDashboardScope(supabase, requestedIds)` loads current profile and `user_branches`. OWNER/ADMIN/FINANCE may select all branches allowed by existing `user_can_access_branch`; other roles only explicit assignments. Unknown/foreign requested ID throws `Akses cabang ditolak`.

- [ ] **Step 3: Implement block collectors**

Create independent functions:

```ts
collectSalesBlock(scope, filter)
collectBranchBlock(scope, filter)
collectCustomerBlock(scope, filter, dormancyDays)
collectStockBlock(scope, filter)
collectPurchaseBlock(scope, filter)
collectClinicBlock(scope, filter)
```

Sales pulls valid `sales` and `sale_items`, preserving sale ID, base qty, net, FIFO cost, category type, channel, customer, and branch. Stock pulls `stock`, open `stock_layers`, expiry, minimum, and moves only for scoped warehouses. Purchase pulls PO, receipt, invoice, return, supplier, and due/payment fields. Clinic delegates to `operasional-klinik-server.ts`; if required schema/data is absent, return `missing`, not zero.

- [ ] **Step 4: Share existing transaction predicates**

Extract valid-status/date/channel predicates from `laporan-transaksi-server.ts` so dashboard and detail reports call same helper. Do not copy status lists into two server files.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- src/lib/__tests__/operation-sales.test.ts src/lib/__tests__/operation-sales-server.test.ts src/lib/__tests__/laporan-transaksi.test.ts`

Expected: PASS.

```bash
git add src/lib/operation-sales-server.ts src/lib/__tests__/operation-sales-server.test.ts src/lib/laporan-transaksi-server.ts
git commit -m "feat: collect branch scoped operation metrics"
```

### Task 4: Dashboard shell, filters, and Sales/Branch blocks

**Files:**
- Create: `src/app/(app)/laporan/operasional-penjualan/page.tsx`
- Create: `src/app/(app)/laporan/operasional-penjualan/OperationSalesDashboard.tsx`
- Create: `src/app/(app)/laporan/operasional-penjualan/dashboard-ui.tsx`
- Modify: `src/lib/nav.ts`

- [ ] **Step 1: Build server page with validated search params**

Accept `preset`, `from`, `to`, `branch`, and `channel`. Normalize invalid dates/channel to MTD/all. Reject ranges over 366 days. Fetch blocks with `Promise.allSettled`; do not cache user-scoped results globally.

- [ ] **Step 2: Build reusable states**

`dashboard-ui.tsx` exports KPI card, metric table, `Data belum tersedia`, block error with correlation ID, and drill-down link builder. Every value distinguishes ready, missing, and error.

- [ ] **Step 3: Render Sales and Branch Performance**

Sales cards: Today/period, vs target, growth, transactions, ATV, UPT, gross margin, split product/service/clinic. Ranking columns: sales, target achievement, growth, transaction, ATV, margin, unique customers. No target renders `Target belum diisi`.

- [ ] **Step 4: Preserve drill-down filters**

Map cards to existing routes:

- sales/transaction/ATV/UPT → `/laporan/penjualan-rinci`;
- branch ranking → `/laporan/transaksi-cabang`;
- salespeople → `/laporan/penjual`;
- clinic split → `/laporan/rekap-klinik`.

Append supported `from`, `to`, and `branch` query parameters only.

- [ ] **Step 5: Add navigation and verify**

Add first tile under `laporan`: `Operation & Sales`, route `/laporan/operasional-penjualan`.

Run: `npm run lint && npm run build`

Expected: exit 0 and static type validation passes.

- [ ] **Step 6: Commit**

```bash
git add src/app/(app)/laporan/operasional-penjualan src/lib/nav.ts
git commit -m "feat: add operation sales dashboard shell"
```

### Task 5: Customer, Stock, Purchasing, and Clinic blocks

**Files:**
- Modify: `src/app/(app)/laporan/operasional-penjualan/OperationSalesDashboard.tsx`
- Modify: `src/app/(app)/laporan/operasional-penjualan/dashboard-ui.tsx`
- Modify: `src/lib/operation-sales-server.ts`
- Modify: `src/lib/__tests__/operation-sales-server.test.ts`

- [ ] **Step 1: Render Customer block**

Show new, repeat, active, dormant, spending, frequency, and species segments. Link acquisition to `/laporan/akuisisi`, retention to `/laporan/retensi`, and spending to `/laporan/pelanggan-teratas`.

- [ ] **Step 2: Render Stock & Operation block**

Show stock value, fast/slow moving, near expiry, expired, and transfer log. Link minimum to existing stock-minimum route discovered from `src/lib/nav.ts`, expiry to existing expiry monitor, and moves to existing kartu-stok/mutasi route. Do not invent a detail URL; disable link if none exists.

- [ ] **Step 3: Render Purchasing block**

Show purchase MTD/period, outstanding PO, coverage, low stock, suggested purchase, purchase vs sales, supplier performance, price, AP aging, and lead time. Unavailable promised-delivery metric is absent with explanatory note.

- [ ] **Step 4: Render Clinic block**

Show booked/walk-in/no-show, revenue per doctor/provider, follow-up compliance, wait, duration, occupancy, and referral. Historical nulls stay `Data belum tersedia`; partial coverage includes numerator/denominator or sample count.

- [ ] **Step 5: Test and commit**

Run: `npm test -- src/lib/__tests__/operation-sales.test.ts src/lib/__tests__/operation-sales-server.test.ts && npm run lint && npm run build`

Expected: all exit 0.

```bash
git add src/app/(app)/laporan/operasional-penjualan src/lib/operation-sales-server.ts src/lib/__tests__/operation-sales-server.test.ts
git commit -m "feat: complete operation sales dashboard blocks"
```

### Task 6: Reconciliation, performance, and acceptance

**Files:**
- Modify: `docs/PAPAN-KERJA.md`

- [ ] **Step 1: Run full automated suite**

Run: `npm test && npm run lint && npm run build`

Expected: all exit 0.

- [ ] **Step 2: Reconcile source reports**

For one branch and one seven-day period, compare dashboard against:

- Penjualan Rinci: net sales, transaction, qty;
- Transaksi per Cabang: branch sales and customer;
- Laporan HPP: FIFO cost and margin;
- Pembelian: purchase and supplier;
- Stock/Kartu/Expiry: qty, layer value, expiry;
- Rekap Klinik: visit/revenue.

Record expected, actual, delta, and source URL. Required delta: rupiah/qty/count exactly zero; percentage may differ at most 0.01 percentage point due to display rounding.

- [ ] **Step 3: Verify RLS negative case**

Branch-only user selects another branch via URL query. Expected: access error or ignored foreign ID; no foreign aggregate, name, or count appears.

- [ ] **Step 4: Measure target path**

Open MTD one branch using production-like data and capture server duration. Target under five seconds. If over target, run `EXPLAIN (ANALYZE, BUFFERS)` for slow query and add only evidence-backed indexes; do not add materialized view in this phase.

- [ ] **Step 5: Browser smoke and commit evidence**

Run: `npm run dev`

Test presets, custom dates, branch, channel, empty state, one forced block error, and drill-down filter preservation.

```bash
git add docs/PAPAN-KERJA.md
git commit -m "docs: verify operation sales dashboard"
```
