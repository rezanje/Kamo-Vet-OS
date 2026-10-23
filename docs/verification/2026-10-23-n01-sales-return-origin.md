# N01 retail-return origin link

The existing sale detail already links its stored `sales_returns`. The return detail did not link back to its stored `sale_id`, and its route wrapper discarded `from`. Two real component regressions failed before this small fix.

The sales return detail now opens `/penjualan/{sale_id}` only from the stored relation; it never substitutes a wholesale invoice or guesses by document number. Existing authentication/source-read guards are retained. The wrapper renders the existing validated contextual back link. The context whitelist accepts only exact local sale/return UUID paths, with the existing restricted document anchors; external links, traversal, query strings and arbitrary fragments remain rejected. No additional database read, transaction mutation, refund policy, stock change or performer/commission action is introduced.

This branch reuses unchanged PR116 `2d143956f9bafd268836e404d058eb534fc7d3d3` for the purchase-return counterpart. Source branch preserved; coordinate these stacked candidates to avoid duplicate application.

Validation: two RED component failures, then 39 focused navigation tests across four files passed. Typecheck and scoped lint passed; independent read-only review found no P1/P2. Exact-head preview/build outcome will be recorded in PR after completion. Full app suite not repeated for this small link-only extension; full hosted simulations remain deferred. No migration. N01 global remains partial, especially relations without a stored foreign key; no invented invoice-to-return allocation.

Main/deployment remains blocked by the previously rejected PR103 merge operation; no retry/bypass and no target writes.
