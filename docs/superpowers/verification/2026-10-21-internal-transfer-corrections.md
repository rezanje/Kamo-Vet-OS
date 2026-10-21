# Internal transfer correction verification

Scope: accounting records in KAMO, with no bank API/payment execution. Base is
`d6d9c70d24fed05ff16a2dfd32f55cbeaa48fb3f` (PR67). Worktree branch:
`codex/internal-transfer-corrections`.

## Behavior and integration

Only active OWNER (the application's Super Admin role) can correct or cancel.
Existing OWNER/ADMIN/FINANCE creation remains subject to module/branch access.
An edit reverses the exact verified journal, marks the original transfer cancelled
without changing its amount/accounts/date/branch/author, and inserts a separately
numbered transfer linked through `replacement_of`. Cancellation only reverses.
The immutable revision contains the original document/journal/line snapshot,
reason, actor, and original/reversal/replacement links. Corrections retain the
original date/branch; bank fees remain expenses, never revenue.

All financial writes, reversal, replacement, audit and durable request commit in
one PostgreSQL transaction. A profile share lock orders account deactivation with
posting/recovery. An actor/key advisory lock serializes exact-payload retries;
source-row locking plus revision rejects competing corrections. Account/COA and
period share locks protect master/closed-period validation. The existing bank
reconciliation ledger snapshot lock is reused before journal/number writes, so
reconciliation first blocks correction and correction first appears in the next
snapshot. The lock timeout has a user-facing retry/recovery explanation.

Active reconciliation covering either old or new bank account/date blocks
creation/correction/cancellation, including historical unmapped statements
(fail closed until manually reconciled). Legacy transfers are accepted only with
one exactly matching journal; malformed, nonfinite or remapped source postings
are rejected rather than repaired. No historical backfill runs. Existing
`cash_transfers` has no other downstream document FK on this main; replacement
and audit links are guarded here. Later ordinary account activity is permitted,
consistent with the existing decision to allow negative account balances.

The form preserves input and request identity on uncertain saves. Read-only
recovery remains available after a source becomes cancelled or leaves the list.
Permission, source-state and reconciliation failures explain the next step.
Corrections open in a full-width responsive panel instead of a narrow table cell.
The existing checked pagination helper makes older transfers reachable beyond
the initial 50 rows; a selected historical ID is also fetched explicitly under RLS.

## Coordination and release constraints

Migration: `20261021073019_internal_transfer_corrections.sql` only. No changes to
stock, opening balances, payroll, assets, wholesale, generic ledger or numbering
helpers. The only adjacent account-page edit labels `transfer-reversal`.

PR62 was inspected at `108a719`. Its unmerged transfer proposal overlaps these
three transfer action/page/form paths and the names `cash_transfer_revisions`,
`cash_transfer_requests`, and `mutate_cash_transfer`. This implementation
supersedes that proposal: **do not apply both transfer schemas or cherry-pick
PR62's transfer migration after this one.** PR62's original proposal updates the
same financial document and permits non-OWNER voids; those behaviors are not used.
PR63/66/67 provide the existing correction/recovery conventions on main.
Parallel stock/opname and monetary opening-balance work need no shared source
files here. Check newly added migrations/preview integration before combining.

Deploying this migration requires its matching application version: direct old
transfer/journal writes are deliberately denied. No database production migration,
reset, real bank transaction, merge or production deployment was performed.

## Reproducible checks

- `python3 scripts/test-internal-transfer-corrections-postgres.py`: owned Docker
  PostgreSQL 16, `--network=none`, fictional data, actual full migration chain,
  auth/storage shims and pre-0068 COA fixture. The runner accepts no DB URL and
  deletes only its own uniquely named container. This is not a clean Supabase
  reset or production schema-parity proof.
- `npm test -- src/lib/__tests__/bank-transfer-actions.test.ts src/components/__tests__/bank-transfer-form.test.tsx src/components/__tests__/bank-transfer-page.test.tsx src/components/__tests__/bank-transfer-recovery.test.tsx`
- `npx tsc --noEmit`
- `npx eslint 'src/app/(app)/kas-bank/transfer' 'src/app/(app)/kas-bank/rekening/[id]/page.tsx' src/lib/__tests__/bank-transfer-actions.test.ts src/components/__tests__/bank-transfer-*.test.tsx`
- `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55421 NEXT_PUBLIC_SUPABASE_ANON_KEY=fictional-local-build-key npm run build`

The SQL suite covers amount/source/destination/fee replacement, cancel chains,
unchanged source history, exact balanced journals, both account balances,
no revenue posting, retries and conflicting payloads, closed periods, active
accounts, OWNER-only corrections, direct-write guards, legacy/mapping checks,
source/replacement bank dependencies, rollback after line/audit failures, disabled
actors and branch visibility. Independent waiting sessions verify duplicate keys,
competing corrections, both reconciliation orders, period close and revocation.

The initial full app test run had **2204 passing and 3 failing** (265 files).
The same three failures reproduced on an untouched detached worktree at the base:

- `merchant-fee-report-pages.test.tsx`: "shows merchandise, merchant fee and final
  bill separately on sale detail" and "does not invent a fee for historical
  sales"; test Supabase mock lacks `auth.getUser`.
- `remaining-transaction-forms.test.tsx`: "clears acknowledged controlled rows
  and keeps defaults on later remount"; fixture expects an absent `draft_key`.

These unrelated baseline failures were not changed. Final counts and fresh check
results are recorded in the PR.

## UI preview limitations

Local Chromium rendered the actual `TransferForm` with fictional data and mocked
server actions. Desktop/mobile screenshots are at
`/workspace/kamo-transfer-preview/{desktop,mobile}.png`; its
`verification.json` records responsive rendering, no mobile horizontal overflow,
and stable amount/request identity after an uncertain response and reload.
This is component/browser verification, not a full authenticated
Next/PostgREST/database end-to-end acceptance test. The screenshots use the
application CSS with a local preview wrapper; responsive form styles are in the
production component, not injected by the harness. A hosted PR preview uses existing
Vercel integration if available; no remote financial mutation is tested there.

## Final local results

- SQL transaction suite and all independent-session race checks: **PASS**.
- Transfer action/form/page/recovery tests: **18 PASS**.
- Full app suite: **2212 PASS, 3 FAIL** across 267 files; the three failures are
  exactly the baseline failures listed above.
- TypeScript and targeted ESLint: **PASS**.
- Next production build with fictional loopback Supabase configuration: **PASS**;
  existing unrelated lint warnings are retained.
