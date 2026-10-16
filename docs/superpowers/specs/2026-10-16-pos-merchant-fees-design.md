# Customer-borne merchant fee in POS

## User intent

The user asks whether percentage merchant fees are implemented and requests a
component at the end of POS checkout. On 16 October 2026 the user explicitly
clarified: **Ditambahkan ke tagihan pelanggan**. Existing POS supports split
payments; only the separate clinic DEMO currently has admin-fee logic.

Implement both cashier and backoffice POS. Add percentage inputs for non-cash
methods and a separate **Fee merchant** bill/receipt row. Rates start at 0% and
are entered according to the merchant's actual rate; do not invent presets from
unapproved historical meeting notes. No automatic bank/MDR expense is created.

## Amount semantics

- Merchandise payable D is calculated by existing price/promo/discount/points rules.
- A split input part's `amount` remains its share of D before fees. Distinct parts
  must sum exactly to D. Single payments have one implied base part D.
- Raw UI input part type extends `PosPaymentPart` with optional `feePercent`.
  Single form field is `merchant_fee_percent`; split rates travel inside raw
  `split_payments` JSON. Omit zero-rate properties where possible for legacy intent
  fingerprint compatibility.
- Each non-cash part fee = round(base amount × feePercent / 100, 2), using the
  shared Decimal arithmetic. Rates are finite, 0..100 inclusive, at most 2 decimals.
  Cash fees are rejected; zero bills create no fee or fictitious allocation.
- Final total T = D + sum fees. Canonical `payment_plan` entries contain gross
  `amount` actually received plus optional snake-case `fee_percent` and `fee_amount`.
  Example: [{method:'Tunai',amount:20000},
  {method:'Debit',amount:81600,fee_percent:2,fee_amount:1600}].
- Header `sales.total` is T; new `merchant_fee_total` stores sum fees, default0.
  Sale gross subtotal/discount fields still describe merchandise only.
  Invariant T = subtotal − discount − diskon_kategori + merchant_fee_total.
- Cash tender/change behavior is unchanged. Example D100000, cash20000, debit80000
  at2%: fee1600, total101600. Cash tender50000 gives change30000; canonical cash20000,
  debit81600, header bayar131600/kembali30000.
- `sale_payments` gains immutable `fee_percent` and `fee_amount`, default0; base
  amount derives as amount−fee_amount. Old rows need no backfill.

## Persistence and accounting

The header trigger independently validates all amounts/rates and aggregates; it
snapshots mapped receipt accounts, goods revenue/discount/VAT, and fee income.
Fees follow the existing clinic customer-admin convention: added after the
merchandise's embedded tax, posted separately to active detailed credit-normal
income account4303. Do not change historic tax snapshots.

No money or loyalty is written before `finalize_pos_sale`. Finalizer remains
atomic and idempotent, including HPP and loyalty. Existing unique actor/checkout
identity, parent locks, frozen snapshots, and stale-close safeguards remain.
Fee rates must affect request intent fingerprints; zero/no-fee legacy keys stay
compatible. Retried or restored drafts keep rates; acknowledged receipts clear
the corresponding draft and next sale starts without a fee.

Refunds retain existing cumulative proportional payment allocation. Fee income
is reversed separately using original expected journal lines and cumulative
cent rounding; full refund exhausts every source fee and payment exactly once.
Changed mapping/tax settings do not change old fee refunds.

## Reports and incentives

Receipts and sale detail show merchandise payable, fee, final bill, and gross
method receipts. Shift/ledger cash and bank totals include actual gross receipts;
count each header once. Detailed report/export exposes fee separately so it is
not mistaken for merchandise revenue. Financial P&L receives fee once in4303.
Loyalty earning, tier qualification and staff commission bases exclude merchant
fees. Pending-sale visibility and legacy fallback behavior remain intact.

## Constraints and scope

No fixed default tariffs, merchant settlement integration, company-borne fee,
global merchant-rate master, unrelated billing refactor, or fictional production
transactions. Existing per-line FIFO stock boundaries remain unchanged.
All money uses at most2decimals; UI, server and PostgreSQL agree at half-cent ties.
Deployment authorization persists from the user's earlier explicit push/deploy
request; complete review and tests before applying only the reviewed new migration.
