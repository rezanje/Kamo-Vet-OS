# C04 — explicit nominal discount mode

Source: checklist C04, gid 831947777, read 26 October 2026. A five-unit purchase with a total Rp10,000 discount is represented explicitly; the previous nominal-per-unit meaning remains the default for every existing promotion.

## Implemented contract

- The central OWNER/ADMIN promo form offers **Per satuan (aturan lama)** and **Total per paket minimum**. Package-total is opt-in, requires nominal discount, positive minimum quantity and exactly one selected SKU. Percent remains per unit. The list labels package totals distinctly.
- For package-total, `discount_value` is the amount for one complete `min_qty` group. With `kelipatan` off, an eligible line receives one amount. With it on, each complete group receives one amount. `max_qty` caps units used to count complete groups; an incomplete group receives no package discount. Both client display and server checkout use the same calculation and the amount is capped by qualifying units' gross value.
- Existing promotions without `rule.discount_mode` continue per-unit pricing without a backfill. Posted line discounts and historical receipts are unchanged. Invalid active package configuration stops pricing with an explicit error instead of silently treating it as an all-product or per-unit promotion.
- The existing line/SKU pricing scope is retained. Repeated clinical service rows with the same SKU, unit and price are grouped for calculation and the one discount is allocated back to source rows. A package spanning *different* SKUs or differently priced/unit lines is not defined by this mode.

The fixture with nominal total Rp10,000, min 5 and max 5 yields 0/10,000/10,000/10,000 at qty 4/5/6/10. With max removed and `kelipatan` on it yields 0/10,000/10,000/20,000. Existing per-unit fixture remains unchanged.

## Migration and release boundary

`20261026002100_promo_package_total_mode.sql` adds a nonvalidated constraint for future writes and extends only the existing atomic `edit_promo` function's allowed value, validation and rule update. Its guard aborts on function/ACL/body drift. Existing clients that omit the mode preserve the stored value during a staggered rollout. It does not change function signature, grants, RLS, roles, sales, or historical rows. The security-definer change requires integrator review and explicit approval before target application; this worker applies no target migration. The disposable PostgreSQL test runs all repository migrations, legacy C01 editor regressions and new package-mode cases with fictional data.

Code completion covers the selected per-SKU mode. Choosing the campaign's desired mode, mixed-SKU bundle semantics, below-HPP policy P03 and field UAT remain outside what can be inferred from C04's recording. The sheet status should reflect those remaining decisions and release evidence, not be marked fully complete from this isolated branch.

## 27 October 2026 follow-up — transaction budget and release readiness

Base brought up to date by merging main `0aea0979db5f969542ab723c505c319b252ead57` (no conflicts). No other worker had pushed to this branch since `7acda411`; the PR had no review threads.

**Fix: one package budget per transaction.** Before this follow-up the engine evaluated each cart row on its own. Clinic billing groups repeated *service* rows but not repeated *product* rows (e.g. the same medicine prescribed twice in one visit), so two rows of 5 with "max 5, once" paid Rp20,000 instead of Rp10,000, and rows of 3 + 3 paid nothing. `hitungPromoKeranjang` now gives each package promo one budget per transaction: rows of the same SKU, unit and price are counted together and the amount is allocated back by quantity; rows of the target in a different unit or price are not combined, and only the best such group receives the package (never two). A package replaces another promo on those rows only when it saves more in total, preserving one promo per row. A cap below the minimum (blocked by both editors, possible only in direct rows) now yields no package instead of a full one. Per-unit (legacy) evaluation is unchanged — still per row.

| Acceptance | Evidence |
|---|---|
| Min 5, Rp10,000, cap 5: qty 4/5/6/10 → 0/10,000/10,000/10,000 | `promo-hitung.test.ts`, `promo-active-loader.test.ts` |
| Min 5, Rp10,000, no cap, kelipatan: 4/5/6/10 → 0/10,000/10,000/20,000 | same |
| Legacy promos stay per unit; no backfill, posted sales untouched | per-unit fixtures; migration has no DML on sales/history |
| Partial input / activation fails safely | create/edit validation tests; DB early-toggle denial, uncommitted activation invisible, target delete/add rolled back |
| Repeated service rows | `service-line-promos.test.ts` (2+3 rows → 4,000 + 6,000) |
| Repeated product rows / mixed unit-price rows of the same SKU | new `hitungPromoKeranjang total per paket` tests |
| Migration not duplicated / not conflicting with latest main | unique version; only other promo migration after C01 is C03 `20261025070000` (earlier); C03 Excel import test passes with C04 triggers |
| Out-of-order application | 267 main migrations applied first, C04 last, then C01/C04/C03/POS/clinic SQL suites pass; re-apply rejected at first statement |

Commands on the merged head (all in this container; disposable PostgreSQL 16 clusters, fictional data, removed after each run — no production, preview, Sheet or real transaction):

- `npm test`: 505 files, 3,675 passed, 1 skipped (existing skip).
- `npm run lint`: 0 errors (12 existing warnings in unrelated files). `npx tsc --noEmit`: pass. `npm run build`: pass.
- `scripts/test-promo-package-total-postgres.py` (268 migrations), `test-promo-edit-postgres.py`, `test-pos-split-payments-postgres.py`, `test-clinic-billing-consistency-postgres.py`, `test-service-performers-postgres.py`, `promo_excel_batch.sql`: pass.
- `test-sales-posting-postgres.py`, `test-posted-sales-postgres.py` (missing `auth.jwt()` shim) and `test-clinic-demo-postgres.py` (employee status guard) fail identically on unmodified main; harness drift unrelated to C04.

**Migration plan (for the release owner, not executed here).** Apply `20261026002100` only after security-scope review of the `edit_promo` SECURITY DEFINER body change and a target migration-history check. If the target already holds `20261026090000`/`20261026100000`, this version is older than the latest applied one and must be applied deliberately as out-of-order (tested above). Deploy app and migration together: the new form writes `discount_mode`, which an unmigrated `edit_promo` rejects. Rollback before any package promo is created: drop the two constraint triggers, the guard function and the constraint, and restore the C01 `edit_promo` body.

**Open business decisions (not inferred).**
1. Mixed SKU: may one package combine different products (e.g. 3 of A + 2 of B = package of 5)? No decision is recorded. If "no", C04 is code-complete pending UAT; if "yes", the split of the discount across products also needs a rule. This mode deliberately allows exactly one SKU.
2. P03 below-HPP: still "Needs decision" in the 23 October coverage. The package amount is capped only by the qualifying gross value, as legacy promos are; no HPP floor is added here.
