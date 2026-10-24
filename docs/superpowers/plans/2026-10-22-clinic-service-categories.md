# Clinic service categories implementation plan

> Execute inline with systematic debugging and test-first verification.

**Goal:** Active service SKUs from supported Accurate imports remain available in the clinic Jasa tab even when their catalog category is not literally Jasa.

**Base:** `878f409` / main. Isolated branch `codex/fix-clinic-service-picker-20261022`; PR82 and A01/PR83 remain untouched.

**Evidence:** The screenshot shows the Jasa picker empty while a restored draft still contains items. The shared classifier only recognizes literal Jasa/Tindakan category ancestors. The supported import fixture produces `SVC` / `KONSULTASI`, which has no Jasa ancestor. Screenshot alone does not establish production item/category values; a minimal question about those values is pending.

**Approach:** Prefer explicit clinic categories Jasa, Tindakan, and Obat (including descendants), then use the SKU's existing `item_type` as the fallback for other/missing categories. Preserve item identity, price, units, transaction kind, consent metadata, and compound/material separation. This is picker classification only; no item reclassification writes, schema, permission, or accounting changes.

- [x] Write a failing regression using a fictional workbook through the actual Accurate parser/payload and clinic classification.
- [x] Add page regressions for exam and inpatient forms: imported service categories, missing category, explicit Obat/Tindakan overrides, active item filtering, preserved branch price/units/consent.
- [x] Fix the shared classifier, then verify focused tests, full suite, TypeScript, scoped lint, production build, and desktop/mobile component fixture.
- [ ] Review and publish the isolated fix with evidence; report production evidence limits.

**Review focus:** Category precedence; no service duplication across tabs; cycle/missing-parent termination; material/compound exclusion; existing transaction metadata stays unchanged.

**Execution ruling:** The user reported this clinic bug in the same session after explicitly requesting push/deploy to main. Preserve that release preference for this bounded fix once verification and review pass; no database migration or customer transaction is involved. A01/PR82/PR83 remain outside the release.

**Results:** Six expected red regressions; 79 focused and 2,413 full-suite tests green; typecheck, scoped lint, production build and real-form browser fixture passed. Independent review: no Critical/Important findings and 29 focused tests rerun successfully. Browser draft-banner timeout was a fixture locator error, corrected without product code changes. Production dataset values remain unverified.
