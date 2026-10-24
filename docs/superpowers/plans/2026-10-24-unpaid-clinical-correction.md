# Unpaid Clinical Correction Implementation Plan

> Execute inline with systematic debugging, TDD and one independent whole-branch review.

**Goal:** Edit saved clinical notes on the same completed-unpaid visit and medical record.

**Architecture:** A new append-only correction receipt authorizes one exact nested UPDATE, under existing RLS. Reuse RekamForm with persisted defaults and locked downstream content; preserve all source identities and times.

**Tech Stack:** Next.js 15.5.25, React 19, Supabase/PostgreSQL, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-24-unpaid-clinical-correction-design.md`

## Constraints and review focus

- Clinical-only approval; no medication/service/compound/followup/doctor/weight/master/ledger changes.
- Completed Pembayaran only, no invoice history or checkout; auth/module/branch checks independently enforced in DB.
- Same IDs, preserved null/zero/text values, repeated edits/retries and stale concurrent saves.
- Cancel/back and isolated user/record/revision draft; initial form behavior preserved.
- Direct writes, spoofed audit, missing invoice/read/error and paid-during-edit must fail closed.
- No historical migrations replay, no PR137 work, preserve concurrent selector changes; inspect latest main before publication.

### Task 1: Audited database correction

- [x] Write/run failing isolated SQL tests with the existing submitted-record guard and RLS definitions, no migration replay.
- [x] Generate one forward migration via CLI. Add revision, immutable correction receipts, invoker readiness/RPC/triggers and exact receipt exception in existing guard.
- [x] Prove same IDs/times/prescription rows, exact retry/conflict, second edit/stale rejection, unauthorized/module/branch/paid/invoice/checkout/direct-write/audit-spoof denials.

### Task 2: Same-form navigation and defaults

- [x] Write/run failing component/action/page tests for persisted fields, same IDs, save/cancel/back, locked downstream fields and paid/unauthorized views.
- [x] Add Edit link and guarded query mode, reuse RekamForm defaults and separate correction action/draft; retain saved cart/followups/attachments read-only.
- [x] Run focused tests and existing clinical tests; update plan progress.

### Task 3: Verification, review and publication

- [x] Full npm test, typecheck, lint and production build; record blockers precisely.
- [x] Independent diff/security review; fix material findings with regression tests.
- [ ] Refresh main, preserve unrelated changes; commit/push/new PR, follow existing merge authorization only when permitted. Check exact main SHA and Production result before claiming live.

## Execution ledger

- Base main: 07b35b85a7a569c64a3d73b04a6a3190402c821c. Screenshot inspected from Library in this executor.
- Initial dependencies incomplete (decimal.js/jsdom missing); npm ci with writable cache restored lockfile dependencies. No source failure inferred from incomplete dependency run.
- Ruling: implement note-only correction with immutable weight/attachments/complaint/doctor/followups/prescriptions; these can mutate patient or downstream state and were excluded by the user's clinical-only selection.

- Task1 complete: isolated SQL red→green, all denials/retries and two-connection races/rollback verified.
- Task2 complete:29 focused correction tests plus2 photo tests; whole suite440 files/3253 tests green.
- Task3 verification complete: build/typecheck/lint/diff check pass; independent review clean. Publication pending. Target migration/RPC activation remains unavailable in this executor; no target migration replay or mutation.
