# Return record corrections — local verification and release boundaries

Base: main `d6d9c70d24fed05ff16a2dfd32f55cbeaa48fb3f`. Isolated branch: `codex/retur-record-corrections-20261021`.

`AGENTS.md` was read. It asks for installed Next documentation; Next 15.5.25 is installed, but `node_modules/next/dist/docs/` does not exist in this package. The implementation follows the repository's existing server pages, awaited params, preserved forms and correction RPC patterns. No dependency versions changed.

## Inventory before implementation

| Actual family | Existing behavior | This change |
| --- | --- | --- |
| Retail/legacy customer return, backoffice and cashier | `post_unit_return('sales')`; exact source line/unit, group snapshots, good/damaged disposition, FIFO/HPP, refund expense, revenue/tax/HPP journals, durable posting identity | Reasoned OWNER correction/cancellation, retained originals, linked replacement, exact journal reversals, complete refund provenance and physical evidence |
| Planned POS payment, including split and merchant fee | `pos_sale_post_refund`; one expense per payment method, immutable `sale_payment_refunds`, cumulative proportional targets | Preserve all old allocations; void every original refund expense; active-only allocation/quantity/value targets; retain exact fee/tax reversal |
| Supplier PO return | `post_unit_return('purchase')`; accepted source quantities, real FIFO issue cost and variance, reduction of PO liability; unpaid/partpaid only within outstanding debt | Same correction transaction restores exact recorded layers and reissues replacement quantities; AP readers and payment ceilings ignore superseded documents |
| Paid supplier return beyond outstanding debt | Existing RPC rejects; no supplier credit-note/refund balance infrastructure was found | Remains explicitly rejected; no manufactured bank receipt or negative payable |
| Marketplace/online, B2B invoice, clinic returns | Retail return RPC requires `sales.channel is null`; purchase return references PO; no separate return lifecycle for these sources | No invented return flow, wholesale invoice/delivery correction, or clinic correction |
| Return correction | No existing return correction entrypoint found | New return-specific lifecycle; existing creation algorithm reused privately |

PR #62 was read, including changed filenames and its coverage matrix. It leaves return corrections open; its overlapping readers and shared correction form are reused, not reimplemented. Active PRs #10, #11, #18, #23 and #62 were inspected initially; #68 appeared during work and covers internal transfers independently. Main was checked again and remained `d6d9c70`.

## Contract

Only active OWNER with current module/operational-branch access may correct. Ordinary ADMIN gains no permissions. Source/request locks, source revision, actor and branch validation protect retries. A successful identical replay returns the recorded audit/replacement result; a changed payload or competing revision rejects. Authorization is checked again after ledger waits.

The reason, physical receipt/shipping evidence and confirmed actual quantities are mandatory. Empty replacement means cancellation with zero actual return. The UI requires the actor to attest that evidence was checked. This records the actor's verification; it does not independently authenticate a paper receipt. No payment provider, bank transfer, dispatch or receipt API is called. Source, unit factor, condition and lot cannot silently change during quantity correction.

Original return headers/items, journals, refund allocations and stock movements remain. Corrections append signed stock/journal reversals and an immutable audit with original snapshots; replacement documents link back. Every refund method is checked and voided together. Financial and stock entries restate the original **open** date, while audit timestamps retain the actual correction time. Both original and current dates must be open. Stock-card signed history remains available; a return-specific invoker view prevents operational usage metrics from treating bookkeeping reversals or superseded supplier returns as new consumption.

The entire lifecycle, including replacement posting, snapshots and final audit/request insert, is one PostgreSQL transaction. Stock/FIFO helpers and global journal/numbering helpers are unchanged. Later stock movements, even replenishment or backdated movements, stock/layer/basis/journal tampering, later payments, payment orders, covered reconciliations, closed shifts/periods and later active returns reject with an actionable reason.

## Deliberate fail-closed boundaries

- Historical returns without captured exact stock/journal/refund provenance remain visible but cannot be corrected automatically. Nothing is backfilled by matching historical amounts/dates.
- Supplier returns beyond the available outstanding debt require a separate credit/refund design. No such feature is claimed here.
- Employee-linked customer returns are blocked even before a payroll row exists. Current payroll computes commission across separate HTTP transactions, so a mere payroll-existence check cannot exclude an in-flight stale calculation. The return guard locks employee linkage and rejects any sale with a salesperson or cashier-to-employee mapping. Resolving this requires the separate atomic commission/payroll workflow; payroll files are untouched.
- Source, unit, condition and lot changes require reconciliation; this UI handles quantities and cancellation. Other source rows can be entered through the existing new-return flow after a safe cancellation.
- Any later movement of an affected SKU blocks automatic correction; net-zero later activity is not guessed to be safe.

## Verification

`python3 scripts/test-return-record-corrections.py` passed against an owned disposable PostgreSQL 16 Docker container with fictional auth/storage shims. All **209** repository migrations applied. The runner accepts no external DB URL and removes only its own container.

The existing online/return and merchant-fee SQL suites passed. New SQL covers 5→3 customer quantities, full cancellation, unpaid/partpaid supplier corrections, paid-debt rejection, original-date stock/journal consistency, effective stock usage, retained originals and exact AP/HPP/refund totals, stale/changed requests, role/branch/active-branch restrictions, closed period, legacy provenance rejection, stock downstream dependencies, journal tampering, multi-method reconciliation, employee linkage and denial of the independent expense editor. A final-audit-insert failure proves rollback after reversal/refund/stock changes. Planned POS returns exercise 80%→60%, both refund expenses, retained old allocations, cancellation and a subsequent full return including merchant fee.

Real independent waiting sessions prove identical correction retries produce one audit/result, competing corrections reject a stale revision, a concurrent stock issue blocks correction, a covering reconciliation committed first blocks correction, a ledger snapshot waiting behind correction sees its reversal, and an actor revoked in an earlier transaction cannot complete the waiting correction.

Application results: **2,209 passed / 3 failed** across 266 test files. The same three failures reproduced in a separate untouched `d6d9c70` worktree: two `merchant-fee-report-pages` cases omit the existing auth mock, and one `remaining-transaction-forms` case expects an absent PO `draft_key`. No unrelated fixes were included. New action/form tests prove mandatory evidence, RPC-only mutation, uncertainty without success acknowledgement, and stable key/quantity/reason/evidence after remount. Dashboard and subledger mocks were updated for active-return queries. Four additional date-window reader tests cover original plus active replacement, cancellation, prior-year returns in the seven-day window and supplier opening balances.

TypeScript and lint for all changed/new application files passed. Next production build passed with fictional loopback Supabase configuration; existing unrelated image/Edge Runtime warnings remain. Authenticated Supabase browser/API acceptance and production schema parity are not established by these tests.

An independent read-only code review found split-refund and date/usage issues; these were fixed and covered above. The final follow-up found no remaining critical/important issue within the documented fail-closed scope.

## Coordination / overlap for parent

New migration: `20261021074417_return_record_corrections.sql`. It adds `return_record_postings`, `return_record_corrections`, `return_record_requests`, the effective-stock view and return-only functions. It wraps existing `post_unit_return`, retaining its tested implementation privately as `return_record_post_base`.

Shared readers include active-return predicates and retail-return netting in:

- `src/lib/dashboard.ts`, `buku-pembantu-server.ts`, `operation-sales-server.ts`, `komisi-data.ts`, `laporan-transaksi-server.ts`, `return-source-units.ts`.
- `src/app/(app)/keuangan/hutang/page.tsx`, `keuangan/sinkron/actions.ts`, `laporan/pembelian/page.tsx`, `laporan/penjualan-kasir/page.tsx`, `laporan/penjualan-rinci/page.tsx`.
- `src/app/(app)/penjualan/[id]/page.tsx` only adds return detail links/cancelled status. Cashier return history excludes cancelled returns.

The migration updates return consumers inside `pay_purchase_invoice_atomic`, `pay_purchase_payment_order_atomic`, `mutate_purchase_payment_order`, `create_purchase_invoice_from_po`, `cancel_purchase_invoice`, `cancel_posted_sale`, and the return-only `pos_sale_post_refund`. Coordinate later migrations touching those function bodies; migration guards fail if canonical patch points differ. No wholesale invoice/delivery, asset, advance, payroll, transfer-bank, opening-balance, stock-helper or credential source was changed. A future integration of PR62's reset registry must separately classify these three new operational tables; no reset code or operation was included here.

No production migration/mutation, reset/wipe, credential change, real refund/transfer, merge or production deploy was performed. This draft requires the matching migration and application to be reviewed/released together; the branch alone does not establish production readiness.

## PR71 coordination follow-up

At parent request, PR71 was first inspected at `f277bd2`, then rechecked at the dated-dashboard fix **`5dde2ef40a0928ba57ef521aae2468e3a2dd4cd3`**. Its `sales_invoices`/`sales_receipts` columns, atomic receipt/credit functions and wholesale payroll epoch are separate from retail `sales` returns and supplier PO returns. This PR introduces no B2B credit or receipt helper and does not duplicate its customer-credit liability (2103) behavior. Its wholesale-only payroll fence does not cover retail return corrections, so the retail employee-linked fail-closed boundary remains necessary.

The shared application files are `src/lib/dashboard.ts` and `src/lib/buku-pembantu-server.ts`; `src/lib/__tests__/purchase-dashboard.test.ts` also has the same complete-query mock support on both branches. PR71 changes wholesale receivables/carried payments and `mutasiPiutang`; PR72 changes purchase-return predicates, retail-return dashboard netting and `mutasiHutang`. These changes must both be retained during integration. Preserve PR71’s `fjMovements {tanggal,total}` original/reversal/replacement aggregation, active-only settlement/carried-payment logic and negative-value chart support. Add PR72’s retail-return query and subtraction once, rather than copying either entire dashboard file over the other. There is no shared migration name or return RPC/schema modification.

A second disposable run applied **210 migrations**, inserting PR71's `20261021073000_wholesale_invoice_corrections.sql` in chronological order before this PR's migration, then passed the existing return/merchant-fee suites, new return correction suites and all return concurrency checks again. This proves combined schema plus return behavior, not a combined application release or a rerun of PR71's separate acceptance suite. No merge was performed.

PR: https://github.com/rezanje/Kamo-Vet-OS/pull/72 . Automatic Vercel preview: https://kamo-vet-os-git-codex-retur-record-correction-0f4f61-kamo-group.vercel.app . A read-only unauthenticated request to `/penjualan/retur` returned HTTP302; the Vercel commit check was still pending when checked. No login, transaction or production database write was attempted against preview.


## Review follow-up: legacy reconciliation and date windows

The reported NULL-account reconciliation bypass was reproduced before the fix: a code-only active statement covering account `1101` did not reject correction. The inner join has been removed. The guard now checks the statement’s COA snapshot directly as well as its current cash-account mapping. A NULL account without a provable cash/bank detail mapping blocks refund correction with an explicit reconciliation/mapping reason. Revenue/inventory/header codes do not establish a bank mapping. Refund journal provenance (`sales-return`) still identifies cash effects after a custom master is deleted. Pure supplier AP/inventory journals do not acquire an unrelated bank dependency.

Regression cases cover code-only `1101`, both mapping fields NULL, nonexistent COA, existing revenue/inventory/header COA, deleted custom cash master, known unrelated `1102` with/without account ID, and an unknown statement dated before the return. Covered or ambiguous cases reject; unrelated/proven earlier-period cases allow correction. No reconciliation is bypassed or automatically edited. Independent read-only review of the final guard found no further important issue.

The return contract is **restatement of the original open period**, rather than a current-date reversal. That choice already applied to both stock and journals; the new date suite explicitly verifies customer and supplier replacement/cancellation on yesterday and prior December 31, retained original header and actual audit timestamp, exact original-date net stock/refund/AP, absence of artificial correction-day/current-year movement, and refusal once the original year closes. Historical open-period report values can change after correction; this is not an immutable as-was historical report.

Dashboard retail sales previously ignored customer returns entirely. They now subtract active return totals on their original date from YTD sales and the complete seven-day trend. Superseded originals and cancellation do not duplicate refunds. A prior-year return remains outside current YTD while appearing when the seven-day window crosses January 1. Supplier subledger uses the same restated-date active-return contract for opening balances.

Final application suite: **2,209 passed / 3 baseline failures**, with the same failure signatures documented above. The focused return/source/purchase-reader group passed 33 tests; TypeScript, changed-file lint and the production build with fictional loopback configuration passed again. An isolated temporary composition of the two shared reader files with PR71 **`5dde2ef`**, preserving its settlement logic and dated `fjMovements`, passed **21 tests**: wholesale dashboard/subledger, return date windows, purchase dashboard and purchase-payment subledger. Temporary wholesale source/tests were restored afterwards; this branch does not duplicate wholesale implementation. PR71 signed-chart support remains an integration dependency for displaying negative retail return days.

The final revised guard/date suite also passed with **210 migrations including PR71 `5dde2ef`**, followed by every existing return/merchant-fee suite and all independent-session return races again. This validates the combined schema and return contract; it does not claim a wholesale or production release.
