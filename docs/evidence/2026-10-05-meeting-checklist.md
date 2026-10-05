# Spreadsheet sweep for the 5 October 2026, 13:00 WIB meeting

Source: [VetOS - Daftar BUG, Report](https://docs.google.com/spreadsheets/d/1HfaR6wK9ImjXQZgeOxH6st9fzyd3VnJBwtJ9RkidC18/edit). The sheet has 15 requests: 2 labelled VERIFIED LIVE (UI), 13 OPEN. This checklist distinguishes shipped behavior, this release, and unresolved data/SQL work; it does not change the spreadsheet statuses.

| Request | Verified status / work remaining |
| --- | --- |
| BUG-01 Stock below zero and missing ordinary medicine cost | Current atomic invoice and compounding SQL passed local last-unit races and retry checks. Production still has 4 negative stock balances and 2 legacy medicine lines without HPP; both missing-cost lines also lack item and recipe IDs. Historical stock/cost reconciliation remains open. |
| BUG-02 Same-day appointment treated as past | Fix merged in PR #5; booking page production GET passed. A production booking write was not performed in this sweep. |
| BUG-03 Clinic revenue by branch | Sheet already labels UI verified. Read-only audit found no active positive-HPP invoice missing an HPP journal; legacy completeness is not certified. |
| BUG-04 Select units in every item form | This release completes clinic medicine lists and printed prescription units. Clinic payment manual alternate-unit SQL restriction identified separately; cross-module coverage remains open. |
| BUG-05 Preserve work after failed save | This release recovers initial examination and inpatient drafts, uploaded references, original request key, and native fields across failed redirect/reload/network errors. POS recovery predates this release. Other transaction forms remain outside this fix. |
| BUG-06 CSV / Excel / PDF reports | This release adds Excel and full-filter printable PDF to new inventory-value and compound-margin reports. Existing report exporter predates it; every report has not been certified. PDF uses the browser print dialog. |
| BUG-07 Fixed asset purchasing | Cash/bank purchase flow already implemented. Asset invoice/recovery work remains in draft PR #21 pending SQL. |
| BUG-08 Number of recurring transactions | Draft PR #22 extended with optional positive run limit, atomic counting, validated history, retries, and review flags. Two migrations required before application release. |
| BUG-09 Compound cost in GL | Current issue/posting functions passed local SQL and concurrent stock tests. Production contains legacy recipes with no compound-linked invoice items; historical GL/recipe reconciliation remains open. |
| BUG-10 Clinic / compound item report | Sheet already labels UI verified. New ingredient/export coverage does not establish complete legacy linking. |
| REQ-01 Actual HPP in Barang & Jasa, inventory-value report | Inventory-value report predates this release; this release adds actual remaining FIFO average to visible SKU rows for OWNER/FINANCE. Inconsistent stock/layers show unknown and flags, rather than fabricated cost. |
| REQ-02 Company-controlled official compound formulas | Master compound SKU listing shipped in PR #25. Production has zero active official formulas. Approved ingredient quantities must be supplied by the company; they are not inferred from product names. |
| REQ-03 Compound date/branch/qty/ingredients/cost/sales/margin/doctor | Existing report plus this release's full-filter Excel/print and ingredient labels. Exact immutable ingredient cost requires the separate protected SQL reader. Legacy unlinked recipes remain excluded and disclosed. |
| REQ-04 Doctor access to cost | OWNER/FINANCE-only policy retained. Read-only role audit found no positive direct HPP visible to DOCTOR; FINANCE could read it. New export authorization tests pass. |
| Unnumbered: doctor/groomer salesperson on invoice | POS already has staff attribution; clinic payment now supports validated active branch doctor/groomer/staff selection in PR #28. Posting keeps existing invoice attribution sealed. Existing invoices preserve their posted attribution. |

## Aggregate verification before application release

- Main base: `3caaab34b076fc1b4405a49119e4f7b18473963c` (PR #25).
- Initial combined suite: 147 files / 1,352 tests passed; TypeScript passed. Payment catalogue/staff integration: 150 files / 1,373 tests, TypeScript and production build passed; recovery follow-up needs its final aggregate verification.
- Browser fixture uses real clinic React forms but substitutes action/storage boundaries and blocks external requests. It covers both forms' medicine pagination, units, recovery, request keys, account isolation, uploaded references, malformed/expired/disabled storage, discard and confirmed-success clearing. It does not prove deployed server-action transport.
- Local PostgreSQL 16 fixture applied all 169 main migrations using auth/storage/publication/bootstrap shims. This is not a clean hosted Supabase provisioning certification.
- Clinic issue, invoice, official catalog, atomic examination, billing lifecycle, discharge, and guarded inpatient-note SQL regression suites passed on the disposable fixture.
- Dedicated local two-session tests: one last-unit invoice and one compound issue commit; competing request rejects STOCK_SHORT; stock stays zero, cost/journals are balanced, and same-key retries do not duplicate mutations.
- Production 12:01 WIB read-only audit: 7 active invoices, all legacy without request keys; 2 medicine lines lack HPP; 0 compound-linked invoice lines; 4 negative stock balances; 0 active official formulas. Private compound ledger remains inaccessible directly to authenticated users.
- Production read-only browser smoke: booking, queue, inpatient, official catalog, inventory value and compound margin pages returned 200; no browser errors. Post-release production smoke also passed (see below).

## SQL release order and data limits

1. Application release can precede optional `20261005051000_compound_cost_report.sql`; the report explicitly marks immutable ingredient cost unavailable when the RPC is absent. No other RPC failure is silently hidden.
2. Recurring PR #22 requires `20261004110000_atomic_recurring_journals.sql`, then `20261005051500_recurring_occurrence_limit.sql`, before its application code.
3. Manual alternate-unit invoice posting needs a separate reviewed migration before its payment UI is enabled.
4. Neither code nor migration fabricates missing legacy cost, adjusts negative production stock, or creates company-approved formulas.

At the latest environment check, only the public Supabase URL and anon key were configured. Production SQL execution or a management token was still unavailable. No business records were changed by this sweep's production checks.

## Production release evidence

- PR #26 merged as `05856a7d627743d9521fbd1025e1c65b28e8d64a`. Production deployment `6852074041` succeeded at 12:34 WIB on 5 October 2026.
- Production browser GETs for booking, queue, inpatient, official catalog and both HPP reports returned 200 without browser errors. OWNER SKU page displayed the new FIFO average column.
- Production inventory Excel was decoded successfully: 645 data rows plus header and metadata sheet, with `private, no-store`. Compound Excel had separate margin, ingredient and metadata sheets. Both isolated printable report routes returned 200 with full-filter scope and browser PDF control.
- New export access check: anonymous requests redirect to login (303); DOCTOR gets 403; FINANCE gets 200 for both report downloads. DOCTOR has no SKU HPP column. FINANCE's existing default module rule blocks the SKU route; this release does not widen it.
- Production initial-examination recovery check passed for an existing editable encounter: an UNSUBMITTED browser field survives reload with the same request key and explicit discard clears it. After login, the browser blocked all non-GET/HEAD requests; none were attempted. No business submission was performed.
- Refreshed read-only legacy audit at 12:39 WIB confirmed the same 7 active legacy invoices, 2 missing-cost medicine lines, 0 compound-linked invoice lines, 4 negative stock balances and 0 active official formulas.
- Optional clinic SQL is ready in draft PR #27; recurring migration/application package remains draft PR #22. Both are intentionally excluded from the schema-free clinic release.

## Payment recovery scope and remaining loyalty limit

PR #28 adds payment session recovery, scoped/remounted by user, visit and invoice identity. It retains row references, chosen units/prices, discounts, payment/staff/points inputs and the original request key; it restores current authoritative locked inpatient rows. The draft clears only after server acknowledgement. Confirmed same-key invoice creation replays use the original posting RPC/hash verification rather than entering correction, and do not award loyalty again in the sequential replay case.

Loyalty is still a separate non-atomic side effect: concurrent first attempts can both award, and a first award that failed after invoice commit is not backfilled by this replay path. Changed points/promos/day/shift may safely conflict with the original SQL request hash. Invoice/stock posting remains idempotent; this release does not certify universal loyalty recovery.
