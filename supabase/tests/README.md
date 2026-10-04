# Supabase SQL checks

Run these checks only against the local Supabase database. Each SQL test starts
a transaction and rolls it back, including fixtures and test helper functions.

```sh
supabase start
supabase db reset
psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
  -v ON_ERROR_STOP=1 -f supabase/tests/clinic_compound_issue.sql
psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
  -v ON_ERROR_STOP=1 -f supabase/tests/clinic_invoice_post.sql
psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
  -v ON_ERROR_STOP=1 -f supabase/tests/official_compound_catalog.sql
psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
  -v ON_ERROR_STOP=1 -f supabase/tests/atomic_initial_clinic_record.sql
psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
  -v ON_ERROR_STOP=1 -f supabase/tests/atomic_inpatient_daily_log.sql
psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
  -v ON_ERROR_STOP=1 -f supabase/tests/clinic_billing_lifecycle.sql
psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
  -v ON_ERROR_STOP=1 -f supabase/tests/clinic_inpatient_discharge.sql
```

The SQL tests cover failure rollback and serial last-unit protection. A true
concurrent two-session race still needs local PostgreSQL verification. Prepare
one branch with a VET warehouse, two visits and active clinic shifts, plus one
medicine stock unit and one positive-cost layer. Call `clinic_post_invoice`
from two authenticated sessions with different visit IDs/request keys and
one line for that same item before either transaction finishes. Exactly one
call should return an invoice ID; the other should report `STOCK_SHORT`, with
one invoice, one HPP/revenue journal pair, stock at zero, and one stock move.
Run the parallel recipe-issue race from the compound test notes as well. Do
not run either exercise against production.

In the current review environment, the SQL test files were also applied to
PGlite/PostgreSQL 18.3 with a curated set of repository migrations and a small
test-only schema bootstrap for columns absent from that subset. Both clinic
posting SQL suites passed there. This verifies PostgreSQL syntax and the tested
transaction cases, but it is not a complete `supabase db reset` and does not
verify concurrent sessions. The repository's Supabase CLI, Docker, and local
PostgreSQL server were unavailable in that environment.

The official catalog test checks OWNER-only publishing, blocked self promotion,
immutable revisions and issued snapshots, dosage and ingredient validation,
doctor access to the active version, idempotent issuance, and blocked inactive
or stale versions. Its migration and test also ran in isolated PGlite with a
minimal test-only clinic-issue stub; full clinic stock/RLS integration requires
the local Supabase command above after PR #6 is ready.

The atomic initial-record test covers rollback when a second official formula
fails after the first issued stock, successful record/follow-up/prescription
and formula posting, idempotent retry, changed-payload rejection, and the
posted-record edit guard. A focused PGlite test with isolated stubs validated
the new migration's SQL syntax and rollback/retry/guard; the complete test
above still needs full local Supabase with the real stock and catalog functions.

For the outstanding true two-session catalog retry check, create a fresh
formula/version, funded VET stock and medical record in the local Supabase
database. In session A, `begin`, set the authenticated JWT role/user, call
`clinic_issue_official_compound` with request key `catalog-race`, then keep
the transaction open. In session B, `begin`, set the same JWT role/user and
call the same RPC with identical arguments; it should block on the unique
request key. Commit A, then check that B returns the *same* recipe ID and
commit B. There must be one recipe, one `compound_official_usage`, and one
set of ingredient stock issues. Repeat B with a changed dosage instruction;
it must return `RECIPE_INVALID` because dosage must match the active formula.
Reuse the same request key with a different visit or active formula version to
verify `IDEMPOTENCY_CONFLICT`. Never run either race against production.

## Release-gate verification (2026-09-29)

All five SQL suites passed on isolated PostgreSQL 16.14 with all 166 project
migrations applied and test-only Supabase auth/storage shims plus public-table
grants. Migration 0068 required its two pre-existing COA accounts to be loaded
before it ran, so this is not a clean `supabase db reset` verification.

Two-session races also passed locally: competing clinic invoices and custom
compound issues each left one successful stock deduction and one `STOCK_SHORT`
rejection. The official-catalog retry race returned the same recipe ID twice
and created one recipe, one official-use record, and one stock issue. These
checks used the isolated test database only; they do not verify production
schema drift, backup recovery, or a full Supabase local stack.

The billing lifecycle migration and its two new SQL suites passed on the same
isolated PostgreSQL 16.14 database. Coverage includes unpaid/DP medicine edits,
price-only HPP preservation, removed medicine stock restoration, two partial AR
receipts followed by one balanced void, fully paid void/reissue without a second
stock issue, request retries, overpayment and cross-branch rejection, ledger
failure rollback, a discharge fee rounded up from 49 hours, and full daily-log
rollback when fee insertion fails. A separate two-session AR race allowed one
Rp150 payment against a Rp200 invoice and rejected the competing Rp150 payment;
one receipt and one journal remained. The isolated database is not production
or a complete Supabase stack.

## Atomic sales posting (2026-10-04)

Run the sales transaction suite against local Supabase with:

```sh
psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
  -v ON_ERROR_STOP=1 -f supabase/tests/sales_safe_posting.sql
```

A self-contained Docker runner creates and removes its own fictional PostgreSQL
16 database, applies every repository migration, runs that suite under the
`authenticated` role and RLS, and checks genuine independent-session races:

```sh
python scripts/test-sales-posting-postgres.py
```

The runner uses explicit auth/storage shims and public-table grants, and seeds
COA 1101/1102 before migration 0068 as required by the existing migration chain.
It is not a complete Supabase local stack or a production verification. It does
not accept a database URL. Coverage includes box and pcs of the same SKU,
partial shipments/invoices and HPP, PKP, service/free-text rows, request identity,
quantity and branch/role validation, forced journal and quotation-line failures,
missing warehouse/stock/layers/positive cost/account, closed periods, and atomic
quotation conversion. Two-session checks cover competing last-unit shipments,
competing invoice remainder, and identical invoice retries. Each race verifies
that the second independent session actually waits on a posting lock.

New sales invoices keep immutable invoice-line → delivery-line quantity and HPP
allocations. Backdated later shipments cannot reorder HPP already billed. Legacy
partially billed rows whose invoice quantities/HPP lack complete allocation links
are blocked with a finance reconciliation message; this change does not backfill
history or provide a reconciliation workflow. The suite proves that rejection,
backdated mixed-cost shipments, immutable allocation rows, exact total HPP, retry
identity, and rollback when allocation insertion fails.
