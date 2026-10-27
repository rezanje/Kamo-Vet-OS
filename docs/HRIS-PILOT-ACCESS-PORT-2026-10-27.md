# HRIS pilot access — port to current main (27 Oct 2026)

Status: **NOT READY TO APPLY.** Branch `claude/hris-pilot-access` (from `main` 0aea097) carries the
four HRIS commits from `codex/grup-barang-accurate-import-24kse3` (PR #245, closed). The app-side guards
pass the test suite, but the database migration was written against the 6 Sep 2026 schema and would break
clinic and cashier flows if applied as it stands.

## Live finding (read-only, 27 Oct 2026 02:40 UTC)

Every HRIS table still has a single `*_all` policy with `using (true) with check (true)` for
`authenticated`: employees (incl. `gaji_pokok`), payrolls, salary components, payroll settings, cash advances,
reimbursements, attendance, leave, overtime, KPI, commission rules, sales targets, shifts, schedules.
Any logged-in account (1 OWNER, 1 ADMIN, 2 FINANCE, 25 DOCTOR, 59 STAFF) can read and write all of it through
the Data API, regardless of what the app screens show. `employees` also has
`employees_account_creator_read` (capability `create_accounts`).

Employees: 126 rows, 87 linked to a profile, only 32 with `branch_id`.

## Why the Sep migration cannot be applied as-is

`20261027030000_hris_pilot_access.sql` (renamed from `20260906181244_...`) replaces those policies with
owner / branch-ADMIN / self only. Code outside `/hris` that runs as STAFF/DOCTOR/FINANCE reads these tables:

| table | non-HRIS readers |
|---|---|
| employees | `lib/dokter.ts`, `lib/service-performers-server.ts`, `lib/penjual.ts`, `lib/tutup-shift.ts`, `lib/komisi-data.ts`, `lib/employee.ts`, `lib/payroll-data.ts`, `api/cari`, klinik jadwal-dokter / pembayaran / rekam-medis, penjualan target / komisi, laporan absensi / penjual, pengaturan pengguna / impor |
| payrolls | keuangan sinkron (FINANCE), laporan gaji |
| employee_salary_components, payroll_settings | `lib/payroll-data.ts`, `lib/payroll-aturan.ts`, pengaturan gaji |
| commission_rules, sales_targets | penjualan komisi / target, laporan promo, `lib/operation-sales-server.ts`, `lib/komisi-data.ts`, pengaturan impor |
| cash_advances | `lib/tutup-shift.ts` (cashier shift close), `/me` |
| work_shifts, employee_schedules | klinik jadwal-dokter, `lib/dokter.ts` |
| attendance, leave, overtime, reimbursements, kpi | `/me`, laporan absensi / kpi, `lib/payroll-data.ts` |

Concrete breakages if applied:
- Doctor and service-performer pickers would show only the user's own row (floating doctors are modelled
  through `employee_branch_assignments`, which the Sep functions ignore; `employees.branch_id` is mostly null).
- Cashier shift close (`tutup-shift`) loses cash-advance reads for STAFF.
- FINANCE loses payroll reads used by accounting sync and the salary report.
- ADMIN sees only the 32 employees with `branch_id`.

## Proposed redesign (to build and verify before any apply)

1. Split the directory from the money: a read-only directory (id, name, role/occupation, branch assignments,
   active flag) stays readable by `authenticated` through a security-invoker view or narrow policy; salary
   columns and the payroll/salary/commission tables become OWNER (+ FINANCE read for payroll/sinkron, to be
   confirmed) only.
2. Branch scope for ADMIN through `employee_branch_assignments` plus `employees.branch_id`, not `branch_id` alone.
3. Self-service (`/me`) keeps own-row read/insert as in the Sep draft.
4. Disposable Postgres test with fictional fixtures for each role (OWNER/ADMIN/FINANCE/DOCTOR/STAFF) covering
   every reader in the table above, then a preflight/readback package like K02's.

## App-side changes already on the branch

- `src/lib/hris-access.ts`, `assertHrisManager` / `assertPayrollOwner` / `bolehKelolaPayroll` in `master-guard.ts`.
- Payroll calculation, correction, approval, and salary components: OWNER only (ADMIN loses access).
- Payroll page shows an "owner only during pilot" notice to non-owners.
- Test mocks updated for the new guard (`named-employee-allowances`, `wholesale-payroll-fence`).
- Full suite: 3668 tests; the only failures after the port were those two mocks, now fixed.
