# Posted retail / online sale correction verification

Status: implemented locally, independent specification and quality reviews approved. No production migration or deployment performed by this workstream. This is a bounded sale-correction report, not an ERP-wide completion statement.

## Business flow

An active OWNER opens `/penjualan/[id]`, gives a cancellation reason, and chooses cancel or cancel-and-prepare-replacement. Cancellation keeps the original source and journals, appends exact financial and stock reversals, records actor/reason/revision, and excludes the original from active sales totals. A replacement opens normal POS or online entry with original customer, items, units, quantities, and source context. Manual discount, redeemed points and vouchers start empty rather than carrying the original aggregate discount as a new benefit. Prices, payment and availability are reviewed through the existing checkout. Replacement is a separate new transaction; cancelling does not charge or refund an external payment provider. The operator must return money through the original method when actually received.

## Supported and deliberately blocked cases

| Case | Implementation / evidence |
| --- | --- |
| New completed retail with cash, split methods, merchant fees and VAT | Original journal lines reversed account-for-account; source allocations retained; void removed from active shift receipt totals. Cash/split/fees/VAT tested against actual production functions. |
| New online WA / marketplace before settlement | Original financial journal and raw FIFO HPP reversed. Fractional online stock quantity, duplicate same-SKU mixed-unit lines, individually rounded source costs and raw journal costs tested. |
| Stock items, unit factors and groups | New sale-only FIFO capture stores original consumed layer ids/quantity/cost/expiry. Each new cashier issue captures a protected logical parent-line UUID before the line is saved; finalization checks that it resolves to the owned source. Cancellation reconciles individually rounded component costs and independently rounded raw parent costs from those exact linked takes; original layers and aggregate stock restored exactly. |
| Customer earned/redeemed points, spending, tier | Source point ledger must match original earned-minus-used points. Offset once; recompute active completed retail/online plus paid clinic spending. Insufficient remaining points rejects atomically. |
| Staff quests and streak | Quest sales value uses merchandise total excluding captured merchant fees. New cashier sale effects have private before/after provenance and exact reward ledger links. A private sequence allocated under the staff lock records effect order, including same-day no-op effects with identical state and timestamps. Only the latest unreversed compatible effect can restore previous progress/streak/balance and append opposite ledger entries. Duplicate apply/cancel cannot double award/reverse. Late effect writer after void rejects. |
| Reward redemption and quest claim | Atomic reward/claim RPCs serialize on the same employee as award/reversal. Durable redemption identity prevents duplicate deduction. Manager fulfillment remains supported without changing point cost. Direct balance/ledger/progress writes are guarded. |
| Stale or forged requests | Actor, active status, module/branch permissions checked before cancellation replay; original row lock and expected revision; private per-actor durable request. No raw posted amount updates. |
| Open-period rule | Source and reversal must be in open periods, source cannot be future dated; reversal uses current WIB day. |
| Historic stock sale without complete FIFO snapshots | Blocked with reconciliation message. No guessed layer backfill; unlinked historical group issues also require reconciliation. |
| Historical staff reward effects without attributable snapshots | Blocked if relevant historic progress/streak exists. |
| Later staff progress/claim/redemption or changed balances | Blocked with reconciliation message, preserving all later activity. No chronological reward replay. Reverse-order compatible cancellations supported. |
| Existing sales return | Blocked, preventing double stock/cash/points reversal. |
| Closed original shift | Blocked pending shift cash reconciliation. |
| Settled marketplace / commission / settlement journal | Blocked pending settlement reconciliation. |
| Existing payroll for source month | Conservatively blocked pending payroll reconciliation. |
| Voucher / promotion-linked source | Blocked pending promo/voucher reconciliation. |
| Missing/unbalanced/mismatched source journals or HPP, changed layer identity/cost, source shortfall / incompatible stock state | Blocked; no mutation on failure. |

## Source coverage

- Shared completion rule: `src/lib/sale-payment-reporting.ts` rejects voided sources; all existing explicit completion projections include `voided_at`.
- Dashboard: shared dashboard loader and app dashboard totals/top items.
- Operational reports: transaction detail, sales items, cashiers, top customers, promo, operation-sales and transaction loaders.
- Finance: sync excludes voided sources; shift UI and database closing checks exclude voided receipts; original financial ledgers remain immutable with signed reversal entries.
- Tax: `faktur-pajak-server.ts` already reads signed journal debit/credit, including cancellation debits. Original/reversal dates remain distinct; no filtering of posted tax history. The audit reference identifies the reversal; source description contains original receipt number.
- Customer: tier recompute, loyalty inactivity, CRM history/totals, clinic customer totals, cashier customer summaries.
- Commission: aggregate and single-sale commission readers filter completion, including void.
- Return selection and insertion: selectors exclude void, database source lock rejects return against void.
- History: source detail and retail list expose cancellation; both receipt views carry cancelled-history notice. HPP detail remains historical. Original checkout retry resolves original source receipt, which is visibly voided; it does not repost.
- Replacement: active OWNER-only source loader under session RLS; same-branch POS shift required; online warehouses restricted to original branch; separate durable draft scopes protect normal cart/input; validation, posting and recovery failures preserve replacement context on both cashier and online routes.
- Shared inventory: only `sale` / `sale-group` client paths dispatch to the new source-validated `sale_stock_out_fifo`. Online already uses a privileged atomic posting operation. Other shared FIFO semantics/return fields remain unchanged. Direct fabricated FIFO snapshot writes reject and rollback.

## Verification

`python3 scripts/test-posted-sales-postgres.py` creates a unique localhost-only disposable PostgreSQL database, applies every sorted repository production migration with lightweight auth/storage shims, and removes the database on completion/failure. It exposes `bootstrap_database()` for the independent backup/restore fixture consumer. It does not read production credentials or data.

Executed production-function suites:
- `supabase/tests/pos_merchant_fees.sql`
- `supabase/tests/pos_split_payments.sql`
- `supabase/tests/online_return_unit_posting.sql` (full suite retained; two intentional forged-PO-write cases accept the new earlier permission rejection while retaining nonmutation assertions)
- `supabase/tests/posted_sale_cancellations.sql`

Cancellation suite covers source authorization/revision/replay, exact financial/stock/FIFO/unit/group/expiry restoration, online fractional HPP, points/spending, reward restoration and dependency blocks (including identical no-op later effects, with and without streak bonuses), direct-write guards, original period/shift/return/settlement blockers, forced final-audit failure rollback, source and logical-link capture failure rollback, missing-link finalization repair/retry, forged foreign line ids, fractional groups sharing SKUs, redistributed parent/component HPP rejection, and shared transfer/production/opname/adjustment/purchase-return/clinic FIFO contracts.

Separate real PostgreSQL sessions test identical cancellation retry contention, effect-before-cancel, cancel-before-late-effect, redemption-before-cancel, and cancel-before-redemption. Lock waits are observed through `pg_stat_activity`; final durable records and balances are asserted.

Focused Vitest run: 12 files, 135 tests passed (sale actions/replacement, inventory caller dispatch, completion readers, payment reconciliation, POS split/group actions, quest logic, checkout identity, operational/item reporting). TypeScript and scoped ESLint checks passed. SQL remains the authority for transaction/lock/rollback assertions; frontend tests do not claim a real browser or live acceptance run.

Independent quality review additionally reran 24 focused tests, all production migrations, four SQL suites and the real concurrency cases; all passed after both quality findings were fixed.

## Remaining boundaries

- Source historical metadata is never reconstructed heuristically. Unsupported old/dependent transactions need a dedicated reconciliation workflow.
- Existing POS checkout still makes several client-to-server calls before finalization. Each new FIFO capture is atomic with its stock consumption; this change does not redesign the pre-existing whole-checkout partial-failure workflow.
- Replacement is reviewed as a new transaction; no automatic external payment refund or payment reuse.
- No production write, production browser acceptance, or deployment proof belongs to this workstream yet.

## Reset registry additions

Operational tables added: `sale_cancellations`, `sale_cancellation_requests`, `sale_staff_effects`, `staff_reward_requests`. Sales carry revision/void metadata and `quest_effects_tracked`; stock movements carry FIFO snapshot fields and logical `sale_line_id` (no cross-request foreign key). `sale_staff_effects.effect_order` owns an identity sequence. Existing staff balances, streaks, progress, ledger and redemptions must reset together. Reward catalog, quest definitions and quest settings are configuration.

## Exact review surface

- `docs/superpowers/verification/2026-10-21-posted-sale-corrections.md`
- `scripts/test-posted-sales-postgres.py`
- `src/app/(app)/crm/pelanggan/actions.ts`
- `src/app/(app)/keuangan/sinkron/actions.ts`
- `src/app/(app)/klinik/antrian/[id]/page.tsx`
- `src/app/(app)/laporan/pelanggan-teratas/page.tsx`
- `src/app/(app)/laporan/penjualan-barang/data.ts`
- `src/app/(app)/laporan/penjualan-kasir/page.tsx`
- `src/app/(app)/laporan/penjualan-rinci/page.tsx`
- `src/app/(app)/laporan/promo/page.tsx`
- `src/app/(app)/page.tsx`
- `src/app/(app)/penjualan/[id]/SaleCancelForm.tsx`
- `src/app/(app)/penjualan/[id]/actions.ts`
- `src/app/(app)/penjualan/[id]/page.tsx`
- `src/app/(app)/penjualan/online/actions.ts`
- `src/app/(app)/penjualan/online/baru/OnlineForm.tsx`
- `src/app/(app)/penjualan/online/baru/page.tsx`
- `src/app/(app)/penjualan/online/page.tsx`
- `src/app/(app)/penjualan/page.tsx`
- `src/app/(app)/penjualan/retur/baru/page.tsx`
- `src/app/(app)/pos/shift/page.tsx`
- `src/app/(app)/pos/struk/[saleId]/page.tsx`
- `src/app/api/cari/route.ts`
- `src/app/kasir/KasirClient.tsx`
- `src/app/kasir/checkout.ts`
- `src/app/kasir/page.tsx`
- `src/app/kasir/quest/RedeemRewardForm.tsx`
- `src/app/kasir/quest/actions.ts`
- `src/app/kasir/quest/page.tsx`
- `src/app/kasir/retur/page.tsx`
- `src/app/kasir/struk/[saleId]/page.tsx`
- `src/app/kasir/tutup/page.tsx`
- `src/components/ClearKasirDraft.tsx`
- `src/lib/__tests__/inventory.test.ts`
- `src/lib/__tests__/kasir-group-checkout.test.ts`
- `src/lib/__tests__/pending-sales-readers.test.ts`
- `src/lib/__tests__/posted-sale-actions.test.ts`
- `src/lib/__tests__/posted-sale-tax.test.ts`
- `src/lib/__tests__/pos-split-checkout-actions.test.ts`
- `src/lib/__tests__/sale-payment-reconciliation.test.ts`
- `src/lib/__tests__/sale-replacement.test.ts`
- `src/lib/customer-tier.ts`
- `src/lib/dashboard.ts`
- `src/lib/inventory.ts`
- `src/lib/komisi-data.ts`
- `src/lib/laporan-transaksi-server.ts`
- `src/lib/loyalty-server.ts`
- `src/lib/operation-sales-server.ts`
- `src/lib/pos-checkout-identity.ts`
- `src/lib/quest-hook.ts`
- `src/lib/sale-payment-reporting.ts`
- `src/lib/sale-replacement.ts`
- `src/lib/tutup-shift.ts`
- `supabase/migrations/20261020171202_posted_sale_cancellations.sql`
- `supabase/tests/online_return_unit_posting.sql`
- `supabase/tests/posted_sale_cancellations.sql`
