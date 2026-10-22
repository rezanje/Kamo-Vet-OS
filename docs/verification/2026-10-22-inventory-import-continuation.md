# Accurate inventory import continuation

Base: `6289994` (origin/main on 2026-10-22). Branch: `codex/fix-inventory-import-stuck-20261022`.

## Verified defect

PR74 (`af45994`), integrated by PR78, deliberately replaced automatic stock posting with explicit OWNER accounting review. `previewSaldoAwalAccurate` returns a persistent `InitialStockState` with `phase: "preview"` and a `run_id`; the preflight returns the same phase but no run ID. `AccurateImportForm.previewReady` treated both as ready for the same preparation action.

After successfully confirming master data and preparing the batch, the page therefore still displayed an enabled Import Sekali action and the bottom continuation panel telling the user to save everything. The handler skipped already confirmed master data and called `previewSaldoAwalAccurate` again. The action's `createInitialStockRun` returns the same previewed run for the same hash, so the screen remains unchanged. The useful final status was only rendered while busy. The adjacent accounting review link existed, but was competing with misleading preparation controls.

The regression reproduces this with the real component and fictional action responses: before the fix, a second continuation click calls stock preview twice (expected once). Two tests failed as expected; four existing-behavior regressions passed. See [red.log](../evidence/2026-10-22-import-continuation/red.log).

The supplied screenshot is consistent with this state. It does **not** establish which control the user clicked, the production request result, or that this is the only cause of the reported incident. No customer workbook, browser console/network trace, production logs, or deployed schema evidence was available. No conclusion about a production migration mismatch is made.

## Change

The form now distinguishes nonpersistent preflight from a saved preview using the existing run ID. Preparation controls disappear after a successful persistent preview; the primary action opens `/keuangan/persediaan-awal?run_id=<saved-run>`. The step indicator and persistent status explain that master data is saved and stock/journal still await OWNER review. The preflight, master-only, rejection, and file/date invalidation paths retain their behavior.

No server action, SQL, migration, permissions, accounting logic, or posting retry logic changed. The existing explicit equity selection, confirmation, reason, atomic posting, and exact retry mechanisms remain the posting path. These UI tests do not independently prove deployed database atomicity.

## Verification

- `npm ci --cache /tmp/kamo-import-npm-cache`: completed without lockfile changes. The inherited dependencies lacked jsdom; the initial default-cache attempt failed outside writable roots, then the local-cache install resolved setup.
- Baseline excluding the new regression: 308 files / 2,401 tests passed.
- New regression: 6 tests, with two expected failures before the code change; all six pass afterward.
- Focused import/review/action suites: 5 files / 20 tests passed, including lost-response exact retry in the existing accounting form.
- Full `npm test`: 309 files / 2,407 tests passed.
- `npx tsc --noEmit`: passed.
- Scoped ESLint for the changed component, new test, and browser harness: passed.
- Production build: passed, 193 static pages generated; fixture-only local Supabase URL/key, no production credentials. Existing unrelated image/unused-variable lint warnings and the Supabase Edge Runtime process.version warning remain.
- `node scripts/test-import-continuation-browser.mjs`: passed at 1280px and 390px. Real import and accounting components, fictional action boundaries and blocked external requests. Asserts one master confirmation and one stock preparation, exact review URL and selected batch, explicit posting requirements, no false completion, no overflow, no runtime errors. This is not authenticated Next/Supabase end-to-end acceptance.
- `git diff --check`: passed.
- Independent Sol 6.1 high code review: no Important/Critical introduced regression; 13 component tests rerun independently and passed.

Evidence: [checks](../evidence/2026-10-22-import-continuation/checks.json), [full suite](../evidence/2026-10-22-import-continuation/full-tests.log), [build](../evidence/2026-10-22-import-continuation/build.log), [mobile preparation](../evidence/2026-10-22-import-continuation/prepared-390.png), [mobile review](../evidence/2026-10-22-import-continuation/review-390.png). Screenshots were visually inspected.

## Boundaries and follow-up

No customer data, production transaction/journal writes, reset, deployment command, shared database migration, security changes, merge, or A01/PR82/PR83 modification. A code/build preview cannot validate production posting. If the incident persists after this UI fix, the minimum next evidence is the exact control clicked and its error/response, with customer-sensitive fields redacted; the original workbook is only needed if that evidence points to parsing or validation.

Deferred pre-existing issue noted by review: file/date inputs remain editable during requests, so a late response can restore stale state after an edit. This change verifies sequential invalidation after preparation, not cancellation or race-safe invalidation. No new behavior is claimed for that case.
