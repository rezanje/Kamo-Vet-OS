# J02 POS payment method correction implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct a posted POS sale's mistaken cash/transfer allocation on the same sale, with auditable reversal and reposting and no second receipt.

**Architecture:** Keep the sale ID, items, stock, total, original journal and original allocation in an audit snapshot. An OWNER-only atomic RPC validates a new cash/transfer split, reverses the active revenue journal, reposts its unchanged revenue/tax/fee lines with corrected cash/bank debits, and updates effective payment rows plus sale display metadata. A private transaction-scoped marker admits only these narrowly defined writes through the existing immutable guards. All new execution rights remain denied except an OWNER-checked RPC. Source and correction periods, reconciled accounts, refunds, closed shifts and ambiguous legacy sources fail closed.

**Tech Stack:** PostgreSQL 16/Supabase migrations and RLS, Next.js 15 server actions, React, Vitest, disposable Docker PostgreSQL.

**Spec:** Checklist J02 in https://docs.google.com/spreadsheets/d/1opWVBMSQ3RHdtwrDefsSBM4Quc9H5zJg1RUNkr0zTFQ/edit and the user's 24 October 2026 decision to keep the same sale with reversal/repost and audit.

## Global constraints

- Do not execute a correction against Production while testing.
- Preserve sale identity, items, stock, total, tax, fees, points, and unrelated journal effects.
- Correct only Tunai/Transfer amounts; preserve other payment methods and fee snapshots. Block cash-change and nonzero cash/transfer merchant fee cases pending reconciliation.
- Block closed source/correction periods, reconciled affected accounts, closed shift, existing return/refund, stale revision, and incomplete or ambiguous source journals.
- No broad role grant. Only active OWNER with source-branch access may correct, using a retry key and required reason.
- A migration that alters immutable guards and grants a new RPC needs separate action-time authorization before application to hosted data.
- Keep Checklist G/H separate; unit and isolated SQL tests are not business simulation.

## Review focus

1. Two concurrent corrections on one sale: one succeeds; stale revision rejects without extra journal. SQL race test.
2. Lost response with same retry key: identical result; changed payload rejected. SQL test.
3. Reconciled or closed-period account: no allocation, sale, or journal change. SQL test.
4. Split sale with unaffected QRIS/fee: existing noncash amount and fee remain unchanged; only cash/transfer delta moves. SQL test.
5. Direct table writes or role/branch bypass: immutable guards and RLS reject. SQL test.

### Task 1: Atomic database correction

**Files:** Create `supabase/migrations/20261024140000_pos_payment_method_corrections.sql`; create `supabase/tests/pos_payment_method_corrections.sql`; modify `scripts/test-pos-split-payments-postgres.py`.

**Interfaces:** `correct_pos_sale_payment(uuid,integer,text,text,numeric,numeric) -> jsonb` consumes sale ID, revision, retry key, reason, cash and transfer amounts. Returns the original sale ID, audit ID and next revision. Audit and request tables are private except OWNER-limited audit reads.

- [x] Write an isolated SQL fixture for an already finalized sale and assert same ID/total/items/stock, exact old and new cash/bank ledger net, two balanced correction journals, revision and audit history.
- [x] Run it against current migrations and confirm failure because the RPC is absent.
- [x] Implement the migration with validated account mapping, immutable-guard gate, idempotency and all fail-closed conditions.
- [x] Run the focused SQL fixture to green; add/recheck retry, stale, rollback, direct write, role, account and concurrent-session cases.
- [ ] Commit this independently reviewable database slice.

### Task 2: Same-sale form and server action

**Files:** Create `src/app/(app)/penjualan/[id]/SalePaymentCorrectionForm.tsx`; modify `src/app/(app)/penjualan/[id]/actions.ts` and `page.tsx`; create `src/lib/__tests__/sale-payment-correction-action.test.ts`.

**Interfaces:** `koreksiMetodePembayaran(formData: FormData)` calls the RPC with the durable request key and redirects back to the same sale. Form exposes Tunai/Transfer allocation fields and reason to the active OWNER only when source payment details exist.

- [x] Write server-action tests for exact RPC arguments, invalid money, error/retry, and no second checkout; watch them fail.
- [x] Implement the action and form; show corrected current method and audit link/history on the existing sale page.
- [x] Run focused tests, TypeScript and build, then review the UI authorization and error paths.
- [ ] Commit the application slice.

### Task 3: Integrated verification and release gate

**Files:** Extend the SQL fixture and `docs/verification/` only where needed for evidence.

- [x] Run the isolated PostgreSQL suite, representative reporting/shift/refund tests, whole project tests, typecheck and build.
- [x] Review the final diff for permissions, trigger bypass, balance and report consistency; fix concrete findings.
- [ ] Open PR with exact SQL and app change scope, tests and hosted migration approval gate.
- [ ] Obtain separate authorization before any hosted migration or security-guard change; deploy only after that gate, then verify exact main/Production and update Checklist J02 accurately.
