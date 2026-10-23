# I08 partial — ad hoc jobs across same-branch warehouses

Extends PR123's atomic FIFO recipe core; it does not create a permanent recipe for a one-off job. The user chooses context branch, output item/unit/planned quantity/output warehouse and material item/unit/quantity/source warehouse per row. Unit conversion is resolved and frozen by the server; prices/factors are never trusted from the form. Same item from different warehouses is supported, duplicate item/warehouse pairs and output-as-own-material reject. All warehouses must be active, authorized and in the selected branch. Cross-branch accounting is explicitly unavailable rather than silently assigned to one branch.

Start uses one transaction for source checks, sorted warehouse/item locks, actual FIFO consumption, per-material frozen warehouse/unit/cost, WIP journal, job and receipt. The original guarded finish receives the frozen output only and reconciles total quantity/value/WIP. Completed history retains job/output/material identity; the review regression caught that a nullable recipe otherwise displayed a blank history name. New nullable schema fields use a provenance-checked compatibility patch so pre-extension recipe proofs still finish; non-NULL source changes remain rejected. No historical values or receipt payloads are rewritten.

The form uses the existing searchable item picker, separate item code display and per-account local draft snapshots. A distinct ad hoc posting key survives reload, and receipt recovery does not post. Changing context branch clears warehouse selections rather than remapping sources. Actual branch/module/role authorization remains server-side. Large reference lists use the PR113 production-page checked-pagination pattern; integration must preserve its remaining item label change.

## Evidence

- RED: missing SQL RPC/action and missing page path; completed-history regression; pre-extension proof rejected after nullable schema extension. Each was observed before the corresponding implementation/fix.
- 20 focused tests across four files passed: exact decimal quantities, draft/key reload, account isolation, source warehouse/unit selections, search preserving selected ID, page metadata/history and existing action/recovery cases.
- Full app: 356files /2705tests passed once after application code stabilized.
- TypeScript, scoped ESLint and production build passed. Build used fictional Supabase values; existing unrelated image/unused-variable warnings remain.
- Isolated PostgreSQL17.6,239 repository migrations, fictional auth/storage: core and ad hoc SQL passed, including two-source example2PCS at2.5 +3PCS at3.125 =14.375;5PCS output receives14.375, WIP clears, no recipe inserted. Unit, branch/role, shortage, stale payload, immutable source, journal/audit rollback and previous-proof compatibility covered.
- Six two-session checks passed on the same SQL implementation: method transition, identical recipe start, finish, last-material competition, rollback then queued retry, and identical multi-warehouse ad hoc start followed by exact finish. Final SQL-only run added audit rollback without needlessly repeating those races.
- Narrow independent review found only completed-history P2; fixed, regression passed and re-review reported no remaining concrete P1/P2.

No hosted user simulation or mobile-browser screenshot is claimed. No target writes, activation, migration, main merge or deployment. Full target-schema equivalence is not claimed by repository-schema tests.

## Migration manifest and limits

Order within this candidate:

1. `20261023145000_production_atomic_core.sql` SHA256 `9d1d84121b520c4b29970aa2ddec422b776d9551261a6e8b103dc626f6845cd3` (unchanged).
2. `20261023161000_production_adhoc_warehouses.sql` SHA256 `9e7454ff5f54dbf07cd0e8ff6d779138a4fdcf25b0d17bd17f13e2992054204d`.

Both are **unapplied** to target. The extension requires the exact reviewed core and fails on core-function provenance mismatch. No PR104/119 migration is replayed. Before any permitted rollout inspect target ownership/helper/trigger parity and preserve ACL/RLS, private proofs and exact costs. Roll back UI or fix forward; do not narrow historical values to cents, delete receipts or replay consumed materials.

I08 remains partial only for unsupported contracts/coverage: independently chosen cross-branch expense context and its interbranch postings/allocation, average-mode valuation, and inherited history listing limit50. Additional non-material expense entry was not invented. Same-branch ad hoc and warehouse-per-material workflows are implemented; their size is not treated as a policy blocker.

Full lane inventory: `2026-10-23-purchasing-inventory-finance-coverage.md`. This extension does not increase the whole-item completion count while the row still includes the cross-branch requirement.
