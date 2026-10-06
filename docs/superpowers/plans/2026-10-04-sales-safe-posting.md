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


Review correction: cumulative skipped invoiced quantity can reassign historic HPP when a later shipment is backdated. New invoice lines now persist immutable delivery-line quantity/cost allocations. Subsequent invoices consume remaining delivery quantities and cost; the final allocation carries residual cents. No shipment date restriction is introduced. A selected partially billed legacy row without complete historical allocations is blocked with an actionable finance reconciliation message; no historical invoice is backfilled. Verification first reproduced the backdated regression (expected remaining HPP49, old cumulative skip gave44), then passed with the allocation ledger. Forced allocation-insert failure and retry verify rollback and one ledger allocation per invoice/delivery pair.


Independent-review corrections: the RPC/RLS boundary now checks active accounts and the application's existing module defaults/overrides. ReactDOM tests first reproduced changed server-render keys after response loss. Forms now persist only tab-local identity, fail closed without storage, and keep a read-only recovery action reachable after quantity exhaustion. Confirmed success retires only the matching operation/order key. Recovery rechecks active actor/module/current and recorded branches under the same order→request lock order; it creates no document, stock movement, journal, or allocation.


Financial read correction: sales-module gating belongs to writes/RPCs, not shared invoice reads. Default FINANCE can use AR/tax/ledger/report modules without sales permission. SELECT now independently requires an active actor and the existing branch predicate. The regression first proved two invoices/Rp377 disappearing under authenticated FINANCE; those reads are restored while sales conversion/posting remains denied. Disabled FINANCE still sees no invoices.

Release integration, 6 October 2026: merged current production including recurring journals, clinic care and purchase recovery. A fresh whole-branch review found a P1: sales-only invoice RLS blocked the existing inventory/cashier stock-shortage invoice after stock/HPP had already changed. `sales_opname_access.sql` reproduced the denied INSERT before the correction. The fix preserves INSERT only for actor-owned `selisih_stok` invoices without orders and their lines without order-item links, with active account, current branch and inventory permission or own open petshop shift. Normal sales, edits, forged creators, another actor's lines, foreign branches, closed/clinic shifts and disabled actors remain denied.

Integration also reproduced a valid assigned DOCTOR quotation conversion being denied despite the application's default all-module access. The five existing roles now follow the same module/default/override and branch checks; an explicit klinik-only override and disabled/cross-branch actor still reject. This preserves Akses Grup rather than introducing a new module grant. Existing role-denial coverage now explicitly configures the restricted module.

Validation: 168 Vitest files / 1,506 tests, TypeScript, changed-file lint and production build pass. The installed lockfile's existing jsdom test dependency was installed without changing dependency declarations. The PostgreSQL 16 runner applies 180 source migrations with auth/storage and pre-0068 COA fixtures; both new authorization regressions, the financial SQL suite and four real two-session stock/quantity/retry races pass. Same checks also run with current production stock-out and branch helper definitions. This is not a clean Supabase provisioning or a production financial transaction test. No historical allocation backfill or full draft field retention is included.
