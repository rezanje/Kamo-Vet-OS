# HRIS schedule-board atomic save — 2026-10-02

Independent continuation after `f9b62e2`, on the existing `codex/hris-meeting-followup` worktree and draft PR18. User authorized useful work while monetary-policy, incentive-catalog and demo acceptance inputs wait. This closes the previously documented partial-save limitation of the HR board.

## Delivered behavior

An HR board save submits deletes, inserts and updates to one `hris_save_schedule_batch` PostgreSQL transaction. An invalid later cell, final payroll, failed write or failed audit rolls the entire batch back. The browser submits the original cell ID, full PostgreSQL microsecond timestamp and shift ID, or an explicit empty snapshot. The server does not substitute its later read. Stale edits, old→new→old changes, recreated rows and occupied cells claimed empty are rejected.

The transaction acquires the existing payroll-source serialization boundary before actor/branch/employee locks, then rechecks current identity, scoped HR access, active branch/employee/shift, positive dated assignment and nonfinal payroll. All rows are validated before mutations. Unchanged cells and empty→empty edits preserve versions and produce no change audit; success counts actual changes. One immutable HR-only event records cell transitions and the authenticated actor. Client-supplied creator fields cannot forge attribution. Board refresh keys include versions even when displayed shift IDs remain the same.

Existing nonfinal historical HR editing remains available. Pending staff requests are not silently cancelled: existing approval snapshot guards reject requests rendered stale by HR edits. Excel import keeps its single atomic insert and unique-cell conflict protection. Legacy direct clients keep existing RLS/final guards; this does not promise browser compare-and-swap protection for arbitrary direct APIs.

## Fresh verification

- Actual old action fails its partial-deletion regression and browser-snapshot transport regression before the fix; both pass afterwards. Scope tests fail before version loading, then pass with exact microseconds and fail-closed missing metadata. The SQL contract fails with the missing RPC before the migration.
- Full application suite: **157 files / 1,331 tests pass**.
- All **12 actual HRIS SQL suites pass** on disposable network-isolated PostgreSQL16 with fictional data and relevant actual migrations. New board tests cover batch rollback, failed audit, access/privacy, malformed/duplicate/oversized rows, inactive shifts, stale versions/recreated IDs, final payroll, new-cell attribution, immutable audit and no-ops.
- Independent concurrent sessions prove one complete board winner, and one complete winner between a board save and a single-shift approval. The losing transaction leaves no partial deletion or false decision audit. A writer revoking ADMIN branch access holds the real shared source lock first; the queued batch rejects after the revoke and leaves both cells and audit unchanged.
- Existing swap, payroll preparation/finalization and accounting-close races still pass. Build succeeds on Next15.5.25. TypeScript after build passes. Lint: zero errors and twelve existing warnings. Diff whitespace check passes.

Reproduce application checks with `npm test`, `npm run build`, then `npx tsc --noEmit`, and `npm run lint`. SQL:

```sh
python3 scripts/test-hris-completion-db.py hris_attendance_sessions.sql hris_attendance_legacy_correction.sql hris_attendance_json_claims.sql hris_attendance_final_resolution.sql hris_schedule_requests.sql hris_schedule_swaps.sql hris_attendance_recap.sql hris_sensitive_access.sql hris_payroll_settlement.sql hris_payroll_effective.sql hris_review_privacy.sql hris_schedule_board_batch.sql
```

Session evidence: `/workspace/hris-board-{action-red,action-green,scope-red,db-red,db-green,db-extended2,review-red,final-db,final-tests,full-tests,all-db,access-race,build,tsc,lint}.log`. Results and commands here remain durable if session logs disappear.

## Review and decisions

One fresh independent reviewer examined the new transaction contract and callers against `f9b62e2`: no Critical, one Important and one known Minor. The Important semantic no-op bug was independently reproduced: PostgreSQL accepts a hyphenless spelling of the same shift UUID, but text comparison incorrectly updated the row, invalidating its version and adding false audit. One regression pass reproduces the failure, then compares UUID values with empty strings safely cast to null. The regression asserts zero changes, unchanged versions and no audit. Full application and SQL regressions passed after this patch; no second reviewer approval is claimed. The Minor is the legacy lock-order availability limitation documented below.

- Ruling: existing implementation authority and the user's continuation request cover this bounded integrity repair; no repeated design approval — cost: priority can be steered, monetary policy remains outside this fix.
- Ruling: per-cell compare-and-swap covers cells actually submitted, rather than a global board revision — cost: independent cells can be edited concurrently, a single stale submitted cell rejects the batch and requires reload.
- Ruling: reuse the established source lock — cost: schedule saves serialize with source writers and payroll preparation. Legacy approvals acquire employee locks first and may cause a deadlock; PostgreSQL aborts a whole losing transaction and the user must reload/retry. Real race checks verify atomic outcomes.
- Ruling: preserve existing historical-edit and import contracts — cost: pending requests can become stale and old direct clients do not acquire the browser-version guarantee.
- Ruling: minimal cell audit has no new free-text reason UI — cost: records who changed which cells and their values; policy requiring reasons for ordinary board edits would be a separate product decision.

## Remaining acceptance gates

Migration `20261002150000_schedule_board_batch.sql` must accompany the application, after the prepared source/identity/schedule migrations. PR18 remains draft. No remote database migration, demo write, production deployment, merge or real payment has been performed. Monetary policy and incentive catalog/recipient allocation remain waiting on user input. Separate demo identity, full migration-chain validation, authenticated API/browser/GPS testing and comparison of one payroll period remain acceptance work. See `2026-10-02-hris-remaining-handoff.md` for the full prior delivery and gates.


## Subsequent lock-order repair

The schedule-specific lock-order Minor above is resolved by migration
`20261002160000_schedule_source_lock_order.sql`. Single/swap submissions and
all decisions/answers/cancellations now enter the existing source boundary
before identity/request/employee/cell locks. Eight forced two-connection races
reject deadlocks and verify complete cells, request states and audit. The
original snapshot-conflict/reload behavior remains intentional. See
`2026-10-02-hris-schedule-lock-order-handoff.md` for fresh verification, review,
queueing cost and the bounded scope of this repair.
