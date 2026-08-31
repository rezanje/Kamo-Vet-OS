# Alert Operasional and Production Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menampilkan alert operasional merah/kuning yang dapat direproduksi dari KPI/detail, menyediakan pengaturan ambang per perusahaan/cabang, dan menyiapkan rollout produksi bertahap dengan gate rekonsiliasi.

**Architecture:** Setting tersimpan per rule dan optional branch override. Alert dihitung on-read oleh collector dashboard dari metric source yang sama; fase ini tidak menyimpan event/acknowledgement dan tidak mengirim notifikasi eksternal. Rollout memakai checklist evidence serta feature flag untuk membuka dashboard/alert per role.

**Tech Stack:** Next.js App Router 15, React 19, TypeScript, Supabase/Postgres RLS, Vitest.

---

### Task 1: Alert rule contracts and settings schema

**Files:**
- Create: `supabase/migrations/20260831234000_operational_alert_settings.sql`
- Create: `src/lib/operational-alerts.ts`
- Create: `src/lib/__tests__/operational-alerts.test.ts`

- [ ] **Step 1: Write failing tests for override resolution and defaults**

```ts
import { describe, expect, it } from "vitest";
import { defaultAlertSettings, resolveAlertSetting } from "../operational-alerts";

it("branch override menang atas setting perusahaan", () => {
  const settings = [
    { ruleKey: "sales_below_target", branchId: null, threshold: 80, periodDays: 30, active: true, severity: "red" as const },
    { ruleKey: "sales_below_target", branchId: "b1", threshold: 75, periodDays: 30, active: true, severity: "yellow" as const },
  ];
  expect(resolveAlertSetting(settings, "sales_below_target", "b1")?.threshold).toBe(75);
});

it("hanya lima rule client yang aktif otomatis", () => {
  expect(defaultAlertSettings().filter((s) => s.active).map((s) => s.ruleKey).sort()).toEqual([
    "expired_or_near_expiry", "negative_stock", "sales_below_target", "sales_drop", "stock_opname_variance",
  ]);
});
```

- [ ] **Step 2: Run test and verify missing-module failure**

Run: `npm test -- src/lib/__tests__/operational-alerts.test.ts`

Expected: FAIL with missing module.

- [ ] **Step 3: Implement rule types and defaults**

```ts
export type AlertRuleKey =
  | "sales_below_target" | "stock_opname_variance" | "expired_or_near_expiry"
  | "sales_drop" | "negative_stock" | "manual_discount_limit"
  | "void_limit" | "fast_moving_out_of_stock" | "no_show_limit" | "staff_productivity";
export type AlertSeverity = "red" | "yellow";
export type AlertSetting = {
  ruleKey: AlertRuleKey; branchId: string | null; threshold: number | null;
  periodDays: number | null; active: boolean; severity: AlertSeverity;
};
export type OperationalAlert = {
  ruleKey: AlertRuleKey; branchId: string; branchName: string; severity: AlertSeverity;
  actual: number; threshold: number; periodLabel: string; label: string; detailUrl: string;
};
```

Defaults:

- sales below target: active, red, threshold 80 percent;
- stock opname variance: active, red, Rp500,000;
- expiry: active, red, 30 days;
- sales drop: active, yellow, 10 percent;
- negative stock: active, red, threshold 0;
- remaining rules: inactive, threshold null, prescribed severity from design.

- [ ] **Step 4: Add schema and RLS**

```sql
create table operational_alert_settings (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null check (rule_key in (
    'sales_below_target','stock_opname_variance','expired_or_near_expiry',
    'sales_drop','negative_stock','manual_discount_limit','void_limit',
    'fast_moving_out_of_stock','no_show_limit','staff_productivity'
  )),
  branch_id uuid references branches(id) on delete cascade,
  threshold numeric,
  period_days int check (period_days is null or period_days > 0),
  active boolean not null default false,
  severity text not null check (severity in ('red','yellow')),
  created_by uuid references profiles(id),
  updated_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index operational_alert_company_rule
  on operational_alert_settings(rule_key) where branch_id is null;
create unique index operational_alert_branch_rule
  on operational_alert_settings(rule_key, branch_id) where branch_id is not null;

alter table operational_alert_settings enable row level security;
create policy operational_alert_settings_read on operational_alert_settings
  for select to authenticated
  using (branch_id is null or public.user_can_access_branch(branch_id));
create policy operational_alert_settings_write on operational_alert_settings
  for all to authenticated
  using (public.is_admin() and (branch_id is null or public.user_can_access_branch(branch_id)))
  with check (public.is_admin() and (branch_id is null or public.user_can_access_branch(branch_id)));
```

Seed company defaults after indexes:

```sql
insert into operational_alert_settings
  (rule_key, branch_id, threshold, period_days, active, severity)
values
  ('sales_below_target', null, 80, 30, true, 'red'),
  ('stock_opname_variance', null, 500000, 1, true, 'red'),
  ('expired_or_near_expiry', null, 30, 30, true, 'red'),
  ('sales_drop', null, 10, 30, true, 'yellow'),
  ('negative_stock', null, 0, 1, true, 'red'),
  ('manual_discount_limit', null, null, 30, false, 'red'),
  ('void_limit', null, null, 30, false, 'red'),
  ('fast_moving_out_of_stock', null, null, 1, false, 'red'),
  ('no_show_limit', null, null, 30, false, 'red'),
  ('staff_productivity', null, null, 30, false, 'yellow')
on conflict (rule_key) where branch_id is null do nothing;
```

- [ ] **Step 5: Verify and commit**

Run: `supabase db reset && npm test -- src/lib/__tests__/operational-alerts.test.ts`

Expected: migration succeeds; tests PASS.

```bash
git add supabase/migrations/20260831234000_operational_alert_settings.sql src/lib/operational-alerts.ts src/lib/__tests__/operational-alerts.test.ts
git commit -m "feat: add operational alert rules"
```

### Task 2: Alert evaluation from shared metrics

**Files:**
- Modify: `src/lib/operational-alerts.ts`
- Modify: `src/lib/__tests__/operational-alerts.test.ts`
- Create: `src/lib/operational-alerts-server.ts`
- Create: `src/lib/__tests__/operational-alerts-server.test.ts`

- [ ] **Step 1: Add failing rule tests**

Test boundary semantics exactly:

- sales achievement `79.99 < 80` fires, `80` does not;
- absolute completed-opname value variance `500001 > 500000` fires;
- any positive expiry stock with `daysToExpiry <= 30` fires;
- growth `-10.01 < -10` fires, `-10` does not;
- stock qty `< 0` fires;
- inactive/null-threshold rule never fires;
- missing source returns no alert plus missing-source diagnostic, not healthy zero.

- [ ] **Step 2: Implement pure evaluator**

```ts
export type AlertMetric = {
  ruleKey: AlertRuleKey; branchId: string; branchName: string;
  status: "ready" | "missing"; actual?: number; periodLabel: string; detailUrl: string;
};
export type AlertEvaluation = { alerts: OperationalAlert[]; missing: { ruleKey: AlertRuleKey; reason: string }[] };
```

`evaluateAlerts(metrics, settings)` resolves branch override, ignores inactive/null threshold, applies strict comparisons above, and sorts red before yellow then branch/rule.

- [ ] **Step 3: Build server metric adapters**

`operational-alerts-server.ts` calls shared dashboard collectors; it must not reimplement sales target, growth, fast-moving, no-show, or productivity formulas. Direct sources allowed only for:

- completed stock opname variance using latest completed opname per branch/item and layer HPP at assessment;
- negative `stock.qty`;
- open `stock_layers.qty_left > 0` and `exp_date`.

Manual discount must exclude promo/voucher/points/category discounts. Void must use auditable void status/log only. If schema cannot distinguish these safely, corresponding rule metric returns missing and remains inactive.

- [ ] **Step 4: Add server tests for branch scope and missing data**

Fake-client tests assert every direct query is restricted to scoped warehouses/branches. A foreign branch request must fail before fetching metric rows. Query errors return correlation ID; do not log customer/medical payloads.

- [ ] **Step 5: Test and commit**

Run: `npm test -- src/lib/__tests__/operational-alerts.test.ts src/lib/__tests__/operational-alerts-server.test.ts src/lib/__tests__/operation-sales.test.ts`

Expected: PASS.

```bash
git add src/lib/operational-alerts.ts src/lib/operational-alerts-server.ts src/lib/__tests__/operational-alerts.test.ts src/lib/__tests__/operational-alerts-server.test.ts
git commit -m "feat: evaluate operational alerts from shared metrics"
```

### Task 3: OWNER/ADMIN alert settings page

**Files:**
- Create: `src/app/(app)/pengaturan/alert-operasional/page.tsx`
- Create: `src/app/(app)/pengaturan/alert-operasional/actions.ts`
- Create: `src/app/(app)/pengaturan/alert-operasional/AlertSettingsForm.tsx`
- Modify: `src/lib/nav.ts`

- [ ] **Step 1: Implement guarded server actions**

`saveAlertSetting` calls `assertMasterAdmin`, validates rule key, branch access, finite nonnegative threshold, positive period days, and severity. Upsert company key when branch null or branch key when present. Always set `updated_by=auth.uid()` and `updated_at=now()` server-side.

- [ ] **Step 2: Build settings UI**

Show one row per rule with company setting and optional branch override. Inactive rules expose threshold but emit no alert until toggled. Labels include unit (`%`, `Rp`, `hari`, `jumlah`) to prevent scale ambiguity.

- [ ] **Step 3: Add role-scoped navigation**

Add `Alert Operasional` under Pengaturan for OWNER/ADMIN. Direct URL access must still enforce role server-side.

- [ ] **Step 4: Verify and commit**

Run: `npm run lint && npm run build`

Expected: exit 0.

```bash
git add src/app/(app)/pengaturan/alert-operasional src/lib/nav.ts
git commit -m "feat: manage operational alert thresholds"
```

### Task 4: Dashboard alert panel and drill-down

**Files:**
- Create: `src/app/(app)/laporan/operasional-penjualan/OperationalAlertPanel.tsx`
- Modify: `src/app/(app)/laporan/operasional-penjualan/page.tsx`
- Modify: `src/app/(app)/laporan/operasional-penjualan/OperationSalesDashboard.tsx`
- Modify: `src/lib/__tests__/operational-alerts.test.ts`

- [ ] **Step 1: Add failing URL tests**

Test detail URLs preserve dashboard `from`, `to`, and branch while targeting actual existing route. Invalid/external URLs are rejected and rendered without link.

- [ ] **Step 2: Load alert block independently**

Server page calls alert collector in separate settled promise. Alert failure shows correlation ID; dashboard KPI blocks stay usable.

- [ ] **Step 3: Render actionable alert cards**

Each card shows severity, branch, rule label, actual, threshold, period, and detail link. Red sorts before yellow. Missing-source diagnostics appear only to OWNER/ADMIN as `Data alert belum lengkap`, never as green/normal state.

- [ ] **Step 4: Verify and commit**

Run: `npm test -- src/lib/__tests__/operational-alerts.test.ts src/lib/__tests__/operational-alerts-server.test.ts && npm run lint && npm run build`

Expected: all exit 0.

```bash
git add src/app/(app)/laporan/operasional-penjualan src/lib/__tests__/operational-alerts.test.ts
git commit -m "feat: show operational alerts on dashboard"
```

### Task 5: Rollout controls and runbook

**Files:**
- Create: `docs/runbooks/2026-08-31-operation-sales-production-rollout.md`
- Modify: `docs/PAPAN-KERJA.md`

- [ ] **Step 1: Write evidence-based runbook**

Runbook must contain these gates with evidence field and signer:

1. Data readiness: all five Accurate master exports, component file, initial stock file, sales targets, capacity, employee links.
2. Pilot master: preview count/reject count reconciled.
3. Pilot stock one warehouse: source qty/value = stock/layer/move qty/value.
4. Dashboard: source-report reconciliation delta rules pass.
5. Operations: booking/timestamp/provider/capacity/referral smoke pass.
6. Alerts: every enabled alert reproducible from detail.
7. RLS: positive and negative branch tests pass.
8. Production decision: OWNER/ADMIN sign-off and timestamp.

No checkbox may be marked complete without command/query/screenshot reference.

- [ ] **Step 2: Define rollback correctly**

Code/dashboard rollback: redeploy prior production commit. Configuration rollback: deactivate rules. Posted opening stock is never deleted; correction uses Penyesuaian Persediaan referencing import run ID. Document this verbatim.

- [ ] **Step 3: Run complete automated verification**

Run: `npm test && npm run lint && npm run build && supabase db reset`

Expected: all exit 0.

- [ ] **Step 4: Execute browser and security matrix**

Run: `npm run dev`

Test OWNER, ADMIN, and branch-only user; company and branch thresholds; all five default alert triggers; one inactive alert; missing-source state; filtered drill-down. Capture evidence in runbook.

- [ ] **Step 5: Commit runbook evidence**

```bash
git add docs/runbooks/2026-08-31-operation-sales-production-rollout.md docs/PAPAN-KERJA.md
git commit -m "docs: add operation sales rollout gates"
```

### Task 6: Production go/no-go

**Files:**
- Modify: `docs/runbooks/2026-08-31-operation-sales-production-rollout.md`

- [ ] **Step 1: Stop on missing external data**

If remaining Accurate exports, opening stock, group components, targets, capacity, or employee links are missing, mark relevant gate `BLOCKED BY DATA`. Do not synthesize values and do not claim production-ready.

- [ ] **Step 2: Pilot one branch/warehouse**

Use preview, require human confirmation of warehouse/as-of date, post once, then run four-way reconciliation. Continue only with zero deltas.

- [ ] **Step 3: OWNER/ADMIN dashboard preview**

Keep dashboard limited to OWNER/ADMIN until report reconciliation and RLS matrix pass. Enable default alert rules only after actual/threshold/detail reproduction is signed.

- [ ] **Step 4: Record decision**

Write `GO` only when all gates pass. Otherwise write `NO-GO`, failed gate, evidence, remediation owner, and next review date.

- [ ] **Step 5: Commit final decision separately**

```bash
git add docs/runbooks/2026-08-31-operation-sales-production-rollout.md
git commit -m "docs: record operation sales go no-go"
```
