# Monetary opening corrections

Authorized scope: OWNER corrects existing cash/bank opening records, with reviewed impact, immutable audit and balanced journals. No inventory, transfer, production database, deployment or merge work. Base main d6d9c70; PR62 opening lifecycle inspected, retained as reference rather than importing its generalized replacement/void flow.

Design: resolve exactly one proven opening from `cash-account-opening` or the selected cash line of `saldo-awal`; absent opening means zero at the account creation date. Preserve the root journal and every unrelated line. Each correction reverses the previous monetary amount against owner equity and posts the replacement amount on the same opening date. Revision, source evidence and current ledger snapshot are checked again against the server preview. Reconciled/closed/ambiguous/inaccessible states fail closed. A zero replacement remains correctable.

Tasks:
1. Add failing action/UI and native SQL tests for preview, correction, repeated/zero edits, journal/running totals, immutable originals and noncash preservation, access/dependency checks, rollback and retries.
2. Implement scoped private context/validation, preview/correction/recovery RPCs, immutable audit/request tables, protected opening journals. Serialize with the existing reconciliation ledger lock; use current database role/branch checks.
3. Route existing opening creation through atomic posting functions without broadening its roles. Remove the destructive general opening replacement/delete path. Preserve existing stock calculations and account master/transfer logic.
4. Add OWNER-only account correction page with durable draft, preview invalidation and audit history; link from account ledger. No shared helper modifications planned.
5. Run full application suite, native PostgreSQL lifecycle/race/regression suites, types, scoped lint/build. Document actual limitations. Commit, push a new branch and create reviewable PR; inspect preview if generated.

Review focus: mixed general openings must preserve noncash effects; missing/duplicate/malformed source must not be guessed; zero can be corrected repeatedly; same-key retries after uncertain response must not duplicate; reconciliation/ledger/permission changes while waiting must be rechecked.
