# Remaining HRIS Implementation Plan

> For agentic workers: use superpowers:executing-plans inline, task by task. User has authorized completing remaining roadmap work; reuse existing isolated worktree. One fresh final reviewer after independent deliverables, one regression fix pass.

Goal: complete swaps, recap, source/access and settlement integrity; implement changed financial/commission rules when their required inputs arrive.
Architecture: reuse Next 15.5.25, React, Supabase tables/RLS/RPCs, current payroll and commission functions; prepared migrations only. Atomic transitions and scoped source RPCs serve existing pages/actions. Fictional local PostgreSQL and real functions/actions supply regression evidence.
Spec: docs/superpowers/specs/2026-10-02-hris-remaining-design.md and supplied 2026-10-01 cloud roadmap.
Global constraints: preserve settled history/legacy unknown time; default monetary settings unchanged; no production DB writes/deploy/payment; do not print credentials. Same branch codex/hris-meeting-followup / draft PR 18. Dependencies installed; official docs fetched from exact Next v15.5.25 tag because installed docs are absent.

## Review focus

Identity/branch assignment changes during locks must not authorize stale actors. Overlapping single-change/swaps and reversed employee lock order must not reserve or partially alter cells. Recap must not treat hidden/truncated history or unknown hours as zero work. Financial source changes and simultaneous period close/finalization must fail atomically. Legacy finance/request callers must not retain raw-write bypasses after new RLS.

## Task 1 — Atomic swaps and staff/HR flow

Files: migration 20261002090000_schedule_swaps.sql; supabase/tests/hris_schedule_swaps.sql; scripts/test-hris-completion-db.py; src/lib/schedule-swap.ts; src/app/me/jadwal/tukar/{page,actions}.tsx/ts; src/app/(app)/hris/pengajuan/tukar/{page,actions}.tsx/ts; existing personal/HR schedule links; src/lib/__tests__/schedule-swap-actions.test.ts.
Interfaces: consumes employee_schedules.updated_at, hris_manage_employee/branch and identity/access triggers; produces hris_swap_candidates(schedule_id,branch_id,start,end), hris_request_schedule_swap(own_id,own_version,peer_id,peer_version,branch_id,reason), hris_respond_schedule_swap(id,accept,reason), hris_cancel_schedule_swap(id,reason), hris_decide_schedule_swap(id,approve,reason), hris_my_schedule_swaps(start,end).
- [ ] Write SQL regressions: own/foreign candidates, mutual consent, wrong peer/HR role, pending conflicts, stale identities/cells/shift, final/attendance, second-write/audit rollback, separate concurrent approvals. Run local runner; expected absent RPC FAIL.
- [ ] Implement prepared migration and run SQL; expected PASS without any partial changed pair.
- [ ] Write real action regressions for forged identity/approval and role/error handling; run expected absent module FAIL; implement staff/HR selection/consent/decision/history pages/actions; expected PASS.
- [ ] Run full app suite, typecheck and SQL; commit independently testable swaps deliverable.

## Task 2 — Complete scoped daily/monthly recap and Excel

Files: migration 20261002100000_attendance_recap.sql; supabase/tests/hris_attendance_recap.sql; src/lib/attendance-recap.ts; src/lib/__tests__/attendance-recap.test.ts; src/app/(app)/laporan/absensi/page.tsx and export/route.ts; daily HR link.
Interfaces: consumes approved employee_schedules and explicit attendance timestamps; produces hris_attendance_recap(start,end,branch_id) JSON employee/shift/session/leave/overtime source; rekapJadwal(data,today) daily+summary; same export source. No money rates inferred.
- [ ] Test 20:00→08:00 yields 720 worked minutes on entry date, approved 08→08 zero lateness, approved leave suppresses past absence, future schedule not absent, unknown legacy/open/void/anomalies, multiple assigned branches and >1,000 rows. Expected new source/helper FAIL.
- [ ] Implement scoped RPC, deterministic pure calculation, monthly summary/daily drilldown and Excel export. Test same dataset and own/foreign/anonymous denial. Expected all PASS.
- [ ] Run whole suite and SQL; commit recap deliverable.

## Task 3 — Database privacy and request integrity

Files: new scoped-access migration/tests; staff and HR request/leave actions and affected readers. Read all legacy callers before edits.
Interfaces: consumes manage_employee/branch and participant identity lock; produces own/HR read policies and audited request transitions. Staff cannot choose employee/status, HR must authorize employee and changes. Current rates/tenor behavior preserved.
- [ ] Reproduce cross-employee salary/bank/payroll reads and raw request approval/installment/paid-period writes under authenticated role. Expected existing bypass tests FAIL.
- [ ] Restrict sensitive rows/columns as needed, update exact callers and selectors, implement locked audited transitions with reason/version. Include access-revocation and foreign HR regressions. Expected PASS.
- [ ] Run full suite and earlier SQL contracts; commit access/request deliverable.

## Task 4 — Payroll source snapshots and transactional settlement

Files: payroll snapshot/settlement migration/tests; src/lib/payroll-data.ts and source detail helpers; payroll actions/page/slip as needed; meaningful action/source failure tests.
Interfaces: consumes exact existing hitungGaji rules, effective source input; produces stored immutable source/draft version and atomic calculate/correct/finalize RPC transitions. Persist installments, reimburse markers, journal and final status together; OWNER only, no real settlement.
- [ ] Reproduce partial settlement on journal failure, repeated/concurrent finalize, changed source/draft, negative net/insufficient installment, query failure/truncation and period-close race. Expected old behavior FAIL.
- [ ] Fail closed and paginate source collection; store source fingerprints/details, version/reasons; implement transactional settlement with employee/source/accounting locks and same balanced journal mapping. Expected rollback on every injected failure, one journal/settlement on simultaneous finalize.
- [ ] Preserve finalized history; run whole suite/SQL/build; commit settlement/source deliverable.

## Task 5 — Financial configuration and commissions

Implement confirmed rules only. Settings use effective dates and groups; persisted finalized source stays unchanged. Add fixed employee/variable period components and source detail using current structures. New incentive types/recipient policy depend on requested catalog; keep historical kasbon and confirmed existing commission semantics.
- [ ] Record incoming policy/catalog answers in a bounded spec amendment before dependent money changes; if absent, mark exact gates and complete independent configuration/history/source work.
- [ ] Test effective boundary, old final history, nonduplicate repeated calculation, group membership dates, caps/partial units/recipient allocation as actually confirmed. Expected missing behavior FAIL, then implement and PASS.
- [ ] Run whole suite and SQL; commit only verified configuration/commission deliverables, not assumed policy.

## Task 6 — Acceptance, final review and handoff

- [ ] Run all local contracts, full npm test/build/lint/tsc and diff check. Demo API/browser tests depend on confirmed separate identity; do not probe or seed an unknown remote database. Prepare release checklist and explicitly name unverified gates.
- [ ] Fresh final reviewer uses exact plan/spec/ledger/base range. Regrade findings; one Critical/Important RED→GREEN fix pass and green full suite. Record rulings/costs and deferred minors in durable report.
- [ ] Push existing feature branch, update draft PR 18 and verify its remote head. No merge/production release. Remove only this plan's scratch after durable report/commits.
