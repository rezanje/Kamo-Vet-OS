# M04 partial: complete and verified CSV master reads

Base main: `538dc13ad5ab7c072c4aa8038539d44f1286cc1b` (PR132 released). This is a separate generic-CSV path on the item import page; it is not the Accurate workbook's unresolved target reconciliation.

## Reproduced failure

The CSV action selected categories, brands, units and existing codes once, with the default API row limit, and discarded their error fields. A failed or null lookup could be treated as an empty master. References and duplicate codes beyond the first page were unavailable to validation, so a valid new row could be rejected for an existing category, or the entire insert could fail when a later existing code was mistaken for new.

Six action regressions failed before implementation. The fixture models the first-page cap and atomic duplicate rejection; its profile identity was corrected before recording the meaningful RED run.

## Change

Use the existing paginated loader with stable CSV ordering. Retain active-only categories and units and the existing all-code duplicate check. Unknown/error reads stop before insertion with a clear master-load error; they are not reported as nonexistent categories or success. A null/non-array shared-loader response also fails closed. Other loader callers retain their previous query options.

The CSV validator and single atomic item insert are unchanged. Good rows still import beside rejected rows, inactive references stay unavailable, and a retry sees already-created codes instead of inserting them again. No automatic reference creation, new pricing policy, mutation retry, migration, authorization change, stock or journal posting.

## Verification

- Seven new action checks cover four master-read failures, a null response, references/codes after the first 1,000 rows with duplicate-safe retry, and inactive references.
- Focused suites: 107 tests in seven files passed, including Accurate, initial-stock, inactive-item and category regressions.
- Narrow independent source review: no concrete P1/P2 finding; source only, without another full test campaign.
- Final application suite: 3,175 tests in 430 files passed. Production build passed with fictional public Supabase configuration and privileged service variables removed; existing unrelated lint warnings remain. Scoped lint, whitespace checks and post-build `tsc --noEmit` passed.

All fixtures are fictional. The original private workbook and financial replay are not copied or needlessly rerun for a CSV reference-loader change. Existing target stock/GL and the missing actual source date remain pending; M01/M04 are partial and M05 invoice-level AP/AR is not implemented by this fix.

## Release

Application-only rollout and revert; no target schema migration or data cleanup is needed. Revert preserves records but restores the earlier validation limitations. Do not mark hosted migration acceptance or simulations complete from this change.
