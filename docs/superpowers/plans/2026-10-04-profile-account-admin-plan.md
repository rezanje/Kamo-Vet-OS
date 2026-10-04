# Profile account administration implementation

1. Reproduce disabled self-reactivation on existing migrations with a SQL test
   that expects denial and fails because the UPDATE succeeds.
2. Add the minimal guarded trigger, preserving the existing self-role trigger.
3. Run rollback SQL cases and two-session permission-revocation checks on local
   PostgreSQL 16. Inspect role detection and denial without changed profiles.
4. Run the repository suite, type/lint checks and diff validation. Commit only
   this isolated branch; hand off to parent for independent review and local
   PostgREST integration before any release.

Executed on 2026-10-04: baseline PostgreSQL test failed because disabled FINANCE
self-reactivation succeeded. With the migration, rollback SQL cases and all three
two-session authorization/revocation checks passed on PostgreSQL 16. The full
repository suite passed (131 files / 1203 tests), TypeScript passed, and lint had
zero errors with 12 existing unrelated image/upload warnings. These checks cover
the repository and local PostgreSQL; native API results are recorded below.

Compatibility follow-up: added the existing active DOCTOR self-role error
contract as a failing real SQL regression. Renamed the new trigger to execute
after the existing self-role guard. Active/disabled combined self-role edits
still reject with unchanged profiles and P0001/ACCESS_DENIED; activation-only
disabled edits reject with 42501.

Independent review of final trigger-order commit `dff72eb` found no
Critical/Important blocker and reran all PostgreSQL groups successfully. After
the parent coordinated the shared fictional DDL rename, the durable native
GoTrue/PostgREST harness passed disabled-account, personal/admin edits, claim
spoofing, trusted service and full fixture-cleanup checks. Evidence is in
`docs/evidence/2026-10-04-profile-account-security-verification.md`. Production
schema release remains with the parent; no production change was made.
