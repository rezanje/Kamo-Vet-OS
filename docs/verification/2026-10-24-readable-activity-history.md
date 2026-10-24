# A01 bounded readability and source navigation

Base main: `6184bcd45fb751f1e1c61b80bbb0a7ee8d16b863`. Reviewed code: `5d20b89575b47a5a5d9e4014f1f3a9270f4b93ed`; subsequent delivery commit changes documentation only.

## Reproduced and fixed

The general audit showed technical field names and raw values without clear before/after labels. Two refund sources added by the earlier payout migration were absent from the UI entity map, so their object-history URLs lost the exact entity/object filter. Existing audit object links opened filtered history, not the source document.

The UI now supplies readable field/entity labels, explicit Sebelum/Sesudah values, localized dates/booleans/statuses and exact decimal-string formatting. Codes are identifiers and remain verbatim, including numeric codes and leading zeroes. Unknown/nested values remain masked; salary and clinical metadata events still reveal no field names or payload values. No historical content is invented.

`sales_refund_requests` and the already-private `sales_refund_payouts` are recognized for exact retained-object filtering. Adding labels does not change their database reader policies; private payout records remain private.

Source links support eight existing root routes: PO, goods receipt, purchase invoice, purchase return, sales invoice, sales order, sales return and retail POS receipt. An actual child event can open its stored root, never an inferred child/number relationship. Ordinary session queries batch source IDs by entity (at most the existing 40-row audit page), then apply current account branch grants, including stored PO/sale parent branches. This is needed because some legacy source SELECT policies are broader than the audit reader. Destinations keep their existing authorization. Online/unknown-channel sales receive no retail receipt link.

Deleted/absent/inaccessible/unsupported sources keep searchable history without a source link. A lookup failure preserves the audit rows and displays a retry message, without leaking server errors. Audit query, server-derived actor, scope/branch RLS, cursor pagination, capture triggers and immutable log are unchanged.

## Evidence

- Initial component RED: 6 failed /4 passed; subsequent decimal/branch and both review findings also observed RED before correction.
- Final focused: 77 tests /9 files passed (history view, filters, source links, branch grants, routes and existing activity components).
- Final full app suite: 3,192 tests /432 files passed. Production build, post-build `tsc --noEmit`, scoped ESLint and `git diff --check` passed. Existing unrelated build warnings remain.
- Independent source review found two P2 issues (identifier formatting and online receipt route); both fixed and narrow recheck clean. No SQL or target database calls, migration, permission change, U09 change or separately blocked N01 resolver included.

Tests use fictional records and mocked Supabase boundaries to exercise the real server page and helpers. They prove emitted queries/rendering and rejection of hidden/out-of-grant returned sources; they are not a claim that all 181 registry sources or database RLS were retested live. No full user simulation performed.

## Release and remaining boundary

Application-only normal PR/main deployment; no database prerequisite. Revert restores the former presentation and leaves audit/source records intact. Usable route: `/perusahaan/log-aktifitas` for authorized active OWNER/ADMIN.

This completes the bounded readability/refund-filter/supported-link request. Full A01 acceptance remains distinct from this subset: routes outside the explicit allowlist retain history-only links; metadata minimization is intentional; old pre-activation events cannot be reconstructed; full authenticated acceptance/workload checks remain deferred. N01's whole-document graph is separate and untouched. Parent owns checklist updates and simulation boxes.
