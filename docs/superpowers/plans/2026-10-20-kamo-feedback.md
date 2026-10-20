# KAMO Feedback Implementation Plan

> **For agentic workers:** Implement tasks with the existing application patterns. Independent catalog, password and manual-journal tasks run in parallel; the coordinating agent verifies and releases the combined change.

**Goal:** Resolve the October 20 customer complaints and release verified fixes without deleting business data or changing unrelated local work.

**Architecture:** Start from current origin/main in an isolated managed worktree. Reuse complete-list readers, transaction draft preservation, audited expense correction and existing branch authorization. Financial corrections preserve history and run atomically.

**Tech Stack:** Next.js 15.5.25, React 19, Supabase PostgreSQL/Auth, Vitest.

**Spec:** Five customer chat screenshots and the supplied employee account workbook reviewed in this conversation. The user authorized implementation, push and deployment; resetting data remains underspecified.

## Global Constraints

- Preserve Supabase branch RLS and active-account authorization.
- Do not deploy the unrelated dirty original checkout.
- Do not publish passwords or commit employee personal data.
- No transaction reset until its exact preserved/deleted data is agreed and a verified rollback exists.
- Do not claim all transaction menus support correction without evidence.
- Reuse existing draft and financial posting mechanisms; success requires a confirmed result.

## Review Focus

- Catalog beyond the API row limit, missing pages and unreadable item units.
- Searching by item code or name while preserving the selected item and draft.
- Financial corrections in closed periods, stale revisions, retries and unauthorized roles.
- Failed save responses retain inputs and cannot silently produce duplicate postings.
- Accounts missing a branch, ambiguous employee identity or uncertain permission mapping stay unprovisioned.

## Tasks

- [x] Complete catalog retrieval and accessible search in affected transaction pickers; test over 1,000 items, code/name lookup and draft restoration.
- [x] Provide authenticated password change using current-password verification and validation; test denial and success paths.
- [x] Add Super Admin manual-journal correction/cancellation with audit history and transactional database tests.
- [x] Close cash-entry and expense draft/status gaps using existing components; verify failed actions keep inputs and confirmed actions clear only matching drafts.
- [x] Audit other correction paths and prepare a private account reconciliation against live employee/branch/account records where credentials allow.
- [x] Run targeted tests, full tests, type check and production build. Review the final diff for financial, permission and data risks.
- [ ] Push the isolated branch, attach any created PR, deploy the verified commit to the existing KAMO project and inspect its live result.
- [ ] Record exact delivered scope, remaining account decisions and reset boundary.
