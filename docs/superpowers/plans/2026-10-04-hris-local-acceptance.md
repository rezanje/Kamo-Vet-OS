# HRIS Local Acceptance Implementation Plan

> For agentic workers: use superpowers:executing-plans inline. User authorized completing feasible remaining work; no repeated approval gate, no additional agents.

**Goal:** Close reproducible local HRIS integration gaps using existing financial rules and fictional records.

**Architecture:** Start isolated actual Supabase auth/API/DB services and apply all179 migrations, documenting any historical prerequisites. Existing SQL suites and browser/API checks exercise real handlers and contracts; any demonstrated application fix receives a regression first.

**Tech Stack:** Next15.5.25, React19, Supabase CLI2.75, Docker, PostgreSQL16/17, global Playwright + system Chromium.

**Spec:** `docs/superpowers/specs/2026-10-04-hris-local-acceptance-design.md`

## Global constraints

Use existing financial rules. Fictional local data only. No remote schema/data mutation, real settlement or production deployment. Do not print credentials. Preserve historical migrations; explicitly distinguish normalized local bootstrap from a clean CLI reset.

## Review focus

Fresh bootstrap and missing grants must not be hidden by broad shim privileges. Cookies and server actions must carry actual authenticated identity. GPS denial and cross-branch reads must fail visibly. Local payroll sources must match manual expected totals and remain immutable after finalization. Retry/reload must not duplicate attendance, schedule swaps, installment or journal writes.

### Task1 — Complete migration/bootstrap evidence

Files: create `scripts/hris-local-stack.py` and local-only runtime directory outside git; existing179 migration sources remain unchanged.
- [x] Start actual minimal Supabase stack; observe raw chain/CLI failures before documenting prerequisites.
- [x] Implement reusable explicit local bootstrap, every source migration unchanged/in order, with prerequisite logging and counts.
- [x] Run all12 existing SQL suites and forced races; record real-stack versus curated-suite limits.

### Task2 — Authenticated API/browser and one-period evidence

Files: create `scripts/test-hris-local-browser.mjs`, fictional fixture SQL and `docs/reports/2026-10-04-hris-local-acceptance.md`.
- [x] Seed local fictional roles/branches linked to real auth users, dated assignments and current policy; assert identity/branch privacy through PostgREST.
- [x] Exercise browser login/cookies, GPS denial/outside/success, correction, schedule/Excel, mutual swap, recap/export and prepare/finalize/retry with manual existing-policy totals.
- [x] Reproduce any failing production behavior; add failing regression; minimal fix; run passing regression/full app suite. No application bug found; setup/harness failures corrected without production code changes.
- [x] Run full app tests, typecheck, lint and diff check; record exact limits and commit durable checks/results. Ruling: parent's final combined branch owns fresh build while the shared dev server stays alive for its benchmark; no standalone fresh build claim.

Ruling: the user supplied implementation authority and financial-policy clarification through the parent; proceed inline without another design confirmation. Cost: local evidence is not stakeholder signoff or remote/production compatibility.

### Task3 — Diagnose interrupted benchmark and make launcher independent

Parent follow-up authorized diagnosis and a reproducible standalone fictional launcher; do not restart3108.
- [x] Inspect saved logs, zombie exit status and cgroup events; report SIGKILL with unknown sender, no V8/OOM evidence.
- [x] Add local-only independent supervised/detached gateway/build/dev/start launcher, atomic exit state and local production build stamp.
- [x] Run seven isolated credential-free regressions, Python syntax and whitespace checks; no shared app/database restart or mutation.
