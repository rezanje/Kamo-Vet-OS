# Multi-branch employee assignments

Approved scope: meeting feedback and user instruction “gas” after prioritizing multi-branch, then unified compound editor. Implements requirement 8 of docs/superpowers/specs/2026-10-05-clinic-feedback-design.md.

Goal: OWNER/ADMIN selects one active employee and multiple additional active branches, then saves them atomically. Existing assignments remain; this is additive assignment, not replacement. Main branch cannot be overwritten. A failed/unauthorized branch or write rolls back every assignment.

Implementation: client checkbox form, strict FormData parser, server action invokes one security-invoker RPC. RPC authenticates active admin, locks employee, validates all selected branches and access before upsert. Keep RLS and existing primary assignments. Default effective date uses Jakarta date.

- [x] Parser and action tests: multiple selections, invalid IDs/dates, duplicates, one atomic RPC and error handling.
- [x] SQL function tests: active admin, inactive employee/branch, inaccessible branch, preserved primary, retry/upsert, injected second-write failure rollback.
- [x] Client form: searchable checkboxes, disabled primary, selection summary, empty selection blocked, change employee resets selection.
- [x] Verify browser, full tests, TypeScript, build, review; apply migration before merge, then verify production read-only.

Next.js 15.5.25 has no node_modules/next/dist/docs in this environment; follow existing App Router patterns and verify build/type checks.

Verification: 155 files / 1,426 tests passed, TypeScript, targeted lint, production build and local browser passed. Isolated PGlite assignment/RLS suite passed; no concurrent session test. Fresh reviewer found no important findings. No production business data written during tests. Release remains migration-before-frontend.
