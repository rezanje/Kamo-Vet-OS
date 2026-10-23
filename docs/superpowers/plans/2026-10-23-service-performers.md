# Service performers implementation plan

> **For agentic workers:** Use executing-plans task-by-task. User explicitly opted for autonomous implementation; routine design approval is not requested again.

**Goal:** S01–S04 store and show independent service-row performers, separate from the logged-in cashier/PIC, without rewriting historical attribution.

**Architecture:** Nullable `service_performers` JSON snapshots on sale/prescription/invoice lines; database validates active branch-assigned doctor/non-doctor IDs and derives names. Existing atomic clinical RPC inserts carry the metadata; posted metadata is immutable. No new grants or business rates. UI supports independent repeated services and bulk fill only empty rows; row overrides survive.

**Tech stack:** Existing Next/React, Supabase/PostgreSQL, Vitest and disposable local PostgreSQL harness.

**Spec:** Canonical Sheet S01–S04, expanded22 October: services only; max one doctor and one non-doctor per row, one optional, visit doctors independent; bulk fill then row override, never silently replace deliberate overrides. Cashier derives from login. Receipts and incentive evidence use saved source rows. Existing PIC and DEMO pool policies stay separate. No old backfill.

## Constraints and unresolved calculation

No main merge, target migration/deployment/reset or role/auth changes. Parent owns release. New header cashier snapshots derive from server identity. Legacy null line metadata is shown honestly, not reconstructed. Unassigned service performer remains visible, not fabricated from cashier/PIC. Product/non-service rows retain existing behavior. General commission treatment when both roles are present is a pending user question; do not implement a guessed split or multiply global commission. Storage/UI/receipt work is independent.

## Tasks and interfaces

- [x] Add failing pure/React tests for two role slots, exact employee IDs, service-only row controls, repeated rows, bulk preservation and legacy display. Create `src/lib/service-performers.ts` (`ServicePerformersInput`, `ServiceStaff`, `emptyServicePerformers`, `bulkFillServicePerformers`, `servicePerformerNames`) and `src/components/ServicePerformersField.tsx` (value/staff/onChange/label). Reuse `clinicalRoles`.
- [x] Add server helper `src/lib/service-performers-server.ts`: `loadServiceStaff(client,branchId)` checked active/effective branch choices, `loggedInCashier(client,userId,branchId)` server account mapping/name. Add local SQL RED tests for branch/role/spoofing, snapshot immutability, inheritance/reissue, rollback and existing RPC idempotency.
- [x] Add one reviewed migration with nullable snapshots and guard triggers. Patch existing clinical RPC definitions by exact counted anchors, failing on schema drift. Preserve function signatures/ACL/stock/accounting and include metadata in existing request hashes. Add actor snapshot columns to existing headers, no historical backfill. Test only disposable local DB, never target.
- [x] POS cashier/backoffice: independent keys for repeated service lines, per-row fields and fill-empty bulk controls, server-authoritative types/cashier, metadata in save and checkout fingerprint/draft; no compulsory performer for physical products. Verify separate duplicates and retries.
- [x] Clinical examination/inpatient/payment: carry explicit row metadata through existing atomic save/post paths; distinguish PIC from per-row performer; existing medical log doctor/paramedic remains preserved. No posted-edit right expansion or DEMO allocation change. Add receipt/invoice persisted-only presentation.
- [x] Incentive evidence: source line IDs and saved performers, not header fallback for newly attributed service lines; returns use explicit source_line_id. General two-person payout calculation waits for the precise business answer. Do not duplicate branch revenue to represent two employees. Verify legacy calculation behavior remains intact.
- [x] Independent review, focused regressions, scoped lint, build once stable, post-build tsc. Document code-complete vs partial S04/pending decision and migration/rollback. Normal push ready PR, no merge.

## Review focus

Forged names/roles/branch IDs must not persist; inactive/future assignments excluded. Duplicate services retain separate stable IDs and override values through draft/retry. Posted/corrected/reissued source attribution cannot be silently replaced by current staff. Failures roll metadata back with transaction; no extra post-payment write. A service with two performers is one revenue row and cannot double the same employee's incentive. Full user simulations remain deferred.
