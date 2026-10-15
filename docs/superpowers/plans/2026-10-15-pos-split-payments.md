# POS split payments implementation plan

**Goal:** One POS sale may be settled through several supported payment methods,
with exactly one sale/revenue total and correct cash, bank, receipt, refund, and
shift amounts. User example: Rp100,000 = Rp20,000 cash + Rp80,000 transfer.

**Scope:** Existing cashier and backoffice POS flows. Existing single-method and
historical transactions retain their behavior. Shared UI supports Tunai,
Transfer, Debit, Kredit, QRIS and E-Wallet, up to six unique positive parts.
Allocation sum must equal the server-recomputed net total. Only cash may be
tendered in excess; change belongs only to cash. Money has at most two decimals.

**Architecture:** Persist immutable `sale_payments` with original mapped account
snapshots. `sales.payment_plan` is nullable for legacy rows. A new planned sale
validates accounts/tax and stores its allocations plus private expected journal
lines atomically, without writing money to the ledger. Existing item/FIFO writes
then proceed. `finalize_pos_sale(uuid)` checks line/payment totals, posts revenue
and HPP from the original snapshots together, and marks `payments_finalized_at`.
Failed pending headers are cleaned without an orphan payment journal. Completed
planned sales remain immutable.
Reports exclude staged planned sales while including legacy NULL plans.

## Interfaces and ownership

- UI: `PosPaymentPart = {method:string;amount:number}`;
  `resolvePosPayments({total,method,bayar,payments?})` returns
  `{parts,method,bayar,kembali}`. For split input `bayar` is cash tender; the
  returned header `bayar` is total plus cash change. Form field
  `split_payments` contains the JSON allocation array, `metode` is `Split`.
- Database: `sale_payments(id,sale_id,method,amount,coa_code,account_snapshot)`;
  nullable `sales.payment_plan`, nullable `sales.payments_finalized_at`;
  unique actor/checkout key and immutable intent fingerprint;
  authenticated `finalize_pos_sale(p_sale_id uuid)`, including atomic loyalty.
- Checkout coordinator: recompute prices/discounts, validate allocation before
  writes, persist actual FIFO HPP per line, finalize before receipt/acknowledgement.
  Recompute customer tier after finalization so the completed sale is included.
- Reporting: flatten canonical payment parts for money breakdown only; count
  sale headers once. Receipts show each net method allocation plus cash tender
  and change where applicable. Financial drift repair must use original account
  snapshots. Legacy non-Split headers are the only header-only fallback.
- Refunds: allocate cumulative refunds proportionally to original payments and
  snapshot accounts, with deterministic cent rounding and no amount above source.
  Preserve original revenue/discount/VAT proportions and stock/HPP return logic.

## Test-first tasks

- [x] UI/helper tests: 20k/80k, transfer+QRIS, missing/duplicate/unsupported method,
  negative/NaN/nonfinite/sub-cent values, short/over allocation, cash change,
  zero-total sale, draft restore and successful reset, old single-method behavior.
- [x] Checkout action tests: both entry points send one canonical payment plan,
  reject bad sums before any sale/stock writes, store per-line FIFO cost, and
  acknowledge only finalized sale. Failed finalization preserves draft and cleans
  staged document instead of issuing a receipt.
- [x] Real PostgreSQL tests: balanced per-account 20k/80k ledger, VAT/discount/HPP,
  frozen account snapshots, branch/actor access, failed mapping rollback, staged
  cleanup, idempotent seal, partial/full multi-step refunds and legacy paths.
- [x] Shift/report/receipt tests: only20k cash expected, one100k sale, correct
  method subtotals/export data, thermal receipt completeness, pending exclusion,
  missing or inconsistent Split allocations fail visibly.
- [x] Full project test suite, TypeScript, lint and build; fresh review; browser
  acceptance with explicit distinction between isolated fixtures and live reads.

Verified 237 test files / 2,010 tests, types, lint (0 errors / 13 existing
warnings), production build, all 196 SQL migrations and four concurrency checks,
and 23 explicitly stub-backed Chromium component acceptance scenarios. Final
production schema/UI verification follows the reviewed release.

## Review focus

1. No second revenue count from joining payment rows.
2. Cash change never reduces transfer/bank balances or inflates expected drawer.
3. Changed account mapping or VAT settings never alter old refunds.
4. A failed or incomplete posting never appears as a completed receipt/report.
5. Lost-response/legacy draft behavior and branch isolation continue to work.

## Rollout

Apply only the reviewed new migration before the matching application release.
No historical payment split is invented or backfilled. Never create fictional
sales/expenses in production merely to demonstrate the feature.
