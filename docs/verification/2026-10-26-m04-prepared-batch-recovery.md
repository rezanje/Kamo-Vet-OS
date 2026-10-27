# M04: prepared batch remains visible when scope memory fails

The initial-stock action previously prepared and recovered a durable batch, then attempted to save an optional source-to-warehouse mapping. If that separate mapping write failed, the outer error handler returned `ok: false` without the already-prepared run ID. The browser consequently showed a failed preparation while the batch existed.

The action now returns the persisted batch and its run ID with a warning that the mapping was not saved. The next file needs an explicit destination choice. This does not post stock or journal, relax an authorization rule, change a valuation policy, or add a migration. The existing OWNER review and atomic posting path remain required.

Fixture regression: the failed-mapping test was red before the change (`ok: false`, missing run ID) and passes after it; a successful mapping preserves the ordinary review message. The fixture uses a fictional workbook, branch, warehouse, SKU and batch. The original customer file, actual cutoff date, control totals and target stock/GL reconciliation remain outside this code fix, so M04 remains partial.
