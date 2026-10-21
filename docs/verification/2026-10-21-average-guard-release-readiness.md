# PR82 — ready source after PR81 release

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

The voice request to finish and push authorizes the completed code/integration/review/push work. It does not remove the existing draft-only, no-production-migration/deploy/activation/data-repair restriction. No further confirmation was needed for the safe local work and branch push. **Separate authorization is needed for a production guard release**; it can explicitly keep average inactive and exclude PDRY repair.

After that distinct release authorization:

1. Recheck exact PR82/main SHAs and current live function/schema/ACL/migration parity. Preserve the prechange activation definition for the reviewed fallback. Verify the guard migration has not already been installed.
2. Apply only `20261021170000_average_activation_accounting_guard.sql` in a bounded atomic transaction and record that exact source once. Do not replay all repository migrations or invoke `activate_moving_average()` as a smoke test.
3. Perform the ordinary exact-head merge and existing application deployment for PR82's matching explanatory UI, with no protection/permission bypass.
4. Verify function source/ACL and application version read-only, and confirm the costing setting and business-record counts did not change. Leave PDRY repair and global average activation for their own authorized, audited steps.

No technical PDRY blocker remains for releasing the guard itself. The remaining release hold is the separate production authorization plus ordinary target/parity verification at release time. There is no code or push blocker. PR82 remains draft, unmerged, with no production migration, deployment command, activation, historical edit, reset or secret/access change performed by this task.
