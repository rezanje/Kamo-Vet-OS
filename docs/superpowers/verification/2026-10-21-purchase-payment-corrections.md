# Purchase payment correction milestone

Status: implemented, locally verified and approved by independent specification and quality reviewers; production release remains open. This is the PAYMENT portion of completion-plan task 4. Invoice cancellation, invoice replacement, stock-layer reversal and atomic direct-invoice creation remain open.

## Supported and blocked cases

| Case | Result and evidence |
| --- | --- |
| Normal PO receipt and invoice, partial cash payment | Actual existing receipt/invoice/payment RPCs exercised. Cancellation preserves original invoice, payment and journal rows; adds exact opposite journal lines and a signed negative payment. Other partial payments remain effective. |
| Partial/full advance allocation | The stored `dari_uang_muka` is reversed exactly, under the advance lock. Current allocated total must equal the sum of signed allocations; supplier, PO and branch/account scope must agree. Remaining allocations stay intact. |
| Payment order containing multiple invoices | New order create, approve, pay and cancellation are atomic. All payments sharing the proven order journal reverse together; the order returns to the proven approved state with a new revision. Repayment uses that revision and a fresh durable key. |
| Existing individual payments with protected request results | Migration links only an exactly identified payment/journal from a unique private request result. No pairing by date, amount, or invoice number. Historical retry payloads remain compatible. |
| Ambiguous legacy payments or order provenance | Rejected with a reconciliation message. Old order results without exact payment IDs and the pre-payment order snapshot are not guessed. |
| Posted payment edit | Cancellation first, then the existing payment flow with amount/method/available advance defaults revalidated. Replacement is tied to the canceled payment with a unique protected link, so a different key cannot create a second replacement. Current date is used; funding account is deliberately reselected through the existing mapping/select control. Order edits return to the restored order. |
| Lost response/reload | Durable keys survive display-draft expiry. Exact retries return the original result. The detail form can explicitly check the stored cancellation result without posting a new cancellation. Current active OWNER/branch/period and exact source cash-account/COA checks precede cancellation replay. |
| Explicit or automatically mapped cash accounts | Branch mapping, global mapping, then legacy default resolution retains the proven account in the protected posting result. Current account/COA must be active and match the payment branch. Recovery and cancellation validate that source against the original journal cash credit, never today's mapping. Mapping changes cannot redirect history; unproven legacy sources fail closed. Existing no-cash-row legacy defaults remain supported only with exact default-code proof. |
| Closed/future/nonfinite source or posting dates | Rejected before effects or cancellation replay. Active branch rows are held for share and access is checked again before final request persistence. |
| Bank reconciliation covering the source cash account | Blocked. Cancellation takes the same ledger table lock as bank reconciliation, then reads dependencies without locking reconciliation rows. The exact source journal determines affected account codes; advance-only reversals do not invent a cash effect. |
| Invoice VAT and inventory | Unchanged by payment reversal. Tests preserve source journal rows, input VAT and stock layers. These are payment corrections, not invoice cancellation. |
| Raw payment/order/journal/allocation/audit writes | Payment/order writes and purchase-payment journal edits are denied outside the authorized RPCs. Allocation totals cannot be forged. Private request storage and audit writes are revoked. Existing branch helper now restricts invoice/payment/order reads. |

## Reader coverage

Signed movements retain historical accounting and make existing sums correct without dropping original payments:

- `src/app/(app)/keuangan/hutang/page.tsx`: debt and return allocation sum signed payments; replacement defaults only come from a canceled individual payment belonging to a visible current unpaid invoice.
- `src/app/(app)/pembelian/faktur/page.tsx` and new `[id]/page.tsx`: net payments and original/reversal history; invoice numbers now open the detail route.
- `src/app/(app)/pembelian/perintah-bayar/page.tsx`, `src/lib/perintah-bayar.ts`: signed payment sum and reservation selectors; atomic order posting rechecks the return-adjusted ceiling under source locks.
- `src/lib/dashboard.ts` and `src/app/(app)/laporan/pembelian/page.tsx`: existing amount sums include the negative reversal and therefore restore paid/debt figures.
- `src/lib/buku-pembantu-server.ts`: negative payments become dated increases in debt, so reports before and after reversal preserve different historical balances correctly.
- `src/app/(app)/keuangan/sinkron/actions.ts`: signed reversal rows are not treated as missing original payments; protected journal IDs identify new order/partial payment journals.
- Purchase-return SQL computes the signed payment sum and shares the PO/invoice lock order. Existing atomic-payment regression checks still pass.
- VAT readers remain invoice/journal based; no invoice is voided in this milestone.

## Verification

`python3 scripts/test-purchase-payment-corrections-postgres.py` applies every current production migration in a unique owned database at `127.0.0.1:5432`, with all inherited libpq routing variables removed. It runs the new acceptance SQL plus the existing atomic-payment regression suite, and destroys the database afterward.

Covered: actual PO receipt/invoice creation; cash partials; cash+advance and all-advance replacement; original journal/line/stock immutability; multi-invoice order cancellation/restoration/repayment; VAT preservation; ambiguous legacy rejection; unique replacement; reason/revision validation; exact/changed replay; current inactive/role/module/branch/period/date checks; approval amount and one-time consumption; direct DML denial; bank reconciliation dependency; injected final request-write failure rolls back payment, journal, advance and order effects.

Additional P1 regressions prove inactive explicit source rejection for first cancellation, exact cancellation replay and read-only recovery; inactive source COA rejection; inactive/cross-branch mapped individual and order posting/recovery rejection; and unchanged historical cash after remapping. All run against the actual SQL functions.

Separate real PostgreSQL sessions verify that source-account deactivation committed while cancellation waits causes rejection without any reversal/request; identical cancellation requests commit one reversal; and both payment-before-cancel and cancel-before-payment lock orderings preserve the signed debt total. The quality-review follow-up also gates journal numbering in real sessions for two different invoices sharing one supplier-wide advance (`po_id IS NULL`). Both payment-first and cancellation-first orderings complete without deadlock, with exact signed allocations, per-invoice debt and request counts. Cancellation now acquires all source advances in sorted ID order before the global ledger lock, matching posting. Account, branch and COA scope locks are shared and compatible between these two paths; the exclusive advance lock is the ordering constraint. Every barrier is scoped to the owned database. Root separately reran `scripts/test-bank-purchase-payment-races-postgres.py` on this stable migration and confirmed both real orderings: bank reconciliation first blocks cancellation; cancellation first is included in the next reconciliation balance. Root also confirmed all seven existing clinical SQL suites against all current migrations.

Fresh focused Vitest: 10 files / 47 tests passed (payment actions, new correction/order actions, real forms and durable keys, dated signed subledger, existing purchase and order logic, shared completion acknowledgement). TypeScript and scoped ESLint passed after the P1 fixes; application files are unchanged in the P2 follow-up. The full native runner and `git diff --check` passed again after the P2 fix. No production calls, live data, dependency installs, or node_modules changes were made. Full combined release tests/build remain the root worker's release gate.

## Exact worker-owned review surface

- `supabase/migrations/20261020195034_purchase_payment_corrections.sql`
- `supabase/tests/purchase_payment_corrections.sql`
- `supabase/tests/purchase_payment_atomic.sql` (fixtures now have explicit supplier identity)
- `scripts/test-purchase-payment-corrections-postgres.py`
- `src/app/(app)/pembelian/faktur/actions.ts`
- `src/app/(app)/pembelian/faktur/page.tsx`
- `src/app/(app)/pembelian/faktur/[id]/actions.ts`
- `src/app/(app)/pembelian/faktur/[id]/page.tsx`
- `src/app/(app)/pembelian/faktur/[id]/PaymentCorrectionForm.tsx`
- `src/app/(app)/pembelian/perintah-bayar/actions.ts`
- `src/app/(app)/pembelian/perintah-bayar/page.tsx`
- `src/app/(app)/pembelian/perintah-bayar/DurablePaymentOrderForm.tsx`
- `src/app/(app)/keuangan/hutang/page.tsx`
- `src/app/(app)/keuangan/sinkron/actions.ts`
- `src/components/PurchasePaymentForm.tsx`
- `src/components/__tests__/purchase-payment-correction-form.test.tsx`
- `src/lib/__tests__/purchase-payment-action.test.ts`
- `src/lib/__tests__/purchase-payment-correction-actions.test.ts`
- `src/lib/__tests__/purchase-payment-subledger.test.ts`
- `src/lib/buku-pembantu-server.ts`
- `src/lib/tautan-dokumen.ts`
- This verification document.

Reset registry additions owned by root: `purchase_payment_cancellations`, `purchase_payment_cancellation_requests`, `purchase_payment_order_requests`. Delete these before their referenced source payments/orders/journals. Payment self-links (`reversal_of`, `replaces_payment_id`) are cleared with the operational payment rows in the same table delete.

## Remaining task-4 scope

Invoice cancellation/void metadata and report filters; exact PO repricing provenance and restoration; direct invoice stock-layer provenance/removal; tax/return/downstream FIFO dependency gates; prefilled invoice replacement; atomic direct-invoice creation (the current direct form still performs multiple database writes). Original advance issuance/cancellation remains an existing separate multi-write family. Do not mark task 4 or all financial posting families complete from this milestone.

## Independent review closure

Specification review independently reran the full native payment suite after active-source/mapped-account validation was fixed. Quality review reproduced and required correction of the shared-advance/ledger lock inversion, then independently reran the final native suite including both two-invoice/global-advance orderings. Both reviewers approved the final implementation. Quality also inspected the root cross-family and native clinical runners plus the three reset registry additions, without findings. Root previously ran those two runners successfully. Application tests/type/lint evidence above is from the implementation worker; final combined release checks remain pending.
