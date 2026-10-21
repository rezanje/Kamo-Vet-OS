# Accurate inventory accounting verification

Base main `d6d9c70`; branch `codex/accurate-inventory-accounting`.

## Boundaries and evidence

No production DB/API writes, production migration, reset, reimport, merge, deployment, credential change or user permission change were performed. Local SQL tests use a newly owned `postgres:16` container with `--network none`, no published ports/shared volumes and fictional auth/storage shims; the runner removes only that container and its volumes. Test users/role setup are fictional fixtures, never production setup instructions.

The parent supplied a separate read-only audit at 15:10 WIB: PDRY batch originally Rp133,540,798.02, remaining Rp133,458,798.02 after Rp82,000 HPP. These amounts are used only as a fictional regression scenario, not as an instruction to apply an entry. The implementation performs no live reconciliation call. Historical repair is still report-only and requires accounting date/counterpart/branch decisions and an authorized release.

## Reproduction

```sh
npm ci --ignore-scripts --cache /workspace/.npm
# Owned, isolated PostgreSQL only; requires cached postgres:16 image.
python3 scripts/test-accurate-inventory-accounting-postgres.py \
  accurate_inventory_accounting.sql \
  accurate_inventory_accounting_guards.sql \
  accurate_inventory_accounting_review.sql
python3 scripts/test-accurate-inventory-accounting-races.py
# Optional reviewed compatibility SQL files, applied only inside the disposable container:
# --compatibility-migration /tmp/kamo-pr69-stock.sql
# --compatibility-migration /tmp/kamo-pr70-monetary.sql
npm test
npx tsc --noEmit
npm run build
```

Core native fixture was observed RED before the new RPCs existed. Import routing was observed RED on the old stock-only submission. The later original-stock provenance regression was observed RED (`Expected protected stock move`) before the guard was added. Review reproduced an actual global-opening header relabel bypass before adding its regression and guard.

## Results

- Actual PostgreSQL 16: all 209 repository migrations plus reviewed PR69 `d40c22b923bb4b6141d38164081bdc4407c5ccea` and PR70 `cc2a89e4d271b9b96ceaee14adab9ef84c2ea24c` SQL applied together; all three bridge SQL fixtures passed. Coverage includes partial/rejected rows, incomplete persisted batches, branch/warehouse/date/COA/permissions, missing/closed periods, exact/conflicting retry, stale evidence, injected journal failure with complete stock/FIFO/move/run/receipt rollback, protected originals with allowed FIFO consumption, historical source/lot proof, consumed value and existing global GL, direct source spoof and global-header relabel prevention.
- Five real waiting-session races passed with both compatibility migrations: global opening commits first → bridge rejects stale review without stock effects; actor-share-before-journal interleaving → no deadlock; bridge commits first → competing global inventory opening rolls back; OWNER deactivation commits first → waiting post is denied; simultaneous exact batch requests → one journal, receipt and stock quantity with identical results.
- Existing native `pos_merchant_fees.sql`, `pos_split_payments.sql`, and `online_return_unit_posting.sql` passed with both compatibility migrations, including sale/return/FIFO behavior. All owned containers and volumes were removed.
- Five focused application suites / 16 tests passed. TypeScript, scoped ESLint, `git diff --check` and final production build passed. Build retains repository warnings about Edge/Supabase Node API, existing images and unused variables outside scope.
- Full suite: **2,208 passed / 3 failed (2 failed and 265 passed files)**. The exact same three failures reproduce on clean main `d6d9c70`: `merchant-fee-report-pages.test.tsx` tests “shows merchandise, merchant fee and final bill separately on sale detail” and “does not invent a fee for historical sales” lack `supabase.auth.getUser`; `remaining-transaction-forms.test.tsx` test “clears acknowledged controlled rows and keeps defaults on later remount” expects an absent `draft_key`. No unrelated test fixes.
- Independent SQL review reproduced the old header-source bypass and verified its fix with the review fixture. Main and open PRs were rechecked before publication; main remains `d6d9c70`. No changed-file overlap with PR69 or PR70; shared-table triggers are uniquely named and source scoped.

## Integration and limits

PR69 and PR70 use distinct files/migrations; this PR does not implement their corrections or change the generic journal/FIFO helpers. The source-specific protections run only for this bridge and source-specific global duplicate prevention. PR70 still owns the general monetary opening safety path. PR62's general opening alternative must not be restored as part of integration.

New import posting stops for Finance review if any other 1301/global-opening evidence exists, even if its net balance is zero or it concerns another branch. This conservative restriction avoids assuming historical allocations. Existing posted batches never enter the stock writer or historical journal apply from this UI/RPC.

Application tests use jsdom and mocked Supabase actions. Authenticated end-to-end browser/API acceptance and production schema parity are unverified. A generated cloud preview has no matching DB migration applied and must not be used to run stock fixtures against a shared/production-connected database. SQL and application must release together through a separately authorized process. Installed Next15.5.25 has no `node_modules/next/dist/docs/` directory requested by AGENTS; existing app conventions were followed.
