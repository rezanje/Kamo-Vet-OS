# HRIS batch 2a — attendance handoff, 1 October 2026 (WIB)

## Result and scope

Continuation of the authorized cloud roadmap on `codex/hris-meeting-followup`, batch-2a base `c99dcc7`, same draft PR 18. Original checkout remains untouched. This batch adds overnight attendance integrity and explicit HR recovery before schedule requests/swaps and the full schedule-aware monthly recap in batch 2b. Batch 1 evidence remains in `2026-10-01-hris-cloud-audit.md`.

Staff attendance now uses database-clock RPCs resolving exactly one active employee from the authenticated profile. Client employee IDs/timestamps cannot select or retime the session. Branch selection needs an effective assignment; checkout retains the check-in branch snapshot even if the assignment is later removed. Configured branch GPS is checked on demand; missing coordinates retain the existing permissive behavior. No continuous tracking.

An overnight checkout updates the original entry date, preserving the month boundary: fictional 30 September 20:00 → 1 October 08:00 is exactly one 12-hour session. The employee lock serializes clock/manual/correction calls; repeated or simultaneous clock-in/out cannot silently overwrite the row. Existing one-record-per-employee-per-day behavior is retained, so split sessions on the same day are not added.

Legacy date/time-only rows remain untouched. Unknown or older-than-yesterday WIB open sessions require explicit HR correction with real times or void and a reason. Durations are computed only when both explicit timestamps are valid. A branchless legacy correction cannot remain open: HR must complete real timestamps or void a mistaken nonfinal session; no historical branch is inferred.

HR corrections/new manual records store actor, reason, original/new snapshot and use the original version to reject stale edits, including preserving PostgreSQL subsecond timestamps when unchanged. The daily page uses the actual WIB date, shows up to 100 earlier unresolved sessions and 50 recent authorized audit events. Voids are displayed and excluded from attendance report/payroll source; monetary formulas are unchanged. Draft periods may need recalculation.

Already-final payroll periods reject attendance retiming/void/new records. An authorized, reasoned operational resolution can release a prior-day finalized open session without changing that attendance row or payroll at all. A separate resolution row and audit event preserve that decision; staff can start a later session. Resolution does not complete unknown hours, change attendance counts, or recalculate finalized money.

## Access and migration

`supabase/migrations/20261001090000_attendance_sessions.sql` is one transaction. It adds timestamps, branch snapshot, version, void flag, correction/resolution tables, an RLS-preserving open-session view and RPCs. `auth.role()` supports scalar and JSON-only claims. Authenticated direct attendance/correction/resolution writes are revoked; no anonymous RPC execution. Staff can read own attendance; OWNER sees all; ADMIN requires current authorized branches, positive primary employee assignment, and access to all current employee assignments. Staff employee-master writes are blocked because otherwise rewriting `profile_id` would defeat own-identity checks. Employee read behavior remains legacy-wide.

Schema and application must be released together after separate demo verification: old attendance direct-write clients will fail after the migration, and new app queries require the migration. This migration is prepared only; it was not applied to Supabase or production. No deployment, production payroll finalization, payments, or journal posting performed.

## Final review and evidence

One fresh independent reviewer reported three Important issues and no Critical/Minor issues. All three were reproduced in local disposable PostgreSQL, then received one correction pass with failing regressions before the fix:

| Finding | Fix and regression |
| --- | --- |
| JSON-only PostgREST claims rejected valid sessions | `auth.role()`; JSON-only own read/clock/new manual/correction and final-session resolution pass; anonymous JSON rejected. |
| Finalized legacy/stale open row permanently blocked staff | Separate authorized operational resolution; reason/version/duplicate/role/branch checks, byte-equivalent attendance and payroll, actor/audit, then successful later clock-in/out. |
| Explicit legacy check-in could remain open without a branch | Reject open branchless corrections with a clear completion/void requirement; explicit complete times release staff for later attendance. |

Final automated verification after fixes:
- `npm test`: 140 files / 1,256 tests passed.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed (Next 15.5.25).
- `npm run lint`: zero errors, same 12 preexisting warnings.
- `bash scripts/test-hris-attendance-db.sh`: four real SQL suites passed; two simultaneous clock-ins and two clock-outs each accept exactly one transition and leave one nonnegative completed session.
- `git diff --check`: passed.

The SQL runner uses a disposable PostgreSQL 16 container with no network or published ports, only fictional users/employees/GPS/payroll and local auth fixtures. It executes the exact relevant baseline migration sources, current employee assignments and existing self-role-change guard, followed by the new migration. Each scenario rolls back, including temporary test-clock overrides. Concurrent calls use separate database connections and the production database clock. The runner removes its own container and temporary logs. It never reads Supabase credentials.

Application action tests use external auth/DB fakes and actual actions/validators. SQL tests prove PostgreSQL locks/RLS/functions under the local fixture; they do not establish Supabase API, browser GPS, cookies or full production migration-chain acceptance.

## Decisions, limits and follow-up

- Bounded 2a first because session integrity supports the next workflows; approved schedule changes, atomic two-person swaps and full schedule-aware daily/monthly recap/export remain 2b.
- Runtime now reports public Supabase credential names ready and unrestricted networking, but no confirmed separate demo identity. Values were never inspected/printed; unknown remote databases were not written. Authenticated browser/Supabase API acceptance remains unverified.
- Legacy hours/branches are never guessed; nonfinal sessions need real completion or void, finalized old opens have a separate audited resolution. Historical duration may remain unknown.
- Attendance own-identity requires preventing staff master-data writes. Existing callers must move to the new RPCs and release app/schema together.
- Voids exclude erroneous work from draft payroll inputs; finalized rows cannot be voided, and operational resolution leaves counts and money unchanged.
- Existing broad employee reads expose sensitive data through direct legacy DB access, and unrelated salary/finance/master/assignment policies/actions remain incompletely hardened. This batch does not claim overall HRIS production safety. Separate demo role tests and broader hardening remain release requirements already identified in batch 1.
- Existing payroll finalization uses several independent writes and does not share the attendance employee lock. Tests prove protection for an already-final period, not a simultaneous finalization/correction transaction. Transactional payroll settlement belongs to the later finance batch; do not run HR corrections concurrently with finalization until addressed.
- New attendance timestamps do not become doctor/overtime rates. Financial batches 3–4 still need the previously listed policy decisions.
- Original 30 September meeting spec remains unavailable; supplied roadmap and existing approved salary design are the implementation authority.
- Deferred minor from batch 1 (Excel blank-template branch reference sheet) remains deferred; this attendance review added no minor findings.
