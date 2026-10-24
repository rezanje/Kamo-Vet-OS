# Clinic in-progress page: staff assignment schema mismatch

Base main: `836105e144cfc0b50ce766d31253a00f1c048940` (A01 readability PR134). Separate hotfix; no A01 polish, U09 user-management edits or blocked N01 work.

## Evidence and causal path

The user supplied a production medical-visit error with digest `3581540017`. Runtime Vercel logs are not accessible in this executor: no Vercel connector, configured Vercel token, CLI or CLI auth was available. No credentials were created or security changed. The digest itself has not been matched to a server stack.

Read-only target diagnostics confirmed the referenced visit is `Diperiksa` and has a branch; no names, contact details, medical text or prescriptions were retrieved. That state unconditionally enters `loadServiceStaff` from the medical page before constructing its form.

The loader selected/ordered `employee_branch_assignments.id`. Both repository migration0135 and current target metadata confirm there is no `id` column: the primary key is `(employee_id,branch_id)`. A zero-row target SELECT of the old projection reproduced PostgreSQL42703 (`column id does not exist`). The checked reader converts this into `ListLoadError`; the page does not catch it, so its rendering rejects. Existing page tests mocked the entire service-staff reader and missed this schema mismatch.

Other checked detail tables on this path (stock, units, branch prices and compound formula/version) were inspected for ID-column presence only and have it. This is not an exhaustive live clinical audit.

## Change and regression

Select `id:employee_id,employee_id` and order by the real `employee_id` column. The query already fixes one branch, so employee identity is unique and stable in that result. No synthetic database column or primary-key migration is needed. Keep branch/effective-date filters, active staff checks, assigned-staff resolution, checked pagination and duplicate detection.

Two added real-page tests use the actual staff loader and a schema-aware Supabase boundary. Both reproduced the rendering rejection before the fix; the other21 tests passed. They now reach the clinical form and preserve own/assigned staff, more than500 assignments, inactive/future/other-branch exclusions. Corrected zero-row SQL projection compiles against the target without retrieving staff records.

Focused tests:70 /7 files passed. Final build/typecheck/full-suite and exact deployment evidence are recorded in the PR once complete. No clinical save, stock/journal posting, migration or target data write was performed. Full authenticated user replay is not claimed without the affected user's session; this fixes the deterministic route prerequisite failure independently of the unavailable digest log.

Application-only rollout and code revert. Revert restores the bad reader, so forward fix is preferable; no data repair is required by this change.
