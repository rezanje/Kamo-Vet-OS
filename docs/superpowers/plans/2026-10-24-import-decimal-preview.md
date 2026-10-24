# Precise decimal import and visible money rounding

User scope: accept source decimals without manual workbook edits, preserve stock quantity precision, show monetary rounding differences. Code and tests only; no target opening posting, stock deletion, migration replay or unrelated clinical/global-number UI changes. Parent coordinates release.

## Evidence and approach

Native XLSX source lexemes and SQL numeric preparation already preserve source strings. Confirmed gaps: textual dot decimals are stripped as if every dot were a grouping separator; combined import never forwards HALF_UP_BATCH_V1; recovery converts exact database strings to Number and preview displays only four quantity decimals/whole rupiah. Screenshot alone does not identify the offending rows.

- [x] Reproduce parser, exact conversion/duplicate sums, preview display and combined-flow policy propagation with synthetic RED fixtures.
- [x] Add import-local decimal arithmetic/formatting. Retain numeric XML text, Indonesian textual compatibility and explicit handling of unambiguous dot decimals; do not silently change ambiguous legacy thousands notation.
- [x] Carry exact quantity/value strings through resolution/recovery/preview. Keep compatibility numeric fields, but use exact evidence for quantity display and source/rounded/delta summary.
- [x] Expose existing explicit HALF_UP batch choice in combined flow, invalidate stale results when changed and send it consistently to preflight/preparation. No rounding of quantities, automatic posting or posting guard changes.
- [x] Focused regressions, private original-workbook read-only parse check if available, review, final test/typecheck/lint/build as appropriate. Preserve STRICT zero-write rejection and unrepresentable-residual guard; explain remaining valuation limits instead of inventing new financial policy.

Existing HALF_UP SQL remains authoritative for durable preview; displayed proposed totals are not proof of posting or an authoritative external control total. Actual source date, SKU metadata and existing stock/GL reconciliation remain separate.

Focused RED/GREEN verified parser, full quantity/rounding display, policy propagation, stale manual responses and persisted recovery. Original private workbook: 304 valid resolved rows, exact quantity preservation, delta reconciliation, unchanged source, zero database calls. Full integrated verification and independent review are recorded in the verification report before release.
