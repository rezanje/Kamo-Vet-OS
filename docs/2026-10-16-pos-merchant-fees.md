# Customer-borne POS merchant fees

Customer merchant fees can be entered as percentages at payment, separately for
ordinary noncash payment or each noncash method in Bayar Gabungan. Defaults are
zero; the cashier supplies the merchant's actual rate. Cash has no merchant fee.

## User walkthrough

1. Refresh `/kasir`, add merchandise and select the salesperson/customer as usual.
2. Choose a noncash method and enter **Fee merchant [method] (%)**. The bill shows
   merchandise, merchant fee and final total separately before payment.
3. For split payment enable **Bayar Gabungan** and divide the merchandise bill
   before fees between methods. Enter a percentage on the relevant noncash part.
4. Example: merchandise Rp100,000; cash Rp20,000 plus debit Rp80,000 at2% becomes
   fee Rp1,600 and final bill Rp101,600. Actual receipts are cash Rp20,000 and
   debit Rp81,600. Cash tender Rp50,000 yields change Rp30,000.
5. Complete a real authorized sale, check the separate fee on the receipt and in
   detailed sales reporting, then confirm the next sale starts with zero fee.
   Failed checkout/reload preserves the current draft's rates.

## Calculation and accounting

- Raw split allocations describe merchandise after discounts/points; their sum
  must equal merchandise payable. Each noncash fee is rounded HALF_UP to cents
  before summing, using Decimal.js to match PostgreSQL numeric.
- Final header and immutable payment allocations contain gross receipts.
  `sales.merchant_fee_total`, `sale_payments.fee_percent` and `fee_amount` retain
  the fee snapshot; historic rows default to zero and remain unchanged.
- Goods and embedded merchandise VAT retain their original basis; customer fee
  follows the existing after-tax customer-admin convention. Journal credit4303
  records the fee separately; cash/bank debits include the actual gross receipts.
  No bank MDR expense is created for this customer-borne surcharge.
- Finalization, earned points, HPP and loyalty remain atomic and idempotent.
  Points, tier spend, commissions and merchandise operation metrics exclude fee;
  shift receipts and financial statements include the actual cash/bank amounts.
- Both TypeScript and online-order SQL tier recomputation exclude merchant fees
  and pending checkout plans.
- Planned POS refunds use the source gross/subtotal ratio, including fees above
  original list value; legacy refunds retain their old clamp. Cumulative original
  fee reversal and nested merchandise-VAT allocation preserve cents across tiny,
  partial and full returns even if mappings/tax settings later change. Preview
  and exported reports display fee cents.
- Canonical account snapshots, branch access, immutable financial snapshots,
  parent locks, pending/stale shift guards and finalization checks remain intact.

## Verification and release

Verified16 Oct2026:

- Vitest:240 files /2,052 tests passed; TypeScript passed.
- ESLint:0 errors /13 existing warnings; changed return files also clean.
- Production build passed; local actual-source Chromium12 checks passed across
  both clients, with no page/console errors.
- Isolated PostgreSQL16: all197 migrations, merchant-fee/split/online-return/
  expense suites and fee-bearing finalization/latechild/staleclose/duplicatekey/
  full-refund concurrency checks passed. Disposable database removed.
- Fresh independent whole-change review: both P2 findings (online tier spend and
  return preview) resolved, no remaining actionable findings.

Release identifiers are retained in GitHub PR/deployment history.
No fictional production sale, expense, refund or shift is created for verification.
FIFO stock calls remain the existing separate per-line operations; this release
adds no claim of whole-checkout stock atomicity.
