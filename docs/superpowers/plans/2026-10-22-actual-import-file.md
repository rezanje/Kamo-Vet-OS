# Actual supplied import file investigation

Base `007a507`: preserve PR84/85 and exclude A01/PR82/PR83. Execute inline with systematic debugging and test-first. Report before production release per the renewed delegation.

The actual Library workbook is held privately outside git. Its 485 data rows all omit Jenis Barang; 304 positive stock rows also have no source date. No master type or posting date may be guessed. Await the minimum user clarification on those values.

Verified actual-file pipeline using unchanged production parsers/actions and an owned network-none PostgreSQL fixture with all 222 migrations: master parser accepts zero/rejects 485; preview incorrectly returns ok; confirmation incorrectly reports done and marks an empty master batch posted; stock preparation rejects all 304 and accounting review/posting must remain blocked. Raw input/responses remain private; publish only aggregates and synthetic regressions.

- [x] Materialize the actual attachment and inspect true XLSX structure before parsing.
- [x] Reproduce master preview/confirmation and stock preparation against isolated PostgreSQL using the real actions. Record exact private responses and sanitized aggregates.
- [x] Verify the saved accounting review/posting denial and no financial writes.
- [x] Write failing synthetic tests: all-rejected preview/confirmation and empty template must not become ready/done or write an import batch; missing type error must explain allowed values.
- [x] Fix zero-valid-master guards without inventing item types or weakening posting checks; rerun actual-file responses.
- [x] Run synthetic valid/precision-boundary import through preparation, saved review and native SQL posting/retry; distinguish that fixture from the unchanged actual file.
- [ ] Run full tests, typecheck, scoped lint/build, review and publish scoped branch/PR with remaining data blockers. No production release.

Additional source evidence: 253 of 304 stock rows have fractional-cent valuations and the aggregate is not an exact cent amount. The existing accounting guard requires exact cents; verify its behavior independently rather than silently rounding source values.

Results: actual unchanged file with hypothetical existing inventory metadata prepares 304 rows but native review/posting deny fractional-cent valuation. After the scoped fix, unchanged actual preview/confirmation stop with 485 rejects and no database writes. Synthetic valid posting reconciles qty 3/value 37.5 with one journal and identical retry receipt. Four RED→GREEN regressions, full 2,417 tests, TypeScript, scoped lint and build passed. Independent review: no Critical/Important regression; 51 tests rerun.
