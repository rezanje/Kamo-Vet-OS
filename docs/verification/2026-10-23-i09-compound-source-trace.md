# I09: stored compound source links (partial)

Base: main `61376d7736dc1669925f4214f1a978e30a053750`.
Branch: `codex/i09-compound-source-trace-20261023`.

## Reproduction and cause

The compound margin/material report already held recipe, material, visit and invoice IDs, but rendered source cells as plain text. Its invoice link contained only the visit ID, and the print page ignored an explicit invoice selector. A source request could consequently select the current invoice rather than enforce the requested source identity. The report did not read the stored selling-parent binding.

Synthetic component/reader tests first produced 11 failures for missing parent enrichment, missing source links, ignored invoice selectors and source-read errors. A separate rendered-report regression failed before cell links were added. No customer data, target transactions or hosted user simulations were used.

## Change

- Read `clinic_compound_sales` for visible recipe IDs through the existing checked, paginated 100-ID lookup. Match recipe and visit, use the captured selling parent ID, and reject invalid, duplicate or unreadable bindings. Legacy missing bindings stay unlinked; names/current master mappings are not used as evidence.
- In the existing protected report, link the stored parent, recipe and material to their existing detail pages. Preserve report values, financial calculations, CSV cells and current module/role/branch restrictions.
- Invoice links include both visit and invoice IDs. The print page enforces the requested UUID, visit and existing active-invoice condition, with no fallback when the source is unavailable. Visit, invoice, item and payment read errors stop printing. The existing unparameterized print route is retained.

No migration, financial posting, stock write, RLS/ACL change, new permission or new medical-data field. This branch contains none of the separately blocked N01 resolver or PR128 refund changes, and does not incorporate PR129/130.

## Verification

- RED: 11 source-reader/print failures, plus the rendered-report link failure, reproduced before fixes.
- Focused GREEN: 108 tests in 14 files, including HPP pagination/export/access, source trace and existing invoice-print regressions.
- Final application suite: **3,115 tests / 419 files passed**.
- Narrow independent source review: no concrete P1/P2 blocker reported; review covered stored binding identity, exact-invoice selection, access boundary and unchanged financial values.
- Production build passed with fictional public Supabase configuration and privileged service variables removed from the build process. Existing unrelated lint warnings remain.
- Post-build `npx tsc --noEmit`, scoped ESLint on all seven changed TypeScript files, and `git diff --check` passed.

Local evidence: `/tmp/kamo-i09-trace-red.log`, `/tmp/kamo-i09-ui-red.log`, `/tmp/kamo-i09-focused-regressions.log`, `/tmp/kamo-i09-all-tests.log`, `/tmp/kamo-i09-build.log`. These logs contain synthetic fixtures only and are not committed.

## Release and limits

Deploying this reader/UI candidate requires no schema rollout. Existing `clinic_compound_sales` is used; revert the application commit to remove the new links/selector. There are no new transactions to undo. No merge, target migration or production release is performed as part of candidate preparation.

**I09 remains partial.** This change covers stored sources in the existing billed, active-invoice report. It does not provide a complete historical/production-job graph, unbilled or voided-invoice browsing, historical-label reconstruction, virtual stock counters, or a new definition of virtual incoming/outgoing movements. Missing legacy bindings cannot be reconstructed from names. Linked detail pages retain their existing access rules. Do not mark the entire checklist item complete from this slice.
