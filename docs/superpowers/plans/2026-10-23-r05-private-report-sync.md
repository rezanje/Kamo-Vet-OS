# Private report configurations implementation plan

> **For agentic workers:** Execute task-by-task with executing-plans. The user has already authorized autonomous implementation and review; no routine approval pause.

**Goal:** Extend PR124 with private per-user cross-browser storage and reopenable report column choices, preserving applied filters and existing report authorization.

**Architecture:** One additive preference table, authenticated owner-only RLS and server-derived account/time; server actions perform individual-row CRUD, never replace another browser's whole list. Existing allowlisted report URLs carry filters and bounded column configuration. Shared report controls only change presentation, never calculations or access.

**Tech Stack:** Existing Next15/React, Supabase/PostgreSQL, Vitest and owned local PostgreSQL fixture.

**Spec:** Canonical Sheet Checklist row63/R05, read 23 October: save/reopen relevant filter, column and existing grouping parameters; changing month preserves the rest. Parent narrowed implementation to private sync and columns. Shared-role configuration remains undecided and is excluded.

## Constraints

No target migration, main merge/deploy/retry, credentials, sharing, report-row snapshots, new aggregation rules or existing auth/permission changes. Reuse current module/account checks. A configuration never authorizes its destination. Preserve browser-only configurations for explicit user copying, never silently overwrite them. PR124 source and applied-default semantics are retained.

## Tasks

- [x] Add failing owner-isolation/disabled/module-denial/actor-spoof/cap/idempotent-update SQL tests and server-action tests. Implement preference table and CRUD actions with server identity, per-row updates and checked list reads. Run only isolated fixtures.
- [x] Add client tests for server reload in a second browser, account switch/stale responses, failed save/delete, concurrent individual changes and explicit legacy copying. Replace local-only persistence with server actions; no silent local fallback on server failure.
- [x] Independently implement `normalizeReportColumns(raw:string|null):string`, shared column controls and export behavior. Support safe simple-header tables and span-aware rows; complex layouts remain visible with an honest limitation. Preserve kolom through GET month changes and preset hrefs. No new grouping semantics.
- [x] Integrate bounded kolom validation with existing href allowlists; preserve repeated filters and server-applied reset defaults. Run focused regressions, scoped lint, production build then separate typecheck once stable.
- [x] Independent security/correctness review; archive evidence, source hashes and migration/rollback limits. Normal push to existing PR124, exact-head preview check; no merge or target write.

## Review focus

Owner/ADMIN must not read another account's private configurations. Disabled/module-denied accounts cannot call actions or direct DML. Failed/corrupt reads never overwrite server or browser records. Lost responses must retry an exact id without duplicate rows; another browser's row cannot be dropped by a list replacement. Malformed/stale/all-hidden column selections keep the full table visible with explanation; totals/merged cells/exports remain coherent. Month changes and navigation cannot revive dirty uncontrolled values or stale account results.
