# HPP reports: local auth, API, and browser acceptance

Completed on 2026-10-04 against product commit `c7c5f0d`; the acceptance command exited 0. This receipt covers the actual Next.js pages and download routes using real GoTrue sessions and PostgREST reads, with Chromium. It adds no production data or application changes.

The fixture is the existing fictional local HRIS acceptance stack: API `http://127.0.0.1:55421`, PostgreSQL container `supabase_db_vetos_hris_acceptance`, and an independent Next.js dev server on port 3109. The database is an adapted acceptance fixture, not a complete Supabase CLI reset. Auth credentials and keys remain in `/workspace/hris-local-runtime/local-auth.json`, outside Git. The script refuses any other API URL and the SQL requires the named fictional branches and 1,200 existing QA-PERF stock rows.

## Observed results

Both the existing active OWNER and a dedicated active FINANCE account passed these checks:

| Check | Expected and observed |
| --- | --- |
| Inventory HTML page | 100 rows |
| Inventory full CSV | 1,200 rows |
| Inventory FIFO total | Rp1,320,000: 1,200 items × 10 units × layer cost Rp110 |
| Inventory average cost | Rp110 for all 1,200 items; master purchase price is Rp100 |
| Compound HTML page | 100 rows |
| Compound full CSV | 1,200 billed lines; the additional voided-invoice line is excluded |
| Compound net billed revenue | Rp216,000: 1,200 × 2 units × Rp100 × 90% |
| Compound historical HPP | Rp60,000: 1,200 × stored **total line** HPP Rp50, counted once |
| Compound gross profit | Rp156,000 |
| Compound margin | 72.22% displayed; derived from the verified revenue and profit |
| Doctor A filter | 600 CSV rows |
| Exact fixture-name search | 1 CSV row |
| Historical active formula | 600 rows keep revision 1 although the current revision is 2 |
| Inactive formula | 600 sales retain their exact usage/version IDs; FINANCE has blank optional revision metadata under existing RLS, OWNER sees revision 1 |
| Report navigation | Both report links visible to OWNER and FINANCE |

The real PostgREST endpoint caps an unrestricted result at 1,000 rows. The reports returned the complete 1,200 rows through multiple 500-row requests. CSV responses asserted `private, no-store` caching. Filters used QA-PERF branch, its warehouse, and the invoice date 2010-01-15 in WIB.

| Negative access check | Actual HTTP result |
| --- | --- |
| Dedicated disabled FINANCE | Both direct exports return 403 JSON |
| Dedicated disabled OWNER | Both direct exports return 403 JSON; the existing OWNER was never disabled |
| Active ADMIN | Both direct exports return 403 JSON; protected report links absent |
| Active DOCTOR | Both direct exports return 403 JSON; protected report links absent |
| Default STAFF modules | Inventory direct export returns 307 to `/mulai`, before the route handler |
| STAFF temporarily granted local `klinik` and `laporan` modules | Both direct exports return 403 JSON from the explicit role guard; protected links absent |
| FINANCE temporarily limited to local `klinik` module | Both direct exports return 307 to `/mulai`; no CSV response |

The temporary FINANCE and STAFF module rows were restored in `finally`. All existing `payrolls` rows were serialized in ID order before and after the run and remained byte-for-byte unchanged. The dedicated fictional report accounts and deterministic fixture rows remain in the local stack for review. The script stops its own dev server and browser on exit.

## Reproduce on this local fixture

Keep the existing local database, GoTrue, PostgREST, and gateway running. Do not reset the shared HRIS fixture. Port 3109 must be free; do not run a Next.js build against this worktree while the script's dev server is running. The installed `@supabase/supabase-js`, Playwright, and `/usr/bin/chromium` are used without adding dependencies.

```sh
cd /workspace/vetos-reports
node scripts/test-hpp-reports-local-browser.mjs
```

The script loads `supabase/tests/hpp_reports_local_fixture.sql`, which creates deterministic FIFO layers and dedicated historical visits, recipes, invoices, invoice lines, and formula versions. These SQL snapshots exercise reporting; they do not exercise clinic posting, journal entries, private financial ledgers, or payroll calculation. Local service credentials are used only to create fictional auth accounts. Report routes read with each user's authenticated session and existing RLS.

Durable non-secret execution evidence is adjacent in `2026-10-04-hpp-local-acceptance.json`. Workspace-only screenshots from the successful run are `/workspace/vetos-reports-owner-inventory.png`, `/workspace/vetos-reports-owner-compound.png`, `/workspace/vetos-reports-finance-inventory.png`, and `/workspace/vetos-reports-finance-compound.png`. The FINANCE screenshots were visually inspected. Runtime logs are `/workspace/vetos-reports-local-acceptance.log` and `/workspace/vetos-reports-local-next.log`; keys and session cookies are not saved in the durable evidence.

## Verification and limits

The acceptance script passed ESLint, `node --check`, and `git diff --check`. Product commit `c7c5f0d` separately passed the full 136-file / 1,245-test suite, TypeScript checks, and focused lint, including loader and CSV regressions for capped, missing-count, duplicate, and changing paginated sources. The final combined release build and independent review are coordinated by the parent task.

These are local acceptance results, not production browser verification. Report reads are not a transactional snapshot: stable counts and identities detect observed pagination inconsistencies, but same-count concurrent value changes can remain undetectable. The page exposes current-source/date caveats. This run covers the 1,200-row normal case and role/module denials; mutation and missing-count behavior is covered by the separate regression suite.
