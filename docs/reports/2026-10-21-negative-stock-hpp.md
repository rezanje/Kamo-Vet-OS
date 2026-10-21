# Negative-stock HPP correction

## Outcome and policy

Reported case: a warehouse starts at -1, receives 10 units at Rp12,080, then sells
20 units. Before the fix, only the 9 remaining physical units contributed HPP:
Rp108,720 total, displayed as Rp5,436 per sold unit. The corrected issue costs
Rp241,600 in both the stock card and the sale HPP journal, with Rp12,080 per unit
and an ending stock balance of -11.

The user confirmed that sales with no known HPP must be rejected until a purchase
price is entered. Negative stock remains allowed when a positive cost is known.

## Implementation

- Available positive-cost units retain their actual FIFO/FEFO costs.
- Missing units use the last positive cost consumed in that issue. If none was
  consumed, use the latest positive warehouse layer/incoming movement at or before
  the posting date, then the master purchase price. Exhausted layers and receipts
  entirely closing a stock deficit remain usable price evidence.
- Sales consuming zero-cost physical layers use the same fallback for those
  unpriced units. Without a positive reference price, raise an actionable error;
  the database call rolls back aggregate stock, consumed layers and movements.
- Canceled direct invoices and canceled repricing-created layers are excluded
  from historical price evidence. A boolean helper checks private layer proofs
  without granting access to their contents.
- Stock movements, returned issue cost, sale-item HPP and HPP journals share the
  calculated value. Physical FIFO takes and actual shortage quantities remain
  unchanged for audit. Existing cancellation checks reject estimated-cost
  reversals pending reconciliation, including zero-cost physical layers valued
  using a fallback; they cannot restore fictitious physical layers or costs.
- Restored the earlier atomic transfer guard, which the later sale-snapshot
  replacement had omitted. Updated the cancellation regression's legacy receipt
  expectation to use that same boundary. The atomic transfer suite verifies it.

## Verification

The regression first failed against the previous implementation with actual HPP
108720 instead of expected 241600. A second regression reproduced the fully
covered zero-cost-stock bypass before its correction.

Run `python scripts/test-negative-stock-hpp-postgres.py` with local PostgreSQL
client/server available at 127.0.0.1:5432. It creates a uniquely named disposable
database, applies every repository migration, runs fictional fixtures and removes
the database afterward. It does not connect to Supabase or production.

Covered cases: zero stock with known master price; transfer into a deficit;
20-unit oversale; another sale after FIFO exhaustion; future-cost exclusion;
no-cost rejection and rollback; partially consumed zero-price-layer rollback;
fully covered zero-price rejection; successful sale after master-price entry;
receipt closing a deficit without a layer; mixed FIFO costs plus shortage;
canceled direct-invoice and canceled split-layer exclusion under an ordinary
authenticated inventory caller.

Related SQL suites: `pos_merchant_fees.sql`, `online_return_unit_posting.sql`,
`posted_sale_cancellations.sql`, `stock_transfer_request_atomic.sql` passed.
`scripts/test-purchase-invoice-lifecycle-postgres.py` passed, including recovery,
repricing, rollback and concurrent create/cancel/consume checks.

`npx tsc --noEmit`, `npx eslint src/lib/inventory.ts` and `git diff --check` passed.

The complete `npm test` run had 2194 passing tests and 3 existing failures in
unchanged UI tests, also reproduced independently:

1. `merchant-fee-report-pages.test.tsx`: "shows merchandise, merchant fee and final
   bill separately on sale detail" — fixture has no `supabase.auth.getUser`.
2. `merchant-fee-report-pages.test.tsx`: "does not invent a fee for historical
   sales" — the same missing authentication fixture.
3. `remaining-transaction-forms.test.tsx`: "clears acknowledged controlled rows
   and keeps defaults on later remount" — stale `draft_key` selector returns null.

The earlier baseline invocation of `scripts/test-posted-sales-postgres.py` stopped
at `pos_split_payments.sql` because its fixture's journal insert violates current
row access policy. The other relevant SQL suites were run separately as above.
The initial JavaScript baseline also lacked installed decimal.js/jsdom; `npm ci`
restored declared dependencies without changing the lockfile.

## Release and historical data

The user authorized production rollout. Migration `20261021020000` was applied
to live Supabase project `koaglxcyjqfmgfzxszkj` on 21 October 2026 and recorded
atomically with its exact source in migration history. Only this migration was
applied; no broad database push or frontend deployment was required.

Post-deployment verification confirmed the live function body matches the tested
migration exactly (body MD5 `14195cfb96519375e24ab0c3655dab0b`), with the original
owner, SECURITY INVOKER setting and execution permissions preserved. The helper
uses SECURITY DEFINER with an empty search path and excludes anonymous execution.

A live smoke check called the issue function for 20 units of the reported item
at WH_PDRY inside a deliberately rolled-back subtransaction. The current known
unit cost was Rp15,000; the full 20-unit cost was verified at Rp300,000. Aggregate
stock, layers and movement count matched the pre-check snapshot after rollback;
no stock movement or sale was persisted. Deployment evidence is saved in
`docs/reports/2026-10-21-negative-stock-hpp-live.json`.

No existing posted transactions, immutable sale HPP snapshots, stock movements
or journals were rewritten. Previously undercosted sales (including
the two POS examples in the screenshots) require accounting reconciliation after
reviewing their source purchase prices; this forward correction cannot safely
infer and rewrite historical postings from today's price.
