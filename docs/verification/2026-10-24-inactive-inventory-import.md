# M04 partial: inactive inventory validation

Base main: `6e581f8fda8e15b5288d3642af2c45bfd21b944a`.

## Reproduced cause and change

The stock-only master loader replaced the type of an inactive item with the text `Tidak aktif`. The resolver consequently classified an inactive inventory SKU as noninventory and reported it as a service to skip. Separately, combined master/stock preflight projected incoming type and units but omitted the incoming activation flag, so a source row explicitly marked inactive could appear ready for stock preparation.

Keep activation separate from item type. Existing-master lookup and incoming-master projection both carry `isActive`; an inactive inventory row is rejected with an actionable inactive-master reason before unit conversion. Actual services and noninventory items retain their existing skipped status. Mixed valid/rejected rows remain subject to the existing preparation and OWNER accounting review.

No migration, master activation, stock/journal write, account/permission change, new rounding rule or posting-guard relaxation. Native active-item verification still applies. This branch does not contain the separately denied N01 work.

## Evidence

- Two action regressions failed before the production fix: inactive inventory was skipped, and explicitly inactive incoming inventory was considered valid.
- The new regressions plus neighboring import/parser/UI suites passed: 56 tests in six files.
- The unchanged private source file was parsed and resolved again using read-only target metadata: 304 rows, no parse errors, all 304 valid, no changed bytes. The actual target SKUs are active, so this fix is additional validation coverage, not a claim to remove that incident's financial blockers.
- Narrow independent source review found no concrete P1/P2 issue. The reviewer did not access private source data or rerun the test campaign.
- Final application suite: 3,168 tests in 429 files passed. Production build passed using fictional public Supabase configuration with privileged service variables removed. Existing unrelated lint warnings remain. Scoped ESLint, whitespace checks and post-build `tsc --noEmit` passed.

The previously completed isolated actual-file pipeline remains the persistence evidence: one prepared run, 304 posted rows, one receipt and one journal; lost prepare/post responses recover the same stored outcome, quantities/values/debit/credit reconcile. Its date and metadata were explicit TEST assumptions, not an actual source cutoff. SQL/posting is unchanged and that expensive replay is not repeated for this classification fix.

## Release and limits

Application-only rollout; no target migration is needed. Application revert removes this classification change without deleting or reversing any records. Existing SQL guards continue to reject unsupported posting.

M04 and M01 remain partial on the target: the supplied file has no source date, old saved batches contain fractional-cent valuations, and existing purchase/compound stock plus other inventory GL require reconciliation. M05 invoice-level AP/AR still needs its source/export contract and an explicit decision about existing GL coverage; this fix adds no fictitious invoices or balances. Hosted migration acceptance and full user simulations remain deferred.
