# Branch Cash and POS Warehouse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Route branch cash payments to the branch's existing COA account and prevent Panduraya/TKI POS from selecting Online warehouses for retail stock.

**Architecture:** Keep existing COA IDs and the posted opening journal. Add a controlled way for administrators to link an existing active cash COA detail to a branch cash account. Require the branch's active cash account for Tunai and reject missing or mismatched mappings at server boundaries; preserve original-account reversal behavior. Select an active RETAIL warehouse for POS inventory instead of relying on alphabetical type order.

**Tech Stack:** Next.js server actions, Supabase PostgreSQL, Vitest.

**Spec:** User screenshot supplied in the 1 November 2026 conversation; implementation scope recorded here. Branch account assignments and opening-balance allocation require owner approval before production writes.

## Global Constraints

- No production data, policy, or warehouse mutation in this code-only change.
- Preserve consolidated balances, posted opening journal, invoice and stock import history.
- OWNER, ADMIN, and FINANCE retain existing global reporting scope; branch users see only authorized branches.
- Do not assign generic cash accounts `110001–110003` or invent a LOJI account.
- No physical warehouse deletion in this change.

## Migration order (draft)

- `20261105020000_quantity_pool_pricing.sql` is already on main from PR #382.
- `20261105030000_opening_invoice_finance_posting.sql` is reserved by open PR #380.
- PR #381 uses `20261105040000_branch_tunai_routing.sql`, then `20261105041000_branch_cash_access_scope.sql`. Both remain unapplied pending the branch cash and access decisions.

## Review Focus

- An unmapped branch cannot silently post Tunai to central cash.
- A manual account choice cannot override the branch's Tunai account.
- Refunds and voids reverse the original cash account even after a mapping changes.
- An Online warehouse cannot satisfy a retail POS stock movement.
- Branch report opening balances need an approved balancing allocation before being displayed as branch balances.

### Task 1: POS retail warehouse

- [ ] Add a failing test for a branch with both Online and Retail warehouses, and for missing Retail warehouse.
- [ ] Select the active RETAIL warehouse for inventory in `src/app/(app)/pos/transaksi/actions.ts`; fail before writing a stock sale if none exists.
- [ ] Run targeted POS tests.

### Task 2: Existing COA link and cash account scope

- [ ] Test that an existing active asset cash detail can be linked without inserting another COA account and that duplicate linkage is rejected.
- [ ] Add an administrator-only server path for linking existing COA; no opening amount is posted.
- [ ] Prepare scoped cash-account and payment-map policies for review; do not apply to production.

### Task 3: Branch Tunai routing

- [ ] Add failing tests for exact branch routing, unmapped branch rejection, and ignored manual cash-account override.
- [ ] Enforce strict branch cash resolution in the app and database payment paths that post cash.
- [ ] Run targeted payment tests and the repository checks.

### Deferred accounting decision

The posted opening journal has `branch_id = NULL`. A branch report cannot show those historical cash balances until an explicit, balanced allocation of opening cash and counterpart equity is approved. Keep this out of the cash-routing change.
