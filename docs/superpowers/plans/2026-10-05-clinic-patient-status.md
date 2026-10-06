# Patient status in medical history

User authorized continued meeting feedback implementation while Batch 1 releases.

Scope: show a patient-status column on the medical history list using existing inpatient_records linked to each visit. Use the latest admission, matching medical-record detail. Active admission: Rawat inap; discharged: Sudah pulang; discharged RIP: Meninggal. No admission: Rawat jalan for native visits; Status belum tercatat for imported history. Never infer discharge from a terminal condition alone. No database schema or business-data changes.

1. Test status mapping against active, discharged, RIP, imported unknown and multiple-admission cases.
2. Read inpatient relation in the existing checked paginated visit query; derive and display status.
3. Verify tests, TypeScript and production build; release separately after Batch 1 verification.
