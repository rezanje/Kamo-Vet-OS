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
zero errors with 12 existing unrelated image/upload warnings. Independent review
and local PostgREST verification remain separate handoff checks.
