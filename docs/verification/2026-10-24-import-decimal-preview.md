# Decimal import: source quantities and visible monetary normalization

The combined Accurate importer dropped the existing valuation policy before preparation. Text numeric parsing also removed decimal points indiscriminately, and quantity previews/recovery used JavaScript numbers and four-decimal formatting. Native XLSX numeric XML and the existing SQL normalization already retained source strings; those SQL guards remain unchanged.

The importer now preserves source quantity/value strings through conversion, duplicate grouping, RPC payload, saved recovery and display. Unambiguous dot/comma decimal text and mixed grouping formats are supported. Native XLSX numeric cells always use original XML. Ambiguous dot-only three-digit text retains its established Indonesian grouping contract (`1.234` means 1234); it is not a new automatic locale inference. A value below the supported compatibility-number range is rejected explicitly instead of silently becoming zero stock.

Combined, manual and stock-only previews show exact base quantity, full source money, proposed two-decimal HALF_UP total and signed difference, including when STRICT refuses preparation. Monetary normalization is an explicit choice; stock quantity is never rounded. Original source values remain preserved. The existing SQL still allocates a representable residual deterministically and can reject a batch whose normalized value cannot be represented by its quantity/HPP layers. A positive residual can change a free item's allocated cost under that existing policy; per-item source valuation is not claimed preserved. No authoritative external control total or actual balance date is invented.

Policy/file/date changes invalidate late responses. Saved manual results are bound to their File/master identity. Same interpretation/file/date/policy retries retain one preparation hash; the interpretation version changes so an earlier incorrectly parsed preview is not silently reused. Existing SQL posting and receipt idempotency are unchanged. Old batches lacking original source evidence are labeled incomplete.

## Evidence

- Synthetic RED fixtures reproduced dot-decimal stripping, missing exact fields/policy/display, late-response handling, and a review-found blank-quantity regression. Blank zero-stock rows again skip without aborting other valid rows.
- Targeted import regressions: 70 tests in seven files passed after the review fix (parser/conversion/duplicates, request policy/hash, STRICT evidence, persisted recovery/account denial, stale manual response and both UIs).
- Private original workbook check: 304 valid rows, no parse errors; exact quantity preservation, source-plus-delta reconciliation, source file unchanged. This read-only local check made zero database calls; original rows and monetary totals are not published.
- Aggregate verification and independent review results are recorded with the release candidate.

## Rollout and limits

No migration, permission/RLS change, opening-stock posting, stock deletion or target data mutation is part of this change. Deploy the application normally; rollback is an application revert. Previously persisted batches/history remain. Source cutoff date and overlap with existing stock/GL are still separate reconciliation requirements before any target opening posting. The preview is not proof of posting. User workflow simulations remain deferred.
