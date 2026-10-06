# Inpatient care staff

Scope: user approved the next priorities from the meeting: employee roles/filtering, initial PJ, visit doctor, assisting paramedic and mandatory condition notes. Implements requirements 9,14–16 of docs/superpowers/specs/2026-10-05-clinic-feedback-design.md. Existing user authorization includes staged tested production releases.

Use existing employee jabatan and branch assignments. No new dependency, incentive formula, historical identity guessing, or invoice changes. Doctor visits require a doctor; monitoring does not force paramedics to identify as doctors. Other structured monitoring fields remain optional per meeting spec. One visit doctor and one assisting paramedic per log; multiple visits are separate logs.

Rulings:
- Employee roles come from jabatan, never a person's display name. Recognize existing DR HEWAN alias. Assistants/perawat are not doctors.
- PCA mapping is awaiting user clarification; initially recognize explicit paramedis/perawat/nurse/assistant jobs. Do not infer PCA's clinical role from its acronym.
- Retain original doctor_name on old inpatient records/logs. Bind employee IDs only on new admissions/logs or deliberate conversion of a legacy log.
- Preserve unchanged employee/name snapshots when correcting an old log, including inactive/moved employees. Changed assignments must be valid now.
- Correct all log write paths with a shared database trigger. Correction and audit are atomic, including direct updates; audit failure rolls back the correction.
- Keep pelaksana and existing prescription/compound/status atomic RPCs. No financial allocation is introduced.
- Next.js 15.5.25 has no node_modules/next/dist/docs here; follow current App Router patterns and verify TypeScript/build.

Steps:
- [x] Trace all admission/log/create/edit/list flows and inspect existing job labels read-only.
- [x] RED then GREEN role/parser check; extend existing form server action tests.
- [x] RED invalid doctor-visit acceptance; add employee IDs, snapshot/branch/role guards, full log/audit correction RPC; preserve old retry hashes.
- [x] Shared staff fields for create/correction, role-filtered registration/exam choices, PJ read-only, report/audit display.
- [x] Local browser: required doctor only for doctor visits, staff IDs/draft recovery, discard, and previous compound/draft behavior.
- [x] SQL authenticated-role and edge checks; 1,438 unit tests; TypeScript and targeted lint; fresh whole-branch review. Both review findings fixed with RED/GREEN checks. Final production build passed (existing lint warnings only).
- [x] Access recovered on 6 Oct; compared all five captured production functions without drift and applied exact migration 20261006090000 with migration history in one transaction. Read-only verification passed for five columns, three triggers, authenticated/anon grants and blocked direct audit insertion. Legacy logs remain unclassified.
- [ ] Merge, deploy, then read-only production smoke. PCA remains pending unless user answers; production master currently has zero explicit paramedic jobs.

Release handoff:
- Recheck production definitions of clinic_save_inpatient_log, clinic_save_inpatient_log_with_status, clinic_save_initial_record and set_visit_service_state for drift against the captured definitions before applying the migration.
- Apply only 20261006090000_inpatient_care_staff.sql in a transaction, record migration history, verify grants/triggers/columns read-only, then merge/deploy and smoke test without saving clinical data.
- Local SQL coverage uses a schema adapted from production metadata, fictional rows and authenticated PostgreSQL role. It does not reproduce full production RLS or concurrent transactions. SQL harness needs PGLITE_MODULE, LOCAL_SCHEMA_SQL, LOCAL_COMPOUND_FUNCTIONS and LOCAL_CARE_FUNCTIONS; browser harness uses Playwright/Vite and /usr/bin/chromium. Dependencies and captured schema are temporary local tooling, not runtime additions.
