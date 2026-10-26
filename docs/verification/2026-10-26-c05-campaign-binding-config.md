# C05 campaign code binding configuration

Source: checklist C05 (CSV gid 831947777), 26 October 2026. Branch starts from main `87955cb` and is separate from draft PRs #218 and #225.

`/crm/kampanye` now stores a distinct campaign alias linked to exactly one existing transaction voucher or product promotion. An OWNER/ADMIN can explicitly select the matching existing calculation mode or leave it unset. Validation rejects cross-type modes, nonexistent targets, malformed codes and duplicate aliases. RLS restricts configuration to active OWNER/ADMIN. A database trigger prevents aliases from colliding with current or later legacy voucher codes, so an unconfigured alias cannot accidentally redeem through the old voucher path. Existing POS/clinic pricing and saved transactions are untouched.

**All aliases are configuration only.** Even when a calculation mode is selected, the screen says they are not redeemable until the runtime contract is approved and built. The unchosen mode warns more specifically. This preserves the legacy default and avoids inventing product voucher stacking or monetary allocation. No new role, rate, checkout rule, schema backfill or historical transaction mutation is introduced.

## Runtime gap before C05 acceptance

- POS display (`src/app/kasir/page.tsx`) and clinical display (`bekalPotonganKlinik`) currently list legacy vouchers. Both would need safe alias projections from binding to the selected active source.
- POS checkout (`src/app/kasir/checkout.ts`), clinical single invoice (`hitungPotonganKlinik` plus payment action), and group checkout (`bayarRombongan`) resolve `voucherCode` directly against `vouchers.code`. Alias redemption would need server-side source resolution in all three paths, preserve the underlying voucher code for the optional cap in PR #225, and save the submitted campaign alias separately on sales/invoices. Group checkout currently distributes one voucher among multiple invoices; its usage-count semantics need a decision before aliasing it.
- Product promo aliases require a decision on whether the code activates or replaces an automatic promo and on stacking with other product/transaction discounts. Selecting `existing_promo` in configuration records the intended calculation source; it does not settle those checkout rules.

The migration `20261026003600_c05_campaign_binding_config.sql` adds a public table, manager RLS and a SECURITY DEFINER collision trigger. **Obtain specific Production security approval before applying it.** Apply the migration before deploying the new route. Worker did not apply it to the target, merge, deploy or perform field UAT.
