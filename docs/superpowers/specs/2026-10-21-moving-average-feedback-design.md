# Moving average, monthly cost closing and operational corrections

The user authorized the five feedback items: imported inventory must enter the
balance sheet; use moving weighted average instead of FIFO for HPP; provide a
monthly cost close; expose safe purchase correction actions; show available stock
on transfer and purchase-order forms.

## Costing and cutover

Keep physical FEFO layers, batch dates and original acquisition costs. Moving
average is a separate per-warehouse/item valuation in `stock.average_cost`.
Activation is prospective and atomic, seeding reconciled priced positive stock
from its existing layer value; unknown opening values must be corrected first.
Existing sale HPP and journals remain immutable. FIFO remains available until
explicit activation, so deploying the schema does not silently change books.

Every receipt updates average using positive existing units and incoming cost.
If existing quantity is zero/negative, the incoming cost becomes the new average.
Every issue uses current average for all units, including negative stock. Unknown
sale cost is rejected. Negative-stock receipt valuation differences are recorded
as current-period HPP/inventory variance, never rewritten into prior sales.
Transfers carry source valuation while preserving physical expiry provenance.
Returns/cancellations carry original issue valuation and recombine with current
stock; physical layer restoration still validates original acquisition costs.
PO invoice repricing and reversal adjust current valuation, without erasing later
receipts. Clinic and delivery callers that bypass core inventory must participate.

## Closing

Immutable valuation events record quantity/value deltas and after-state. Closing
a completed month snapshots the last event per warehouse/item as of month end,
even when later transactions already exist. A global shared/exclusive inventory
lock serializes posting, activation and closing. Closed event dates and closed
receipt-cost corrections are rejected; current sales may consume older physical
layers. Existing accounting locks also protect inventory event dates.
Closing does not freeze next month's current average or rewrite past HPP.

## Other feedback

Inventory imports post exact source-backed inventory/equity opening journals in
the same transaction, with branch, duplicate, period and manual-opening guards.
Purchase actions reuse existing lifecycle RPCs; received unit/quantity errors use
documented return/replacement flows rather than unsupported destructive edits.
Forms show available stock from selected warehouse, base and selected units.

## Verification

Use disposable PostgreSQL with all migrations, meaningful TypeScript/UI tests,
type checking and targeted lint. Verify mixed receipts, FEFO vs average, negative
stock, transfer, sale/clinic cancellation, repricing and reversal, dated snapshots,
closing races, import rollback/idempotency and safe correction entry points.
Preserve the previously deployed negative-stock correction and report existing
unrelated test failures explicitly.
