# Wholesale invoice corrections implementation plan

**Goal:** Implement the approved OWNER correction/cancellation of B2B invoice recording while preserving deliveries and receipts.
**Architecture:** A uniquely named wholesale migration adds atomic correction/receipt RPCs, revision checks, durable request results, linked replacement invoices and customer-credit audit. Physical delivery snapshots and FIFO are never reversed by invoice correction. Existing sales posting must count only active invoice allocations after cancellation/replacement.
**Tech stack:** PostgreSQL/Supabase, Next server actions, existing CorrectionTransactionForm, Vitest.
**Spec:** User ACC delegated 2026-10-21; latest main d6d9c70, PR62 still excludes remaining B2B work. Execute inline in isolated Cloud branch.

## Constraints
- OWNER only for correction; preserve current OWNER/ADMIN/FINANCE receipt permission and branch/module gates.
- No production DB changes, deployment, merge, reset, force push, credential changes or external money movement.
- Prices, due date and notes may be replaced; item/unit/qty/delivery changes require delivery reconciliation/physical return outside this task.
- Original invoices, allocations, payment receipts and journals remain; correction appends reversal/replacement and audit.
- Overpayment becomes explicit non-spendable customer credit in liability account 2103; cash and advance usage stay unchanged.
- Standalone advances, returns, assets, payroll and inventory corrections remain outside scope.

## Review focus
- Correction/payment races must serialize on order then invoice; same-key retry returns original result.
- Legacy source journal/allocation/payment evidence must reconcile, otherwise block with actionable reason.
- Delivery counters/HPP must reconcile; correction cannot create stock from invoice quantities.
- Closed periods, bank reconciliation and existing payroll dependencies must block unsafe changes.
- All AR readers must include carried payments; subsidiary AR needs dated reversal/credit movements.

## Tasks
- [x] Add PostgreSQL tests for unpaid/part-paid/overpaid correction and cancellation, unchanged stock/FIFO/delivery, permissions/direct-write bypass, stale revision, retry, downstream blockers and injected failure rollback. Run red against main.
- [x] Add bounded wholesale schema and RPCs. Retain allocations; active-only allocation accounting permits re-invoicing cancelled deliveries. Atomically receive payments with idempotency, account/advance validation and journal linkage.
- [x] Add invoice detail, linked history/receipts/customer credit and durable correction form with live impact preview; server actions use verified RPC outcomes and revalidate affected readers.
- [x] Update existing AR/dashboard/seller/subledger consumers for carried settlement and dated correction movements; add focused action/component regressions.
- [x] Run full Vitest, typecheck, targeted lint/build and real two-session PostgreSQL tests; document exact evidence and limitations. Push branch and open reviewable PR; inspect preview availability. No production actions.

Verification and bounded dependency overlaps are documented in `../verification/2026-10-21-wholesale-corrections.md`. Full-suite baseline failures and customer/staging acceptance remain explicitly open.
