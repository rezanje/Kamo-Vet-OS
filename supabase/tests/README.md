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
