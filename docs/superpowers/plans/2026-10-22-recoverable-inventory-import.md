# Recoverable Inventory Import Implementation Plan

> Inline execution authorized by task; use test-driven-development and executing-plans.

**Goal:** Prepare, recover, review and post opening inventory safely with explicit source/rounding decisions.
**Architecture:** Existing parsers and master flow plus stock-only form; atomic invoker preparation RPC; database recovery and generation-guarded UI. Existing posting contract remains intact.
**Tech Stack:** Next15/React19, ExcelJS, PostgreSQL16, Vitest.
**Spec:** docs/superpowers/specs/2026-10-22-recoverable-inventory-import.md

## Global Constraints
No live writes, migrations, merge/deploy. No raw private rows in git. Normal push to PR86 allowed. Preserve PR84/85, A01/82/83. Do not weaken precision or authorization.

## Review Focus
- Source formulas/text numeric and large precision: preserve cached numeric lexemes, reject unknown values.
- Fractional quantities/conversions: exact representability or zero-write denial.
- Different account sharing a browser or hash: recovery requires actor plus branch access.
- Concurrent preparation/lost responses: complete one batch, reload exact persisted evidence.
- File/date/category changes mid-await: no stale state or next-stage mutation.

### Task 1: Atomic preparation and monetary evidence
Files: source numeric helper, saldo parser/resolver, import actions, migration, native SQL tests.
- [x] Write parser raw-precision regression and SQL preparation/retry/normalization/denial tests; observe RED.
- [x] Preserve source decimal strings; atomic RPC implements strict/explicit normalization and audit, no policy default inference.
- [x] Targeted parser/native tests GREEN; commit.

### Task 2: Stock-only flow, recovery and stale protection
Files: import page/forms, recovery action, accounting display, component/action tests.
- [x] Write stale-response/remount/recovery/double-submit/explicit stock-only tests; observe RED.
- [x] Implement database/URL recovery, explicit modes/date/policy and request-generation gates. Explain File reselect. Keep posting exact retry.
- [x] Targeted tests including84/85 GREEN; commit.

### Task 3: Verification and candidate
- [x] Reuse actual private workbook with synthetic metadata/date; strict denial, opted-in reconciliation and exact retry.
- [x] Full suite, typecheck, scoped lint, production build and native suites once stable; fresh whole-branch review.
- [x] Record evidence/limitations/rollback; commit, normal push, update PR86. No merge/deploy.

Execution record: 4 reviewer findings RED→GREEN; final full suite2433/313, native5 suites/223 migrations, typecheck/lint passed; final build/release-gate status recorded in verification report. Original file verified in a fresh isolated database on final candidate. No live action.
