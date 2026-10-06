# Clinic Batch 1 release verification

Authorized by user on 2026-10-05: release the completed changes immediately and continue remaining feedback.

- Repeated full suite: 152 files, 1,407 tests passed.
- Read-only Supabase Management API access confirmed; production function definitions backed up outside repository. No patient or transaction rows exported.
- Compared existing production void/reissue function: only checkout-payment provenance changes; clinical function retains existing atomic/retry contract with added required-field validation.
- Adapted isolated PGlite database reconstructed from live public column, enum, and primary/unique/check constraint definitions. Tests used fictional local data and actual production invoice, stock, journal, receipt, service-state and reissue functions.
- Passed: second receipt failure rolls back invoice, stock and journals; successful split posts two receipts, balances journals and deducts medicine stock by unit factor; identical retry returns same invoice; changed payment distribution rejected; reissue preserves checkout payment markers without another stock deduction.
- Limits: adapted local database has no production RLS/trigger coverage and no concurrent sessions; no real production business transaction created for testing.

Required release order: apply the two Batch 1 SQL migrations in one transaction, then merge the application PR and verify Vercel Production deployment and authenticated read-only pages.
