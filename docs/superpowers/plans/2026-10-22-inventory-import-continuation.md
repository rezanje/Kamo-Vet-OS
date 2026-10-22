# Inventory import continuation implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline and test-first.

**Goal:** Move a prepared Accurate inventory batch to its explicit accounting review without repeating import preparation.

**Architecture:** Keep existing server actions and the atomic reviewed posting unchanged. Distinguish the nonpersistent stock preflight (`run_id: null`) from the persistent preview (`run_id` present) in `AccurateImportForm` and expose the existing review link as the next action.

**Tech Stack:** React 19, Next 15, Vitest/jsdom, Playwright fixture.

**Spec:** Delegated bug report: `/pos/sku/impor` appears stuck after preparation, with both a review link and an import continuation button. Screenshot does not establish which button was clicked or the production request outcome.

## Global constraints

- Base `6289994` / current origin/main, isolated branch; leave A01/PR83 and PR82 untouched.
- Fictional fixtures only; no production transaction, migration, reset, permission, or secret changes.
- Retain explicit OWNER review, idempotent posting, atomic stock/journal reconciliation.
- Publish a branch/PR; no merge or production deployment.

## Review focus

- Persistent previews must stop offering the preparation action.
- Preflight alone must still allow one preparation and must not expose a nonexistent review batch.
- Master-only imports must retain their completion path.
- Rejected previews must display the error rather than a review-ready state.
- Changing file/date must invalidate the old review target; posting outcome recovery remains owned by the accounting form.

## Task 1: Reproduce and correct the continuation

**Files:** `src/app/(app)/pos/sku/impor/AccurateImportForm.tsx`, `src/components/__tests__/accurate-import-continuation.test.tsx`.

**Interfaces:** Use existing `AccurateImportState` and `InitialStockState`; `run_id` separates preflight and persistent preview. Review target remains `/keuangan/persediaan-awal?run_id=<id>`.

- [x] Create fictional component regression showing preflight → master confirmation → persistent stock preview. Assert no enabled preparation action remains and a primary link targets the prepared run. Watch it fail on main.
- [x] Gate preparation on absence of a persistent preview; make the current stage and next action say review/posting, without claiming stock has been posted.
- [x] Cover master-only completion, unsuccessful preparation, date/file invalidation, and action counts.
- [x] Run focused tests, full `npm test`, scoped ESLint, TypeScript, production build, and real browser fixture at desktop/mobile widths. Record exact failures/limitations.
- [ ] Review final diff and publish one commit/branch/PR; check automatic preview if available.

## Progress / decisions

- Investigation: PR74/78 replaced automatic posting with a review link but left `previewReady` true for both preflight and persistent preview. The bottom green panel and top Import Sekali action therefore still call `previewSaldoAwalAccurate` after preparation; successful status text is stored but hidden when idle.
- Baseline setup: inherited node_modules lacks jsdom. First npm ci failed because default cache is outside writable roots; retry uses `/tmp/kamo-import-npm-cache`. No application baseline failure inferred from missing dependencies.
- Execution is already authorized by the delegated request; continue inline without a new approval gate.
- Task 1 verification complete: six regression tests, full suite 2,407/2,407, focused 20/20, desktop/mobile fixture, TypeScript, scoped lint, production build and whitespace passed.
- Independent Sol 6.1 high review: no Important/Critical introduced issues; reviewer separately ran 13 component tests, all passed.
- Deferred pre-existing issue: inputs remain editable during an in-flight request, so its late response can restore stale state. Sequential invalidation is covered; cancellation/race-safe invalidation is outside this bounded continuation fix.
