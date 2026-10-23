# J04 — recurring journals from an existing journal

## Result

Candidate base: `02f52e7d5a4b8312d592dede5b662b4428610746` (`origin/main` at final pre-commit sync). Migration: `supabase/migrations/20261023073807_source_recurring_journals.sql`, SHA-256 `ae0ad2a27eaa9cc4f6723ce3af996641466e6cde0ef9193a63e0dfb51eb10667`.

J04 adds a monthly schedule flow sourced from an existing, balanced, active `manual` or `manual-correction` journal. The user confirms the source snapshot, first month, posting day, and finite count or inclusive end month. The source month is excluded. A source schedule is manual-only, creates no journal at setup, and posts only its oldest due period. Replaying the same period returns its exact receipt. Existing recurring templates keep their automatic catch-up behavior.

Source lines, description, branch, and schedule configuration stay in a finance/branch-scoped immutable table. The legacy globally readable template row contains only a generic marker, empty lines, and no copied description or amount. Read pages require complete and receipt-consistent queries before showing progress or enabling a post. An ambiguous create response is recovered using the same request key; an ambiguous period post retries the same idempotent RPC and confirms the existing receipt.

Scope is monthly source schedules from valid manual journals. Weekly or other recurrence families, automatic source posting, bank payments, changing posted history, amendments, and refunds remain out of scope.

## Verification

- `python3 scripts/test-recurring-source-postgres.py` — passed on disposable network-isolated PostgreSQL 17.6 after applying 237 repository migrations. `recurring_source_journals.sql`, `recurring_source_guards.sql`, `atomic_recurring_journals.sql`, and `recurring_occurrence_limit.sql` passed. The deterministic two-session same-period race returned one journal/receipt and one new-post result. The runner removed its owned container and volume.
- `npx vitest run` — 352 test files, 2,682 tests passed.
- `npx tsc --noEmit` — passed.
- `npm run lint` — passed with 12 existing warnings in unrelated clinic/image-upload files; no errors.
- `npm run build` — passed; Next generated all 194 static pages and the new finance routes. Existing warnings include Supabase JS's `process.version` Edge Runtime import through the existing middleware and the lint warnings above.
- Target project migration and finance transactions — not run in this candidate pass. The new migration is `20261023073807_source_recurring_journals.sql` and must be reviewed against current target migration history/catalog before release. Full hosted workflow/UAT remains deferred.
- Supabase advisors — not run; `supabase --version` returned `supabase: command not found`. No CLI installation or workaround was attempted.

## Release order and rollback bounds

The candidate application depends on the new migration. Apply only this reviewed migration after target-history/catalog parity, backup-age, and preview gates are confirmed; then deploy the matching application commit. No blanket migration replay is included.

The schema change is additive, but proof rows are immutable and there is deliberately no destructive down migration. If rollback is required before a source schedule has been created, the previous app can be restored while keeping the additive schema. Once a source schedule exists, retain all source/receipt rows and use a forward fix; the old catch-up path rejects source-marker rows, so an old app version may surface a recurring-posting error until the compatible app is restored. Do not delete or rewrite proof data as rollback.

The PostgreSQL fixtures use only fabricated accounts, journals, identities, and branches. No customer workbook, production journal, stock, or target database data was copied into the repository or modified.

## References

- [Supabase RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security) — distinguish anonymous Auth users from signed-in users and use `auth.uid()`-based identity checks.
- [Supabase database functions guide](https://supabase.com/docs/guides/database/functions) — pin `search_path`, verify authorization within exposed security-definer functions, and explicitly grant execution.
- [Next.js page convention](https://nextjs.org/docs/app/api-reference/file-conventions/page) — current page `params` and `searchParams` are awaited promises.
