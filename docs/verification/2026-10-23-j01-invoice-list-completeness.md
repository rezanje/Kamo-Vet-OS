# J01 — complete backoffice invoice and payment reading

Base: main `61376d7736dc1669925f4214f1a978e30a053750`. Separate from PR128 retail refunds, PR129 PO prices and the blocked N01 resolver. No migration, target transaction, ACL/RLS change or financial action change.

## Verified defect

`/penjualan/faktur` fetched wholesale invoices, clinic invoices and advances without ranges or exact counts. It treated errors as empty arrays. API-default row caps therefore omitted the1001st invoice. Embedded `sales_receipts`/`invoice_payments` could independently omit the1001st payment, making displayed outstanding amounts too high. A source error could display incomplete/empty data beside finance controls.

The actual server-page regression enforces a1000-row API cap:8 tests failed before the fix, including missing final headers,1000 rather than999 remaining on a2000 invoice with1001payments of1, and failed reads being rendered as empty. Customer-credit failure already threw; the new common reader preserves refusal without exposing the raw source error.

## Change

Use existing checked pagination for wholesale/clinic headers, active advances and positive customer credits, with original filters and unique-ID ordering. Read receipt/payment children separately in200-visible-parent-ID batches and checked500-row pages. Remove capped embedded arrays from header selection and attach each verified child exactly once to its stored parent. Missing counts, short/failed pages, count changes, duplicates and foreign child-parent identities reject rendering instead of producing partial totals.

Existing status/cancellation, initial clinic DP, signed reversal/payment, carried-balance and due-date calculations are unchanged. Existing role/branch/RLS and finance posting actions/parameters are unchanged. The new reader performs SELECTs with the existing authenticated client, not a definer/service client. No new document resolver or route is included.

## Validation and limits

-9 actual server-page tests pass:1001clinic and wholesale headers,1001payments per source, exact remaining999, and header/payment/advance/credit/late-page/count failures. Typecheck and narrow independent review passed, no P1/P2 found.
- Aggregate app run:3110 passed and1 outdated fixture failed (`clinic-billing-reader`, missing query range/count support). After updating that fixture to the real separate payment read, all24 affected tests passed. No production logic was relaxed. Production build, post-build typecheck and scoped ESLint passed. Exact published-head preview is recorded in the PR; existing unrelated build warnings remain.
- All fixtures are fictional. No authenticated hosted UAT or live financial writes. Reads across separate requests are not a transactionally frozen financial snapshot: exact counts/IDs catch incomplete pages and some concurrent changes, not every same-count update.
- This fixes completeness for the existing wholesale/clinic invoice backoffice. It does not turn retail receipts into wholesale invoices, define new finance correction permissions, reconcile historic documents, or complete global J01/P08/J02/I09. Virtual in/out meanings and clinical refund rules remain outside this source-read fix.

## Release

No database prerequisite or data conversion is needed. Normal application rollback restores the previous reader without changing transactions. PR128 merge/N01 publication remain blocked and are not retried or repackaged. PR129 stays on its own branch with its migration unapplied. This branch can be reviewed/published independently; target rollout/merge remains held while release coordination is pending.
