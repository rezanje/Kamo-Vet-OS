# H02–H06 production preflight (read-only) — 28 Oct 2026

Ran `preflight.sql` unchanged on production through Supabase `execute_sql` (one SELECT, no writes).
Branch head at the time: `ed9e2eb5`, which already contains the latest `origin/main` (J03, K06/K14, P01, P02, U11).

| Check | ok |
|-------|----|
| clinic_post_invoice insert column anchor | true |
| clinic_post_invoice values anchor | true |
| HRIS access helpers present (20261027030000) | true |
| item_group_components present | true |
| inpatient doctor visit columns present | true |
| invoice_items.service_source_line_id present | true |
| commission_rules.sumber values fit the new list | true |
| no view depends on commission_rules.sumber | true |
| salary_components values fit the new checks | true |
| **SUMMARY** | **true — 0 failed** |

Extra read-only state check (same session): H02/H04/H05/H06 objects are not yet present (`clinic_post_invoice`
not patched, no `employees.commission_group`, no `payslip_templates`, no visit guard). commission_rules still has the two
20261027030000 policies. Production has 3 doctor-visit logs and 160 Grup items.

Nothing was applied. apply.sql is still the owner's step before merge.
