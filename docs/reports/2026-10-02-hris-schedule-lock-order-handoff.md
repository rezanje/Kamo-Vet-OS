# HRIS schedule mutation lock order — 2026-10-02

Bounded continuation after `039dfd8`, on the existing isolated `codex/hris-meeting-followup` branch and draft PR18. User approved continuing independent SQL/lock-order work while monetary-policy, incentive-catalog and demo inputs wait. Original `/workspace/Kamo-Vet-OS` remains untouched.

## Result

Migration `20261002160000_schedule_source_lock_order.sql` replaces four existing implementations without changing their signatures, security-definer settings, empty search paths or ACLs: single-change submission/decision, swap submission and the shared swap transition. Auth/reason validation precedes the existing source advisory lock `72310402`; that lock now precedes every profile, request, employee and schedule row lock in these mutation paths. Swap submission resolves its locking actor helper after the source boundary rather than in its declaration initializer.

The existing board, payroll and source writers already acquire this source lock first. Their source-first versus legacy approval employee-first cycle is therefore removed for these schedule paths. Actual stale requests/approvals still fail their snapshot checks; rejection/cancellation still succeeds when allowed. Lock acquisition alone does not increment the payroll source revision; only existing effective source-write triggers do. Role/access, dated assignment, final payroll, peer consent, atomic audit and immutable history rules are preserved. Read-only candidate and schedule-list flows are unchanged.

The new definitions expand the touched SQL into structured declarations, conditionals and queries. This is focused readability work on these four implementations, not a whole-repository formatting pass or a change to already recorded migrations.

## Evidence and review

- Before the fix, two real PostgreSQL connections deterministically produced SQLSTATE `40P01`: a source-holder board call waited for an employee row held by the old approval, while that approval waited for the source lock. `/workspace/hris-lock-order-red.log` records the actual deadlock, its locks and function stack.
- After the fix, eight forced interleavings pass: single submission/approval/rejection, swap submission/approval/rejection, peer consent and cancellation. A real source-holder takes the advisory lock; each contender must be observed waiting on that exact lock through `pg_locks`/`pg_stat_activity` before the holder invokes the actual board RPC. The holder commits a complete batch; stale contenders reject without false request/audit, and permitted cancellation/rejection commits exactly one event. Effective remaining cells, complete batch audit, states and function permissions are checked. Any unexpected deadlock now fails the earlier board race as well.
- All **12 SQL suites and prior board/swap/access/payroll/accounting-close races pass**, plus the eight new deterministic races, on disposable PostgreSQL16 with network disabled and fictional identities. The runner automatically executes the new harness when both swap and board suites are selected, after prior payroll races so its fictional employees do not affect their counts.
- Fresh full application suite: **157 files / 1,331 tests pass**. Python parsing and diff whitespace checks pass. Application source and dependencies are unchanged in this follow-up; build, subsequent TypeScript and lint remain the verified results at `039dfd8` (zero lint errors/twelve existing warnings), rather than new build claims.
- One fresh independent reviewer compared the SQL token changes against the original functions and inspected source revision, permissions, initialization, locking and the test harness: **no actionable Critical/Important/Minor findings**. Reviewer did not independently rerun the DB suite; the actual parent-run results are the evidence above. No review patch was necessary.

Reproduce:

```sh
npm test
python3 -B scripts/test-hris-completion-db.py hris_attendance_sessions.sql hris_attendance_legacy_correction.sql hris_attendance_json_claims.sql hris_attendance_final_resolution.sql hris_schedule_requests.sql hris_schedule_swaps.sql hris_attendance_recap.sql hris_sensitive_access.sql hris_payroll_settlement.sql hris_payroll_effective.sql hris_review_privacy.sql hris_schedule_board_batch.sql
```

Session logs: `/workspace/hris-lock-order-{red,green2}.log`, `/workspace/hris-lock-all-db.log`, `/workspace/hris-lock-full-tests.log`. The first green attempt exposed a test-query whitespace typo in its final state assertion; that harness typo was corrected before the passing runs. Durable results and commands here do not depend on future availability of those logs.

## Decisions and remaining gates

- Existing implementation authority plus the explicit continuation covers this bounded repair; no repeated design-permission gate. Cost: monetary policy and feature scope remain unchanged.
- Reuse one existing source boundary for all these mutating schedule entrypoints. Cost: submissions, answers and cancellations now queue behind source writers/payroll even when they do not alter an effective schedule. They do not invalidate payroll drafts merely by taking the lock.
- Replace the existing implementations in a new migration, preserving security and functional checks. Cost: definitions are repeated for an explicit upgrade path; future edits must keep these latest implementations consistent.
- Scope covers the tested schedule paths. Unrelated attendance/finance/recap operations and arbitrary transactions that pre-acquire other locks are not covered by a global no-deadlock claim. Existing snapshot conflicts still require reload/rejection and a new request when appropriate.

Release this migration after the prepared source/identity/schedule and `20261002150000` board migrations. No remote database migration, demo write, deployment, merge, real payment or policy activation occurred. Monetary rules and incentive catalog/recipient allocation still await input. Separate demo identity, full migration-chain/API/browser/GPS acceptance, signed-off manual payroll comparison and a separate production release decision remain outstanding. See the earlier two HRIS handoffs for full delivery and gates.
