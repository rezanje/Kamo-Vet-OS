# HRIS batch 2b1 — schedule request handoff, 1 October 2026

## Result and scope

Continuation of the uploaded cloud roadmap and the user's accepted priority: one-person schedule-change requests before swaps and full recap. Base `7ad1e8c`, isolated `codex/hris-meeting-followup`, existing draft PR 18. Original checkout remains untouched. Prior batch evidence is in `2026-10-01-hris-cloud-audit.md` and `2026-10-01-hris-attendance-handoff.md`.

Staff can view their published schedule at `/me/jadwal`, choose an eligible assigned branch and different active shift, preview the original and proposed times, and submit a reason. The original schedule remains effective while waiting. Submission uses the authenticated account's exactly one active employee mapping, not a client employee ID. Requests cover today or future dates with no recorded nonvoid attendance and no already-final payroll. The page includes all requests in the selected range (maximum 62 days) plus the latest 50.

At `/hris/pengajuan/jadwal`, authorized OWNER/ADMIN can approve or reject with a reason. Approval revalidates employee, requested branch, assignment date, shifts, attendance and final payroll, original cell ID/version and full original snapshots. Changed definitions, deletion/recreation and an old→new→old schedule reject approval. Authorized HR may reject an obsolete request without changing the schedule. Decision, effective schedule update and immutable actor/reason/old/new event commit together. Failed audit insertion rolls back the entire decision.

The approved shift replaces the same existing `employee_schedules` source used by payroll. The actual collector regression confirms scheduled 07:00 / actual 08:00 gives 60 minutes late; approved scheduled 08:00 / actual 08:00 gives zero. Monetary formulas and rates are unchanged. Two-person swaps and the full schedule-aware monthly recap/export remain the next units.

## Access, locks and migration

`supabase/migrations/20261001100000_schedule_change_requests.sql` runs in one transaction. It adds schedule versions, requests, immutable events, own-schedule and submission/decision RPCs, and a payroll source-access guard. Scalar and JSON JWT claims work; anonymous RPC execution and authenticated raw request/event writes are denied.

Schedule reads permit staff's own records or complete authorized current employee/shift scope. Writes require HR scope and a positive effective assignment. Staff cannot bypass requests through the old board or master-shift writes. Global shifts are writable only by OWNER; ADMIN can write assigned branch shifts. Existing HR board writes remain available, receive versions and reject already-final periods. Zero affected rows from a scoped shift mutation or board deletion now report failure instead of false success.

Request and approval locks participate in employee identity/status, employee assignments, actor profile/branch access, branch settings and shift definition writes. Submission rechecks the own-active identity after taking the employee lock; decision rechecks scope after that lock. Configuration changes cannot invalidate those checks before the approval commits. A serialization/deadlock failure is surfaced as a reload requirement, without a partially approved request.

Existing calculate/correct/finalize payroll actions operate across the company. They now require OWNER before collecting source rows or writing results; merely managing all current employees does not prove visibility of historical schedules/attendance. Missing migration or insufficient source access fails closed with a controlled message. This restriction does not make the old financial settlement transactional.

Schema and application must be released together after separate demo validation. This migration was prepared only; no Supabase or production migration, deployment, payment, payroll finalization or journal posting was performed.

## Final review and verification

One fresh independent reviewer reported three Important findings, no Critical findings and no concrete Minor findings. One fix pass followed actual failing PostgreSQL reproductions:

| Finding | Correction and regression |
| --- | --- |
| HR scope could change while approval waited for an employee lock | Recheck scope after locking; actor and employee assignment writers participate in locking. Concurrent A→B transfer prevents A-admin approval; concurrent access revocation waits until an already-valid approval commits. |
| Staff could submit after their employee was unlinked during the lock wait | Lock the actor profile; lock using the own-active predicate and recheck unique active mapping. Concurrent unlink, rebind and deactivation deny the old account and create no request. |
| Current employee scope did not prove historical payroll source visibility | OWNER-only company payroll. A branch admin with a hidden historical shift is denied before payroll collection/writes. |

`scripts/test-hris-schedule-review.py` executes seven real PostgreSQL cases. Against the pre-fix migration six fail (the employee-assignment writer already blocked through an existing foreign-key lock); against the corrected migration all seven pass. The optional baseline source argument proves RED without replacing the working migration. Readiness waits for the container's final loopback TCP listener rather than its temporary initialization socket.

Final commands and outputs are recorded below after the one fix pass. These are local automated checks, not live Supabase/browser acceptance:

- `npm test`: 146 files / 1,270 tests passed.
- `npm run build`: passed (Next 15.5.25).
- `npm run lint`: zero errors, same 12 preexisting warnings.
- `npx tsc --noEmit`: passed.
- `bash scripts/test-hris-schedule-db.sh`: request/approval/access/version/atomic audit suite, all four previous attendance SQL contracts, and two simultaneous approvals passed. Exactly one decision wins, one effective schedule changes, and submission plus decision produce two events.
- `python3 scripts/test-hris-schedule-review.py`: seven review regressions passed.
- `git diff --check`: passed.

The runners create disposable PostgreSQL 16 containers without network, ports or volumes, use only fictional users/employees/schedules/attendance/payroll, load the exact relevant baseline migration sources and existing self-role guard, and remove their own containers/logs. They do not read Supabase credentials. Application tests execute real actions/validators/payroll collector with external auth/database fakes. Full Supabase migration-chain, API authentication, browser cookies, GPS and UI acceptance remain unverified.

## Decisions and costs

Every implementation ruling and declined review judgment is preserved here:

- Execute the supplied roadmap and accepted priority directly. The user already authorized implementation and bounded plans; the missing original meeting spec may require later adjustment.
- Ship one-person requests first. Atomic two-person swaps and full monthly recap/export remain pending.
- Only existing published schedules today/future, before attendance and nonfinal payroll, can be requested. Retroactive staff changes require a separate explicit HR correction design; stale requests can still be rejected.
- The existing schedule schema has no separate branch field. Record a positive assigned branch on the request and validate both shift branches against it; a global shift alone cannot establish the historical branch worked.
- Local skill ledger helper scripts and the nested reviewer template were unavailable. Cloud skill guidance, equivalent manual ledger/task bookkeeping and an explicit fresh review package were used; automatic helper bookkeeping was unavailable.
- Global master shifts are OWNER-only, branch shifts assigned ADMIN-only. Previously permissive ADMIN global writes become restricted to avoid cross-branch changes through shared definitions.
- Schedule authorization uses complete current employee scope, consistent with attendance. Rolling employees outside an admin's complete scope need OWNER or broader authorized assignment; historical permissions still require separate design.
- Zero-row mutations fail instead of claiming success. Concurrently cleared cells and revoked access require reload.
- Initially guarding company payroll by all-current-employee scope was insufficient; the final ruling is OWNER-only. Even an ADMIN assigned all current branches needs OWNER to calculate/correct/finalize whole-company payroll until scoped source collection and settlement are designed.
- Identity/access configuration writers join the request locks. These writes can wait or encounter a deadlock/serialization failure; callers must reload/retry. Approval and its event remain atomic.
- Declined review judgment: existing nontransactional financial settlement is outside this batch and remains a release blocker. Concurrent finalization versus attendance/schedule changes or journal posting is not established safe. Protection is proved for an already-final period only.
- Declined review judgment: broad legacy employee reads and unrelated finance/master/assignment policies require separate hardening. Sensitive data still needs DB-level restrictions and separate demo role tests before release.
- Declined review judgment: existing HR board batch writes use several requests. This batch makes the new approval atomic; an old board batch can still partly save if a later request fails, requiring reload.
- Financial batches 3–4 still need the previously recorded business-policy decisions. No new doctor/overtime rate is inferred.
- Deferred batch-1 Minor: the blank Excel template still lacks a branch-reference sheet. No additional concrete Minor findings in this final review.

Runtime reported public Supabase credential names ready and unrestricted networking, but there was no confirmed separate demo database identity. Credential values were never printed and unknown remote databases were not written. Automated success is not a claim that the whole HRIS is safe for production.
