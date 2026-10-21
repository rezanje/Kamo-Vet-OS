# Atomic bank reconciliation and corrections

Implemented locally; independent specification and quality review approved. Quality review independently reran the full native bank suite and ten targeted action/acknowledgement tests. No production migration, transaction or browser acceptance is evidenced here.

## Contract

An active financial account with Kas & Bank access and permission over all branches can save a reconciliation. Full scope is necessary because the selected account's balance contains both global and branch journals; partial branch visibility cannot produce an authoritative bank balance. OWNER may correct/cancel with reason and expected revision. The original record/journals remain, with exact signed reversals and revision audit. Reconciliation is a balance snapshot, not an arbitrary adjustment of the unexplained difference.

The posting key survives expired display drafts. Identical replay returns the first result, changed payload rejects, and current actor/module/account scope is checked again after waits. Creation, charges/interest journals and the record commit atomically. The book balance includes only journals dated on/before the selected date. The ledger is locked in the shared order `journal_entries`, then `journal_lines`, in SHARE ROW EXCLUSIVE mode while taking the snapshot and posting. A lock timeout retains the form for review/retry.

Corrections reverse the source journal first, then calculate the replacement snapshot. Zero charges create no empty journal. Later active reconciliations for the source/target bank block out-of-order correction. Original/replacement dates must be due and open. Account, active branch, detail COA, exact cents, finite values and separate bank-account COA are validated. Original fee/interest lines are verified against the linked document. New raw table writes and raw reconciliation journal/line writes are denied. Legacy records without certain account/journal provenance remain visible, but unsafe correction fails with a matching-data message.

The list is paginated and links to record detail, correction/cancel forms and reason history. The estimated preview is labelled; the dated authoritative balance is calculated on save. A read-only outcome action recovers pending create/edit/void results without reposting. Destination acknowledgement clears only the exact user's durable key even when the originating form is no longer mounted; unrelated/new keys remain.

## Verification

`python3 scripts/test-bank-reconciliation-postgres.py` applies every production migration in an owned localhost database and runs the actual lifecycle SQL. It covers as-of-date balances/future exclusion, cents, create/edit/void/retry/read-only recovery, changed-payload rejection, legacy visibility, unsupported legacy links, forced final-write rollback, retained original journals, stale revision, closed/future periods, direct DML denial, branch context before replay, Finance creation vs OWNER correction, module/all-branch capability removal and inactive accounts.

Actual separate PostgreSQL sessions prove duplicate create and recovery wait for the original commit, duplicate cancellation records once, a concurrent ledger writer finishes before the snapshot, and module access revoked during ledger or branch-row waits blocks the write. Both newer-reconciliation dependency checks occur after the ledger lock; a concurrent newer create prevents reversal of an older snapshot. Non-finite new/source dates and branch deactivation during the ledger wait are rejected. Temporary databases are removed. Reset registry adds the two operational audit/request tables; the reset suite passed 135 cleared / 65 preserved after the addition.

Focused application tests cover atomic-action arguments/failure destinations, exact durable acknowledgements without the original form, controlled form preservation, expired posting keys, existing opening-balance hidden-form recovery and normal transaction drafts. Scoped lint and TypeScript passed; final combined release checks remain required.

## Exact review surface

- `supabase/migrations/20261020193103_atomic_bank_reconciliation.sql`
- `supabase/tests/bank_reconciliation_lifecycle.sql`
- `scripts/test-bank-reconciliation-postgres.py`
- `supabase/migrations/20261020175023_recoverable_operational_reset.sql` (two operational registry entries only)
- `src/app/(app)/keuangan/rekonsiliasi/actions.ts`
- `src/app/(app)/keuangan/rekonsiliasi/page.tsx`
- `src/app/(app)/keuangan/rekonsiliasi/[id]/page.tsx`
- `src/app/(app)/keuangan/rekonsiliasi/RekonForm.tsx`
- `src/app/(app)/keuangan/rekonsiliasi/BankReconciliationRecovery.tsx`
- `src/components/LocalTransactionDraft.tsx` (exact durable acknowledgement only)
- `src/components/__tests__/durable-draft-completion.test.tsx`
- `src/lib/__tests__/bank-reconciliation-actions.test.ts`
- `scripts/test-operational-reset-postgres.py` (database-local barrier filter only)
- `scripts/test-posted-sales-postgres.py` (database-local barrier filter only)
- `docs/superpowers/verification/2026-10-21-bank-reconciliation.md`

## Remaining boundaries

No guessed attribution of historical journals. No statement-file import, automatic allocation of unexplained differences, external bank integration, or production claim. The production reset remains pending its own production backup and isolated restore.
