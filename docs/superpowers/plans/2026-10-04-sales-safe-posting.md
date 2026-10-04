# Sales posting completion

Authorized scope: complete the existing quotation/order/shipment/invoice unit contract and make shipment/invoice failure atomic. No new draft, expiry, recurrence, discount, or price policy.

Root cause: shipment creates its header before stock RPCs, catches stock errors, and still advances shipped quantities. Invoice ignores line/update errors and uses a best-effort journal. Both use stale application remainders and have no request identity. Quotation conversion ignores line insertion errors before accepting the quotation.

Design: dedicated authenticated, branch-scoped transaction RPCs lock the order and selected lines, validate exact requested quantities against current remainders, preserve stored unit/factor/price snapshots, issue FIFO/FEFO stock and shipment HPP, allocate invoice HPP from shipped units, and post balanced journals. Stable form request keys return the original document on identical retries; changed payloads fail. Stock/journal/line failure rolls the entire call back. Service/free-text lines skip inventory. Quotation conversion locks the quotation and copies all lines before acceptance. Shared purchase/clinic/recurrence posting functions remain unchanged.

Plan:
1. Write action boundary regression tests and disposable PostgreSQL tests; observe failures.
2. Add migration 20261004150000_sales_safe_posting.sql and route actions/forms through RPCs.
3. Verify box + pcs same SKU, partial shipment/invoice, HPP, PKP, rollback, retries, authorization/RLS, two-session races; run full Vitest, TypeScript, targeted lint.
4. Commit logical stages and report remaining release gates precisely.

Local Next installation is 15.5.25; AGENTS.md's node_modules/next/dist/docs guide path is absent. Follow installed server-action typing and existing application conventions.
