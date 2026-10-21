# Moving-average clinic and order delivery integration

`20261021123100_average_clinic_paths.sql` switches the existing direct clinic and sales-order stock writers to the effective moving-average unit cost when the global method is active. FEFO ordering, physical layer consumption, stock availability checks, branch/auth checks, request replay, and accounting flows remain in their existing routines. Guarded function-definition replacements fail the migration if an expected upstream anchor changes.

- Clinic invoice HPP uses the current warehouse/item average; the stock move retains the exact rate before the invoice rounds cents.
- Compound issuance stores the recognized cost in `compound_issues.unit_cost` and the consumed physical price in `physical_unit_cost`, alongside its existing layer ID and expiry. Historical FIFO issues backfill the physical snapshot from their original issued cost.
- Compound void restores physical layers at their snapshot price and returns inventory value at the historical issued cost. A later receipt therefore does not reprice the cancellation. Billing continues to use the issued cost snapshot without issuing ingredients again.
- Clinic edits accept a zero-priced physical layer when the effective average is known and positive. Unknown recognized costs still reject issuance.
- Sales delivery HPP uses the average; later invoices continue allocating saved delivery HPP. The existing accounting-period validation retains its established error, followed by the inventory-period guard before stock locks.
- Direct writers acquire the inventory shared lock before stock locks; the core valuation trigger owns average updates and immutable movement events.

Verification on 2026-10-21:

```
PATH=/tmp/hpp-postgres/runtime/usr/lib/postgresql/17/bin:$PATH python3 scripts/test-moving-average-clinic-postgres.py
```

Passed against every current production migration in a unique disposable localhost PostgreSQL database. The new suite covers average HPP, physical FEFO, replay, invoice edits, unknown-cost rollback in all three direct issue paths, compound cancellation after receipts, compound billing after receipts, linked-compound cancellation rejection, and historical delivery-to-invoice allocation. Unchanged `clinic_compound_issue.sql`, `clinic_invoice_post.sql`, `clinic_billing_lifecycle.sql`, and `sales_safe_posting.sql` also pass in default FIFO mode. Baseline red evidence was expected clinic HPP 5.33 versus the old FIFO result 4.00. Log: `/tmp/moving-clinic-green.log`.

The runner uses lightweight auth/storage shims from the repository's existing harness, not a full Supabase stack. No external deployment or commits were performed. Existing clinic/order physical-stock shortage restrictions are preserved; this change does not expand those flows to negative stock.
