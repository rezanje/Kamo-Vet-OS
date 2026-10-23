# Combined KAMO feedback candidate — 23 October 2026

This candidate integrates seven previously reviewed fixes without changing their source branches. It preserves activity-history links alongside document navigation, recoverable import, clinic catalog filtering and paid checkout, and atomic purchase advances. It has **not** been merged to main, manually deployed, or applied to the target database.

Base: `102f3b0555305524611296e29d16affc12553eb7`. Exact source heads, migration order and SHA256 checksums are in [manifest.json](manifest.json). All seven heads are ancestors of this branch. The nine migration files are byte-identical to their respective source heads.

| Source | Scope |
| --- | --- |
| PR83 | A01 activity capture and document history |
| PR86 | Recoverable inventory import and explicit monetary normalization |
| PR87 | PO price editing and CRM searchable selectors |
| PR88 | N01 related-document navigation (`bf9022d`, the supplied head) |
| PR89 | K04 clinic ingredient category consistency |
| PR90 | K08 atomic paid clinical checkout |
| PR91 | P06/P09 atomic PO advance cap, lifecycle and refunds |

## Integration decisions and regression evidence

Six pages conflicted between A01 and N01: purchase PO detail, purchase invoice detail, payment orders, purchase advances, sales invoice detail and sales advances. Each retains both activity-history links and the stored-document anchors, provenance, denial behavior and return links. Four real-page regressions first failed on the N01-only resolution, then passed after preserving both behaviors (15/15 navigation tests; combined focused set 38/38).

The later purchase-advance conflict retains PR91's `AdvanceForm`, draft completion/recovery, paginated reads and read-error handling, with additive audit/navigation links. The clinic payment auto-merge retains its invoice activity link alongside PR90's checkout flow. No source financial policy or source migration was rewritten to resolve conflicts.

The A01 financial SQL fixture now gives its fictional PO a value of 1000 for advances of 100/101, and selects a depreciation period after an existing reset cutoff. The runner supplies the original A01 fixture's legacy COA4101 prerequisite. These are test prerequisites, not production permission or accounting changes.

## Verification

[checks.json](checks.json) records commands and boundaries. Final application checks: **331 files / 2575 tests passed**, TypeScript, scoped ESLint and production build passed (194 static pages). The build retains unrelated repository warnings.

The fresh, network-disabled PostgreSQL **17.6** run passed **20/20 SQL suites**, plus independent-session races:

- DP cap under READ COMMITTED and REPEATABLE READ, same-key retries, PO revision, refunds/cancellation and recovery interactions with activity triggers installed.
- Concurrent import preparation/posting returns the same persisted run/receipt, with one journal and one audit event.
- Injected audit/journal failures roll back advance sources, refunds, import or clinical invoice/stock/journal state as applicable. Actor/branch denials remain in place. Clinical DOCTOR actors cannot read the OWNER-only audit oracle.
- Import quantities, layer values and debit/credit totals reconcile. The original precision/guard/review suites remain enabled.
- K08 surgical rollback followed by reapplication preserves the exact combined function definition, security properties, owner and ACL.
- Synthetic local `pg_dump`/`pg_restore` preserves the covered catalog, ACLs and fixture row count. This is **not** a test of restoring the target's physical backup or its business transactions.

See [native-final.json](native-final.json) and [native-final.log](native-final.log). These contain object names and fictional test outcomes, no target rows or schema source dump.

Chromium exercised actual server-rendered detail/list pages against fictional query responses at 1280px and 390px. Audit links and exact document/payment/DP destinations survive. [Browser log](browser-integration.log), [desktop purchase](browser/purchase-desktop.png), [mobile purchase](browser/purchase-mobile.png), [mobile sales](browser/sales-mobile.png). Screenshots use the fixture harness CSS; they are not evidence of authenticated hosted visual UAT. No live transaction was submitted.

## Read-only target assessment and isolated fidelity

Authenticated Management API reads confirmed project `koaglxcyjqfmgfzxszkj`, PostgreSQL17.6 and read-only transactions. Target history has 207 records through `20261021183000`; main has 222 files, of which 204 match recorded versions/names. The 18 unrecorded names are **not** an instruction to replay them: some effects already exist. Three target-only history records implement monitoring, verified simulation backups and recoverable reset. The inpatient category patch already exists despite missing history. One optional repository repricing routine is absent on target and has no current candidate caller.

The isolated runner bootstraps main's schema with synthetic defaults, then applies a private, schema-only overlay for public/private/clinic_private/kamo_maintenance. It compares the **captured properties** of 225 tables, 293 routines, 367 triggers, 301 policies, one view, 11 enums and four schema ACLs. Table/column/function ACLs are included. The snapshot, generated target DDL and any local dump remain outside Git; no source customer, patient, auth, inventory or financial rows are copied.

Actual target recovery/reset function bodies are retained in the isolated overlay; reset functions are never executed. A single non-personal reset-cutoff date is represented by a labelled synthetic control row with fictional ID/actor/payload. The cutoff guard affects depreciation/recurring automatic journals through the reset month, not ordinary import/DP/clinic journals. Its rejection/success boundaries are tested.

An initial apparent A01 privacy failure came from missing column ACLs in the harness. Read-only target checks established that authenticated users can select closing-header id/period but cannot select total_value. Capturing/mirroring those column grants corrected the harness; all original audit tests pass without weakening permissions.

### Explicit fidelity limits and release gates

Covered-catalog equality **does not establish full target or security equivalence**. These application-schema security properties were not captured/mirrored and must be checked before target rollout:

- Table and routine ownership, especially SECURITY DEFINER execution ownership.
- View ownership, ACLs and `security_invoker` / `security_barrier` options.
- Role attributes (including BYPASSRLS), membership and inheritance.

The local bootstrap uses its own PostgreSQL roles/ownership. Hosted Auth/GoTrue/Storage/JWT behavior, managed extension configuration, other schemas, and real operational/company/costing settings or business data are also outside this reproduction. The tests establish synthetic transactional behavior under the captured schema properties, not hosted authenticated acceptance or real-data migration safety.

A narrow independent source review found no demonstrated regression in the conflict resolutions, but identified the security-metadata limitation above and a blanket view-difference exemption in the verification runner. The latter was removed: **every covered kind, including views, must now have zero remaining normalized differences**. Five synthetic parity tests pass; replacing the gate with the prior exemption makes the changed/removed branch-predicate tests fail. The existing narrow PostgreSQL cast/AND normalization remains semantically tested including NULLs; it never exempts an arbitrary changed view. Three focused combined SQL suites, backup/restore and K08 rollback/reapply passed after this verification-only change; the unchanged application suite was not needlessly rerun. See [native-review-fix.json](native-review-fix.json).

Unrelated baseline native fixture failures from earlier source work are not claimed fixed or counted as passing: protected sales-return aliases in `posted_sale_cancellations.sql`, direct employee-status fixture updates in `clinical_occupation_selection.sql`, and the old unauthenticated inpatient-discharge fixture boundary. This integration is not completion of the entire M04/stock/GL or feedback audit.

## Controlled rollout plan — not executed

1. Review this combined candidate and verify fresh target parity, including the unverified ownership/view/role properties above. Confirm no intervening migration or function changes. Keep the target recovery/reset routines; never overwrite them with historical repository reset definitions.
2. Establish an approved, usable recovery point and agreed downtime/rollback procedure. Read-only metadata showed seven COMPLETED physical/WALG backups, newest `2026-10-22T15:14:23.542Z`, PITR disabled. **No actual physical target restore was tested**. The isolated synthetic restore does not clear that release gate.
3. Obtain the parent's coordinated release gate. Apply only the nine reviewed files in the manifest order: six A01 migrations, recoverable import, clinical paid checkout, then atomic purchase advance. The isolated run applied all nine within one transaction; target locking/timeouts/extension ownership still require preflight. Do not push all 18 unrecorded historical names.
4. Coordinate DB/app versions: the new DP guards require the atomic path; old direct-write forms may fail closed during a mismatch. Do not encourage retries through an obsolete path. Verify exact-head Vercel build and authenticated OWNER/branch smoke with identifiable synthetic records before reopening flows. Check for existing persisted receipts before retrying uncertain outcomes.
5. Record created IDs, before/after totals, quantities, journal debit/credit and audit events. Explicit import normalization may allocate residual value to a zero-source-value item and affect later HPP: do not claim per-item source valuations are preserved. Do not invent the actual import date, item type or control total. Partial receipt/revision/refund semantics beyond PR91's existing rules remain outside this release.

Rollback is bounded: pause affected writes first. An app rollback alone does not remove DB guards or undo posted receipts. Prefer forward correction; preserve import keys/receipts, audit rows and stock/journal links. The tested K08 surgical reverse changes only its guarded function body; it does not undo invoices. Do not drop new tables, erase audit/idempotency evidence, reset data, or physically restore the target without a separately coordinated recovery decision. No universal automatic down migration is asserted.

## Reproduce isolated checks

The catalog capture uses only the existing configured Management credential for read-only queries to the one intended project. Keep its output outside every Git worktree:

```sh
python3 scripts/kamo-integration-catalog.py --output /tmp/kamo-private/target-catalog.json
python3 scripts/test-kamo-integration-catalog.py
python3 scripts/test-kamo-feedback-integration-postgres.py \
  --target-catalog /tmp/kamo-private/target-catalog.json \
  --report /tmp/kamo-private/integration-results.json
KAMO_FEEDBACK_INTEGRATION=1 node scripts/test-related-documents-browser.mjs
```

The SQL runner accepts no target URL or credential and writes only to its owned network-none Docker fixture. It verifies the manifest before applying candidate migrations and removes its fresh fixture and volumes on exit. `--resume-owned` is only for an already verified task-owned disposable fixture; it is not a live-database option.
