# J03: return-aware customer spending (partial feedback delivery)

Original reproduction: a completed 100,000 merchandise sale plus 1,600 merchant fee, refunded 50,800 gross, was still counted as 100,000 customer spending by the next checkout refresh. The helper also queried branch-scoped rows while updating a global customer master, and silently accepted API page caps/read errors.

The authoritative `refresh_customer_spending(uuid)` now calculates complete global completed sales minus active returns, plus active paid clinic invoices. Returned merchant fees follow the same cumulative cent allocation as the existing return journal; points are unchanged. The caller must have an active account and access to a source sale/visit branch. The function returns only acknowledgement, never hidden transactions, and locks the customer before its absolute recomputation. Existing table privileges, RLS and source posting guards remain unchanged.

The shared JavaScript helper reports a boolean and contains secondary failures so successful checkout/invoice/receipt recovery is not stranded after financial commit. The return action verifies its durable receipt and authoritative source customer; a failed refresh preserves acknowledgement with an explicit warning against duplicating the return. Legacy online posting and posted-sale cancellation also refresh inside their existing transaction, preserving their existing source authorization, points and posting atomicity.

## Verification

- RED: prior implementation ignored active refunds; review regressions reproduced throwing derived failures and branch-filtered recomputation.
- 49 focused helper/action/checkout tests passed; cashier and backoffice receipt recovery succeed when the derived RPC transport fails.
- Full app run: 3,101 tests passed; one outdated source-projection test expected the removed JavaScript query. That test was updated to cover its remaining query owners and all 17 tests in its file passed afterward. No remaining app test failure; no redundant full run after this test-only correction.
- Typecheck, post-build typecheck, scoped lint and production build passed. Build retains existing unrelated lint warnings.
- PostgreSQL 17.6 / 245 repository migrations: synthetic global A+B+clinic history, merchant-fee rounding, >1,000 headers, invalid-source rollback, branch/inactive/anonymous denial, absolute retries and online/cancellation aggregate preservation covered by the focused runner.
- Two PostgreSQL sessions passed: a real atomic partial refund waits for the competing customer refresh, then its final refresh retains all committed source history.
- Narrow independent source review found no remaining P1/P2 blocker in the helper/auth/function patches.
- Existing online-return suite is included. Existing cancellation sale-specific prefix covers stock/HPP, financial rollback, authorization and durable cancellation. Its later old generic stock-out fixture calls lack documents now required by opname/transfer guards; they are outside this runner's scope. Guards were not relaxed. Its `box` conversion is now defined before first checkout to match the existing sold-unit guard.
- Only fictional local fixtures; no hosted customer transaction, external refund or full hosted simulation.

## Rollout and limits

Apply only `20261023182000_customer_return_spending.sql` before deploying this app revision. Preflight verified target history 229/latest `20261023161000`, new version/function absent, and both patched target functions exactly matched the previously verified main schema. Migration patch anchors fail closed on unexpected drift; function ACL/ownership are preserved. Existing seven PR126 migrations must not be repeated.

A completed physical backup was listed at 2026-10-23 15:14 UTC; physical restore has not been tested. Migration changes functions and records its schema version, without backfill or historical transaction writes. Roll back the application first, then restore the two previous function definitions and retire the new helper only when no deployed caller uses it. Derived customer totals may be recomputed; do not restore financial tables or delete returns.

J03 remains partial: explicit cash/transfer refund workflow, clinical payout and partial-refund loyalty policy are separate work. No new historical points rate or partial points reversal policy is inferred here. Customer refresh after JS financial commit is best effort; failure keeps the receipt and warns on the return page, rather than claiming the statistics changed.
