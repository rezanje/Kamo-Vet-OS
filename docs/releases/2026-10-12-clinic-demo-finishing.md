# Clinic DEMO consent and financial policy

MEET-07–09 implementation uses explicit example policies authorized for the demo. Default shared pool is 5% of net service after discounts, excluding tax/admin, split equally between selected eligible recorded staff. Admin is per-method integer-rupiah rounded: Transfer 1%, Tunai/QRIS/other methods 0% initially. OWNER/ADMIN can create prospective versions and choose customer/company bearer.

Checkout initially supports full single/mixed payments. It uses existing invoice, stock, receipt and journal primitives in one transaction; stored allocations replace legacy clinic commission and flow into payroll. Reissue preserves policy, payments, staff and original earning month. Paid DEMO money-changing corrections/refunds remain outside this initial scope.

Rawat Inap consent has a specific category/default template, immutable document and patient/owner/branch identity snapshot, stale-draft rejection and serialized signing. Admission plus initial history is atomic and the persisted request key survives draft recovery.

Verified before release:

- 202 Vitest files / 1,711 tests, TypeScript, production build.
- 191 repository migrations on disposable PostgreSQL 16; consent, demo finance, invoice, billing lifecycle, occupation and compound binding suites passed.
- Real transaction races: signature versus visit branch update and duplicate signature passed.
- Finance rollback after second receipt failure, payload replay/conflict, customer/company accounting, discounted/taxed basis, deduplication, and prior-month reissue passed.
- Independent review: consent branch/stale-draft race, earning-month reissue, admission draft identity, and per-method company printing findings resolved and verified.
- Connected demo migrations applied atomically; default policy and typed global template created through the UI. WA engine read back disabled before demo checkout.

Production deployment and live scenario evidence are recorded after release.
