# K01 — paid clinical addendum, review scope

This change adds a separate, append-only note for a paid visit's submitted medical record. It does **not** reopen the original examination form or change the existing medical record, prescription, invoice, payment, inventory, or journal. It therefore closes the safe clinical annotation portion of the paid case, not the checklist's complete paid Edit workflow or later financial/racikan correction.

## Behavior and evidence

- A user with the existing active clinic profile and operational visit access can add text and a required reason after an active invoice is `Lunas` with `paid_at` set. The form uses a stable retry key. A repeated identical request returns the same addendum; reuse with different content fails.
- The database captures the original submitted record JSON, visit, active paid invoice and payment time, actor and server timestamp. A trigger replaces forged evidence on a direct insert. The addendum row cannot be updated, deleted or truncated. The original record and posted transaction tables are never written by the new RPC.
- The result page and printable record list the separate addenda with actor, time and reason. A prior addendum remains visible when its paid invoice is later voided; no new addendum can then be written. A failed history read blocks printing rather than silently omitting the audit.
- Local PostgreSQL 16 fixture `python3 scripts/test-paid-clinical-addenda-postgres.py` checks idempotency, forged evidence, immutable sources and unpaid/voided/foreign-branch/anonymous guards. The fixture creates and removes its own Docker database; no live database was touched.

## Security migration awaiting approval

`20261026103000_paid_clinical_addenda.sql` creates one new RLS-protected table, its read/insert policies, two authenticated invoker RPCs (`clinic_can_add_paid_addendum`, `clinic_add_paid_record_addendum`), and audit/immutability triggers. It grants authenticated users **SELECT and INSERT only** on the new table and EXECUTE on the two RPCs. It makes **no** grants, RLS changes, or writes to existing patient, clinical, financial or stock tables. The actor gate reuses `clinic_record_correction_actor` from `20261024074043_unpaid_clinical_correction.sql`; apply that migration before this one if the target lacks it. The UI requires the new table and RPC, so database approval/application must precede application deployment. Neither migration was applied by this worker.

## Remaining checklist gap

The source checklist asks paid `Edit` to reopen the **same initial medical form** with existing diagnosis/therapy populated, without another visit or medical record. This addendum leaves the original clinical facts immutable and does not present itself as that Edit action. Paid racikan/item correction and any invoice, stock or payment reconciliation also remain open. Implementing those needs a separate, explicitly reviewed posted-transaction workflow. Field UAT remains pending by instruction.
