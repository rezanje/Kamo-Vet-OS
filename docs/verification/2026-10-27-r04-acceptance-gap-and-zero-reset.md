# R04: acceptance gap matrix and as-of zero-position fix

Base: main `91d0a5ec`. Sheet row R04, columns A–N, was read on 27 October 2026; O/P were not used. Related PRs: #126, #210, #227 and #231, all already on main. No other open PR or branch touches the R04 files. R05 draft #252 changes only its own preset test script.

## Acceptance gap matrix

| Sheet K/D requirement | Existing verified coverage on main | Missing code | Unresolved policy / source | Field UAT (H) |
|---|---|---|---|---|
| As-of period-end value, not a current-stock substitute | Saved monthly snapshot (`/keuangan/closing-hpp`, #126/#210) and arbitrary-date event view (`/laporan/nilai-persediaan/historis`, #227). Neither reads current layers for a past date. | Fixed here: an item whose minus position had no cost stayed unavailable after its qty returned to zero, so its branch and all-branch totals were blank on every later date. The saved closing already stores the known value for the same cutoff. | FIFO and dates before moving-average activation: no authoritative cost history (migration 0074 opening rows). The target still uses FIFO with zero saved closes (#121 note); this is not re-verified here. | Required |
| Per-branch breakdown and total; one, many or all branches | Searchable multi-select; branch subtotals; selected total; filters kept through paging (#126, #210, #227; acceptance test `7d225be3`) | None found | Branch follows the **current** warehouse assignment. There is no historical warehouse→branch dimension. | Required |
| Detail and branch sums equal the total | Exact Decimal sums over all rows regardless of page; numerics read as text in the as-of view | None found in the as-of view. The snapshot view sums with Decimal but parses JSON numbers. Its precision loss stays below one cent for realistic Rupiah values, so it is not material and not changed. | — | Required |
| Reconcilable to the inventory ledger (GL 1301) | Per-branch GL 1301 balance through the cutoff, with difference; branchless GL shown separately; links to Buku Besar with the same `akun`/`sampai`/`cabang`. Buku Besar applies the same date/branch rules with no status filter, so the linked balance matches. | None found | GL is read now for journals dated up to the cutoff. It is not a frozen snapshot, so backdated journals change it. A zero difference is not proof of reconciliation. | Required |
| Stock valuation details | Item/warehouse detail with qty, average, value, source document, and negative-qty flag | None | Negative-stock valuation policy. Example: a receipt taking stock from minus straight to positive has an unknown `value_delta`. The report keeps that item unavailable while the closing stores `value_after`, and that path posts no variance journal. This is a costing/GL policy question and is deliberately left unchanged. | Required |
| Cutoff/timezone | WIB dates for events, activation and journals; future dates rejected | None | — | Required |

## Fix

`src/lib/inventory-historical.ts` (`eventPositions`):
- A recorded event with `qty_after = 0` and `value_after = 0` now marks the position's value as known again.
- The valuation trigger always writes value 0 at qty 0, and activation seeds qty-0 positions at 0. Valuation adjustments and reprices cannot run at qty ≤ 0.
- The saved monthly closing takes `value_after` as-is, so the two R04 views now agree for this path.
- Qty continuity and monetary-contradiction checks still run before the reset, and they are strict again after it. A contradiction that follows the reset is still rejected (tested).
- No method, rounding, cutoff, timezone, negative-stock or branch-mapping policy is changed.

## Evidence

All fixtures are synthetic: fictional branches, warehouses, items and documents.
- The new test failed before the fix (`value: null`, expected `"50"`) and passes after it.
- R04 suites: 43/43 passed.
- Full suite: 510 files / 3,725 tests passed, 1 skipped.
- Lint: 0 errors. `tsc --noEmit`: passed. `next build`: passed (with a raised Node heap in this container). `git diff --check`: clean.
- Independent review found no blocking issue and confirmed that a 0/0 event means zero value for every event source. The minus-to-positive receipt gap above came from that review; it predates this change.
- No migration, database read or write, production export, merge, deploy or preview.
