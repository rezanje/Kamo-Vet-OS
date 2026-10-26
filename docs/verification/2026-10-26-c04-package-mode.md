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
