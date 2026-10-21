# Master-data lifecycle verification

Base main `d6d9c70`; branch `codex/kamo-masterdata-lifecycle`. Design and integration boundaries: [plan](../plans/2026-10-21-master-data-lifecycle.md).

## What is implemented

All six master lists provide consistent Edit, Nonaktifkan/Aktifkan and recoverable Sampah/Pulihkan actions. Supplier Edit is new. Lifecycle actions require a reason and the reviewed row revision; the database checks the current active OWNER/ADMIN and employee branch access. Unused means no references/evidence, including configurations, historical records and snapshots. Referenced records retain Nonaktifkan; no FK unlink, cascade, permanent deletion, stock adjustment, payroll mutation or journal mutation is implemented.

The default list hides trash, dedicated inactive/trash views support recovery, and restoration produces an inactive row. Existing inactive SKU relations survive an unrelated edit. Employee status does not change login-account state. Category-specific atomic removal/replacement is preserved and tested rather than copied into a generic deletion helper.

## Reproduction

These scripts always create a new owned PostgreSQL 16 container with `--network none`, no published ports and fictional data. They accept no database URL or credentials for a shared database. Cleanup removes only that named test container and its anonymous test volumes. The test-only auth/storage shims support both PostgreSQL claim representations used in existing fixtures; pre-0068 COA fixtures are fictional migration prerequisites.

```sh
npm ci --ignore-scripts --no-audit --no-fund --cache /tmp/kamo-npm-cache
python3 scripts/test-master-data-lifecycle-postgres.py \
  --regression-suite pos_merchant_fees.sql \
  --regression-suite pos_split_payments.sql \
  --regression-suite online_return_unit_posting.sql
# Fetch the reviewed PR74 migration at af4599401703379a974bed9489722991089588ee
# into the local path below; it is applied only inside the owned test container.
python3 scripts/test-master-data-lifecycle-postgres.py \
  --compatibility-migration /tmp/kamo-pr74-inventory-accounting.sql
npx vitest run
npx tsc --noEmit
# Run eslint on the changed application/test .ts/.tsx paths.
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399 \
NEXT_PUBLIC_SUPABASE_ANON_KEY=fictional-master-preview npm run build
node scripts/test-master-data-lifecycle-browser.mjs
git diff --check
```

Chromium runner needs local `vite`, `playwright` and `/usr/bin/chromium`; `KAMO_PLAYWRIGHT_MODULE` may specify an installed Playwright package. It imports the actual lifecycle components, serves fictional action responses only on loopback, and aborts external browser requests. It is component acceptance, not a real Next/GoTrue/PostgREST login or end-to-end transaction test.

## Observed results

- PostgreSQL: 209 repository migrations apply in isolation. The lifecycle suite covers unused trash/restore/activate/archive for all six entities, stale revisions, mandatory reason, anonymous/service-role RPC denial, inactive/unauthorized actor, spoofed context rejection, branch selection, employee account binding and login state, immutable audit and injected final-audit failure with full rollback.
- Used-data fixtures retain branch assignments, an actual payroll amount, schedule, zero stock, exhausted FIFO and all brand/supplier/category/unit links. New FK/text/JSON and import-source-code references to trashed masters reject. Code-only import history also blocks trash; zero physical stock is insufficient evidence of non-use. Used text-unit names cannot be renamed out from under history. Existing item-category removal/replacement still works atomically through its original RPC.
- Fifteen actual two-session lock waits pass: both FK/reference orders; both text-unit/reference orders; both JSON snapshot/reference orders (including uppercase UUID); source-code/JSON-code import references; both rename/reference orders for source-code and JSON-only history; competing same-revision actions; branch-grant revocation while waiting; and actor deactivation while waiting. Only five winning lifecycle actions produce five audit rows; rejected writes leave no partial state.
- The existing merchant-fee, split-payment and online return/FIFO SQL regression suites pass with the new master guards.
- Compatibility: all 210 migrations including PR74 `af45994` apply, and the same lifecycle/code-history SQL suites/fifteen races pass. This is schema/master behavior compatibility, not combined PR74 application or transaction acceptance.
- Application: 29 focused tests cover current active-role denial/unchanged role scope, atomic RPC arguments/results, invalid/stale/reference failure feedback, supplier edit/no-op detection, recoverable trash/restore, busy controls, inactive reference retention and safe filter/return paths.
- Full Vitest: **2,223 passed / 3 failed** across 269 files (267 passed, two failed). The three failures also reproduce on a detached clean main `d6d9c70`: two `merchant-fee-report-pages.test.tsx` cases lack an auth mock, and one `remaining-transaction-forms.test.tsx` case expects an absent PO `draft_key`. No unrelated fixes are included; the full suite is not claimed green.
- An additional legacy `employee_account_operational_context.sql` run stops at its direct `UPDATE expenses` assertion because newer main migrations revoked that write. The exact failure reproduces after all 208 untouched main migrations in another owned container. No permissions were loosened and this old whole-suite check is not claimed passing; the new lifecycle suite separately proves that employee archival preserves account state, schedule and payroll.
- TypeScript, scoped ESLint, `git diff --check` and production build pass. Build uses fictional loopback Supabase configuration, retaining repository warnings outside scope. `AGENTS.md` was read; this installed Next 15.5.25 package does not contain the referenced `node_modules/next/dist/docs/` directory. Existing local server-action/client patterns and installed types/build were used.
- Chromium actual-component UI passes at 1280px and 390px: confirmation/reason, referenced rejection without lost reason, truthful employee login notice, inactive restore explanation, uncertain outcome feedback, no horizontal overflow, filter navigation/reload and zero runtime errors.

[Desktop referenced/restore preview](../../evidence/2026-10-21-master-data-lifecycle/desktop-referenced-and-restore.png) · [Mobile uncertain-outcome preview](../../evidence/2026-10-21-master-data-lifecycle/mobile-uncertain-outcome.png)

## PR76 P2 review: code rename then trash

The review case was reproduced against `06c2a5b` in the owned isolated database: an import row retained `CODE-USED`; updating the master to `CODE-RENAMED` followed by trash at revision zero succeeded. The RED run deliberately failed with `P2 REPRODUCED: code renamed and code-referenced SKU moved to trash at revision zero`. The transaction was fictional and its test container was removed.

The migration now shares one private code-provenance check between trash and a `BEFORE UPDATE OF code` trigger. A code with source-code or canonical JSON-string history cannot be changed. The old code, reference data, lifecycle revision and trash state remain unchanged after rejection; Nonaktifkan and ordinary name/price edits remain available. Identical-code saves, genuinely unused code changes, and changes with only UUID-based configuration references still work. The new `master_item_code_history.sql` fixture runs automatically in the native runner.

Reference writers also resolve the code to a stable item identity before waiting, then lock/recheck that identity. Four new real lock-wait races pass: source-code or JSON history commits first → rename rejects; unused rename commits first → waiting source-code or JSON writer rejects the stale old identity. No rejected reference row is committed and no source history is rewritten. Native totals are now 15 races on the 209-migration source schema and the 210-migration PR74 compatibility schema; the existing sale/payment/return/FIFO regression suites also pass.

This follow-up changes SQL, native tests and evidence only. Application sources are identical to `06c2a5b`; the 2,223 passing/3 baseline-failing Vitest, TypeScript, lint, build and component-browser results above are retained from that application version, not presented as a new frontend rerun. No shared/production database, existing permission policy, auth/profile, transaction helper, reset, merge or production deployment is changed.

## Remaining release gates

Draft implementation only. Production schema parity (including every actual reference representation), data size/performance, combined open-PR acceptance and authenticated browser/API/database acceptance remain unverified. Review/apply the matching migration and application in an isolated staging release before authorizing production. Future reference-bearing schema additions must preserve the parent-lock fences; this migration cannot automatically cover tables created afterward. Conservative configuration/snapshot references may intentionally require Nonaktifkan instead of Sampah.

No production database query/mutation, migration, deletion/reset, permission/credential change, merge or production deploy was performed. No authenticated business write was attempted against an automatic preview. No actual customer, employee or financial data is stored in fixtures/evidence.
