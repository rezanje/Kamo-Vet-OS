# KAMO Remaining Feedback Completion Plan

> **For agentic workers:** Use subagent-driven-development with separate specification and code-quality reviews. Execute continuously within the user's authorization; keep unresolved identity inputs and credential handoff explicit.

**Goal:** Complete remaining customer feedback with verified production behavior, preserving accounting history, branch isolation and recoverable transaction-reset data.

**Architecture:** Reuse existing atomic posting/reversal RPCs and draft wrappers. Implement each posting family separately; a generic direct-update/delete switch is prohibited. Posted corrections preserve source documents and reverse their accounting/inventory effects before a replacement is entered. Reset preserves master records and requires a durable verified backup.

**Tech Stack:** Next.js 15.5.25, React 19, Supabase PostgreSQL/Auth, Vitest, isolated PostgreSQL acceptance tests.

## Confirmed scope and boundaries

- The user requested completion and production release of all remaining application feedback.
- Reset covers all branches. Preserve COA, items, customers/pets, suppliers, employees, user accounts and settings; clear operational history and inventory/cash effects only after rollback verification. The user clarified on 21 October that the app should restart fresh, including examination and inpatient history.
- Meeting scheduling is explicitly excluded by the user.
- Do not invent identities, email addresses, branch assignments or permissions. Twelve previously held records can be corroborated from the supplied workbook and current HR data; seven still require identity/branch confirmation. Two additional names now have corroborated contact/placement information; thirteen still require email addresses. Fourteen remaining accounts are privately prepared, not yet provisioned.
- Existing 66 accounts and unrelated original checkout changes remain intact.
- The user confirmed administrative credential replacement is not yet finished. Keep administrative production operations pending during this handoff; never log another credential or execute against the wrong Supabase project.

## 1. Cashier stock receipt recovery

Files: `src/app/kasir/persediaan/terima/[id]/TerimaForm.tsx`, `src/app/kasir/persediaan/actions.ts`, `src/components/__tests__/cashier-receipt-form.test.tsx`, `src/lib/__tests__/cashier-stock-request-action.test.ts`.

- [x] Persist rows and notes after failed/uncertain save and remount using existing draft components.
- [x] Preserve all original request lines; missing goods use zero received quantity. Reconcile stale draft IDs against current request lines and isolate mounted user/request contexts.
- [x] Keep existing `receive_stock_request_atomic` canonical-payload retry semantics; acknowledge only confirmed success.
- [x] Run `node node_modules/vitest/vitest.mjs run src/components/__tests__/cashier-receipt-form.test.tsx src/lib/__tests__/cashier-stock-request-action.test.ts src/lib/__tests__/terima-permintaan-atomic.test.ts`.
- [x] Obtain specification and quality approval, then commit the bounded change (`dee56f8`).

## 2. Purchase-order lifecycle

Files: `src/app/(app)/pembelian/actions.ts`, `src/app/(app)/pembelian/[id]/page.tsx`, existing PO form and purchase tests, a new CLI-generated migration.

- [x] Replace arbitrary status updates with authorized, branch-checked transitions, explicit failure feedback and audited cancellation reasons.
- [x] Allow draft edits only before receipt/invoice/advance/return dependencies; lock the source row and reject stale revisions.
- [x] Commit PO header/items together with a stable posting key; identical retry returns the first document and altered payload rejects.
- [x] Verify OWNER, unauthorized role, cross-branch, downstream document, stale revision, duplicate-submit and mid-insert rollback cases.

## 3. Posted sales corrections

Files: sale detail/actions, `src/lib/sale-payment-reporting.ts`, `src/lib/tutup-shift.ts`, `src/lib/customer-tier.ts`, sale readers/reports, CLI-generated correction migration and PostgreSQL acceptance suite.

- [x] Add reasoned OWNER cancellation with row locks, active-account/branch/period checks and immutable audit/request records.
- [x] Reverse payment allocations, merchant fee/VAT, stock/FIFO cost, points and customer totals atomically. Full return alone is insufficient because it leaves the original sale active.
- [x] Preserve original documents and journal lines; use separate unique reversal references. Reject unsupported dependent returns/settlements with actionable instructions.
- [x] Route posted edit through cancellation and prefilled replacement; do not silently mutate posted amounts.
- [x] Update all completed-sale readers, shifts, commission and tax/report consumers to honor cancellation consistently.
- [x] Test cash/split payment, grouped stock, rounding, period lock, dependent return, inactive actor, cross-branch, rollback and concurrent identical retry.

Local evidence: `6ecf18d` and `docs/superpowers/verification/2026-10-21-posted-sale-corrections.md`. Production release remains open.

## 4. Purchase invoice/payment corrections

Files: purchase invoice/payment actions and screens, debt/dashboard/subledger/tax readers, CLI-generated migration and PostgreSQL acceptance tests.

- [x] Separate payment reversal from invoice reversal; restore consumed advances and payment-order state where applicable. Payment milestone independently spec/quality approved; invoice milestone remains open.
- [ ] Reverse original accounting entries without deleting history; reverse inventory valuation only when downstream consumption is safely handled or blocked.
- [ ] Require active OWNER, branch, original/new open periods, reason, revision and stable request identity.
- [ ] Exclude void source records from operational liabilities and reports while preserving ledger reversal history.
- [ ] Test invoices with/without payments, FIFO consumption, advance allocations, payment orders, tax dependencies and all retry/authorization cases.

## 5. Remaining financial and inventory posting families

Files: manual journal creation, bank transfer, opening balance, reconciliation and inventory adjustment actions/RPCs, plus inventory receiving/transfer/production/opname, B2B posted delivery/invoice, sales/purchase return, active fixed-asset purchase/depreciation, purchase/employee advance and finalized payroll correction paths.

- [ ] Move multi-step writes into atomic family-specific operations: failure must preserve prior balances and must not leave an orphan header or partial stock change.
- [ ] Persist posting identities independently of expiring display drafts wherever replay can create duplicate transactions.
- [ ] Add source correction/cancellation through existing reversal mechanisms, preserving closed-period, FIFO, payroll and branch rules.
- [ ] Audit every transaction form for visible pending/result status and recoverable failed input; test representative controlled rows and ordinary fields.
- [ ] Maintain a source-backed coverage matrix; unimplemented or unverified families remain open.

## 6. Recoverable all-branch reset

Files: reset guard/form/actions, CLI-generated transaction-only reset migration, private operational backup/restore scripts and isolated database tests.

- [x] Enumerate explicit transactional tables, dependencies and aggregate fields. Include clinical examination/inpatient history in the approved operational reset while protecting all named master data; never call the legacy SKU-deleting reset.
- [x] Persist a complete snapshot with a deterministic manifest and checksum; verify downloaded read-back and isolated restore before deletion.
- [x] Lock reset scope, reject stale snapshots or concurrent changes, and clear transaction families in dependency order atomically.
- [x] Retain backup/audit history, block automated recurring catch-up from recreating cleared transactions, and prove restored master counts/hashes unchanged.
- [ ] Execute only the approved all-branch scope; verify empty transaction lists, zero inventory/cash effects and preserved 66 accounts/master data after reload.

Local reset verification: `docs/superpowers/verification/2026-10-21-operational-reset.md`. The four checks above describe locally tested/reviewed code only; production execution remains unchecked. Manual journals, bank transfers and opening balances also passed local independent reviews; the rest of task 5 remains open.

## 7. Accounts, release and status evidence

- [ ] Provision corroborated remaining identities using current verified HR/contact/branch data, preserving existing records; register genuinely missing employees only from complete unique source records.
- [ ] Keep the seven unresolved identities/branches and additional incomplete contacts in a named editable confirmation list for the customer. Never mark them complete without source answers.
- [ ] Review the existing job/access mismatch using the user's approved job-based access; do not silently grant Admin/OWNER.
- [ ] Test final account/profile/branch links and sample sign-ins; exclude all credentials and personal source data from Git and public reports.
- [ ] Run targeted suites, complete Vitest, type check and production build; review combined diff and apply verified migrations to the exact KAMO project.
- [ ] Push branch, create/attach PR, deploy verified commit, check canonical production version and authenticated application behavior.
- [ ] Update the customer request matrix with actual results, production links and precise unresolved inputs. Meeting remains out of scope; credential revocation and billing status require verified evidence before claiming resolution.
