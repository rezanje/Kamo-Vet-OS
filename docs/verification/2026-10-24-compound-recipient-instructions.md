# Compound recipient instructions

## Finding and scope

Inspected the actual Library image `libfile_cbd0dbeb8fd48191b30a8bb4b0c596df`, materialized into this executor. The screenshot has `2x1`/blank in usage and `habiskan, sebelum makan`/`habiskan, setelah makan` inside a separately saved internal step field. This is mixed historic input, not one mislabeled storage field.

Main editor now says **ISI PETUNJUK PEMAKAIAN**, explains the recipient is the pet owner, and saves only the explicitly confirmed usage to existing `compounding_recipes.dosage_instruction`. The existing internal technical editor and storage remain separate, collapsed, with a review notice. No legacy text is copied, classified or inferred as clinical instructions. The recipient editor uses a new draft scope; restored technical drafts cannot overwrite recipient usage or quantity. Official formula usage remains read-only and protected by the existing database snapshot trigger.

A narrow invoker trigger synchronizes explicit future saves to the exact linked `prescription_items.aturan_pakai`, including unchanged explicit saves that reconcile print. It locks the linked row, writes only if different and fails atomically for a missing/inaccessible link. This creates no prescription/billing lines, backfill, patient record rewrites, formula changes, new role grants, stock movements or payment changes. Existing role/branch policies remain in force. Both editor actions restrict the update itself to pending/ready records.

## Validation

- Reproduced RED: missing recipient editor/action and usage edits not reaching printed prescription before implementation.
- `npm test`: **438 files / 3,234 tests passed**.
- Focused actual page/action tests: **16 passed**, covering legacy mixed text, new blank records, explicit usage mapping/readback, internal separation, official read-only state, status/access failures, and old internal drafts.
- `python3 scripts/test-accurate-inventory-accounting-postgres.py compound_recipient_instructions.sql official_compound_catalog.sql clinic_compound_issue.sql`: **all three passed** after all 249 repository migrations in a disposable PostgreSQL16 container, with fictional auth/storage shims and fixtures. Includes print synchronization, blank/null, same-value saves, orphan rejection, forced failure rollback, branch restriction and official same-value/forbidden edits.
- `npx tsc --noEmit`: passed, including post-build validation.
- Scoped ESLint: no errors; retains existing patient-photo `<img>` warning.
- `npm run build`: passed; existing Supabase Edge runtime and unrelated lint warnings remain.
- `git diff --check`: passed.
- Independent read-only review: no remaining blocker after print-link and independent-draft fixes.

An extra existing SQL suite, `employee_account_operational_context.sql`, fails in its unrelated `sale_items` forbidden-write assertion because the later service-performer guard raises `ACCESS_DENIED`. Reproduced the identical failure on latest main **without this migration**. It was not changed or claimed green.

These are actual server-page rendering, action-boundary and real PostgreSQL tests, not authenticated production UAT. No production patient instructions were edited as a test.

## Release and rollback

Preflight target: 233 migration records, latest `20261024033000`; new function/trigger absent; existing official snapshot protection, column types and restrictive parent policies inspected and compatible. The project lists a completed physical backup at `2026-10-23T15:14:21.325Z`; restore not tested. The CLI's read-only target query failed on pooler connection refusal; supported Management API schema reads succeeded. No denial was bypassed.

Apply only `20261024075120_compound_recipient_instruction_sync.sql` before the application release. Its body creates only the invoker function and trigger, with no clinical DML. Keep its exact version in migration history; do not push other pending migrations. Verify function body, invoker mode, execute revocation, official protection and unchanged policies afterward. Merge only this task's PR; leave PR137 and other work untouched. Production status requires the successful GitHub Production deployment for the exact merge commit.

Rollback: restore the previous app first, then remove this trigger and function if needed. Preserve all clinical, stock and financial records; never reverse explicit patient instruction edits automatically.
