# PR82 — ready source after PR81 release

## Release update, 24 October 2026

The user authorized release to main. The reviewed guard SQL (SHA-256 `2af2ac5d684384ff0378f86be3ca7db74a52ee8a7963813231f06219f555fabf`) was applied exactly once through the Supabase Management migration API to project `koaglxcyjqfmgfzxszkj`. Supabase recorded version `20261024110335`, so the repository migration file is now `20261024110335_average_activation_accounting_guard.sql`. No average activation was invoked. Immediate read-only checks found the guard in the activation function, its previous execute ACL unchanged, method still FIFO, and unchanged counts for stock (375), stock layers (390), journal entries (43), and cost events (0). The prechange function definition and state were saved outside the repository for fallback review.

On current main plus PR82, 3,338 application tests and the production build passed. An isolated 250-migration installation test confirmed the guard can be installed over unreconciled stock without changing mode or financial data. The broader accounting SQL runner passed the guard and average cases, then failed on `posted_sale_cancellations.sql` with `Sumber opname berubah atau tidak ditemukan`; the same fixture and error were reproduced on current main without PR82. This failure is not counted as a passing full SQL suite. Application merge and hosted verification remain pending at this point in the release.

Fresh main inspected: `6289994422ce32e795f6f27baba04b5db477210d` (PR81 merged). PR82 was rebased only after that main change became observable. The runner add/add conflict was resolved using the previously tested combined runner, retaining its helper loading and exact activation-source contract. Its rollout baseline now points to the actual released main6289994. There is no duplicate average implementation. The production guard SQL is byte-for-byte unchanged from the reviewed PR82 version.

## Global activation, branch reconciliation

The existing `inventory_costing_settings` table is a single boolean-keyed row, and `activate_moving_average()` has no branch argument. Its all-branch OWNER/FINANCE check and loop cover all inventory warehouses/items. PR82 compares physical carrying value with GL1301 separately per branch, but the method switch is **global**. One unreconciled branch blocks adoption for everyone. Selecting a branch in the operational header does not provide partial activation.

New fictional cases verify that a correctly reconciled branch A cannot activate while branch B still lacks its inventory GL, and that a branch-filtered request is rejected by the all-branch authorization requirement. Denial does not create cost seeds, change physical stock/lots/history/GL or change FIFO mode. Existing zero/unpriced positive layers and negative opening pools also require reconciliation before adoption. Actual production balances were not re-audited in this continuation.

## Guard release is independent of PDRY repair

**Yes: the guard can technically be released before PDRY is reconciled.** The migration only creates the private precondition and patches the existing activation function definition. Installation does not call activation or inspect/repair business balances, choose an accounting date/counterpart, post a journal, revalue stock or change the costing setting.

`python3 scripts/test-average-activation-install-postgres.py` applies the222-migration current-main schema to an owned network-none PostgreSQL16 fixture, adds fictional stock160 with GL0, installs the exact guard SQL, and confirms mode/data/history/GL are unchanged. A subsequent fictional activation attempt is rejected. This models installing the guard after the already-released `20261021183000_correction_master_reference_guards.sql`, despite the guard's earlier migration timestamp.

PDRY reconciliation is therefore an **activation prerequisite**, not a prerequisite for installing the protection. If the reported PDRY quantity/HPP/GL discrepancies remain, global activation must remain blocked until the separate historical reconciliation is reviewed. No historical journal backfill, guessed counterpart/date, reset or real transaction is part of PR82.

## Fresh verification after rebase

- Full Vitest: **308 files /2403 tests passed**, no failures.
- Native223-migration guard matrix, global-scope cases, existing average/correction/clinic/import/FIFO regressions and five real activation/GL/actor/receipt race scenarios passed.
- The actual current-main222-migration baseline followed by **only** the guard migration passed the complete remaining-production-order matrix, all four average suites, official returns/date-window suites, master-reference and exact function-source contracts, and six real correction-lock scenarios.
- Guard installation over an unreconciled opening fixture passed without mode/data changes.
- TypeScript, changed-source ESLint with zero warnings, Python syntax and whitespace passed. Production build passed with fictional loopback Supabase, excluding Supabase/DATABASE_URL/PGPASSWORD variables from the child. Existing unrelated warnings remain. No authenticated backend/business acceptance or production database read/write is claimed.

Evidence: `docs/evidence/2026-10-21-average-activation-guard/main-6289994/`. Guard SHA256: `2af2ac5d684384ff0378f86be3ca7db74a52ee8a7963813231f06219f555fabf`.

## Authorization and exact remaining release actions

The earlier voice request to finish and push authorized the code/integration/review/push work but left a draft-only production release hold. The user separately authorized release to main on 24 October 2026. That authorization covers the guard release while average activation and historical data repair remain separate work.

After that distinct release authorization:

1. Recheck exact PR82/main SHAs and current live function/schema/ACL/migration parity. Preserve the prechange activation definition for the reviewed fallback. Verify the guard migration has not already been installed.
2. Apply only the reviewed guard SQL in a bounded atomic transaction and record that exact source once. Do not replay all repository migrations or invoke `activate_moving_average()` as a smoke test. Completed as migration `20261024110335_average_activation_accounting_guard.sql`.
3. Perform the ordinary exact-head merge and existing application deployment for PR82's matching explanatory UI, with no protection/permission bypass.
4. Verify function source/ACL and application version read-only, and confirm the costing setting and business-record counts did not change. Leave PDRY repair and global average activation for their own authorized, audited steps.

PDRY reconciliation remains a prerequisite for global average activation. The guard migration is installed; PR82 application merge and hosted verification are the remaining release steps. No activation, historical edit, reset, or secret/access change was performed by this release update.
