# Feedback implementation and verification

## Delivered

1. New Accurate opening-stock imports debit Persediaan 1301 and credit Modal
   Pemilik 3101 using exact source quantities, costs, branch and date, atomically
   with stock and import status. Blank/missing HPP is rejected separately from an
   explicitly supplied zero. Existing posted imports are not backfilled.
2. Moving weighted average valuation per warehouse/item is independent of
   physical FEFO acquisition layers. Activation preserves reconciled opening
   carrying value and historical sale HPP. Current issues include all sold units,
   even negative stock; missing cost rejects sales. Receipts over negative stock
   record current-period valuation variance with protected HPP/inventory journals.
   POS, groups, online sales, clinic, compounds, deliveries, returns, cancellations
   and official purchase repricing use consistent recorded valuation.
3. `/keuangan/closing-hpp` provides activation, completed-month closing and
   immutable as-of quantity/average/value snapshots. Subsequent-month movements
   do not change closed snapshots. Global shared/exclusive posting locks serialize
   close against inventory transactions. Current issues may consume old physical
   batches; closed receipt-price corrections and backdated movements are rejected.
4. Eligible owners see PO edit/cancel entry points and related invoice correction
   links. Draft unit selection shows base-unit quantity and cost. Received PO
   quantity/unit errors require a valid return/new document and reconciliation;
   invoice replacement corrects prices while preserving original PO units.
5. PO and transfer forms show available stock for the selected warehouse in base
   and selected units, with checked pagination, error handling and draft recovery.

Reports, exports, SKU cost labels and manual opening-balance proposals use current
average carrying value when active. Known negative balances retain signed value;
reconciliation warnings have a separate count from missing monetary valuation.

## Controls and review repairs

- Closed snapshot global totals/counts are not selectable by scoped financial
  readers. UI totals are recomputed solely from authorized warehouse values.
- Average fields, inventory events and direct aggregate/layer/movement writes are
  protected; official invoker inventory RPCs retain a bounded mutation context.
- Inventory-variance and source opening journals cannot be directly deleted,
  reassigned, disguised as manual journals or edited independently of stock.
- Sale reversals validate movement HPP and original physical layer identity,
  expiry and capacity independently. Invoice repricing applies only its cost
  delta and inverse, retaining later receipts. Legacy metadata proofs remain
  strict for all original fields.
- A direct receipt recorded as covering negative stock cannot be canceled through
  an unsafe quantity reversal, including a same-price/zero-variance case.
- Existing negative-stock guards and FIFO behavior remain until activation.

## Verification evidence

The original FIFO function was restored in a disposable test database after the
new schema was installed: the mixed-price average issue regression failed for the
expected valuation assertion. The new implementation then passes that regression.
Clinic, import, correction and blank-HPP fixes also have observed red/green tests.

Final application verification:

- `npm test`: **271 files, 2236 tests passed**, no failed tests.
- `npm run build`: passed, including the new closing route.
- `npx tsc --noEmit`: passed.
- Changed-source ESLint: **38 files passed**.
- `git diff --check`: passed.

Disposable PostgreSQL verification applies all repository migrations, uses only
fictional fixtures at localhost:5432, and removes each database afterward:

- `scripts/test-moving-average-postgres.py`: mixed-price receipts/issues, source
  transfer valuation, preserved acquisition prices, official authenticated writes,
  raw-write rejection, negative-to-positive receipts and balanced variance,
  immutable old HPP, dated closing snapshots, source-journal protection, scoped
  totals, period rejection, old-batch current sales and close/post concurrency.
- `scripts/test-average-corrections-postgres.py`: PO split repricing/retry/inverse,
  later receipts, ordinary/group cancellation, historical proof compatibility,
  late-failure rollback and negative-cover receipt cancellation rejection; existing
  FIFO purchase and sale cancellation suites also pass.
- `scripts/test-moving-average-clinic-postgres.py`: clinic issue/edit, compound
  restoration/billing, delivery/invoice allocation and four existing FIFO suites.
- `scripts/test-import-balance-sheet-postgres.py`: exact opening journal,
  duplicate/branch/date/value rejection, late-failure rollback and concurrent
  first imports with exactly one committed opening.
- `scripts/test-negative-stock-hpp-postgres.py`: prior negative-stock regression
  plus merchant fees, online returns, sale cancellations and atomic transfers.
- Original full purchase-invoice and posted-sales runners passed, including their
  concurrency checks. The local test bootstrap now mirrors Supabase's service
  role BYPASSRLS setting; stale UI authentication and purchase acknowledgment mocks
  were repaired without weakening assertions.

## Release status and limitations

This new feedback package is implemented and verified locally. It has **not** been
deployed to production. The earlier negative-stock correction remains the last
production rollout recorded in this chat.

New migration order: `20261021110000_import_balance_sheet`,
`20261021120000_moving_average_inventory`, `20261021123000_average_clinic_paths`,
`20261021124000_average_corrections`. The schema starts in FIFO for a controlled
prospective cutover; an authorized all-branch OWNER/FINANCE activates moving
average through the new page/RPC after initial-stock reconciliation. Past HPP,
existing import balances and posted journals are not silently rewritten.

Customer/supplier/COA master imports do not contain monetary opening balances;
no receivable/payable values were invented. Receiving-unit errors and transactions
with incomplete source/reversal proofs still require reconciliation rather than
unsafe edits/deletes. The first cost closing is for a completed month from the
activation month onward; it does not retroactively reconstruct pre-activation
monthly averages or reopen stored snapshots.
