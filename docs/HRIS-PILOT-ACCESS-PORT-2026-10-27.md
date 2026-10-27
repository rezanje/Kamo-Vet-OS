# HRIS pilot access: who can see salaries (27 Oct 2026)

Branch `claude/hris-pilot-access` (from `main` 0aea097). The owner chose **option A** on 27 Oct 2026:

| role | sees | changes |
|---|---|---|
| OWNER | everything | everything |
| FINANCE | all HRIS and money data (base salary, payroll, kasbon, reimburse, components, settings) | nothing in HRIS |
| ADMIN | employee directory, attendance, leave, overtime, schedules, shifts, KPI for branches they hold (default capability = all branches) and employees without a branch | the same. **No** base salary, payroll, kasbon, reimburse or salary components |
| STAFF / DOCTOR | own attendance, leave, overtime, kasbon, reimburse, KPI | clock in/out, submit leave, overtime, kasbon, reimburse (status `Menunggu` only) |
| every login | employee directory without salary (doctor, performer and salesperson pickers), shifts and schedules (clinic doctor roster), commission rules and sales targets | commission rules and targets: OWNER/ADMIN only |

## Live state before (read-only, 27 Oct 2026 02:40 UTC)

Every HRIS table had a single `*_all` policy `using (true) with check (true)`, so any of the 88 non-owner/non-admin
accounts could read and write salaries, payroll, kasbon and reimburse through the Data API. The volume exposed is small
today: 5 employees with `gaji_pokok > 0`, 3 kasbon, 0 payroll, 0 reimburse, 1 salary component. The `role_modules`
table also gives DOCTOR the `laporan` module, so doctors could open the salary report (`/laporan/gaji`). After this
migration that report returns no rows for them.

## Design

- `employees.gaji_pokok` moved to the new table `employee_base_salaries` (OWNER all, FINANCE read). The old column is set
  to 0 and pinned by `check (gaji_pokok = 0)`. Revoking that column per role is impossible, because every app role is the
  same database role `authenticated`. Column privileges would also break the invoker functions
  `assign_employee_secondary_branches` and `set_visit_service_state`, which run `select *` on `employees`. The migration
  aborts (`HRIS_SALARY_COPY_MISMATCH`) if the copied total differs from the source total.
- Helper functions are in schema `private` (security definer, `search_path = ''`, execute granted to `authenticated` only),
  so they are not exposed as Data API endpoints.
- ADMIN branch scope uses `user_branches` plus `has_role_capability('all_branches')`, not the operational-branch header.
  HRIS screens span every branch the admin holds. Employees reached through `employee_branch_assignments`
  (floating doctors) are covered.
- The automatic kasbon for a cash shortage at shift close used to be a direct insert by the cashier. Now it goes through
  `record_shift_cash_shortage(shift_id)`, which requires: the shift belongs to the caller's branch, it is `closed`, it was
  closed less than 15 minutes ago, `selisih < 0`, and no shortage kasbon exists yet for that shift. The amount is taken
  from the shift row. `cancel_shift_cash_shortage(shift_id)` undoes it when the journal fails (refused once a journal
  exists). The reason text matches `ALASAN_SELISIH_KAS` in `src/lib/kasbon.ts`.
- `employees_lock_directory` (`for update using (true) with check (false)`) keeps `select ... for share` working for
  invoker clinic functions such as `set_visit_service_state`. Row locks must pass UPDATE `USING`, and without this
  policy a STAFF provider lookup returns no row. Real updates by non-managers are still refused by `WITH CHECK`.
- The audit log for these tables is metadata-only (`activity_log_sources.metadata_only = true`), so it never carries amounts.

## App changes

- `src/lib/employee-salary.ts`: `bacaGajiPokok`, `simpanGajiPokok`. The employee list shows the salary column only to
  OWNER/FINANCE. The create field, the edit field and the benefit section of the profile appear for OWNER only. Saving an
  employee as ADMIN never touches salary.
- Payroll calculation (`payroll-data.ts`) reads salary from the new table.
- Kasbon and reimburse approval: OWNER only. Overtime approval: OWNER/ADMIN. Salary rules (`/pengaturan/gaji`):
  OWNER only. Payroll calculation, correction and approval, and salary components: OWNER only (from the earlier HRIS commits).
- `seed.sql` and two SQL fixtures no longer write `employees.gaji_pokok`.

## Verification

- `scripts/test-hris-pilot-access-postgres.py` runs `supabase/tests/hris_pilot_access.sql` on PostgreSQL 16 with
  fictional fixtures. It proves the old exposure (STAFF reads 3 salaries), the salary move, and the per-role read/write
  matrix above (including ADMIN with all-branches switched off, the shift-shortage function, and anon). A mutation check
  (adding a `using (true)` salary policy) makes it fail at `staff: no salaries`.
- Unit tests: 3,854 pass (`npm test`) after merging `main` 7090f98.
- Other SQL suites: `activity_audit_people_settings`, `master_data_lifecycle` and the dedicated runners listed in the PR
  were run with the migration. Suites that already fail on `main` fail at the same statement with and without it.

## Production apply (not done yet)

Pre-check (read-only): confirm the 16 `*_all` policies are still the only policies on these tables (plus
`employees_account_creator_read`), and record the salary total and count. Then, in one transaction, apply the migration
and insert the history row `20261027030000 hris_pilot_access`. Read back the policy list, the salary total (must match),
and `employees.gaji_pokok` (all 0). Deploy the app right after, because the old app writes `gaji_pokok` on employee
create and edit, and those writes are refused once the constraint is in place.

Rollback: drop the new policies, re-create the 16 `*_all` policies, drop the constraint, copy salaries back from
`employee_base_salaries`, and redeploy the previous app.
