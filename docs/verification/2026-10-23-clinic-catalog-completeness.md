# U03 / U04 — clinical catalogue completeness

Base: PR103 `a58c5e107f81872772330f31dfdfcf887bf53d00`, already reconciled with released main `e46f45e97ae2500b3aaade5e8a9e50915f9fcca3`. PR105/106/108 remain unchanged. No migration, main merge, deployment, target write, or retry of the denied PR103 merge.

## Demonstrated defects and fix

- Official compound formula loader returned only the first PostgREST page. A fixture with 1,205 permitted active formula headers returned 1,000 before the fix. Headers now use checked exact-count pages, ordered by code then unique ID. Current versions are resolved only through stored IDs, in batches of 200. Missing, inaccessible, failed or truncated version reads stop the load instead of presenting an incomplete catalogue. Existing unpublished headers without a current version remain omitted; inactive headers remain available only when callers explicitly request them.
- Examination and inpatient-note master SELECTs omitted code, although the shared picker already supported separate code display/search. Tests using actual selected-column projection observed null ordinary medicine/service/material codes. Both readers now include nullable code; name, item ID, classification, stock, branch prices, quantities and units retain their contracts.
- Affects official formula choices in examination, inpatient notes and administrator catalogue, plus ordinary medicine/service/material code search in examination and inpatient notes. Same authenticated session, existing RLS, existing parent and role gates; no service-role client or wider visibility. A mocked denied read tests empty permitted results, not a claim of authenticated database RLS integration.
- The standard checked-reader limit of 10,000 formula headers remains explicit: larger lists fail visibly rather than truncate. No catalogue data or ingredient snapshots are rewritten.

## Verification

- RED observed: formula fixture 1,205 returned 1,000; inactive/missing-version/partial-header checks failed before the loader fix. The two additional code propagation tests failed before adding code to the SELECTs; 19 existing page tests still passed. [Code RED summary](../evidence/2026-10-23-clinic-catalog/codes-red-summary.log).
- GREEN: **36 tests across 5 files passed**. [Focused run](../evidence/2026-10-23-clinic-catalog/focused.log). Covers late formulas, exact version IDs, bounded batches, active/inactive/unpublished, missing/inaccessible versions, source errors/truncation, code propagation, existing clinical service classification and branch price/stock/unit enrichment, and name/code picker regressions.
- Independent review: no P1/P2 findings, **29 tests across 4 files independently passed**; pagination, RLS query scope, composite formula-version FK and nullable code types checked. No reviewer edits or target actions.
- Scoped lint, build and separate post-build typecheck are recorded alongside this document. Full suite and user workflow/browser simulations were not repeated for this bounded read-only change.

No schema deployment step. Rollback: revert this candidate's source changes; preserve PR103 dependency. Code/pushed/ready/preview do not mean main, production deployment, or UAT complete.

## Bounded inventory of remaining U03 / U04 / U05

This inventory identifies menu sources rather than equating one shared picker with complete global coverage. Candidate scope below is not yet released while the main integration action is blocked.

| Menu / source | Actual evidence and disposition |
| --- | --- |
| CRM promotions and clinical material bulk selection | C02/PR96 and PR101 released earlier: category-aware search and active filtered select/deselect, preserving selected IDs outside filters. Do not reimplement. |
| Examination, inpatient note, payment, clinical request/receiving | PR103 covers shared name/code controls and checked item/enrichment sources. This candidate closes the formula-source cap and missing code projections. Clinical latest-record limit1 queries are intentional document/default selections, not product catalogue caps. |
| Clinical official catalogue formula control | PR108 changes presentation/binding. This candidate separately fixes its shared formula reader. K10/11/12 belong to PR105 and are not included here. |
| Sales quote/order/online; production recipe entry | PR103 name/code picker controls; sales item source checked. Production active item/recipe/warehouse sources still use unpaged queries: an actionable remaining U04 read gap. No business policy decision required. |
| POS request/transfer, stock-card selector | PR106 controls; existing loadKatalogPermintaan checks product/unit source. Stock-card heading split in PR108. Warehouse and account code labels are not product-name prefixes. |
| SKU substitute/group, variants; CRM discount exceptions | PR108 controls and variant/CRM checked reads. Group/substitute product sources already checked (existing 6,001-component test). SKU category/brand/unit/supplier metadata reads remain unpaged and are an actionable U04 source gap. Family embedded-member listing is not proven exhaustive. |
| Cashier inventory request/receiving | Request product catalogue is checked; receiving barcode catalogue checked. Receiving still reads request children embedded and performs its branch/status gate after loading catalogue: bounded remaining reader/ordering gap, not a new permission policy. Request stock hints use an unpaged stock read. |
| Price list | Intentional 150-row search result cap; broad matching results lack pagination. This is a list-completeness gap, not proof specific late codes cannot be searched. Price overrides also remain unverified at scale. Coordinate ownership before changing price-related screens. |
| Commission/quest product reference selectors | Direct active-item reads remain unpaged. Commission overlaps finance lane; hand off rather than concurrently change incentive rules. Quest is existing configuration, not authority to add payroll automation. |
| Purchase PO/direct invoice; minimum-stock reorder | Other lane owns purchasing/import/finance. PO code/name native controls and minimum-stock item/stock completeness are explicit handoffs; not silently marked covered by these candidates. |
| Persisted invoice/prescription descriptions | Do not heuristically strip codes from historical free-text/snapshots or rewrite transactions. Presentation requires reliable stored code/provenance for each surface; not claimed globally solved. |
| Global branch/category multiselects outside CRM/material controls | No assertion every native select or checkbox list is a product selector. Role/access matrices, import mapping, consent categories and fixed clinical states are distinct contracts. No new selection/eligibility policy invented. |

Clinical policy blockers remain K01 posted-edit role/status/amendment rules, K02 BMHP timing/model, K03 finished-stock shortcut scope, K06 paid-to-inpatient eligibility/billing, K07 ordinary administration/paid-duration provenance, and K09 signed-form rules. Parent already asked K01/K09; do not ask repeatedly. C03 template, C04 package semantics and C05 campaign/voucher linkage are separate decisions. U03/U04/U05 remain globally partial pending the explicit read gaps, other-lane coverage and deferred user verification.
