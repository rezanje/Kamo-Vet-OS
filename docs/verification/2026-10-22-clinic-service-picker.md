# Clinic services with imported categories

Base `878f409`, branch `codex/fix-clinic-service-picker-20261022`.

## Reproduction and evidence boundary

The Rekam Medis screenshot shows an empty Jasa tab with a restored draft containing items. No patient identifiers or contact details from the screenshot are copied into this record or fixtures.

The shared classifier recognized only category ancestors named literally Jasa or Tindakan and sent everything else to Obat, ignoring `item_type`. Accurate's supported SVC import maps to `item_type: "Jasa"` while preserving its catalog category; the repository already supports KONSULTASI as an independent imported category. A valid imported service in KONSULTASI therefore disappeared from Jasa and appeared under Obat.

The workbook regression uses the real parser, payload builder and classifier. Its Jasa result was empty before the fix. Exam and inpatient page fixtures reproduced the same issue without a Jasa ancestor, including an uncategorized service. The [red run](../evidence/2026-10-22-clinic-services/red.log) had six expected failures and seventeen passes before production code changed.

This verifies a defect consistent with the report; the production items' actual category/type values were not available. A minimal question about one affected SKU's Jenis/Kategori was asked. No production credentials, customer data queries or authenticated business submissions were used. If a particular SKU is still absent, its active flag, item type and category chain must be checked separately.

## Behavior

Nearest explicit clinic category Jasa, Tindakan or Obat selects the tab, including descendants. For other/missing category chains, `item_type: "Jasa"` selects Jasa; other item types retain the existing Obat fallback. Cycles terminate using the existing visited set. This deliberately changes the old generic-category service expectation: a service without an explicit clinic category belongs in Jasa rather than being silently listed as medicine.

The classifier returns the original SKU objects. Item IDs, prices, units, `item_type`, `tindakan_kategori`, draft and posting behavior are unchanged. Existing compound/ingredient exclusion in the ordinary medicine list remains intact. Both Rekam Medis and Rawat Inap use the shared fix. No category is inferred from a service name and no master data is rewritten.

## Validation

- Focused suites: 79 tests passed across classifier/import parser, both page loaders, clinic forms, save results and payment master.
- Full `npm test`: 310 files / 2,413 tests passed.
- TypeScript, scoped ESLint and `git diff --check`: passed.
- Production build with fictional local Supabase settings: passed, 193 static pages generated. Existing unrelated image/unused-variable and Supabase Edge Runtime warnings remain.
- Real classifier, RekamForm and CatatanForm browser fixture: KONSULTASI service visible/searchable/addable; item ID, Rp45,000 price, service transaction kind and consent category preserved; reload restores the draft; Tindakan remains separate. Desktop and 390px viewport checked, no runtime errors. Existing narrow-screen overflow is outside this classification-only change; no responsive-layout fix is claimed.
- Independent Sol 6.1 high review: no Critical/Important findings; 29 focused tests rerun and passed.

Evidence: [full suite](../evidence/2026-10-22-clinic-services/full-tests.log), [build](../evidence/2026-10-22-clinic-services/build.log), [browser checks](../evidence/2026-10-22-clinic-services/checks.json), [exam picker](../evidence/2026-10-22-clinic-services/exam-desktop.png), [inpatient picker](../evidence/2026-10-22-clinic-services/inpatient-desktop.png). Screenshots visually inspected. The initial browser harness used an overly strict locator for the draft banner including its child button; correcting that locator resolved its timeout without application changes.

No database migration, accounting/stock writer, security/permissions or production data changes. A01/PR83 and PR82 remain untouched. User's existing push/deploy-to-main preference applies after verification and review; live authenticated patient save/posting is outside release smoke checks.
