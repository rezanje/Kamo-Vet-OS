# Employee Excel Import

Source: user-supplied blank `Format Data Karyawan.xlsx`, sheet `Data Karyawan`, 43 columns, two header rows. The workbook is a data template, not a source of instructions.

## Scope

- OWNER/ADMIN uploads `.xlsx` through HRIS → Karyawan → Unggah Excel.
- The two-row matrix is parsed on the server. Required: Nama and ID Karyawan. Optional core mapping: Jabatan, Telp, Email, Tanggal Bergabung, Status Kerja. Every nonempty substantive matrix column is retained as a label/value pair in an admin-only detail record. `No` is ignored as a spreadsheet row number.
- An optional branch selection applies to the whole file. A mixed-branch file must be split or imported without a branch, then assigned later. `Organisasi` is not guessed to be a branch or department.
- Login ESS columns are retained as reference only. Import never creates accounts, passwords, or roles.
- Template contains no base salary. Imported employees get the existing database default of zero; payroll values must be configured separately before processing.

## Safety

- Maximum 500 data rows, 900 KB uploaded workbook, and 900 KB serialized payload.
- Invalid format, duplicate IDs within the file, malformed dates, unsupported statuses, lost-leading-zero numeric identifiers, and malformed email stop the entire upload before database writes.
- Existing IDs are skipped, never overwritten. The database import, private detail storage, and primary branch assignment run in one transaction.
- Private matrix detail rows use RLS and grants limited to authenticated OWNER/ADMIN. A second role check in the database function protects direct calls.
- Server reports counts and row numbers, never confidential cell contents, in result URLs.

## Release gate

Apply the migration before deploying the app. Verify OWNER/ADMIN import, duplicate rerun, bad-row rollback, STAFF denial, and private-detail visibility in a non-production environment. Do not upload the user's blank template as employee data. Before production rollout, remove public test credentials and rotate those credentials; the current public login page discloses them while indicating that data is real. No production migration, deployment, account change, or employee-data upload occurred in this implementation worktree.
