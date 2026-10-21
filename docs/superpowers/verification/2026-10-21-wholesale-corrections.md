# Wholesale / B2B invoice correction verification

Implemented on `codex/kamo-wholesale-corrections`, based on `d6d9c70d24fed05ff16a2dfd32f55cbeaa48fb3f` (main / PR67). No production migration, merge, reset, deployment, credential change or real refund/transfer performed.

## Existing functionality and gap evidence

- Read root `AGENTS.md`. Installed Next 15.5.25 has no `node_modules/next/dist/docs/` directory; existing app patterns and installed `next/cache.d.ts` API exports were inspected. No framework or dependency-version change.
- PR62 remained open and explicitly listed remaining B2B correction work as incomplete. Other open PRs were inspected; no existing B2B invoice correction was duplicated.
- `0098_rantai_penjualan.sql` and `20261004150000_sales_safe_posting.sql` already implement quotation → order → physical delivery → invoice, atomic delivery/invoice posting, FIFO cost allocation and branch/module checks. Existing RPCs and allocation records are retained.
- Physical stock/COGS is recorded at **delivery**, not invoice. The existing invoice receipt action used separate receipt, advance counter, journal and status writes. It had no atomic correction/replacement lifecycle.
- Existing retail/online cancellation and purchase lifecycle patterns were reviewed. This change does not add retail, return, asset, standalone advance, inventory correction or payroll correction workflows.

## Behavior

- Active OWNER with source-branch access corrects invoice prices/due date/notes or cancels invoice recording, with reason, expected revision, durable request key and immutable audit. Originals, original line allocations and original receipt documents stay in place. Reversal and replacement journals/documents are linked.
- Replacement preserves item, quantity, unit, factor, delivery allocation and HPP. Any attempt to change physical quantity/items through this API is rejected with a delivery reconciliation / physical-return instruction. No stock balance, layer or movement is created by invoice correction.
- Cancelling financial recording reopens invoiceable delivery quantities; goods remain physically issued. Active-only invoice allocation accounting allows re-invoicing those goods without duplicating HPP or stock movements.
- Original payments remain on their source invoice. Replacement `carried_paid` preserves their application without creating new receipts/cash movements. New payments, advance usage, journal, revision and durable result commit atomically under the same order/invoice locks as correction.
- Excess payment is an explicit audit-linked customer credit: Dr1201 / Cr2103. It is visible on invoice history and the invoice list. It is **not** an automatically spendable standalone advance; cash/advance consumption already recorded is not reversed. Settlement/refund requires separate finance review.
- Closed source/correction periods, reconciled receipts (including ancestors), existing payroll, missing/incorrect allocation evidence, malformed source journals, stale revisions and disallowed roles block with a reason. A future payroll calculation captures a B2B epoch before reading source data; its write rejects a stale epoch. Both source/target correction periods are fenced.
- Advance allocation checks the unique original funding journal, date/period, customer/order/branch and used counter. Used source documents/journals are protected. Unverified **legacy advance-funded receipts** are deliberately blocked during correction with a funding-reconciliation instruction; no historical funding is inferred/backfilled.
- AR list, dashboard, seller report and dated subsidiary AR include carried payment or dated original/reversal/credit movements as appropriate. Orderless stock-opname invoices retain their separate existing family; the shared receipt list/detail still displays their real payments.

## Verification performed in Codex Cloud

`python3 scripts/test-wholesale-corrections-postgres.py` — **passed** against an owned, uniquely named disposable Docker PostgreSQL16 container. It accepts no external database URL, applies all repository migrations, uses fictional fixtures, and removes its own container afterward. Checks include:

- Existing full `sales_safe_posting.sql` regression suite.
- Unpaid replacement; part-paid replacement; repeated carried payments; overpayment credit; paid cancellation; re-invoice after cancellation with historical allocations retained.
- Exact AR/credit/cash effects, original receipts retained, original invoice retained, unchanged delivery/FIFO/stock, and price correction after separate physical stock consumption.
- OWNER restriction, anonymous/private-helper/private-table denial, direct document/payment/journal/movement/used-advance mutation denial, changed-key payload conflicts, stale revision and loss-of-response recovery.
- Closed period, payroll dependency, bank reconciliation (including ancestor receipts), malformed physical counters, forbidden quantity mutation, missing advance funding and unverified legacy advance-funded receipt.
- Injected final durable-result failure rolls back the complete invoice, journals, audit, credit, counter and advance allocation state.
- Real two-session correction retry, receipt retry, competing final payments, and both payment-versus-correction orders.
- Real payroll stale-snapshot races in both orders; absent epoch=0, same-month increment once, cross-month increments both.
- Real funding-journal INSERT versus first advance usage in both orders: a late phantom is blocked, or the receipt rejects invalid funding with no leaked usage/payment. Direct conflicting source edits may fail atomically under normal database lock/deadlock handling; no bypass or partial commit is permitted.

Application checks:

- Focused Vitest: **5 files /13 tests passed**, covering actions/confirmation, draft restore and preview, orderless detail, subsidiary AR history, payroll source token.
- Full `npm test -- --reporter=dot`: **2,207 passed /3 failed across268 files**. The same3 failures were reproduced before application changes on main after `npm ci`: two `merchant-fee-report-pages.test.tsx` tests (`shows merchandise, merchant fee and final bill separately on sale detail`; `does not invent a fee for historical sales`) lack an auth `getUser` mock; `remaining-transaction-forms.test.tsx` → `clears acknowledged controlled rows and keeps defaults on later remount` cannot find the existing PO form draft key. They are outside this B2B change and remain reported, not hidden.
- `npx tsc --noEmit`: passed.
- ESLint on all changed application/test files: passed.
- `npm run build`: passed; existing warnings in unrelated image/upload files remain.
- Independent focused code review found draft-preview, orderless-history, payroll-race and advance-evidence gaps. They were addressed and re-reviewed; no unresolved critical/important finding in final follow-up. This is not customer UAT or complete ERP acceptance.

## Integration and overlap notes for parent

- Unique migration: `20261021073000_wholesale_invoice_corrections.sql`. It alters only the B2B lifecycle plus narrowly required receipt/advance and downstream guards. Apply only to an isolated/staging database for acceptance first; this task has not applied it to production.
- No file overlap with PR68 transfer-bank, PR69 stock/opname or PR70 monetary-opening correction files as inspected. There is a **schema overlap** with stock/opname: `sales_invoices` and `sales_invoice_items` remain shared; the new B2B guard preserves orderless opname insert behavior and refuses B2B correction of those invoices. `sales_receipts` now uses the shared atomic receipt RPC, including existing orderless receipt entry. Run combined branch migrations/regressions before integration.
- `src/app/(app)/hris/penggajian/actions.ts` has a narrowly scoped four-line dependency overlap: fetch epoch before commission reads, fail closed on read error, include epoch in existing upsert. No payroll calculation/correction/payment logic is implemented or replaced. Coordinate this with existing PR18 if it proceeds.
- Used `sales_advances` evidence is hardened only to protect invoice receipt allocation; standalone advance creation/correction remains outside scope.
- No generic shared stock/return helper was changed. Customer/supplier return correction remains owned by the separate return task.
- Authenticated browser acceptance with a migrated isolated backend remains open. A build/PR preview alone does not establish database acceptance or production readiness.
