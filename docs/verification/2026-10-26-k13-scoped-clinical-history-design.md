# K13 — proposed scoped cross-branch clinical history read

Status: design for security review only. No migration, RPC grant, RLS change, deployment, or production data read is included here.

## Verified gap

The K13 checklist requires a patient already seen at branch A to have that clinical history visible during a visit at branch B, with visit date and origin branch, without linking a different animal that shares a name. `src/lib/patient-clinical-history-server.ts` anchors the visit to the authenticated operational client, requires the expected `pet_id`, and reads visits, records and prescriptions with a second cookie session. The latter still uses normal table RLS. `visits_select` in `20260908133000_fix_medical_import_owner_match.sql` is branch scoped for ordinary visits; `mr_select` follows those visible visits; `pi_all` in `0006_rekam_medis.sql` follows the same branch. Thus a correctly linked pet UUID can still yield only the operational branch. The existing read-only UI and branch name are necessary but insufficient.

## Proposed boundary for approval

Introduce one read-only, server-called RPC returning a narrow clinical projection for **one** patient UUID resolved from an anchor visit visible in the caller's operational branch. The caller passes the anchor visit UUID, not an arbitrary patient, owner name, phone number, or target branch. In one database transaction the RPC must:

1. Require `auth.uid()` and an active profile with current `klinik` module access (using the current `role_modules` override/default semantics). Require that the anchor visit is readable with the existing `user_can_access_branch(anchor.branch_id)` check. Confirm the anchor has a non-null `pet_id` and customer identity.
2. Resolve the patient by the exact `pet_id` from that anchor. Return only visits tied to that same UUID; validate the owner/patient mapping before any legacy/imported row is linked. A matching animal name alone must never authorize a row. Keep uncertain identity mappings unavailable until resolved.
3. Return only visit ID/date/origin branch and the clinical fields already shown in `RiwayatTabs` (record ID, anamnesis, diagnosis, therapy, prescription summary). Exclude invoice, payment, stock, customer contacts, other patients, and all write capability. Distinguish an empty verified history from a query/authorization failure.
4. If a privileged inner reader is needed to bypass branch RLS for the narrow projection, keep it in a non-exposed schema, set a fixed `search_path`, revoke all default `PUBLIC`/`anon`/`service_role` execution, and expose only the checked wrapper to authenticated callers. No general cross-branch `visits`/`medical_records`/`prescription_items` SELECT policy or `all_branches` grant. Document and review every returned column and the exact source predicate.
5. Preserve stable visit IDs and chronology; no copy/import/upsert of historical visits. Show origin branch and date in the existing read-only clinical tab. The operational finance, inpatient and compound tabs remain bound to the operational branch and original RLS.

The exact eligible roles and legacy identity exceptions require product/security approval; the proposal uses the existing clinic module and active-profile model and does not silently introduce a new production permission. A security reviewer must approve the narrow cross-branch disclosure before an implementation migration is applied.

## Required fixture before release

Use PostgreSQL with two branches, two patients with the **same name** but different UUIDs, and an authorized active clinic user attached only to branch B. Assert: B's anchored patient can see A+B clinical visits with correct branch/date; same-name other patient is excluded; arbitrary A visit/pet argument is denied; disabled profile, missing clinic module and anon are denied; invoice/stock and other operational records remain inaccessible; attempts to write through the RPC fail; pagination returns complete stable history without duplicates. Run application tests, typecheck, lint and build after wiring UI. Perform field UAT later with a verified same-patient cross-branch case.
