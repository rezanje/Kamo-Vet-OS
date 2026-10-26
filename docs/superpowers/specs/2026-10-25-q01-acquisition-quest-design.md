# Q01: Customer acquisition quest

## Intent and accepted rule

An active daily or monthly quest counts a customer once across all branches when a new customer with a valid canonical phone makes their first finalized POS purchase during the quest period in Asia/Jakarta. Shared family phones form one identity. Credit the cashier and branch of that first finalized sale. Older masters, duplicate phones, incomplete payments, and later purchases must not earn a second acquisition. Existing point claims and sale cancellation must remain auditable and reversible.

## Current system and constraints

Both stock and non-stock cashier checkouts finalize through `finalize_pos_sale`. The application then calls `apply_sale_staff_effects` as a best-effort, separate request. That function uses one `sale_staff_effects` snapshot per sale, adds staff points and ledgers, and reverses only in effect order. It requires the original cashier and an open shift. A failed post-payment request is not retried durably; replay after another staff effect can corrupt the snapshot order. The cashier sale must remain successful when quest processing is temporarily unavailable.

## Approaches considered

1. **Reward in the post-payment hook only.** Smallest code, but callback order can credit the wrong branch and transient errors lose points. Rejected.
2. **Reward inside financial finalization.** Exact first-sale attribution, but reward errors would roll back a paid sale. Rejected.
3. **Claim at finalization, then process an ordered private outbox.** A per-phone transaction lock and unique claim choose the first committed paid sale. The sale commits with a durable job and the then-active quest settings. A restricted worker processes each cashier's jobs in order and retries safely. Chosen for the full item.

## Intended design

- In the same database transaction as payment finalization, canonicalize the customer's phone, acquire a transaction-scoped lock keyed to it, and save a private unique first-sale claim. The claim's cashier, branch and finalized timestamp come from that sale. The user approved an immutable claim: canceling the first sale reverses its points, and no later cashier earns acquisition for that phone.
- Write a private job for every tracked cashier sale, not only acquisition sales. Record the finalization order and a snapshot of active quest definitions and reward settings. A job is idempotent by sale ID. Newer jobs for the same cashier wait until older jobs are done or voided.
- Keep checkout's reward call best-effort. A restricted background worker retries pending jobs after shift closure without granting broad table access to staff. It uses the stored snapshot and the existing effect/reversal accounting rules. A canceled pending sale is skipped; an applied sale follows the existing auditable reversal path.
- Use the sale's payment-finalization time in Asia/Jakarta for the acquisition period and reward ledger month. Never infer historical quest snapshots or change old transaction balances.
- Pre-migration sales have no frozen phone-at-payment record. Historical duplicate checks use the current customer master phone, so an old phone edit cannot be reconstructed with certainty; the new finalizer freezes phone for all subsequent tracked sales.

## Acceptance tests

Use a disposable PostgreSQL database with all migrations. Verify two branches racing on the same canonical phone, payment commit versus delayed reward callbacks, duplicate `08`/`+62` formats, old customers, failed and retried reward jobs, closed shifts, cancellation before and after reward processing, period boundaries, replay idempotency, and direct STAFF/ADMIN/OWNER access boundaries. No real customer sale or reward mutation is a test fixture.

## Open decisions and release gates

- Whether a zero-total finalized sale reserves the first-sale claim and earns acquisition progress needs a business decision; no reward should be assumed for zero consideration before that choice.
- The existing Vercel cron configuration supports a daily schedule. The fallback processes one bounded batch of 50 jobs at 09:30 WIB, so recovery can take roughly 24 hours or longer during a backlog. Immediate checkout processing remains best effort.
- The new private tables, worker execution path and restrictive quest configuration policies change persistent database access. Review exact role grants and obtain specific action-time approval before a Production migration.
- The existing permissive access to `staff_reward_catalog` and `quest_settings` is adjacent configuration work requiring its own reviewed access scope.
