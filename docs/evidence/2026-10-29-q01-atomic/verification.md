# Q01 follow-up — quest progress atomic with the new-customer claim (verification)

Audit finding (29 Oct 2026): quest progress was written by a separate `apply_sale_staff_effects` RPC call
that `/kasir` made after the payment had committed, with errors only logged. If that call failed, the
new-customer claim (written inside the payment finalizer by PR282's trigger) stayed locked while progress
never moved, with no recovery. `/pos/transaksi` (back-office POS) never made the call, so its receipts
never counted for any quest.

Checklist: **Q01 — partial** (this closes the atomicity/coverage finding; owner apply on production and
user UAT are not done).

## Design chosen: same transaction as the claim

Both POS entry points finalize through the same database finalizer (`finalize_pos_sale`, also called by
`cashier_post_stock_atomic`), which sets `sales.payments_finalized_at`; the Q01 claim trigger already runs
on that update. The new migration adds a second AFTER trigger on the same event, `q01_staff_effects`,
which applies the staff effects (all quest kinds, streak, points) for that sale in the same transaction.
PostgreSQL fires same-event triggers in name order, so `q01_claim_new_customer` runs first and the
new-customer quest reads the claim just written (the migration asserts this order).

Why this instead of a retry/recovery path:
- claim, progress, points, money and stock commit together or not at all — there is no state in which a
  claim exists without its progress, so no recovery job is needed;
- `/pos/transaksi` is covered without new app code and with the same eligibility rules (claim rules stay
  in `quest_claim_new_customer`; effect rules stay in the existing function body, carried over verbatim);
- the finalizer has already asserted the cashier (active staff, branch, open shift or back-office access),
  so the effect logic needs no client caller checks;
- fail-closed: if the effects cannot be recorded, the payment does not finalize and the cashier sees the
  error (existing checkout cleanup removes the unpaid draft), instead of progress being silently lost.

Shape (anchored, counted rewrite that fails on drift — same pattern as Q01/K02/K10):
- `public.sale_staff_effects_apply(uuid)` — the existing body of `apply_sale_staff_effects`, including the
  Q01 `new_customer` patch, moved from the live definition with only the caller-check lines replaced by a
  not-found check. Private (no client grants). Idempotent per sale (`sale_staff_effects` row).
- `public.apply_sale_staff_effects(uuid)` — same client RPC, same caller checks and ACL, now delegates.
  An older app build that still calls it after payment gets `{"applied": true}` and nothing is counted twice.
- `public.apply_sale_staff_effects_on_finalize()` + trigger `q01_staff_effects` (private).
- Void unchanged: `cancel_posted_sale` → `reverse_sale_staff_effects` reverses progress/points/streak, and
  `q01_release_new_customer` releases the claim.
- App: `/kasir` no longer makes the separate call (`src/lib/quest-hook.ts` removed); `/pos/transaksi` needs
  no change.

Behaviour change to note: back-office receipts now record staff effects, so the existing void rule for
`/kasir` (reverse a cashier's effects latest-first, otherwise "Transaksi staf berikutnya masih aktif")
also applies to back-office receipts. Rp0 receipts still never claim a new customer (unchanged), but, as
on `/kasir` today, they do record the cashier's daily streak.

Historical gaps are not backfilled (daily/monthly periods, streaks and the latest-first reversal chain
depend on transaction time; a backfill would land in today's period). `owner-apply/preflight.sql` reports
how many claims have no progress and how many paid receipts (kasir vs back office, last 30 days) have no
staff effects, for an owner decision.

## Files
- `supabase/migrations/20261029153000_q01_quest_progress_atomic.sql` (sha256 `5cb284b734fa0eb839dbc5fd165ee1d6992d7a59d73d9d6ff457b872feefe450`)
- `supabase/tests/q01_quest_progress_atomic.sql` (sha256 `0fc77b322e888ceeacfdb4ca464e028e73984b8575f8cda2ca69abc16ed44ccd`) — runs on the `pos_merchant_fees.sql` fixture prelude
- `scripts/test-q01-atomic-postgres.py` — native PostgreSQL runner (no Docker, no DB URL); `--baseline` runs the same checks without the new migration
- `scripts/test-posted-sales-postgres.py` — `concurrency_tests()` adapted: receipts are paid in the reverse of the order they are cancelled (latest-first rule), and the late-effects race now asserts "no active effects" / "progress back to the earlier receipt's state" instead of "no rows" (effects now exist from payment)
- `supabase/tests/posted_sale_cancellations.sql` — before the staff-reward section, closes the effects that earlier receipts in the same file now record at payment, so that section starts from the clean staff state its exact-restore assertions use (passes on main too)
- `src/app/kasir/checkout.ts`, `src/lib/quest-hook.ts` (deleted), three vitest mocks of it removed (the strict RPC mock in `pos-split-checkout-actions.test.ts` now also proves neither checkout makes a separate quest call)
- `owner-apply/` — preflight / apply / readback / rollback + rehearsal (see its README)

## What the new SQL test proves (`q01_quest_progress_atomic.sql`)
1. `/kasir` (open shift): `finalize_pos_sale` alone writes the claim, the `sale_staff_effects` row and progress (new customer 1, sales 50000).
2. Idempotent: RPC replay ×2, finalizer replay, and a direct internal call → still 1 effect row, progress unchanged.
3. Atomic: a test-only trigger fails the last write of the staff effects after checking that the claim and progress=2 were already written in the transaction; afterwards the receipt is unpaid, no claim, progress still 1, no journal. Retried payment → claim + progress 2 together.
4. `/pos/transaksi` (no shift, back-office access): payment claims and counts for that cashier; a repeat customer adds sales but not a new customer; no claim without effects.
5. Void: earlier back-office receipt cannot be reversed while a later one is active (existing rule); latest-first voids release claim and progress for back office and kasir; the replacement receipt earns the customer and the quest reward once.
6. Internal function/trigger are private; RPC ACL unchanged; claim trigger orders before the effects trigger.

## Results (throwaway native PostgreSQL 16.15, Ubuntu build, C.UTF-8, fictional data)

`python3 scripts/test-q01-atomic-postgres.py` → `native-pg16.log`:
```
Applied 304 repository migrations in order.
Re-applied 20261028180000_q01_new_customer_quest.sql + 20261029153000_q01_quest_progress_atomic.sql: idempotent.
q01_quest_progress_atomic.sql: passed
q01_new_customer_quest.sql: passed
c05_campaign_codes.sql: passed
quest_config_write_guard.sql: passed
pos_merchant_fees.sql: passed
pos_split_payments.sql: passed
pos_payment_method_corrections.sql: passed
cashier_atomic_fifo_floor.sql: passed
posted_sale_cancellations.sql (fee prelude, minus other-FIFO-callers block): passed
refund_payout.sql (fee prelude): passed
return_planned_corrections.sql (fee prelude): passed
customer_return_spending.sql (fee prelude): passed
negative_stock_hpp.sql (fee prelude): passed
average_sale_corrections.sql (fee prelude + average opening): passed
service_line_performers.sql (split prelude): passed
sold_sku_units.sql (split prelude): passed
promo_edit.sql (split prelude): passed
Q01 race: one new customer paid at two counters at once -> claims,progress,effects = 1,1,2
All Q01 atomic checks passed.
```

`python3 scripts/test-q01-atomic-postgres.py --baseline` (main without the migration) → `native-pg16-red.log`:
```
q01_quest_progress_atomic.sql: fails without the migration, as expected:
  ERROR:  Assertion failed: kasir payment writes claim and staff effects together
... every regression: passed
Q01 race: one new customer paid at two counters at once -> claims,progress,effects = 1,0,0
```
(the race line reproduces the audit finding: one claim, zero progress.)

`python3 docs/evidence/2026-10-29-q01-atomic/run-native-pg.py scripts/test-c05-q01-postgres.py` (existing C05/Q01 runner, unchanged, incl. re-applying the Q01 migration after this one) → `c05-q01-runner-native-pg16.log`: 304 migrations, both re-applied, 11 suites passed, C05 and Q01 races passed.

`python3 docs/evidence/2026-10-29-q01-atomic/run-posted-sales-races.py` → `posted-sales-races-native-pg16.log`: effect/cancel, void/late-effect and redemption/cancellation races passed. The adapted races also pass on main (checked against `git archive HEAD`).

`python3 docs/evidence/2026-10-29-q01-atomic/owner-apply/build-and-rehearse.py` → `owner-apply/rehearsal-pg16.log`: preflight 8/8, readback 6/6, re-apply idempotent, rollback restores `apply_sale_staff_effects` md5-identical, both Q01 suites pass; preflight counted the 2 seeded receipts paid without progress.

Pre-existing, unrelated: the full `posted_sale_cancellations.sql` stops on main at its "other FIFO callers" savepoint block (`Sumber opname berubah atau tidak ditemukan`, `guard_cancelled_opname_effects`), so `scripts/test-posted-sales-postgres.py` end-to-end fails on main before this change too. The runner above executes the rest of the file.

App checks (worktree): `npx vitest run` → 557 files passed, 1 skipped; 4110 tests passed, 1 skipped. `npm run lint` → 0 errors (12 existing warnings). `npx eslint <changed files>` → clean. `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p .` → clean. `NODE_OPTIONS=--max-old-space-size=8192 npm run build` → success (the default heap ran out of memory in this container).

Not run here: Docker-based runners (`test-activity-audit-postgres.py`, `test-average-activation-accounting-postgres.py` moving-average variant of the cancellation suite); Supabase-hosted PostgreSQL; production preflight; user UAT of `/kasir` and `/pos/transaksi`.

## Release order
1. Owner: `owner-apply/preflight.sql` (read-only) on production — after the C05/Q01 package; note the `info:` counts.
2. Owner: `owner-apply/apply.sql`, then `owner-apply/readback.sql`.
3. Then merge/deploy the app (it no longer makes the separate call).
