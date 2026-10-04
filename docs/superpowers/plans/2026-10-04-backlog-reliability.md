# WhatsApp completeness and acceptance implementation plan

> **For agentic workers:** Use superpowers:executing-plans for this isolated branch. Independent modules are delegated under superpowers:dispatching-parallel-agents.

**Goal:** Existing reminders use complete, checked sources and expose failures without sending from partial eligibility data.

**Architecture:** Preserve candidate rules and outbound helper. Add a bounded paged reader inside the engine, and handle failures at its existing manual/cron boundaries. Fictional in-memory query fixtures reproduce Supabase range, count and unique-log behavior.

**Tech Stack:** Next.js 15.5.25, Supabase JS, TypeScript, Vitest; existing system Chromium/Playwright for optional local benchmarks.

**Spec:** `docs/superpowers/specs/2026-10-04-backlog-reliability-design.md`

## Global constraints

- Existing dates, trigger selection, ownership and resend policy remain unchanged.
- Stable ID ordering; page size 500; source cap 50,000; fail closed before any log or send on incomplete reads.
- Never send real messages or inspect credential values.

## Review focus

- Source error after the first page must create no messages.
- Recent activity beyond 1,000 rows must prevent false lapsed reminders.
- Settings failure and disabled settings must not be conflated.
- Only a unique-key conflict may be treated as an already-processed event.
- Provider success followed by a log-update failure must not be presented as safely completed or retried automatically.

## Task 1: Source completeness and seven-trigger acceptance

Files: `src/lib/wa-engine.ts`, `src/lib/__tests__/wa-engine.test.ts`, `src/lib/__tests__/helpers/wa-db.ts`, existing `wa-ownership.test.ts`.

- [x] Add failing behavior tests for settings/source/count failures, >1,000 activity rows and seven triggers using fictional data.
- [x] Run focused Vitest and confirm failures are caused by current incomplete reads.
- [x] Implement checked stable pagination; update existing fixture to support actual range/count behavior.
- [x] Verify all focused tests and the full application suite.

## Task 2: Delivery log and caller failure handling

Files: same engine/tests; `src/app/api/cron/wa-engine/route.ts`, `src/app/(app)/pengaturan/wa-engine/actions.ts`; real caller tests.

- [x] Add failing cases for nonduplicate insert failures, update failure after provider acceptance, provider rejection, and duplicate execution.
- [x] Preserve unique conflicts and current no-resend policy; expose other errors at manual/cron boundaries without private data in public errors.
- [x] Verify focused tests, full suite, TypeScript and lint; commit.

## Task 3: Local benchmark and release record

- [x] When the local fictional stack is ready, measure authenticated customer, medical record and stock navigation in one versus ten tabs; save exact fixture/cardinality/context and errors.
- [x] Otherwise document the concrete missing prerequisite; do not claim performance fixed.
- [x] Run final build and checks, obtain one fresh branch review, fix actionable findings, publish a reviewable PR and record remaining activation/deployment gates.
