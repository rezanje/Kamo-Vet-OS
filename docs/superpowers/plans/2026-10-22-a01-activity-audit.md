# A01 Activity Audit Implementation Plan

**Goal:** A cross-module, append-only activity index and per-object history for explicitly registered business mutations, including deleted objects.
**Baseline:** original main6289994, integrated latest origin/main102f3b0555305524611296e29d16affc12553eb7 without conflicts; isolated branch codex/a01-activity-audit-20261022. PR82 average and new SO feedback excluded.
**Architecture:** PostgreSQL triggers write compact allowlisted snapshots in the source transaction. Existing domain correction audits and journals remain authoritative; the activity index links to object history and does not copy their payloads. No historical backfill. Server session actor/time; no browser-supplied actor or audit-write RPC.
**Tech:** PostgreSQL 16, Supabase RLS, Next 15 server components, Vitest.
**Spec:** Delegated A01 meeting 22 October, 61:00–65:58.

## Constraints and scope
- No production migration/data/permission/authentication change, merge, deploy, or Sheet edit.
- New log read access conservatively follows existing master lifecycle audit: active OWNER/ADMIN, existing source-module access and existing branch capability/operational selection. Other roles retain existing domain histories. No existing policy is broadened.
- Only business codes/document numbers, status and numeric fields are retained as values. Personal/contact/medical/free-text content is excluded; field names can indicate redacted edits. No secrets or raw medical records. Actor name is a server profile snapshot for attribution.
- A registry of explicit source tables is the coverage boundary. Header-only coverage must be called out; no claim that every module is audited.
- No source FK on the log: deletion must retain identity, label, scope and actor.
- A retry with no business mutation produces no update event. Existing posting request keys remain responsible for command idempotency.

## Review focus
- Disabled/anonymous/other-role readers and module revocation; cross-branch and selected-branch access.
- Spoofed created_by/context cannot set audit actor; direct insert/update/delete/truncate is denied.
- Forced audit-write failure rolls back the business mutation; no swallowed failures.
- Personal/free-text changes have field names but no before/after values; cascade deletion remains attributable.
- Pagination preserves object/module/action filters; missing migration/errors are visible, not shown as an empty history.

## Execution
- [x] Write SQL acceptance tests for immutable log, actor, sanitization, source rollback, deletion retention and branch/module isolation. Run RED against main.
- [x] Add migration, explicit registration, safe snapshot capture, source authorization and indexes; run SQL tests GREEN plus correction regression suites.
- [x] Write failing viewer/history tests (filter, pagination, error, no historic claim); implement general viewer, object links and per-object history entry points.
- [x] Inventory tracked/untracked mutation paths and document deploy/rollback/UAT gates.
- [x] Run full Vitest, typecheck, scoped lint, build, SQL regressions, diff checks and independent review; fix material findings.
- [x] Commit, push isolated branch, create reviewable PR. Report code/push/deploy/migration/UAT separately.

## Baseline
- Full Vitest: 308 files, 2,401 tests passed on untouched main (32.15s). Existing act() warnings present.
- AGENTS.md/CLAUDE.md and engineering evidence read. Installed Next 15 package lacks node_modules/next/dist/docs; use existing patterns, installed types and production build.
- Existing PostgreSQL disposable harness uses network-none containers, fictional data and auth/storage shims; it is not production parity or full Supabase reset.

## Expanded final candidate
- [x] Replace the insufficient43-table slice with179 explicit business sources; classify all47 remaining technical/request/proof/domain-history tables in the226-table schema. Do not infer full command coverage from counts.
- [x] Cover receipt/payment/advance/return sources; journal/asset children; pricing/category/unit; opname/production/shifts; CRM/clinical metadata; HRIS/company/settings/tax metadata.
- [x] Natural/composite keys, recursive/cascade/tombstone associations, source-reader clamps, metadata privacy, old/new branch/module intersections; fix independently found payment-map branch and unknown-module denials.
- [x] Expand catalog/menu/document links and indexed related-source/object query; test long composite IDs, pagination, failures and privacy.
- [x] Preserve main102f3b0 released fixes; no PR86 candidate code imported. Final app2458tests/315files pass; all6 A01 SQL suites pass.
- [x] Diagnose overnight UTC/Jakarta fixture mismatch and reproduce on pristine latest main. Configure fictional fixture sessions to Jakarta without changing product guards; complete SQL18pass/1baselinefailure.
- [ ] Parent-coordinated authenticated shared-database UAT, deployment/migration, volume/concurrency and release approval. Keep A01 business checklist incomplete until accepted.

See `docs/verification/2026-10-22-a01-activity-audit.md` and checked-in evidence for exact final results, exclusions, migration order and rollback. Independent security review completed with no outstanding important findings before main integration; integration did not conflict with audit code. PR83 remains the single delivery vehicle. No staging/production migration, deploy, merge or Sheet edit is performed here.
