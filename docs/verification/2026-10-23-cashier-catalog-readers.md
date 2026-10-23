# U03 / U04 — cashier and existing quest reference readers

Base PR108 `8286584673fbd93ccb15218ce418f13f8456b0b0`, depending on PR103/106. Independent of PR105 therapy migration, PR111 clinical catalogue and PR113 production/master-reference readers. Existing heads preserved. No main merge, target migration or deployment attempted; the denied PR103 merge was not retried.

## Proven scope

| Surface | Fix and boundary |
| --- | --- |
| Cashier receiving | Read header first. Existing login/open shift/shift branch and Dikirim-only status checks occur before child/catalogue reads. Disetujui is still rejected in cashier; no clinic policy copied over. Request children are independently checked in stable exact-count pages using the authorized stored request_id. ID, requested/approved quantity, unit and note retain their existing payload. Active barcode catalogue remains checked. Header/child/catalogue failure or truncated page hides the receiving form with a generic retry message, never database details. |
| Cashier request stock hint | Existing selected active warehouse of the shift branch remains unchanged. Check warehouse errors and load its complete stock rows with exact counts and stable IDs; a late product no longer looks out of stock merely because its row is beyond1000. Failed reads cannot become zero. Stock hints remain hints; no stock movement, receipt action, destination policy, draft identity, units or quantity rule changed. |
| Existing quest product targets | Complete active item and active branch choices with exact-count pages. Shared reference field shows product name and separate code, supports exact-ID search and optional blank with the existing target_ref_id contract. No quest/reward/points/payroll policy or action change. Existing category-target semantics, configuration lists and last20 redemptions are not redesigned or claimed exhaustively checked. |

All reads use the same client/session/RLS. No privileged credentials, auth/role/RLS/grant changes, broader branch query or new financial mutation. Fixture branch/guard tests are code-level evidence, not authenticated target RLS simulations. Read errors suppress partial context. No schema change.

## Executed checks

- RED: receiving/request fixture **12 failed / 2 passed** before fix. Embedded request lines were not independently loaded, parent guards ran after catalogue reads, and late stock appeared zero. [Cashier RED summary](../evidence/2026-10-23-cashier-catalogs/cashier-red-summary.log).
- RED: existing quest reference fixture **4 failed** before checked sources/searchable exact-reference field. [Quest RED summary](../evidence/2026-10-23-cashier-catalogs/quest-red-summary.log).
- GREEN: **59 tests / 7 files passed**, including 1,205-line/catalogue/stock choices, cross-branch and login/shift/status guards, explicit parent child filter, approved unit/quantity preservation, failures/truncation, existing receipt retry/draft identities, atomic request receipt tests, duplicate-name exact references and optional empty setup. [Focused run](../evidence/2026-10-23-cashier-catalogs/focused.log).
- Independent review: **34 tests / 4 files passed**, no P1/P2 findings. Checked guard ordering, Dikirim-only status, exact IDs, stored quantities/units, error handling and unchanged policies.
- Final build, scoped lint and separate post-build typecheck recorded with the batch. No repeated full suite, target write, broad simulation campaign or new browser UAT.

No migration step; rollback by source revert. Parent release lane coordinates integration after PR103/106/108. Ready/pushed/preview is distinct from main, production deployment and user verification.

## Final bounded lane inventory

This closes the remaining cashier-source and quest-choice rows recorded in PR111's inventory. Together with PR111 and PR113, all demonstrated source gaps identified in that bounded clinical/master/production/cashier/quest pass have fixes, rather than repeated visual selector changes.

**Remaining handoffs, not silent completion claims:**

- Purchasing lane: PO/direct invoice product choices and minimum-stock/reorder item/stock completeness. Avoid concurrent changes to purchasing/import/financial workflows.
- Finance/master-pricing coordination: price-list broad query pagination (currently150) and override completeness; commission rule product/category choices. No proof a specific late code is unsearchable merely from the intentional price query limit.
- Ordinary list/history scope: variant-family headers/embedded member listings, production embedded ingredient display/last50 orders, existing quest configuration/redemption history. These are not evidence that an item picker is incomplete, and this batch does not claim to audit all transaction/history lists.
- Historical invoice/prescription free text: no heuristic code stripping or transaction rewriting. Explicit stored provenance is needed for any safe historical presentation fix.
- Clinical policy: K01 same-visit navigation candidate exists, but posted edit role/status/amendment is awaiting user's rule; K09 signed-form rule likewise already asked by parent. K02/K03/K06 and remaining K07 ordinary administration/paid-duration provenance remain documented decisions. K10/K11/K12 are separate PR105 ready code, with its migration still owned by release lane.
- CRM policy: C03 template, C04 package semantics, C05 campaign/voucher linkage remain separate decisions. Existing merged CRM/category/material filtered select/deselect controls are not reimplemented.

U03/U04/U05 remain globally partial until other-lane evidence and deferred user verification are reconciled. Parent owns Sheet candidate notes/checkboxes; this executor did not edit them or retry the blocked release.
