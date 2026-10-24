# U03 / U04 / U05 — remaining master and CRM selectors

Independent code batch on PR106 `fa3538c`, with PR103 `a58c5e1` dependency. PR105 and its therapy migration are not included or modified. No target write, migration, main merge or deployment attempted; parent reported automatic approval denied PR103 merge. This batch is code preparation within the authorized checklist, not another route to execute the denied merge.

## Proven scope

| Surface | Change and preserved behavior |
| --- | --- |
| SKU substitute | Name-first searchable field; separate code, exact hidden reference ID. Unavailable stored reference survives an unrelated edit. Unmatched nonempty text blocks submission; explicit empty input clears. Reusing the field with another stored ID resets its state. |
| Group SKU components | Existing group component ID, quantity, units/factor JSON contract retained. Search does not silently switch ID or reset units; only an explicit result changes the component and default unit. Item type remains visible separately. No BOM/stock/pricing mutation policy changed. |
| Variant family membership | Name-first code-search for exact SKU IDs. Repeated hidden item_id and label fields retain alignment; stable UI row keys preserve the third row's ID/label when removing the middle row. Membership/status/category actions remain existing. |
| Variant SKU/category catalog | Active, non-Group SKU filters preserved, former limit2000 replaced by checked count/pages with unique ID ordering; fixture 2.205 items is searchable. Category list checked as well. Login/OWNER/ADMIN management gates retained. Read failures suppress forms. Family-header/embedded member listing is still the existing query, not newly claimed as an exhaustive family-history audit. |
| CRM customer-category discount exceptions | Exact item:/kategori: target IDs retained. Category hierarchy/status uses flatOptions existing. Shared field renders product names and separate codes; category choices explicitly say Kategori. Rule table splits product code/name. Discount precedence, percentage validation, write/delete actions and readonly role gate unchanged. |
| CRM read completeness | Active items, categories and rules for the exact customer_category_id use checked pages/count/stable ID ordering. Fixture 1.205 items; failures distinct from empty and no edit form against partial context. No cross-category rule query. |
| Compound formula selection | Only the same bound active formula versions are offered. Formula name/version and reference code are separate; stale/unassigned/inactive formula IDs still cannot enable submission. Existing technical steps/ingredients/dosage policy unchanged. K10 usage-label changes from PR105 are not overwritten. |
| Production output and stock-card heading | Name displayed separately from code, without changing stored descriptions, units, movement calculations or links. |

New ItemReferenceField is for these master/reference forms only; it does not replace transaction-draft state APIs. No schema, actor, role, RLS, financial or stock action change. Master group/substitute loaders already use completeReportQuery with an ID tiebreaker; their existing 6.001-component/count/failure regressions were retained and rerun, not reimplemented.

## Executed verification

- RED: variant name/reference control, CRM incomplete/error reads, variant catalog cap, stored-default refresh, and optional unfinished-search regression. [Reference](../evidence/2026-10-23-master-crm-selectors/reference-red.log), [CRM](../evidence/2026-10-23-master-crm-selectors/crm-red.log), [variant cap](../evidence/2026-10-23-master-crm-selectors/variant-red.log), [default refresh](../evidence/2026-10-23-master-crm-selectors/default-refresh-red.log), [optional search](../evidence/2026-10-23-master-crm-selectors/optional-search-red.log).
- **46 tests / 11 files pass**: exact IDs/duplicate names, unavailable FK preservation, required/optional validation, repeated variant row deletion, group quantity/unit, CRM readonly/filter/pagination/errors, variant auth/catalog, official binding/stale IDs, stock card and existing group/discount/clinical regressions. [Focused tests](../evidence/2026-10-23-master-crm-selectors/focused.log).
- Independent review found and verified the optional-reference P2 fix. No remaining P1/P2; reviewer independently ran **12 tests / 4 files**. [Review](../evidence/2026-10-23-master-crm-selectors/review.txt).
- Final build and scoped lint passed. Separate post-build typecheck passed (exit 0). [Typecheck](../evidence/2026-10-23-master-crm-selectors/typecheck.log). [Build](../evidence/2026-10-23-master-crm-selectors/build.log), [lint](../evidence/2026-10-23-master-crm-selectors/lint.log), [reference lint](../evidence/2026-10-23-master-crm-selectors/reference-lint.log), [source hashes](../evidence/2026-10-23-master-crm-selectors/source-sha256.json). Existing build warnings are retained; no gates loosened.
- No repeated full suite, new browser/keyboard/mobile campaign, user workflow simulation or live data writes. Shared picker keyboard/portal behavior was previously verified under PR103; this is not a claim that every new screen received browser UAT.

## Remaining scope and release

This closes the known remaining visual controls identified in the POS/master/CRM lane. U03/U04/U05 remain globally partial: purchase-owned PO native labels are outside this lane; historical invoice/prescription descriptions are not heuristically stripped; other loader/embedded-child completeness remains unproven. Branch/account codes and screen-reader labels remain identifiers, not SKU name prefixes to delete.

Ready PR is coordinated with release lane only after PR103/106. No database migration. Rollback is a source revert. PR103/105/106 remain unchanged. Code/pushed/ready PR is separate from main/deployed/UAT. Parent owns Sheet updates and the blocked release decision.
