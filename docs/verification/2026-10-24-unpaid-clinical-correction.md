# K01 — completed-unpaid clinical correction

User selected **Koreksi catatan klinis dulu**. This implements only that approved slice; broader K01 (medicine/service changes, compound reissue, paid/posted corrections) remains partial. Parent owns checklist and broad user simulation remains deferred.

## Implementation

- Actual Library screenshot `libfile_e70e7facc9408191aec2f5610c30f372` was materialized and viewed in this executor. The completed/awaiting-payment banner and missing checkout were visible. No screenshot pixels or real patient data were used in fixtures or committed.
- Hasil pemeriksaan has **Edit** when database eligibility succeeds. It reopens the existing `RekamForm` on the same visit with explicit saved medical-record ID, existing clinical values, saved weight/photo/doctor/provider and read-only prescription/compound/followup context.
- Six editable fields: anamnesis, diagnosis, therapy, temperature, clinical signs and supporting-examination text. Patient master, weight, complaint, doctor/provider, attachment paths, prescriptions/services/compounds, followups, stock and ledger remain untouched. Temperature preserves zero, null and source numeric(5,2) precision.
- The new invoker RPC/receipt triggers retain source RLS and active profile/module/operational-branch access. It locks visit then record, checks expected revision, requires completed `Pembayaran`, no checkout and **no invoice history**, and saves against the exact same medical-record row. It never invokes initial submission, service-state transitions or prescription issuance.
- Append-only server-authored actor/time/reason/request/revision/before-after evidence authorizes one exact nested update in the same transaction. Plain submitted UPDATE/DELETE remains rejected. Receipt spoofing, previous receipts and client session flags cannot authorize arbitrary updates. Existing metadata-only activity capture observes the record update without exposing clinical text in general logs.
- Same-key exact replay acknowledges the stored outcome; changed payload conflicts; new edits need the current revision. Drafts are separated by authenticated user, visit, record and revision, separate from initial-exam drafts. Batal clears only that correction draft and returns to the same result.
- Main was refreshed from `07b35b85a7a569c64a3d73b04a6a3190402c821c` to `bcb039e90a78cfb3b42b771f308c51b8e96564d2`, preserving PR138 medicine-filter changes. No PR137 operation was performed.

## Verification

- `npm ci --cache /tmp/kamo-npm-cache` restored incomplete executor dependencies; package/lock files unchanged. The first run's missing decimal.js/jsdom results were environment failures, then resolved.
- `npm test -- --maxWorkers=4`: **440 files / 3253 tests passed**, exit0.
- `npx tsc --noEmit`: PASS, exit0.
- `npm run lint`: PASS, exit0, 12 existing warnings / no errors.
- `npm run build`: PASS, exit0, existing image/unused-variable and Supabase Edge Runtime warnings.
- `git diff --check`: PASS.
- Focused tests verify preserved form values/source IDs, zero/null/two-decimal temperature, distinct draft scopes, reload/back, cancel, repeated save/reopen, failed transport, source-specific errors, paid/read failure/foreign ID guards, photo read-only behavior, correction-only action whitelist and unchanged initial workflows.
- `python3 scripts/test-unpaid-clinical-correction-postgres.py`: PASS in owned PostgreSQL16 `--network none`, no exposed ports or target credentials, removed after testing. **No historical migrations replayed.** It builds a narrow fictional clinical schema, imports the exact old posted guard and current branch helpers from source, and applies only the candidate forward migration. It proves same row/IDs/times, unchanged prescription/compound snapshots, actor/time/image canonicalization, immutable audit, direct writes/deletes, invalid field/precision, retry/conflict, stale revision, module/branch/inactive/anonymous/invoice/checkout/paid denials. Two real connections prove invoice-before-correction and correction-before-correction wait/recheck behavior; losing writes leave no receipt. Operational rollback was tested to freeze entry while retaining clinical values/audit.
- Tests were first observed failing for missing SQL RPC, absent Edit/defaults and absent correction action; corresponding focused tests then passed. The full-suite admission fixture initially lacked the new readiness RPC; its explicit mock was extended and the whole suite rerun green.
- Independent reviewer found no Critical/Important/Minor findings after source precision fixes; independently confirmed invoice/correction concurrency denial. Final added rollback/concurrency harness was also submitted for incremental review.

## Rollout and limits

The executor has no connected Supabase target action/credentials or deployment application tools. **The forward migration has NOT been applied to any external target.** The app fails closed while the readiness RPC is absent; existing saved-result reads remain compatible through `select("*")`. A code deployment alone does not activate this feature. Do not call the feedback live until target rollout and exact-main Production success are verified.

Apply only `supabase/migrations/20261024074043_unpaid_clinical_correction.sql` through the authorized release lane after verifying target identity, backup/current migration history, source column precision/RLS and guard definition/ACL parity. Its preflight aborts if the old submitted-record guard body drifted; do not weaken the check or replay old migrations. No role, existing policy or initial-save grant is broadened. The rollback file is an operational instruction, not an executed target change; it retains medical data and append-only evidence.

SQL verification uses a narrow fixture, not a full deployed Supabase integration. Target migration parity, target RPC/schema-cache readiness, authenticated runtime smoke and Production deployment success remain external rollout evidence. Paid/posted and prescription/compound corrections are intentionally unavailable.
