# R03 — searchable categorized report catalog

Base main: `e46f45e97ae2500b3aaade5e8a9e50915f9fcca3`. The report homepage replaces the flat tile list with category and keyword search, keeping existing routes. Every entry distinguishes an available page, a missing placeholder or a source needing module access. Related requirement names and drilldown notes are discoverable without adding new financial calculations.

## Source reconciliation

The repository's `docs/DAFTAR-LAPORAN-KAMO-2026-08-24.md` says 50 reports in its historical summary, but its tables contain **51 named requirement rows**, mapped to **31 existing routes**. Several requirements are aliases or details within the same page. All rows are preserved in `src/lib/report-catalog-requirements.ts`; the source-generation check verified every mapped route has an actual page. This is a route/coverage inventory, not a claim that historical calculations or all feedback are validated.

Requirements without an explicit old route are grounded in existing source screens: sales receipts and purchase payments are opened from their invoice lists; account journal detail from the ledger; asset/history/location details from the asset list. Notes explain those drilldowns. The Pet Hotel category limitation remains explicit, confirmed by the current `TINDAKAN_KATEGORI` defaults; no category or clinical policy was invented.

Existing navigation tiles remain represented, including tax/HPP placeholders which have no route. HPP inventory/margin entry points keep their existing OWNER/FINANCE-only visibility. The active profile and own-role `role_modules` rules are read before constructing links. `bolehBukaPath` determines whether an entry has an anchor; unavailable authorization reads fail closed. Backend permissions/RLS/settings are unchanged.

## Verification

- RED: eight real-homepage regressions failed against main. A further shared-source regression failed when the purchase invoice page was lost from the Purchasing category after URL deduplication.
- GREEN: 10 component cases cover source aliases, categories, search/clear, missing/gap labels, module restrictions, HPP role visibility, inactive/anonymous profiles, access-read errors and shared cross-category sources.
- Full final application suite: 353 files / 2,695 tests passed. Local production build passed; final typecheck and scoped lint were run after the category correction. Final commit Vercel build is checked separately.
- Independent review identified the flat access-rule type and shared-category issues; both were corrected. Final bounded source review found no important blocker.

No migration or business-data writes. No full hosted simulations. Main release remains behind the separately reported tool approval blocker; no bypass is attempted. Rollback is a scoped code revert.
