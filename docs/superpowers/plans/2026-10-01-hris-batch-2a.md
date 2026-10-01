# HRIS batch 2a — attendance sessions and corrections

> Use superpowers:executing-plans inline; user authorized continued work on the roadmap.

Goal: one correct overnight session, duplicate/race protection, branch/own-data checks, traceable authorized correction. This bounded batch establishes attendance before transactional schedule requests (batch 2b).
Architecture: preserve attendance date/time compatibility, add explicit timestamps and branch snapshot; security-definer RPCs resolve own employee and use database clock/locks; manual corrections require reason and audit snapshot. Existing salary formulas untouched.
Spec: docs/superpowers/plans/2026-10-01-hris-cloud-execution.md batch 2, older approved HRIS design.
Constraints: no production migrations/writes/deploy; SQL only on disposable local PostgreSQL; no guessed hours for legacy/stale sessions, no continuous location tracking or new pay policy.

## Tasks

1. SQL contract and fictional tests: add supabase/tests/hris_attendance_sessions.sql and local-only fixture runner; show absent RPC RED. Migration supabase/migrations/20261001090000_attendance_sessions.sql adds checked_in_at/checked_out_at/branch_id, correction audit, clock/correct RPCs and attendance read boundaries. Test 20:00→08:00 across month, duplicates, stale/legacy opens, own/foreign branch admin, no anonymous writes, row locks/concurrent calls, reason/audit rollback and final payroll lock. Existing legacy rows remain untouched and flagged.
2. Staff integration: src/lib/attendance-session.ts (+tests), src/app/me/actions.ts and page.tsx use open session ahead of today's row; timestamps rendered in WIB, stale/legacy unresolved sessions direct staff to HR. AbsenTombol supports permitted branch selection for rolling employees; RPC validates assignment and GPS against session branch. Regression UI/action tests first; use backend clock, never trust client employee or timestamp.
3. Authorized corrections: hris/absensi page/actions (+tests) use RPC with expected version and explicit timestamp or approved void for mistaken open session. Daily UI lists unresolved previous sessions with actor/reason/old-new audit; use current WIB date, guard read/write access. History includes duration where timestamps are known; unknown/inconsistent sessions flagged. No guessing legacy dates/hours.
4. Verify full Vitest/tsc/build/lint and real local PostgreSQL behavior/concurrency/RLS tests. Independent final review, fix important findings RED→GREEN. Commit/update existing draft PR 18. Record actual verification and unverified Supabase/browser acceptance.

Interfaces: RPC hris_clock_attendance(p_action text,p_branch_id uuid,p_lat numeric,p_lng numeric) returns attendance row; hris_correct_attendance(p_id uuid,p_expected_updated_at timestamptz,p_checked_in_at timestamptz,p_checked_out_at timestamptz,p_reason text,p_void boolean default false) returns attendance row; hris_record_attendance(...explicit dates/status/reason...) for new manual records if needed. Helpers select one open session and produce ready/done/correction state, worked duration only from explicit timestamps.
Review focus: client-forged identity/time/branch; legacy/multiple stale opens; check-out branch changed after check-in; concurrent clock/correction; correction of settled payroll or rewritten legacy history. Missing remote demo remains unverified.

## Final review amendments

Use auth.role() for scalar and JSON-only Supabase/PostgREST claims. Add hris_resolve_final_attendance(id, expected version, reason) plus a separate immutable attendance_session_resolutions record: only authorized HR may release prior-day open sessions in final payroll periods, without changing historical attendance/payroll or guessing checkout. Open-session queries exclude these explicitly resolved rows; payroll/report source remains unchanged for them. Branchless legacy corrections must be explicitly completed or voided; leaving them open is rejected. Three reproduced Important findings receive one RED→GREEN fix pass.
