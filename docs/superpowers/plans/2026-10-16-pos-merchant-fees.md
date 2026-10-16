# POS Merchant Fee Implementation Plan

> **For agentic workers:** Execute test-first domain tasks with one fresh whole-branch review. Root coordinates server integration and release; parallel workers own disjoint UI, SQL, and reporting files.

**Goal:** Add percentage merchant fees paid by customers to ordinary and split POS checkout, with matching receipts, journals, refunds, and shift totals.

**Architecture:** Quote per-method fees from base merchandise allocations, then persist gross payment allocations and immutable fee snapshots. Existing atomic finalization posts merchandise and fee income together; refunds reverse original fee income separately.

**Tech Stack:** Next.js15 / React19 / TypeScript / Decimal.js / Supabase PostgreSQL / Vitest / Chromium.

**Spec:** docs/superpowers/specs/2026-10-16-pos-merchant-fees-design.md

## Global Constraints

- User confirmed customer-borne fee; rates default0%, adjustable by non-cash method.
- Raw parts `{method,amount,feePercent?}` sum to merchandise payable before fees.
- Canonical parts `{method,amount,fee_percent?,fee_amount?}` contain gross receipts.
- Header `merchant_fee_total` defaults0; canonical fee fields default0 and remain immutable.
- Fee income account4303; goods tax and revenue exclude fee under existing customer-admin convention.
- No bank MDR expense, historic rewrite, guessed tariff or fictional production write.
- Preserve actor/branch/shift access, draft identity, atomic finalization/loyalty, frozen snapshots, and legacy paths.
- All money/rates finite, money/rates at most2decimals, rate0..100, no cash fee.

## Review Focus

1. Split fee applies only to the relevant base part, never full bill or fee-on-fee.
2. Fee, cash change and gross payment receipts reconcile exactly at cents/half-cent ties.
3. Lost responses, refreshed catalogs, restored fees and old receipt acknowledgements cannot duplicate or clear a different sale.
4. Changed mappings/tax settings and partial/full refunds preserve original fee income and payment caps.
5. Staff commission/loyalty exclude fees while cash/bank/receipts include gross paid money.

## Task 1 — quote and checkout integration (root)

**Files:** new src/lib/pos-merchant-fees.ts; both checkout actions;
src/lib/pos-checkout-identity.ts; associated unit/action tests.

**Interface:**
`quotePosMerchantFees({total:number,method:string,payments?:unknown,feePercent?:number})`
returns `{total:number,feeTotal:number,parts:PosMerchantPlanPart[]}`;
`PosMerchantPlanPart={method:string,amount:number,fee_percent?:number,fee_amount?:number}`.
`total` input is merchandise payable; output is final gross payable. Existing
resolvePosPayments validates gross parts and cash tender after quote. Persist
quote.parts, quote.total, quote.feeTotal; earn points and quests from merchandise.

- [x] Write failing quote tests:100k20cash/80debit2%=1600→101600, single2%, zero/cash, invalidrates, base mismatch, halfcent, large totals, metadata omission at0%.
- [x] Observe RED before creating quote implementation; implement using PosDecimal.
- [x] Add failing action/identity tests for gross header, fee plan, changed rate, same-key replay, retained base points and cash change.
- [x] Integrate both checkout actions and fee-aware fingerprints; run focused tests.

## Task 2 — POS UI and drafts (fee_ui)

**Files:** PosPaymentFields.tsx, both POS clients, pos-payments.ts type,
pos-draft.ts, UI/draft/component tests and explicit local browser fixtures.
**Consumes:** quotePosMerchantFees contract fromTask1. Never change actions/SQL/reports.

- [x] Write and observe RED for single/split percentage fields, exact1600fee/gross101600, per-method fee labels and clearing rates on cash/method switch.
- [x] Implement optional feePercent input types; percentage inputs only non-cash, defaults0; show net base+fee+final amount and correct pay validity/tender.
- [x] Persist single merchantFeePercent and split feePercent in drafts, zero reset after exact acknowledgement; preserve failed reload identity.
- [x] Run focused tests and actual-source Chromium fixture checks without production writes.

## Task 3 — database accounting and refunds (fee_database)

**Files:** one new generated migration, SQL acceptance suite, isolated PostgreSQL runner.
**Consumes:** canonical gross plan fields + sales.merchant_fee_total.

- [x] Write failing real-PostgreSQL acceptance before implementation.
- [x] Add default0 fee columns without rewriting historic snapshots; replace header payment trigger with independent fee/base/total validation and4303 income snapshot.
- [x] Preserve prevalidation before stock, private staging, atomic/idempotent finalizer and loyalty, parent locks, canonical account/fee immutability, branch RLS and close guards.
- [x] Extend planned refund helper to reverse original4303fee separately with cumulative cents; old nofee paths unchanged.
- [x] Verify VAT/discount/HPP/points, invalid-forged inputs, free/legacy, missingaccount rollback, changedmapping/tax, partial/full refunds and relevant concurrency on full197-migration chain; no production writes.

## Task 4 — receipts/reports/commission/loyalty (fee_reports)

**Files:** both receipt pages, sale detail/detailed report/export, payment-reporting helper as needed,
commission/customer-tier/operation-sales readers where fee affects eligible bases; focused tests.

- [x] Write and observe RED for separatefee row, grossmethod display, one headercount, exactcash20k/bank81.6k and final101.6k.
- [x] Show separate fee without inventing legacy fees; include fields in selectors; preserve receipt widths and exact acknowledgement wiring.
- [x] Exclude fee from points/tier/commission basis, keep financial receipts/shift gross, preserve planned missingjournal safeguard.
- [x] Run focused report/receipt/shift regressions and no-fee historical paths.

## Task 5 — whole release (root)

- [x] Run full npm test, types, lint, production build and full isolated SQL runner.
- [x] Fresh reviewer checks all five Review Focus cases; fix actual findings with regressions.
- [ ] Commit/push, create and attach PR, apply exact reviewed migration, merge/deploy and confirm live status.
- [ ] Verify live UI/report reads without submitting fictional business records; provide link and short walkthrough.

## Progress / rulings

- 2026-10-16: User explicitly chose fee added to customer bill. Adjustable0%-default inputs avoid inventing unapproved merchant rates. Existing clinic after-tax admin convention and4303 income classification are reused.
- Execution remains in the clean managed workspace on dedicated feat/pos-merchant-fees from origin/main e7e5bd3; no main-branch edits or extra worktree installation.

- Final verification:240 files/2052 tests, types, lint0errors(13oldwarnings), productionbuild;197migrations+4SQLsuites+feeconcurrency;12Chromium; independentreview clean after online-tier and returnpreview fixes.
