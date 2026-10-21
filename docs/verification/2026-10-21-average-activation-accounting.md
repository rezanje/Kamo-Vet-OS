# Average activation accounting reconciliation

Draft PR: [#82](https://github.com/rezanje/Kamo-Vet-OS/pull/82). Tested production implementation remains `7c66e896aad97c0190e672f2f964d5f0f9e8010e`. Initial publication record `a2be160` was documentation only; the PR81 follow-up changes tests and documentation only. Latest combined compatibility is green for all seven PR81 migrations; the earlier six-migration caveat below is historical and superseded by the follow-up section.

## Outcome and safe handling

PR80's `activate_moving_average()` could enable average with physical remaining inventory160 and inventory GL0. It checked layers but never reconciled the accounting side. The original failure is reproduced by `average_activation_accounting.sql`: before the new migration, it raises `Expected activation denial: rekonsiliasi` because activation incorrectly succeeds.

This patch adds **one private precondition to that existing RPC**, after its exclusive inventory lock and its existing already-active return, before any seed/average/settings write. No second costing engine is included. The earlier independent prototype remains unpublished on `codex/kamo-moving-average`; none of its schema is part of this branch.

Activation now requires finite, complete physical remaining quantities/value and balanced, finite GL1301 reconciled **per branch**, including inactive warehouses and unallocated historical GL. Equal global totals cannot hide incorrect branch allocation. A tolerance of1e-8 Rupiah permits only numeric division noise; a difference of0.001 is rejected. A negative opening pool has no audited signed physical-layer basis and is blocked for reconciliation; PR80's ongoing known-cost negative-stock behavior is unchanged. Missing/invalid inventory COA and future inventory GL also block adoption.

**Missing historical PDRY journal:** if remaining inventory exists without matching GL1301, activation raises SQLSTATE23514 with instructions to reconcile separately. FIFO stays active; average costs, source lots, history, journals and settings stay unchanged. It does not backfill a journal, choose an equity/expense counterpart, infer a price, reimport or revalue stock. Finance must review the source evidence, date and counterpart in the separately authorized historical repair task before retrying activation. The same rule applies to any branch; no PDRY-specific exception exists.

The existing action shows the error without a success message. The closing page explains the prerequisite and the absence of an automatic adjustment journal. Already-active installations retain the existing idempotent status return; this is a first-activation guard, not a retroactive repair.

## Concurrency and permissions

Inventory writers retain PR80's shared advisory lock; activation retains its exclusive lock. Because ordinary journal writers and some pending release flows may hold journal relations before seeking inventory, the guard takes stable relation and stock/actor row locks with **NOWAIT**. It never waits for those locks while holding the exclusive inventory lock. A conflict aborts activation with SQLSTATE55P03 and asks the operator to wait, reload status and retry. The subsequent request reads committed stock/GL again.

The guard locks the current actor and access/module/capability metadata, rechecks the existing all-branch OWNER/FINANCE authorization, and pins stock, lot, warehouse/item and inventory COA/GL evidence for the decision. The helper is private; no grants, new role capability or public mutation interface are added. The public activation signature, OID/ACL, initial FIFO default, physical FEFO and all PR80 cost/closing implementations are preserved.

## Verification actually run

All SQL used owned PostgreSQL16 containers with `--network none`, no ports, fictional auth/storage shims and fictional inventory/journals. No external DB/DSN is accepted by the new runner. All owned containers and volumes were removed.

```
python3 scripts/test-average-activation-accounting-postgres.py
```

Applied all216 source migrations. The activation fixture and18 existing average/correction/clinic/import/FIFO suites passed. New cases cover missing GL, correct global but incorrect branch totals, unallocated GL, orphan layers, negative opening pools, sub-cent mismatch, future/nonfinite/unbalanced journals, unauthorized actors, private helper ACL, unchanged state on denial, injected final seed failure rollback, successful reconciled cutover and repeated activation without duplicate seeds. Existing average fixtures now contain an explicit, balanced **fictional** opening journal instead of bypassing the guard. That temporary test helper never enters production schema.

Five real independent-session scenarios passed: GL writer first with immediate retryable conflict and committed-gap recheck; activation first with a waiting journal writer; actor revocation first; activation pinning actor until its decision ends; and a receipt+GL transaction winning before two competing activations (one seed, one already-active result). No deadlock occurred. See `docs/evidence/2026-10-21-average-activation-guard/native-main.log`.

Frontend:4 focused files/18 tests and full **283 files/2301 tests** passed. TypeScript, changed-source ESLint with zero warnings and whitespace passed. Production build passed using fictional loopback Supabase configuration with Supabase, DATABASE_URL and PGPASSWORD variables removed from its child. Existing unrelated lint/Edge-runtime warnings remain. No browser/backend business acceptance or live activation is claimed. Local Next15.5.25 has no bundled `next/dist/docs`; the UI change is static explanatory text and introduces no Next API usage.

## Release PR68–73+79 coordination

Based on fresh main `9aafe37` (independent PR80). No other author's/release branch was modified. The six source migrations from PR68–73 were fetched read-only and replayed **in timestamp order** with this branch (222 migrations). PR79 contains no SQL. Exact inspected heads are in the evidence manifest.

The new activation fixture, all average/correction/clinic/import tests and FIFO suites through `sales_safe_posting.sql` passed in that combined source replay. The old `posted_sale_cancellations.sql` fixture then fails because it directly issues `retur-beli` while iterating generic legacy stock callers; PR72's `return_record_protected_effect()` correctly requires the official return correction route. The **same failure was reproduced without this patch** on PR80 plus those six migrations (221 migrations). No guard was loosened and no shared legacy test was rewritten here. This is a release fixture compatibility caveat, not evidence that the activation fix causes a business regression. Combined application/customer acceptance remains open.

The five activation race scenarios were also run against the chronological222-migration combination. See the dedicated compatibility-race log. Integration should preserve PR72's return boundary and update its old direct-call fixture separately. At this checkpoint main still has not incorporated PR68–73+79; do not rebase onto another task's unmerged branch. Rebase onto main only once that release is observable, then rerun the affected suites.

## Separate requirement review — outside this narrow fix

These are follow-up review findings, not claims of completed repairs:

- **Activation audit contract:** PR80 stores activation actor/time and cost events, but its no-argument RPC has no reviewed expected-state payload, immutable GL-source evidence, audit reference or reason. The new guard provides a stable current-state reconciliation, not a full persisted Finance review workflow.
- **Monthly accounting completeness:** `close_inventory_month()` validates valuation events, dates and authorization; it does not reconcile branch GL or explicitly detect unfinished multi-request JS stock/journal posting. Monthly accounting completeness needs its own review/test scope.
- **Cross-branch transfer accounting:** physical/average transfer helpers preserve source value/expiry; source inspection found no corresponding branch-GL reclassification in the transfer primitives/wrappers. Current transfer tests mainly prove quantity/value conservation. Cross-branch GL treatment needs a separate combined review; no interbranch or counterpart account is invented here.
- **Opening policy and precision:** negative opening pools now require reconciliation, and PR80 already rejects positive unpriced/zero-cost layers. Legitimate zero-valued stock and audited signed opening values need explicit Finance policy rather than a master-price fallback. PR80's later average-rounding/value algorithm is unchanged and was not subjected to an exhaustive large-quantity precision audit in this patch.

Before any release/activation: resolve the source/GL discrepancy and approved historical counterpart in its separate task; review these remaining contracts; establish production schema parity and authenticated isolated-backend acceptance. Matching balances alone do not prove that a historical counterpart was economically correct.

## Boundaries

Draft code/test work only. No production migration, activation, deployment command, historical data edit, revaluation, reset, real transaction, secret/access change, merge or readiness promotion was performed. Publishing this branch may cause the repository's existing automatic preview integration; that is not financial/backend acceptance.

## PR81 P2 follow-up — actual combined replay

This section supersedes the earlier six-migration fixture compatibility caveat. Exact inspected PR81 head: `e23002326a8666bbaf1cb1545a04465944abb3ca`. All **seven** PR81 migrations are included, especially `20261021183000_correction_master_reference_guards.sql`; this is not a replay of the older six independent PR heads.

The review issue was reproduced in the actual combined runner: `moving_average_inventory.sql` failed because `pg_temp.seed_average_opening_gl()` did not exist. The runner now loads `supabase/tests/fixtures/average_opening_gl.sql` before all three average suites and the clinic suite. A preceding source-preservation assertion also needed a precise PR82 composition contract: stock-in, stock-out and closing definitions must remain exactly unchanged; activation must equal its baseline plus **only** the reviewed accounting guard call. The assertion was retained and narrowed to that exact expected change, not disabled. The activation accounting fixture itself now runs in this combined matrix.

The old posted-sale fixture now asserts SQLSTATE42501 with PR72's exact official-return-path error and verifies quantity, physical layers and movements are unchanged after the rejected direct `retur-beli` call. Before PR72 is installed, it still checks the original successful FIFO return cost. Production return guards were not weakened. The combined runner explicitly executes this fixture in addition to the existing official return/correction/date-window suites.

Actual commands, run in an isolated detached worktree containing exact PR81 plus PR82 changes:

```
python3 scripts/test-remaining-production-order.py
python3 scripts/test-remaining-production-order.py --clean-replay
```

Both exited0. The first applies215 deployed-main migrations, then all seven pending PR81 migrations and the PR82 guard in rollout order. The second applies all223 migrations chronologically. Both pass master-reference coverage, unexpected retired-overload authority rollback, correction/average boundaries, exact costing/activation source contracts, six real correction-versus-activation lock races, the activation fixture, correction/financial/FIFO suites, all four average suites, and official return correction/date-window fixtures. The PR82-only216-migration regression matrix plus five activation races also exited0 after the legacy fixture update. The five activation/GL/actor/receipt races were additionally rerun on the exact seven-migration PR81 combination (223 migrations) and passed.

Evidence: `docs/evidence/2026-10-21-average-activation-guard/pr81-followup/`. No production SQL/application source changed in this follow-up; only test runner/fixture and evidence/documentation changed. Frontend/type/lint/build results above therefore remain those of the unchanged implementation, not a new frontend rerun.

Because PR81 is not yet on main, its runner is included from exact PR81 head with the targeted compatibility changes; `runner-vs-pr81.diff` records the small upstream-relative patch. No other PR81 application, migration or test source was imported into PR82. When PR81 becomes observable on main, reconcile the same-file addition by preserving PR81's runner plus this helper/source-contract/fixture coverage patch. No rebase onto an unmerged release branch, branch modification, merge or production operation was performed here.
