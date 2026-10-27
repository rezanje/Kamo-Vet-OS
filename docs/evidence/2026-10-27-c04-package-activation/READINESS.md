# C04 package-total — activation readiness

Status: app live with package-total gated off; one migration pending. **No production write, flag change, merge or
deployment was made by this work.** Production identifiers and outputs are kept out of this public repository.

## Proven

| Item | Evidence |
|---|---|
| One database change pending | `supabase/migrations/20261026002100_promo_package_total_mode.sql`; it changes no data rows. |
| App safe without it | PR #223: legacy edits send the pre-C04 payload (accepted); package payload refused until the migration. |
| Out-of-order apply on current `main` (incl. K03) | `owner-apply/rehearsal-pg17.log` (17.6), `rehearsal-pg16.log` (16.15): preflight → apply → readback → after-tests → second apply refused → rollback refused while a package promo exists → rollback → preflight → re-apply. Generated SQL byte-identical across versions. |
| Live cashier FIFO floor with package-total | `scripts/test-promo-package-fifo-floor-postgres.py` on 17.6 and 16.15 (results below). |
| Containment / recovery | `06` freeze and `07` thaw in the same test (results below). |
| Security review | `SECURITY-REVIEW.md`: independent agent pre-review (one NULL gap fixed red→green) and independent post-change review of containment and tests. |
| Production read-only checks | Target identity, preflight Query A `0 failed`, C04 absent, flag off; repeated after K03 (details private). |

### FIFO floor integration (synthetic: price 20, FIFO cost 10, package of 5)

Stored package promos are priced by the app's own engine (`scripts/promo-package-quote.mjs` →
`loadPromoAktif` + `serviceLinePromos`). The resulting `promo_discount` is posted through `cashier_post_stock_atomic`.

| Package amount | Qty | Promo | Net | HPP FIFO | Result |
|---|---|---|---|---|---|
| 30 | 5 | 30 | 70 | 50 | posted |
| 30 (max 5) | 10 | 30 | 170 | 100 | posted, one package only |
| 50 | 5 | 50 | 50 | 50 | posted (equal to floor) |
| 60 | 5 | 60 | 40 | 50 | rejected "di bawah HPP FIFO", nothing issued |
| 100 | 5 | 100 | 0 | 50 | rejected "Harga neto Persediaan nol", nothing issued |
| legacy 10% | 5 | 10 | 90 | 50 | posted (legacy unchanged) |

### Containment / recovery

- `06` freezes only active package promos. Legacy promos stay active, and a manager's earlier edit is kept.
- Re-running `06` changes nothing.
- Sales, sale lines, payments, stock moves/layers, journals and journal lines are byte-identical before and after.
- `07` stops on a promo edited after the freeze, and keeps that edit.
- After the decision is recorded, `07` re-activates only unchanged promos, with the ledger still identical.
- A promo whose target was removed blocks `07`.
- A changed C04 guard stops both `06` and `07` before any write.

## Gates (see `owner-apply/OWNER-RUNBOOK.md` for sources)

Mandatory:
1. PR #249 exact-head `Technical checks` green, then merged via PR (ruleset; 0 approvals required).
2. Release slot from the coordinator (K03 held the exclusive slot; no concurrent migration).
3. Inside the slot: preflight `0 failed` → record newest completed backup time → apply → readback `0 failed` →
   flag + redeploy.
4. AGENTS.md release report (PR description now; PR comment after merge/deploy).

After activation: field UAT with a real campaign.

## Not blocking the existing scope

- **Mixed-SKU packages:** not defined. App and database enforce exactly one target SKU, so this is a future
  extension, not a defect.
- **P03 (below cost):** live since PR181/182 (`20261025060000_cashier_atomic_fifo_floor.sql`). The `/kasir`
  checkout (`cashier_post_stock_atomic`) rejects stock lines whose net price is zero or below FIFO cost, and
  package-total goes through it unchanged (table above). No exemption or pricing-policy change was made.
- **Not re-proven here:** the `/pos/transaksi` and clinic billing paths use the same promo engine but post through
  their own functions. Their below-cost behaviour is whatever they enforce today; C04 does not change it.
