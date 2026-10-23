# I03 — trace cashier stock counts in the authorized back office

## Evidence and scope

The cashier create action and the back office already use the same `opname_orders`, `opname_counts`, and `opname_results` documents. This is not a missing replication job. The back-office list silently limited history to 200 orders and ignored query errors. The shared result view also ignored result metadata errors and asserted that stock had been adjusted even with no readable result. An embedded result-items relation could be truncated by the API row limit.

Synthetic reproduction used 251 visible completed cashier orders and a separate inaccessible warehouse. The previous page could not show order 201 on a later page; error/missing-result fixtures rendered misleading empty/success states. All eight new regression cases failed before implementation for the intended reasons.

The list now uses the existing checked 50-row pagination, exact counts, stable created-at/id ordering, and unchanged authorized warehouse/status filters. Results link to the exact order's result section. The shared result view reads all result lines in checked pages and stops on missing/unverifiable data. Its text confirms a saved document, not stock/GL reconciliation. Corrections and source-invoice notices are retained.

This proves application read-path behavior with synthetic fixtures; it does not prove the cause of any specific customer's missing document. No production data was imported or mutated. I02 posting atomicity/accounting remains separate. The cashier history list's own 50-row cutoff is outside this back-office batch. Existing parent-route authorization and RLS are preserved; no new confidentiality guarantees are claimed.

## Verification

- RED: 8/8 new component regressions failed on the previous implementation.
- GREEN: 12 focused cases across office visibility and existing cancellation UI passed.
- Full application suite: 353 files, 2693 tests passed.
- TypeScript, scoped ESLint, diff whitespace check passed.
- Production build passed with existing unrelated warnings.
- Bounded independent source review: no important blocker; no reviewer edits or repeated broad tests.

Coverage includes older orders, result links, cancelled filters/paging, inaccessible warehouse exclusion, missing exact counts, metadata errors/absence, 1001 result lines, and line-read errors. Browser/UAT is deferred. This is read-only UI/query work: no migration or business-policy change. Rollback is the code revert; source stock/GL history is untouched.
