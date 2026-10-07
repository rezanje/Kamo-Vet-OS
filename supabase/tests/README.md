# Supabase SQL checks

## Atomic monthly recurring journals

```sh
python3 scripts/test-recurring-db.py
psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
  -v ON_ERROR_STOP=1 -f supabase/tests/atomic_recurring_journals.sql
```

The Python command creates and removes a network-isolated PostgreSQL 16 container
with fictional data, auth shims and the actual core/RLS/accounting/recurring
migrations. It also runs two independent sessions against the same schedule and
month: one posts, the other returns the same journal, leaving one balanced pair
of lines. This curated accounting stack is not a complete Supabase reset or proof
of production schema parity. The SQL command requires a local Supabase database
with `20261004110000_atomic_recurring_journals.sql` applied.

Coverage includes header/line/progress atomicity; rollback on line and progress
trigger failure; WIB dates; consecutive catch-up and first-run rules; closed
period and inactive-account rejection; disabled schedules; branch access;
full-UUID identities and legacy reference reuse; and incomplete, missing or
ambiguous historical markers. No legacy journal is rewritten automatically.
The curated harness also applies the existing user-management and module-access
migrations. Disabled OWNER accounts cannot post, recover progress or retrieve
historical RPC results. Existing Buku Besar defaults/overrides are enforced,
service-role cron remains allowed, and real waiting sessions reject profile or
module revocations committed before the schedule lock is acquired. Historical
NaN/infinite amounts are rejected instead of advancing progress.
Apply the migration before the updated app. Deploy both together; do not continue
using an old application version that posts recurring headers and lines itself.
An identified historical mismatch requires reviewed accounting correction before
that schedule can continue; this test harness performs no production correction.

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


Sales account/module gates match the application's existing access-group rules:
accounts must be active; OWNER overrides module rows; ADMIN without custom rows
has full default access; FINANCE/STAFF require explicit `penjualan` permission.
Disabled accounts cannot post or recover previously committed operations.
Read access remains active-account and branch scoped, independent of sales
module permission, so existing finance receivables, tax, and ledger consumers
continue to see sales documents. The SQL suite checks default FINANCE invoice
counts/totals, denied posting, and disabled-account invisibility.

Sales form identities now persist in tab-local session storage across errors,
refreshes, and exhausted forms. Only a confirmed success retires that identity.
When storage is unavailable the form has no usable key and posting fails closed.
The recovery action calls the read-only `sales_get_posting_result`, which checks
the actor, module, current order branch, and recorded posting branch. It locks
the order before the key, matching the posting lock order. Component tests render
the actual order page and cover a committed-response-loss/remount/recovery flow,
independent invoice keys, exhausted forms, and confirmation-only rotation.


Actual local GoTrue/PostgREST/Chromium coverage is available with:

```sh
node scripts/test-sales-local-browser.mjs
```

This harness refuses any API except `http://127.0.0.1:55421`, requires the local
fake-auth manifest and database `supabase_db_vetos_hris_acceptance`, and uses app
port 3111. Run it after the exact committed migration chain is applied. It seeds
its own fictional user/branch/order and 2035-dated inventory/documents. It rejects
a disabled OWNER's valid JWT, commits each actual shipment/invoice form while
aborting its server-action response, reloads, checks the persisted original key,
and recovers read-only. It verifies one shipment, one invoice, one allocation,
two journals and stock38, then stores screenshots and fixture IDs under `/tmp`.
It starts/stops its own local Next process when necessary and leaves fictional
financial audit fixtures in the shared test database for inspection.

Verify the same fictional invoice with a default FINANCE account and the actual
receivables page by passing the fixture path printed by the browser harness:

```sh
node scripts/test-sales-finance-read-local.mjs /tmp/vetos-sales-browser-<token>/fixture.json
```

This local-only follow-up checks the real API invoice amount, denied sales
posting without module permission, `/keuangan/piutang`, and an existing JWT
after disabling its own fictional FINANCE profile. It saves `finance-ar.png`
beside the fixture and uses the same local app port and API restrictions.
## Purchase receipt and retry verification (2026-10-04)

```sh
python3 scripts/test-purchase-recovery-db.py
```

This runner creates and removes a fictional PostgreSQL 16 container with no
network. It uses the actual purchase/stock/accounting migrations, test-only auth
functions and grants, and two schema columns from migrations outside its curated
subset. It is not a clean Supabase `db reset` or production schema verification.
The SQL suite can also run against a reset local Supabase with:

```sh
psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
  -v ON_ERROR_STOP=1 -f supabase/tests/purchase_recovery.sql
```

Coverage includes staged box-to-base receipts, multiple expiry batches, damaged
claims, omitted and foreign rows, duplicate rows, over-receipts, changed unit
conversions, closed periods, distinct receipt journal identities, partial invoice
FIFO splits, forced stock/journal failures and complete rollback, identical and
conflicting retries, nonfinite amounts, current role/module/branch rejection, and
disabled users in every supported role, assets moved outside the current branch scope, and private ledger/helper permissions. The runner additionally uses independent
connections for identical receipt/invoice/bank-asset retries, competing remaining
receipt/invoice allocations, and recovery blocked behind newly revoked role or
branch access. No historical receipts are repaired or repriced by this migration.

`src/lib/__tests__/purchase-actions.test.ts` executes the actual server actions
with infrastructure boundaries mocked; `purchase-request.test.ts` verifies tab
key reuse and retirement. Browser interaction and the complete Next-action/PostgREST/database round trip
are verified by the local browser suite below. Browser storage retains request
identities only; when browser storage is unavailable, retries remain stable only
while the same form stays mounted. Existing rules still require a PO to be fully
received before any PO invoice can be created.

### Real local purchase browser acceptance

```sh
node scripts/test-purchase-local-browser.mjs
```

Requires the fictional real GoTrue/PostgREST local stack on `127.0.0.1:55421`,
its generated auth manifest at `/workspace/hris-local-runtime/local-auth.json`,
PostgreSQL container `supabase_db_vetos_hris_acceptance`, the existing fictional
OWNER login, Playwright and Chromium. The script refuses a different API URL,
starts its own Next.js app on loopback port 3112, uses a fresh isolated purchase
branch/SKU/PO/bank per run, and closes its browser and app afterward. It creates
only fictional local data, dated 2035-01-03 so asset-page catch-up cannot add
historical depreciation to the finalized October 2026 HRIS period.

The suite passed against the actual source-migration local database with real
SSR auth cookies, GoTrue and PostgREST. It submits two staged receipt forms,
checks 40 base units and two balanced GRNI journals, deliberately fetches the
second server-action response until its transaction commits and then aborts the
browser response, refreshes, and recovers the same receipt IDs through the
read-only recovery form without another stock move or journal. A real partial
invoice form reprices 10 base units and balances GRNI/AP. A real bank-funded
asset form posts one asset and a balanced journal to its selected mapped bank,
and retires its key while the same page stays mounted.

The script compares October payroll slips, finalized runs, audit events and
payroll journal headers/lines before and after; their hash remains unchanged.
Normal fictional configuration inserts naturally advance the global HRIS source
revision. Results and screenshots go to `/workspace/purchase-browser-runtime`.
This verifies the named local flows, not production schema drift, remote recovery,
or browser key persistence when session storage is unavailable.

## Atomic purchase invoice and payment-order settlement

```sh
python3 scripts/test-purchase-payment-postgres.py
```

This runner creates and removes an isolated PostgreSQL 16 Docker container,
applies the repository migrations with fictional auth/storage shims, and uses
fictional PO/invoice/advance/approval fixtures. It verifies exact-payload payment
recovery, the return-adjusted debt ceiling, direct-write blocking, integer rupiah
and fractional advance guards, payment/journal/advance/approval rollback, and
aggregate payment-order settlement. Two independent sessions test both lock
orders: payment before return and return before payment. No production or
connected database URL is accepted.
