# HRIS cloud audit and batch 1 handoff — 1 October 2026 (WIB)

## Actual baseline

Repository rezanje/Kamo-Vet-OS, clean checkout `b218041` on `work`; isolated branch `codex/hris-meeting-followup` in `/workspace/hris-meeting-followup`. Original checkout untouched. The planning baseline `949325a` is not an object in this checkout, so ancestry/diff against it cannot be established. Actual HEAD already includes employee Excel import and editable profile/benefits.

Uploaded roadmap is saved as docs/superpowers/plans/2026-10-01-hris-cloud-execution.md. Older approved 2026-08-02 salary design is available. Meeting requirements 2026-09-30, September pilot safety plan/report, and src/lib/hris-access.ts are absent. This limits the meeting-specific audit: the table below maps the supplied roadmap, not unavailable timestamps/video.

Cloud runtime: connected, Node 24.19.0 LTS, Next 15.5.25, ExcelJS 4.4.0, npm ci successful. /etc/codex/network-policy.json reports unrestricted HTTP and no VPN; runtime policy state unknown. NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY configured names have readiness unknown, no verified separate demo DB. Values were not inspected or printed; no database connections/write acceptance tests performed. Source requires those two public Supabase variables. Tests/compile do not establish DB readiness.

Next package has no node_modules/next/dist/docs; official version-15 route documentation fetched successfully. Async searchParams/params conventions retained.

Baseline: npm test 131 files / 1,203 tests pass; npm run build pass; npm run lint exit 0, 12 existing warnings (images and unused _drop). No baseline failures.

## Requirement gaps

| Roadmap requirement | Baseline / decision |
| --- | --- |
| Employee profile/personal/employment/bank | Existing editable profile and raw imported fields; bank info remains in authorized import details. Add attendance/pay history navigation. |
| Weekly/monthly schedule/full shift names/times/libur/colors | Month board exists with initials; add week navigation and full readable shift/time labels, keyboard buttons. |
| Excel schedule round-trip | New bounded template/export/preview with server revalidation and empty-cell-only insert. |
| Per-branch/per-role access | Existing policies are often broad. New schedule flow restricts roles and user_branches; profile requires positive current primary assignment and access to all returned assigned branches; staff salary hidden on list, payroll/slip/components pages guarded. DB RLS is a release blocker, not claimed fixed. |
| Overnight/duplicate/stale/month-boundary attendance | Needs adjustment: clockOut only updates today's Jakarta date, time fields alone. Batch 2. |
| Authorized corrections with actor/reason/history | Existing manual attendance upsert has no complete correction trail. Batch 2. |
| Schedule change / two-person atomic swaps | New workflow, not present in staff request flow. Batch 2; needs transactional DB design. |
| Effective schedule/lateness | Payroll already consumes employee_schedules, but approved schedule changes absent. Batch 2. |
| Configurable location/radius | Existing lokasi helper and branch coordinates; live acceptance unverified; missing-coordinate behavior permits existing attendance. Batch 2 audit. |
| Daily/monthly recap/export | Existing daily UI and laporan-hris aggregation; daily default hardcoded July date, overnight/session detail and consistency flags need adjustment. Batch 2. |
| Grouped salary / fixed per-employee / variable period | Existing salary_components overrides and manual payroll adjustments; grouped configuration/detail needs adjustment. Batch 3. |
| Effective rates/history | Stored payroll final lock exists; effective-date configuration needs design. Batch 3. |
| Doctor sitting fee/overtime/late policy | Confirm basis, categories, partial hours, groups, rate/cap boundaries. No financial formulas changed. |
| Kasbon monthly limit/full repayment | Existing tenor/installment policy; preserve debts; effective date/applicability unconfirmed. Batch 3 gated. |
| Reimbursement repeat settlement / source lines | paid_periode and installment uniqueness exist; finalization comprises multiple independent writes with unchecked errors, so atomicity/live idempotence unverified. Batch 3 gated. |
| Commissions eligibility/recipient/scope | Existing omzet/laba/item/category/target/date rules and paid/refund source handling; group eligibility/multiple recipients require supplied catalog. Batch 4 gated. |
| Commission source detail/payroll mapping | Existing commission → payroll helper; itemized payroll sources need adjustment. Batch 4. |
| Franchise/clinic cost split | Deferred separate accounting design and reconciliation. |
| Continuous tracking / quest / statutory parity | Explicitly deferred/outside scope. |

## Data path and callers

Employee: employees + employee_branch_assignments → jadwal page/server scope → employee_schedules + work_shifts. Staff /me and /me/actions.ts query attendance via own profile_id mapping. Payroll-data.ts consumes active employees, schedules, attendance, approved leave/overtime, salary components, kasbon installments, unpaid reimbursements; hitungGaji is pure, called only through kumpulkanDataGaji. That collector is called by hitungPenggajian, simpanKoreksi, sahkanPenggajian. Finalization writes installments/reimbursements, postJournal/jurnalPenggajian, then final status. It is not transactional and was left untouched.

Komisi-data.ts collects sale/clinical invoice/online invoice plus returns and commission_rules → hitungKomisi → komisiPeriode. Callers are penjualan/komisi/page.tsx and payroll-data.ts. Reports use laporan-hris.ts; shift formatting is shared by hris/shift, hris/jadwal and klinik/jadwal-dokter. Existing helpers preserved.

## Decisions and operational limits

- Execute only batches 0–1 from the first cloud task; later financial rules and meeting-specific details remain pending.
- Use uploaded batch-1 requirements as implementation authority because meeting spec is unavailable; no meeting payroll examples become policy.
- OWNER has global access; other roles require current explicit user_branches. ADMIN no longer gets global access in new schedule/profile flow. Unassigned admins need assignments.
- Schedule employees require positive current employee_branch_assignments, because RLS-hidden assignments cannot prove absence; legacy primary assignments are seeded by existing migration. Employees whose assignment starts within the period are included; the board and server reject dates before their effective assignment. No assignment fallback that could bypass RLS.
- Excel inserts empty cells, skips identical rows, rejects changed existing cells. Concurrent uniqueness conflict aborts the single insert rather than overwriting. Replacements use existing board.
- Profile history is 100 latest attendance rows / 24 payroll periods, showing stored totals/status without recalculation. Imported bank fields retain admin/owner-only profile access.
- Staff salary hidden on employee list and salary pages have server role gates. Existing schema contains broad authenticated policies for schedules, attendance, payrolls, employees, salary components; page gates do not replace RLS. Separate demo RLS tests and hardening are required before production release. Multi-branch profile admins need all assigned branches; future-only/hidden assignments fail closed before salary/bank/history reads. Existing master/financial actions outside new schedule flow are not fully branch-hardened by this batch.

## Unverified acceptance and release

No authenticated browser or separate demo DB is available: fictional HR editing, export/reimport against persisted DB, staff/own-branch/other-branch/owner RLS tests are unverified. Action tests use a mocked internal scope wrapper plus actual validators; profile render tests mock access resolution. Separate scope-server tests exercise actual aksesCabangHRIS/scopeJadwal against an external DB/auth fake. None substitutes for live RLS tests. No production migrations, deployment, real payroll calculation/finalization or payment performed. This branch is for review, not a production-readiness claim.

## Final review and verification

Fresh independent reviewer requested four Important fixes: period-start assignment filtering, export/import row-limit mismatch, profile assignment proof, inactive-shift round-trip. All four received failing regressions followed by passing tests. Added persisted-schedule pagination after a regression reproduced Supabase's 1,000-row default truncation.

Final limits: 10,000 schedule rows / 900 KB .xlsx, consistent parser/validator/export; JSON action bounded to 3 MB within the existing 32 MB server-action configuration. Export refuses unsupported sizes instead of producing an unimportable file. Stored schedules are paginated; inactive shifts retain readable labels and exact existing imports are skipped, while new inactive-shift assignments are rejected.

Deferred minor: blank Excel template has employee/shift references but no selected-branch reference sheet. For a new template, branch_id must be filled from the selected cabang URL value (or use an exported existing row). This is a usability gap; scope validation still prevents forged branches.

Rulings made during implementation (and cost if wrong):
- Batches 0–1 only per first cloud task; later batches remain pending.
- Uploaded roadmap supplies batch-1 requirements without the unavailable meeting spec; meeting details may require follow-up.
- Empty-cell insert / identical skip / reject replacement is the Excel contract; bulk replacements require manual board editing.
- ADMIN access in new flow requires user_branches instead of globally permissive legacy helper; unassigned admins need explicit assignments.
- Schedule membership requires positive employee assignments; legacy employees without seeded assignments need repair before scheduling.
- Add salary page role gates and hide staff salary on list; staff own salary stays in own dashboard, DB policies still require separate hardening.
- Profile ADMIN needs positive current primary assignment and all returned assigned branches accessible/current; multi-branch/future-assigned employees may require owner inspection or broader authorized assignments. RLS visibility cannot establish completeness on a differently configured database; live acceptance is required.
- Increase invented 500-row cap coherently to 10,000 and paginate persisted rows; larger exports must use smaller periods, preview can contain more rows.

Verified commands: npm test → 136 files / 1,240 tests passed; npx tsc --noEmit → no errors; npm run lint → zero errors, same 12 baseline warnings. npm run build → successful production build. No tests failed in final suite. No production release performed.
