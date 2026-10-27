# S04 — explicit ordinary commission policy for two saved service performers

Source: supplied checklist S04 (gid 831947777), including the 22 October addendum. The requirement is a saved source actor per service row, receipts showing the cashier and performer, and incentive evidence without manually assigning an entire line to one staff member. Existing PR126 provides saved performers, source receipts and single-actor commission. This branch extends only unresolved ordinary two-person commission; it does not change clinical or transaction posting.

An OWNER/ADMIN can append a dated policy for all branches or one branch. A branch policy takes precedence over the global policy; the latest effective date and creation time wins in a scope. The three explicit choices use **existing commission rules and rates**:

- `personal_rules`: pay each saved actor only through an active rule that names that employee. A global rule does not apply.
- `both_full`: run applicable existing rules for each saved actor using the full service basis. This can pay two full bases and is never the default.
- `split`: run applicable existing rules on the configured doctor/staff percentages of the saved basis. The two shares must total 100 with at most two decimals.

An explicit `pending` choice can supersede an earlier policy to pause two-person payout again without deleting history. It keeps the payroll block.

No policy or a malformed policy keeps the old pending behavior. A chosen policy without a matching active rule for every actor also stays pending; payroll calculation/finalization still stops. Ambiguous return source and DEMO fixed-pool snapshots remain pending/existing respectively. Explicit returns choose the policy by the original sale date, including an outside-period sale. One source row remains one branch revenue row; calculation-only actor rows drive commission and per-actor bases. The report labels the source revenue separately from overlapping individual bases. Existing posted transactions and finalized payroll slips are not rewritten.

The additive migration `20261026002000_service_commission_policy.sql` creates an append-only table. It grants SELECT to active authenticated profiles and INSERT only to active OWNER/ADMIN through RLS, with column-limited INSERT and no UPDATE/DELETE. No existing RLS policy, commission rule, role assignment or service RPC is modified. **Security-scope review/approval and target migration-history check are required before production application. This worker did not apply it to a target.** The app reader requires the migration first. No historical data backfill or policy row is inserted; an authorized operator must explicitly choose mode, date, optional branch and shares.

Dummy fixtures cover no policy, missing personal rule, personal/global separation, full basis, percentage split, branch override, negative return, invalid config, DEMO and uncertain return. Action validation tests cover invalid dates/shares and the server-owned audit fields. Disposable PostgreSQL 16 fixture covers grants, RLS, share constraint and immutable policy history. Field UAT and the actual business choice are deferred, so S04 should be marked **code-ready for configured two-person ordinary commission**, not fully operational by default.

## 2026-10-27 follow-up — continuation of PR #222 on latest main

Merged PR #222's four commits unchanged with main `4f07f12` (no conflicts). Only the existing configurable mechanism
(`personal_rules`, `both_full`, `split`, `pending`) was reviewed. Rates, dates, shares and defaults were not chosen,
and no policy row is seeded.

**Gap fixed — deploy order.** The commission page and payroll read `service_commission_policies` directly. If this code
reached Production before the separately approved migration, the page and every payroll calculation would fail, not
only rows with two performers. `muatKebijakanKomisiJasa` now treats only "table not found" (`PGRST205` / `42P01`) as
"no saved policy". Two-performer rows then stay pending and `assertServiceAttributionReady` still blocks payroll,
while single-performer rows calculate as before. Every other read failure (permission, JWT, incomplete page) stays
fatal. The page states that policy storage is not installed and hides the form; the action shows a plain message
instead of a raw database error.

**Test repair.** The commission page test mock predated PR #222's reads: it had no policy loader, no `baris`, and no
policy action. Two tests failed once #222 met main, before any change here. The mocks now match.

Synthetic tests added:
- table missing (both codes): pending two-performer row, payroll blocked; single-performer rows still pay; with no
  two-performer rows payroll is not blocked.
- any other read error: fatal.
- stored numeric shares mapped.
- policies after the period end excluded.
- page shows the not-installed state and hides the form.
- action shows a plain message for a missing table.

Disposable PostgreSQL 16.15 and 17.6 runs of `scripts/test-service-commission-policy-postgres.py` pass (append-only,
OWNER/ADMIN insert, active-profile read, no anonymous/edit access, share validation).

**Migration, unchanged and not applied:** `20261026002000_service_commission_policy.sql`.
- Blast radius: one new table `public.service_commission_policies` plus one index. No change to existing tables,
  functions, RLS policies, roles, commission rules, sales or invoices.
- Permissions it creates:
  - `revoke all` from public/anon/authenticated/service_role;
  - `SELECT` to authenticated, through RLS limited to active profiles;
  - `INSERT` on 5 columns only (branch, date, mode, two shares) to authenticated, through RLS limited to active
    OWNER/ADMIN with `created_by = auth.uid()`;
  - no UPDATE/DELETE grant (append-only); `force row level security`.
- Its version is older than migrations already applied in Production, so it must be applied deliberately out of
  order with a migration-history check.
- It needs its own exact approval and release slot.
