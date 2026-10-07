# Meeting partials completion — 7 October 2026

## Scope

Complete BUG04 unit selection, BUG05 failed-save work preservation, BUG06 report downloads, REQ2 official formula configuration, REQ3 compound report reconciliation and MEET06 native employee occupations. BUG07 originally requests an asset purchase menu; existing asset purchase/cash-bank flows satisfy that scope. No direct-invoice asset extension is implied.

Transaction drafts cover purchasing, sales, assets, payments, journals, reconciliation, inventory, shifts and clinic workflows. They isolate authenticated users/documents, retain controlled rows and validated attachment references, exclude signature/file bytes and clear exact acknowledged submissions. Keyed new SQL transactions support exact replay; existing unkeyed multiple-write operations require inspecting uncertain outcomes before manual resubmission. No automatic posting/replay is added.

Online sales, source-linked purchase/POS returns, transfers/request receipts and purchase invoice/payment-order settlements use checked atomic RPCs. Official unit snapshots, base FIFO amounts, source ceilings, cost variance, branch access and identity checks are enforced. Source mutation/reparenting is protected. Broader legacy raw POS/journal/stock posting permissions are existing architecture limits, not newly solved by this release.

All report downloads provide CSV, Excel and native print-to-PDF. Item reports export every filtered row instead of the displayed page. Source/ingredient reads remain paginated and exact-count checked without a 5,000-row cutoff. Unknown historical costs stay unknown and receive reconciliation context.

## Verification

Independent posting and draft/report reviews found defects that were corrected and reviewed again. Application suite: 192 files / 1,623 tests passed, TypeScript and ESLint passed. The production build passed. Final release checks are recorded in the pull request.

Disposable PostgreSQL 16 applies 185 repository migrations with test-only auth/storage shims and pre-0068 fictional COA fixtures. Actual production helper definitions are injected before new migrations for additional verification. Suites cover source forgery/reparenting, exact replay, real FIFO journals, tiny partial-HPP allocation, rollback and independent-session concurrency. This validates the application schema/runtime, not clean Supabase provisioning.

## Cutover

Production preflight found no transfer/receipt/movement activity in the preceding ten minutes and no active stock queries. Install the reviewed legacy FIFO gate first, preserving deployed function body/owner/ACL/invoker behavior; allow old in-flight actions to drain while old request lifecycle remains available. Then apply the four remaining exact migrations together, with migration history and lock/time limits. Old direct transfer/receipt stock-outs fail before stock effects; new atomic definer RPCs remain available. Old forms temporarily fail safely until the new application deployment. Do not restore broad policies or disable source guards.

Only schema/routine/permission/history changes are authorized during this cutover. No business fixtures, historical cost guesses, formula seeds or HR assignments are written.

## Company data still required

Production preflight found four historical negative stock rows, two inventory sale rows without HPP, no sales lacking original revenue journals, and no duplicate source-SKU ambiguity. These facts do not supply the missing costs or justify historical correction. One existing test formula is inactive; real company formulas and selling-item associations remain to be provided/configured by OWNER/ADMIN.

Native Dokter/Paramedis/Groomer occupation choices are available independently from login roles. Actual paramedic/branch assignments require real employee data. PCA is not defined in the meeting. Incentive allocation, admin fees and inpatient consent templates remain pending company decisions/templates; GPS/WA reminder scope stays deferred as recorded in the meeting.
