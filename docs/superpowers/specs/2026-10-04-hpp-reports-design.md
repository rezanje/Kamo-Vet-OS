# Current inventory valuation and compound billed-sales reports

Implements REQ-01/REQ-03 from `2026-09-24-vetos-open-items-design.md`. The user approved OWNER and FINANCE access on 2026-10-04. No global permissions, private cost ledger grants, production changes, historical backfill, or deployment.

Inventory valuation is current, grouped by item/warehouse including inactive holdings. Union stock balances with positive remaining layers; show stock quantity, layer quantity, difference, priced subtotal, complete value and weighted average only when all remaining quantities have positive finite costs. Missing layers, negative stock, invalid costs and quantity discrepancies remain visible. Expired inventory retains value. Never substitute master buy price or present mutable layers as historical inventory.

Compound report starts from explicit `invoice_items.compound_recipe_id` under non-void invoices. Date filters use invoice creation in WIB; all payment statuses are billed sales. Cost is total line `hpp`, used once. Sales are rounded line quantity × price after line discount; invoice-wide discount/tax allocation is outside this report. Unknown cost yields unknown profit/margin, and summary profitability uses only cost-covered rows with coverage disclosed. Zero revenue has undefined margin. Formula version joins are optional: inactive catalogue metadata is hidden from FINANCE by existing RLS. Keep recipe/invoice names and exact version ID. Doctor is the visit's assigned doctor, not immutable invoice-time attribution. No name matching of legacy compounds.

Both page and CSV use the same authenticated server loader. Require an active OWNER/FINANCE profile plus the existing report-module permission, resolve accessible branches with authenticated branch checks, and constrain stock layers to those warehouses. Stable paginated reads must detect over-limit results and errors rather than return partial totals. Exports contain every filtered row, regardless of table page. No service role.

Also repair the operation/sales dashboard's snake-case stock layer mapping into the existing camel-case stockValue helper, with a real collector regression.
