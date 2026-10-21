# Purchase feedback: correction actions and warehouse stock

Date: 2026-10-21 UTC. Local implementation only; no migrations, deployment, or commits in this workstream.

## Findings and changes

The PO detail page already had owner-only correction forms, but displayed them only while a PO was Draft/Dipesan. Received POs had no correction entrypoint or links to their invoices. The PO edit form also omitted the unit selector even though the existing `revise_purchase_order` RPC accepts and validates the selected unit against the item master.

- Eligible active Super Admins now see Edit PO and Batalkan PO actions at the top of PO detail. The existing forms and lifecycle RPC remain responsible for edits, audit reasons, revisions, and cancellation.
- Direct PO corrections are hidden once dependent receipts, invoices, returns, payments, or advances exist. The database still enforces these restrictions if dependencies appear after page load.
- Received or dependent POs expose a correction section with their invoice detail links. Invoice detail already provides Batalkan faktur and Batalkan & siapkan pengganti through `cancel_purchase_invoice`; those existing actions are reused.
- Draft PO correction now includes master unit choices, quantity in base units, and purchase cost per base unit. Changing the unit keeps the entered price so the user can explicitly check the intended price per unit.
- New PO and transfer forms now load complete warehouse stock, show available stock for the selected destination/source warehouse, and show the selected unit plus base-unit quantity. Missing stock rows mean zero only after the stock read completes successfully. Failed or incomplete reads fail visibly instead of fabricating zero availability.
- Stock hints follow saved warehouse selections when restoring existing drafts, including drafts saved before warehouse selection was included in the controlled snapshot. Non-stock purchase item types do not display stock hints.

## Received wrong-unit limitation

The supported backend intentionally rejects direct editing or cancellation of a PO once receipt or other dependent transactions exist. A PO-linked replacement invoice inherits the original PO units, so invoice replacement can correct price/HPP but cannot rewrite a wrong unit recorded on a posted receipt.

For received quantity/unit mistakes, the UI directs the user to review the receipt, actual stock, and related documents with Super Admin before making a safe return and a new PO. The return must be valid for the original source and remaining stock. No destructive update of posted stock, receipt rows, or journal entries was introduced. Cases with already consumed stock, insufficient returnable stock, or historical conversion mismatches still require reconciliation rather than an unconditional return/edit shortcut.

## Files

- `src/app/(app)/pembelian/[id]/page.tsx` — visible correction actions, dependent-document checks, invoice links, and guidance.
- `src/app/(app)/pembelian/[id]/POCorrectionForm.tsx` — unit correction and base-cost preview.
- `src/app/(app)/pembelian/baru/{page.tsx,POForm.tsx}` — load and display selected destination stock.
- `src/app/(app)/pos/pemindahan/baru/{page.tsx,PemindahanForm.tsx}` — load and display selected source stock.
- `src/lib/warehouse-stock.ts`, `src/components/WarehouseStockHint.tsx` — checked stock loading and shared unit display.
- Related component/library tests, including correction visibility, unit payload, warehouse/unit changes, zero stock, pagination, failed stock loads, and legacy draft restoration.

## Verification

- Focused purchasing/warehouse-stock suite: **22 tests passed across 5 files**.
- ESLint on all changed purchasing/stock UI, loader, component, and test files: **passed**.
- `git diff --check`: **passed**.
- `npx tsc --noEmit`: **passed at 10:31 UTC**, before parallel HPP work added new tests. A later run reported only concurrent `src/lib/__tests__/hpp-moving-average.test.ts` signature/property mismatches; that separate workstream owns those changes.
- Full `npm test` at 10:31 UTC: **2203 passed, 3 failed**. Two sales-detail tests in `merchant-fee-report-pages.test.tsx` had stale mocks lacking `supabase.auth.getUser`; root owns those fixes. The third failure was the existing PO acknowledgment test in `remaining-transaction-forms.test.tsx`, which expected `draft_key`/`transaction-confirmed` although PO creation already uses `request_key`/`purchase-confirmed`. Its fixture was corrected, and positive acknowledgment plus wrong-key retention now pass in the focused suite.
- Regression tests were observed failing before the corresponding UI behavior was implemented.

`AGENTS.md` requires consulting installed Next.js guides, but this checkout's `node_modules/next/dist/docs/` directory is absent. The changes preserve existing App Router/server component and client form patterns. No browser or live mutation was performed in this workstream.
