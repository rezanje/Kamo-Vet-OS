# C04 bounded follow-up — complete active promotion sources

Base: current main `e46f45e97ae2500b3aaade5e8a9e50915f9fcca3`, isolated branch `codex/c04-promo-read-integrity-20261023`. PR122 remains frozen at `7440af9087e7841984c560007054b71e42da5e73`, with exact-head preview SUCCESS. No main/target retry.

During the requested final inventory, source inspection found a demonstrated read defect in `loadPromoAktif`: both active promotions and promo target items used a single uncounted API response, and errors were ignored. A truncated/missing target list became `itemIds: []`, which the existing engine correctly interprets as all products. Thus missing source rows could silently broaden eligibility or lose applicable discounts. This defect is independent of the unresolved new package/campaign policy.

The loader now reuses the existing checked-list reader for exact counts, stable ordering and complete pages. Headers retain existing active/automatic, date and branch filters. Target reads include only the resulting eligible promo IDs in batches of at most 200; composite primary key `(promo_id,item_id)` supplies stable identity without schema changes. Default existing safety ceiling is 10,000 rows per checked read; exceeding it fails instead of silently pricing a subset. Missing count, later page error, duplicate/truncated data or thrown read stops loading. Only a successfully verified empty target list continues to mean all products. Source failures are never converted into no-discount or all-product pricing. Existing callers await this read before their checkout/posting writes; no new financial mutation path is added. This fix does not introduce a new error UI for every caller.

The CRM editor now calls nominal discounts **Nominal per satuan**, with a short explanation that this is per eligible unit, not one package-total amount. Existing calculation/stacking/min/max/multiple rules remain unchanged. Fixtures cover qty 4/5/6 at min 5 and max 5 with Rp2,000 per unit (0/10,000/10,000), full multiples at 10 (20,000) and no minimum. No unapproved conversion to a new package policy.

## Executed checks

- RED: 9 of 10 new completeness tests fail against the prior loader; the verified-empty case already passes. Failures demonstrate late promo/target omissions and unsafe failed reads, not a new mocked policy.
- GREEN: 107 affected tests /10 files pass, including new loader, existing promotion engine/edit/category/editor, clinical pricing helpers and cashier/backoffice checkout regressions.
- Scoped lint 0 errors/warnings; production build and separate post-build typecheck pass. One test-local `let` changed to `const` for lint, without logic/assertion changes. An initial broader run used an older shared dependency directory missing jsdom/decimal.js; switching the isolated worktree to the already-installed dependency directory used by PR122 resolved the environment error. No package/lockfile/install change or test weakening.
- Independent reviewer found no P1/P2 and separately ran 28 tests/2 files. Its count overlaps root tests. Reviewer did not build or access any database.
- No migration, policy/permission change, master-data mutation, target call, full user workflow simulation, merge or deployment. No repeated full repository suite.

Evidence: `docs/evidence/2026-10-23-promo-read-integrity/` contains RED/GREEN, lint/build/typecheck, review and source hashes. Exact terminal lane inventory and release dependencies are in `2026-10-23-clinical-ui-terminal-inventory.md`.

## Completion boundary and release

This source-read integrity defect and existing per-unit labeling are code-complete. **C04 as a whole remains partial** for the agreed package/total-discount representation; C03 import template and C05 campaign/voucher semantics are still decisions. S04 two-person commission remains blocked; no incentive formula is added here.

This is an independent ready app candidate from current main. Release lane coordinates integration after resolving the existing approval-review block. It can combine normally with PR122 because neither changes the other's source files. No schema ordering is required for this bounded helper/label change. Rollback is a normal revert of this app commit; no data rollback or historical price rewrite. G/main and H/UAT remain false until actual integration/UAT.
