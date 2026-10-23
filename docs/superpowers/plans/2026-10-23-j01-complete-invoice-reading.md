# J01 complete invoice reading — implementation plan

> Use superpowers:executing-plans in this isolated branch; keep PR128/129 and N01 separate.

Goal: invoice backoffice must not silently lose rows/payments at the API default limit or treat failed reads as empty/paid data. No transaction, role, valuation, correction-policy or database changes.

Files: existing `penjualan/faktur/page.tsx`, new `src/lib/sales-invoice-payments-server.ts`, focused real-page regression and verification note.

- [x] RED: actual page fixture enforces1000-row API cap; the1001st clinic/wholesale invoice disappears,1001st payment is omitted, failed reads appear empty.
- [x] Read invoice/clinic/advance/customer-credit lists with existing checked pagination and stable unique-ID order. Fail on errors/count drift, not partial totals.
- [x] Read receipt/payment children separately in bounded batches of visible invoice IDs with checked pagination; do not rely on capped embedded arrays. Preserve existing filters/statuses and RLS. Validate child-source membership/duplicates.
- [x] GREEN >1000 headers and child payments, late-page/read/count failures, empty/canceled/read-only states; preserve all financial actions and payloads.
- [x] Focused24 tests passed after aggregate3110passes/1obsolete mock was corrected; build/typecheck/scopedlint and narrow review passed.
- [ ] Publish candidate and verify exact-head CI. No target mutation or denied publication/merge retry. Full J01 channel/price/qty policy is not completed by this fix.
