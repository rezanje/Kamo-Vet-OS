# N01: two-way links from DP (uang muka) to its order and to the payments that used it (partial)

Base: main `66e3d65`. Ownership checked before editing: no open N01 PR. Earlier N01 PRs were released. The only open
PR touching purchase pages (#248) edits the PO and purchase-invoice detail pages, which this change does not touch.

## Gap matrix (Sheet: "koneksi dua arah PO→penerimaan→faktur→DP/pembayaran … beberapa pembayaran ketika split payment")

| Direction | Before | After |
| --- | --- | --- |
| PO → DP, purchase invoice payment → DP, sales receipt → DP | Linked (earlier N01 work). | Unchanged. |
| Purchase DP → PO | PO number as plain text. | Links to the stored `po_id` PO when the PO is readable. |
| Purchase DP → invoice payments that used it | Not shown; only the "terpakai" amount. | Every `purchase_invoice_payments.advance_id` row links to its exact `#payment-<id>` on the invoice, including split use across several invoices and cancellation/reversal rows. |
| Purchase DP → legacy PO payments that used it | Not shown. | Every `po_payments.advance_id` row links to its `#legacy-payment-<id>` on the PO. |
| Sales DP → sales order | Order number as plain text. | Links to the stored `order_id` order when readable. |
| Sales DP → receipts that used it | Not shown. | Every `sales_receipts.advance_id` receipt links to its exact `#receipt-<id>` on the invoice (split receipts each listed). |

Rules:
- Only stored IDs are used. A usage whose document is unreadable, or whose embedded ID does not match, is listed
  without a number or link.
- A failed usage read shows an alert, never "unused".
- A DP with a recorded used amount but no readable usage says so.
- Nothing is matched by name, amount or date.

No migration, RLS/ACL, permission, payment/accounting policy, form or posting change. Files: the two DP list
pages, `src/lib/advance-usage.ts`, `src/components/AdvanceUsageList.tsx`, one `sales-order` route in
`src/lib/related-document-routes.ts`, and tests.

## Verification (fictional fixtures only)

- RED: 6/7 new page tests and the new route-helper test failed on base.
- GREEN: focused suites pass. Full Vitest, `npm run lint` (0 errors), `npx tsc --noEmit` and the production build
  were run on the candidate.

## Remaining (N01 stays partial)

- Usage reads are batched per 100 DPs (two reads per batch for purchase). Very long DP lists load more slowly.
- Goods receipt → invoice still has no stored allocation. Only shared-PO grouping exists, as recorded earlier.
- Invoice ↔ return/refund and payment-order coverage are not changed here.
- Field UAT not performed.
