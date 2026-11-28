# PR362: import-only independent-review fixes (UNAPPLIED, not live)

Scope: follow-up normal commits on `hermes/promo-master-import-release`, starting
at `6c6ce1a9658d86b26cd9cc43c1361edd08e19731`. No network, credentials, hosted
reads/writes/preflight, push, PR changes, install, merge or deployment. Only the
unapplied 0415 candidate may change. Installed source migrations, shared billing,
report routes and exact deferred archives are not modified.

## Contracts

- **PROMO-IMPORT-01**: authenticated app preview no longer SELECTs the private
  `promo_import_targets` table. The bounded `read_promo_import_context(jsonb)`
  reader requires the original active OWNER/ADMIN guard and returns only matching
  promo configuration snapshots plus the immutable-manifest locked flag. Private
  SELECT/DML ACLs stay revoked; no service-role client or broad grants.
- **PROMO-IMPORT-02**: the reader's canonical `promo_edit_snapshot` supplies both
  visible diff data and its expected `{id,version}`. That original token travels
  from the rendered workspace into the actual save action and public import RPC;
  explicit `null` means the preview found no matching name. Server revalidation
  may reject an obsolete catalogue/diff, but cannot silently accept a new diff.
  Missing/wrong/stale tokens conflict. The RPC locks sorted batch names, then all
  existing parents in UUID order before catalogue locks (the existing edit/child
  trigger order). It checks every expected state before the first write and
  rechecks at the final per-entry lock point. Canonical state includes the full
  rule, activation, expected ID and sorted complete target set. A conflict aborts
  the file; the UI requires Periksa ulang and another explicit save. There is no
  new global table lock. Unchanged target links and unrelated rule keys survive.
- **PROMO-IMPORT-03**: imports preserve existing activation, including when expiry
  is extended. Identical inactive rows explicitly disclose “Tetap nonaktif — status
  tidak diubah”. New promos retain normal active creation. Explicit activation
  stays in the existing promo editor; original 353 expiry guards remain unchanged
  and reject activating expired promos. No Excel activation column or new policy.

## Reproduce / verify locally

All heavyweight processes must hold the shared OS flock for the **whole fixture**.
A lock timeout (exit 1 without a started fixture) is resource contention, not a
business-test failure. Native PostgreSQL uses Unix sockets, PG17, original complete
337-migration chain, exact hosted_auth_uid platform shim, one BEGIN/COMMIT per
migration and no business stubs. Node has one worker, heap1024/1536; no full build
or low-heap full-project typecheck.

```sh
flock -w 120 /opt/data/kamo-heavy-test.lock python3 scripts/test-promo-master-import-postgres.py --review-fixes --json /opt/data/kamo-promo-fixes-native.json
flock -w 120 /opt/data/kamo-heavy-test.lock env NODE_OPTIONS=--max-old-space-size=1024 KAMO_PROMO_NATIVE_ARTIFACTS=/opt/data/kamo-promo-fixes-workbook node node_modules/vitest/vitest.mjs run src/lib/__tests__/promo-master-import.test.ts --maxWorkers=1
flock -w 120 /opt/data/kamo-heavy-test.lock python3 scripts/test-promo-master-import-postgres.py --excel-plans /opt/data/kamo-promo-fixes-workbook.json --json /opt/data/kamo-promo-fixes-original.json
flock -w 120 /opt/data/kamo-heavy-test.lock env NODE_OPTIONS=--max-old-space-size=1536 node node_modules/typescript/bin/tsc --noEmit -p tsconfig.promo-checkpoint.json
```

`--review-fixes` starts the real server-action Vitest bridge inside the original
full-schema fixture. Only Supabase transport and Next cache are adapted: actual
queries/RPCs run as `authenticated` with modern JWT claims, including the real
private-table ACL denial. The bridge exercises actual filled XLSX → real preview
→ same-name save as OWNER and ADMIN, stale header/targets/activation/absence, and
explicit refresh/review before retry. Native direct reader role/ACL, old per-SKU
manifest immutability, canonical-rule/identity checks and target-tuple preservation
are additional assertions. This is **not** PostgREST/browser/auth-provider UAT.

Three independent-session barriers pin absent-name advisory waits, header waits
and child-target waits. Each requires the exact blocker PID plus `Lock` and a
non-null event, verifies the conflict, preserves the concurrent writer, and reads
back no earlier new promo or earlier existing-header/target change from the batch.
The original opposite-order test now expects one commit and one reviewed-snapshot
conflict, not silent overwriting after serialization. All sessions/clusters are
closed in finally/context-manager cleanup.

## Retained RED evidence

- `/opt/data/kamo-promo-fix-p1-red.json`: actual authenticated workbook preview
  failed on private-table read before the narrow reader fix.
- `/opt/data/kamo-promo-fix-p2-red-valid.json`: old wire contract actually accepted
  all three stale two-session schedules, committing `created:1,updated:1`; actual
  stale displayed-preview/save action also returned success. The earlier
  `p2-red.json` additionally retains a transport-fixture boolean JSON error; it is
  not used as the valid action reproduction.
- `/opt/data/kamo-promo-fix-p2-ui-red.log`: the rendered workspace failed to pass
  the displayed snapshot to save before its binding was fixed.
- `/opt/data/kamo-promo-fix-p3-red.json`: actual native identical inactive import
  reactivated the promo; the real action omitted retained-activation disclosure.
- `/opt/data/kamo-promo-fix-p3-ui-red.log`: rendered workspace omitted that notice.
- `p2-green.json` retains a fixture-only numeric-text assertion mismatch (`22.00`
  versus `22`) after conflicts already worked; corrected to numeric comparison.
- `tsc-initial.log` retains incomplete test-row field typing, corrected without
  changing behavior. Original pre-review 37-native/183-Vitest evidence remains
  evidence of its old SHA, not closure of these findings.

Final exact-head commands/results and source/frozen-scope hashes are external:
`/opt/data/kamo-promo-master-review-fixes-results.json` and
`/opt/data/kamo-pr-promo-master-review-fixes.md`. Full exact-head CI/build,
independent closure, authorized hosted migration permissions/backup/preflight/
apply/readback, PostgREST/browser verification and user acceptance remain release
work for the parent. Deferred unsafe attribution/reporting and 0414/0418 are NOT
integrated, fixed, reactivated, or certified by this import-only checkpoint.
