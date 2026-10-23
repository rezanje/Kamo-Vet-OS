# N01 — navigation through existing stored documents

## Candidate and boundaries

Base: current main `102f3b0555305524611296e29d16affc12553eb7`. Isolated worktree `/workspace/kamo-n01`, branch `codex/n01-document-navigation-20261022`. A01 PR83 remains exactly `3b6f82dde5bfe616f2759f121de45d7a1de11b29`; it is not merged, rebased or edited. This candidate contains no A01, PR86 import candidate, CRM U01/U05 or N02 numbering work.

Feedback: stored related documents were difficult to trace from a transaction number because users had to reopen/search each menu. This batch provides direct links to the related records the schema actually stores, including one-to-many receipts and split payments, document type/status, correction provenance and contextual back navigation.

No schema/migration/RPC/auth/permission/financial mutation code changes. No target database access or writes. Financial calculations, forms, existing posting/correction actions and state transitions remain intact. No credentials are generated. The new behavior is server-rendered navigation over the existing authenticated client and routes.

## Implemented source-to-destination matrix

| Starting document | Stored relation | Destination / behavior |
| --- | --- | --- |
| Purchase order | `goods_receipts.po_id` | Every returned receipt opens its existing detail page, not just the first. Receipt has no lifecycle-status field; label is honestly “Dokumen tersimpan”. |
| Purchase order | `purchase_invoices.po_id` | All returned invoices, including canceled ones, linked with status. Existing correction section is preserved. |
| Purchase order | `purchase_advances.po_id` | Every linked DP opens its exact row in the existing advance list; active/canceled status retained. |
| Purchase order | `po_payments.po_id` | Legacy PO payments have exact row anchors and details. Explicit warning says invoice allocation is not stored; they are never presented as payment of a guessed invoice. |
| Purchase order | `purchase_returns.po_id` | Stored returns open their existing detail route with cancellation status. |
| Goods receipt | `goods_receipts.po_id` → readable PO | Link back to that PO; list invoices whose stored `po_id` is that same PO. **These are labeled invoices on the same PO, not a direct receipt allocation.** |
| Purchase invoice | `purchase_invoices.po_id` | Readable PO and its stored receipt list, with the same grouping limitation. Direct/legacy invoice without a PO gets an honest explanation. |
| Purchase invoice | `purchase_invoice_payments.invoice_id` | Every returned payment appears in the document navigator and retains its complete original detail row. Exact `#payment-ID` links target each row. Cancellation, reversal and replacement statuses are visible. |
| Purchase payment | `reversal_of`, `replaces_payment_id` | Source/inverse links only to matching readable payment rows; missing source is labeled unavailable. No relationship is inferred from amount/date/number. |
| Purchase payment | `advance_id`, `payment_order_id` | Readable linked DP / order opens the exact existing list row. No standalone payment/order-detail route is invented. |
| Purchase invoice | `replaces_invoice_id` and inverse unique FK | Original and replacement invoices linked only after a scoped read succeeds. An inaccessible original does not disclose its number or receive a manufactured link. Query failure does not become a false “no replacement” state. |
| Sales invoice | `sales_receipts.invoice_id` | Every returned split receipt is independently linked to its actual source invoice and `#receipt-ID` row. Existing original-money/carried-payment arithmetic is unchanged. |
| Sales receipt | `advance_id` | Its explicitly allocated, readable DP opens the exact sales-advance row. A legacy DP amount without a readable FK is labeled unavailable; no customer/name matching. |
| Corrected sales invoice | Stored `replaces_invoice_id` ancestry | Existing bounded ancestry traversal retains original receipts, source invoices and statuses. Ancestor receipt links use the original invoice ID and return to the replacement. Missing ancestry is labeled; it is not reconstructed. |
| DP/order/receipt/invoice destinations | Encoded `from` context | “Kembali ke transaksi asal” returns to the originating invoice/payment row. A strict existing-route/UUID/fragment whitelist rejects external URLs, path traversal, arbitrary query strings and unsafe fragments. |

`related-document-routes.ts` centralizes **existing** route patterns. The repository had no shared transaction-route builder covering these records; no new application route is created. Foreign-key IDs are used throughout, never document numbers as route IDs.

## Access and disclosure review

- Uses the unchanged `createClient()` from `src/lib/supabase/server.ts`: current session cookies and selected-branch header remain attached. No service client, privilege bypass or new role/module grant.
- Existing middleware remains the route/module guard; all newly loaded related documents stay within the starting purchase or sales module. Contextual return links disclose no destination document metadata; destination middleware still applies.
- New reads are exact-FK scoped: current root ID, `po_id`, original ID or inverse `replaces_invoice_id`. No new all-branch listing, name/number matching, generic OR query, RPC or write. Existing DP/payment-order list queries are unchanged; this batch adds only anchors/back navigation there.
- Embedded FK targets are shown only when their existing user-scoped query returns a readable row. A hidden parent blocks the additional receipt→invoice lookup. Root-not-found stops related reads. Missing and inaccessible targets share an honest generic message rather than exposing hidden numbers.
- Self-referencing invoice provenance uses explicit source-ID reads instead of relying on ambiguous self-embedding. Independent source reads are batched after the root is read.
- All returned one-to-many items are rendered; no first-payment selection or new display limit. Existing backend API row limits still apply; this change does not claim to remove server-imposed limits.
- No raw database error is emitted by new related-list failure handling. Existing non-navigation fields retain their current source permissions and rendering.

## Verification

- RED: route-helper suite failed because the helper was absent; six new navigation cases failed against unchanged main. The root-not-found safety case already passed. Additional legacy-route assertion was observed failing before support.
- Focused GREEN: **23 tests / 3 files**, including multiple receipts, all purchase payments, reversal/replacement, original/replacement invoices, split sales receipts, original-invoice receipt IDs, unavailable lineage/DP/source numbers, query failure, root permission denial, exact FK filters, route validation and safe return context.
- Final full Vitest: **2,435 passed / 312 files**; no failures. Existing React act() warnings retained. This is the N01/main suite, not A01's separate test count.
- TypeScript and scoped ESLint passed. Final production-build result and command evidence are recorded in `checks.json`; existing repository-wide build warnings are not silently suppressed.
- Chromium uses the actual seven detail/list server pages with a fictional query boundary on loopback. It clicks two receipts, follows receipt→invoice, opens exact DP/payment-order rows and returns to the originating payment, checks both split sales receipts and sales DP, and verifies hidden-source fallback. Desktop and 390px mobile are exercised, including mobile link navigation and no document-wide horizontal overflow. Table overflow remains scoped to the table.
- Browser fixtures disable financial actions and permit only loopback requests. No real authentication/PostgREST/DB integration, mutation or migration is performed. Fixture denial checks and exact query-scope assertions are not misrepresented as production RLS parity tests.
- Screenshots: [purchase desktop](../evidence/2026-10-22-n01/purchase-desktop.png), [purchase mobile](../evidence/2026-10-22-n01/purchase-mobile.png), [sales mobile](../evidence/2026-10-22-n01/sales-mobile.png). Screenshots were visually inspected.

Reproduce using the existing dependency environment:

```sh
npx vitest run src/lib/__tests__/related-document-routes.test.ts src/components/__tests__/related-documents-navigation.test.tsx src/components/__tests__/wholesale-invoice-detail.test.tsx
node scripts/test-related-documents-browser.mjs
npm test -- --reporter=dot
npx tsc --noEmit
# Scoped ESLint on the changed TS/TSX/MJS paths.
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399 \
NEXT_PUBLIC_SUPABASE_ANON_KEY=fictional-n01-build npm run build
git diff --check
```

AGENTS.md, CLAUDE.md, existing route/access/client code and stored schema FK definitions were reviewed. Installed Next15.5.25 lacks the requested `node_modules/next/dist/docs/`; existing server patterns, installed types, browser rendering and build were used. No new dependency was installed. No worker agent was launched.

## Gaps and release state

- A goods receipt has no stored invoice allocation: only shared-PO grouping is proven. Exact per-receipt invoice attribution would require a separate model decision, outside this no-schema batch.
- Unlinked legacy payment/DP records are not matched by supplier/customer/name/date/document number. Missing provenance remains missing; no old history is reconstructed.
- Payments and payment orders do not have standalone existing detail routes. This candidate opens their exact rows on the existing invoice/list page; it does not create a new document model or financial operation.
- Generalized journal/reversal-journal navigation, POS/clinic split-tender details, sales-delivery allocation navigation and other modules are not implemented in this batch. Existing links remain. Do not mark full N01 universally complete from this supported subset.
- Large histories remain subject to existing API maximum rows. Real authenticated selected-branch/module UAT and representative legacy data review remain release gates; local browser tests are fixtures.
- Parent review decides release. No merge, manual deployment, target migration, production/live writes or Google Sheet edit is performed. Application rollback is the normal previous-app redeploy; there is no database rollback or migration for N01. A01's separate target-database blocker is unchanged.
