# J04 Source Recurring Journal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a finite monthly schedule from an existing general journal and execute each due occurrence exactly once.
**Architecture:** Keep legacy auto templates; private immutable source/occurrence proofs plus one public source marker. Finance-scoped definer RPCs reuse the internal atomic journal writer; new source schedules run manually.
**Tech Stack:** Existing Next15.5/React19/TypeScript/Decimal, PostgreSQL17.6/Vitest and cached isolated Docker harness.
**Spec:** docs/superpowers/specs/2026-10-23-j04-recurring-source-design.md

## Global Constraints

- No source/historical journal rewrite, source normalization, external bank payment, data reset or old RLS/role/settings/credential change.
- Keep copied source lines/description OUT of globally readable legacy recurring rows; use new finance/branch-scoped proof storage.
- One source → one immutable plan, finite count/end, first month after source; fresh confirmation and explicit backdate choice.
- New source execution manual; setup zero ledger writes; legacy automatic behavior preserved.
- Native executor, focused iteration, one stable full check and final review; main release serialized with other lane.

## Review Focus

- Caller changes preview/config/key or submits twice/different keys/actors: no duplicate or silently changed source schedule.
- Source/COA/branch/role/period changes during creation/execution: reject stale/unauthorized writes atomically.
- Direct API writes must not unlink source marker/proof, forge progress or insert/update/delete protected occurrence journals.
- Source data must not leak into globally readable legacy template fields; new proof readers keep finance/module/branch scope.
- Future/closed/skipped/out-of-range months and malformed receipts must not become executed/success; exact historical replay remains safe.

### Task1 — transactional source lifecycle

**Files:** new CLI-named migration; supabase/tests/recurring_source_journals.sql; scripts/test-recurring-source-postgres.py.
**Consumes:** existing profiles/role_modules/branch helpers, journal_entries/lines, recurring_journals and private clinic_write_journal.
**Produces:** four public RPC signatures in spec, private canonical snapshot helper, source-marker column, two immutable proof tables and narrow integrity guards. Snapshot fields: id/no_jurnal/tanggal/branch_id/revision/source/deskripsi plus ordered line id/account_id/code/debit/credit. Config: name/first_period/day/count/last_period.

- [x] Write fictional SQL fixtures + acceptance using real manual source journal: preview/create,12 months and receipt replay, setup zero journals, changed requests/source/roles/branch/period denial, direct tampering, audit/journal failures and chronological count/end. Run against main; observe missing source RPC RED.
- [x] Create guarded migration preserving old source grants/policies; implement snapshot/access, atomic create/recover, manual execute and immutable proof/direct-write guards. Reject old RPC source mode after existing authorization; do not alter legacy posting semantics.
- [x] Run new acceptance GREEN and existing atomic_recurring_journals.sql/recurring_occurrence_limit.sql, isolated independent databases as needed. Add deterministic two-session same-period run: one journal/proof and stable retry receipt.
- [ ] Commit task1 after focused verification; record exact baseline failures/rulings without permission weakening.

### Task2 — source flow, calendar and exact links

**Files:** src/lib/recurring-source.ts + tests; source setup/detail routes/components under keuangan/jurnal-berulang; source-actions.ts; jurnal/page.tsx; jurnal-berulang/page.tsx; lib/recurring.ts and affected real page/action/draft tests.
**Consumes:** Task1 snapshot/config/receipt RPC contracts. Source marker is_source_schedule skips legacy catch-up. Only metadata/empty lines live in the legacy row; source details come from authorized proof reads.
**Produces:** journal source action, confirmed/durable source form, exact ?entry=uuid links, private source detail with paginated virtual periods/proof-backed history and one due-period Run.

- [x] Write RED pure calendar/count/end/WIB tests, real journal/source-page/action/draft tests and legacy catch-up source-skip regression. Reject false-empty reads and stale/fake response success.
- [x] Implement bounded monthly helper/window and finance-scoped source UI/actions with fresh ignored-draft confirmation, immutable preview, request recovery and receipt ack. Preserve old manual template form; handle toggle error honestly.
- [x] Run focused GREEN including legacy recurring/action/page/closing regressions. Browser visual keyboard/mobile review is not run in this environment; no external transaction submission.
- [x] At stable candidate run one full app suite/typecheck/lint/build; retain SQL/basic evidence and source checksum. Scoped final independent review/release checks remain pending.
- [ ] Normal push one PR, exact-head CI. Only reviewed necessary migration with parity/backup/catalog gates, normal main merge and exact Production proof under existing user approval; no blanket replay/live financial transaction UAT.

Autonomous implementation/method/main-first approval was explicitly supplied in trusted parent/user history. Source/date/count choices remain explicit in UI. Private ledger is /workspace/kamo-j04-private-20261023/progress.md; no repeated approval menu is inferred.
