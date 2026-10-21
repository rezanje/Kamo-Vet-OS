# Bounded purchase-invoice correction release

Baseline: main 8197ab7, with production purchase/payment/reconciliation and sale/save-feedback fixes retained. This release extracts only the previously reviewed invoice lifecycle from 89e8676. Inventory adjustments, payroll, bank transfers, opening balances, standalone advances and reset changes are excluded.

## Included behavior

- PO and direct invoice creation atomically commit invoice rows, exact stock valuation, journal, attachments and a durable result. Repeated matching requests return the original result.
- Active OWNER can cancel an invoice or prepare a reviewed replacement while retaining the original invoice and signed journal/stock evidence. Active payments must be reversed first; dependent returns/stock consumption, uncertain legacy provenance, closed periods or a different VAT month block cancellation.
- Active debt, purchase/dashboard/operations and payment-order readers exclude void invoices. The dated subledger and VAT journal sources retain reversals and history. Replacements cannot be linked more than once.
- Source branch/item/account/warehouse checks remain authoritative in the database, including current checks after waits. Proof and request tables remain private with RLS.

## Current verification

- 20 focused application suites / 125 tests passed: actual invoice/payment forms, draft acknowledgement/recovery, action payloads, signed dated debt, purchase dashboard, tax/operations readers and existing receipt feedback.
- Native PostgreSQL invoice suite passed with all release migrations: original purchase-recovery/receipt/FIFO assertions; actual PO/direct invoice, VAT/valuation, exact rollback, cancellation/replacement, payment prerequisite, dependency/access guards, same-key concurrent create/cancel, both stock-consumption/cancellation orders and inactive account detection after journal-counter waits.
- Native purchase-payment suite passed, including original payment regressions, source deactivation, duplicate cancellation and supplier-wide shared-advance races.
- Native sale/FIFO/payment/reward regression suite passed again.
- TypeScript, scoped ESLint and diff whitespace checks passed.
- Fresh 199-table production backup 554f355e-4d73-453e-957e-6c5bb5b20e98 persisted with a verified checksum. Actual isolated restore passed and validated all 199 tables.

## Release gates at preparation

Current preview build, one production migration and authenticated no-write production checks remain gates. No live invoice correction or deployment is claimed by this preparation record. Final results will be recorded on the release PR and the user-facing status report. No reset is repeated, no financial production fixtures are manufactured and no external refund is automatic.
