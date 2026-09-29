# VetOS Clinic Inventory and HPP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make clinic medicine and compound stock issues, invoice HPP, and accounting coherent, with no negative stock or duplicate cost postings.

**Architecture:** Two authenticated Postgres posting boundaries preserve existing business timing: compound ingredients at recipe creation, ordinary medicine at checkout. The second boundary consumes stock for ordinary medicines, attaches stored compound costs without reissuing ingredients, and commits invoice and journals together. CREATE for individual and group checkout now use the invoice boundary. Compound invoice edits/voids fail closed pending historical reversal; ordinary medicine invoice edit still uses its legacy path. The real two-session race and complete invoice lifecycle remain release gates.

**Tech Stack:** Next.js 15, TypeScript, Supabase Postgres RPC/PLpgSQL, Vitest, pgTAP or local SQL transaction assertions.

**Spec:** `docs/superpowers/specs/2026-09-24-vetos-open-items-design.md`

## Global Constraints

- Review branch only; no production data changes, backfill, merge, or deployment.
- No service-role bypass for branch authorization; execute RPCs as the authenticated caller and check `user_can_access_branch`.
- No importing the divergent stabilization branches; no change in doctor HPP visibility.
- Compound stock is issued at recipe save and must never be issued again at invoice creation.
- `postJournal` is best-effort; it is not an acceptable posting step inside the atomic boundary.

## Review Focus

1. Two concurrent checkouts of the last unit: only one succeeds, no negative stock.
2. A compound with two ingredients where the second has insufficient stock: neither ingredient moves and no partial recipe persists.
3. A repeated save of the same recipe or invoice: at most one stock issue and one HPP posting.
4. A compound invoice line with a duplicate name in the same visit: explicit recipe identity is required; name matching cannot pick the wrong cost.
5. A journal account that is missing, inactive, or a header: transaction fails without leaving stock or invoice changes.

---

## Files and responsibilities

- `supabase/migrations/20260924124000_clinic_compound_issue.sql`: immutable issue rows; authenticated compound issue RPC; recipe void restore by historical cost.
- `supabase/migrations/20260924125000_clinic_invoice_post.sql`: atomic clinic invoice CREATE; row locks, branch checks, stock-layer consumption, invoice lines, balanced revenue/HPP journals, idempotency.
- `supabase/tests/clinic_compound_issue.sql`, `supabase/tests/clinic_invoice_post.sql`: rollback-scoped SQL integration assertions, including concurrent-session procedure documented beside tests.
- `src/lib/klinik-posting.ts`: typed RPC inputs/results and guarded error mapping; no separate stock mathematics.
- `src/app/(app)/klinik/rekam-medis/[visitId]/actions.ts`, `src/app/(app)/klinik/racik/actions.ts`, `src/app/(app)/klinik/rawat-inap/actions.ts`: call compound boundary; remove app-level ingredient stock issue from every recipe-creation route.
- `src/app/(app)/klinik/pembayaran/[visitId]/actions.ts`: call invoice boundary on individual/group CREATE; preserve pricing, shift, consent, voucher, and points checks around the atomic core; block compounded edit/void paths until historical reversal exists.
- `src/lib/__tests__/klinik-posting.test.ts`: pure mapping and action-contract regression tests; SQL tests provide transaction proof.

### Task 1: Pin the schema and posting contract

**Files:** Create `src/lib/klinik-posting.ts`, `src/lib/__tests__/klinik-posting.test.ts`; review schema in `supabase/migrations/0008_klinik_pembayaran.sql`, `0029_compounding.sql`, `0044_racikan_bom.sql`, `0058_stock_layers_fifo.sql`, `0084_klinik_stok_hpp.sql`, `src/lib/posting.ts`.

**Interfaces:** Produce `ClinicPostingLine`, `ClinicCompoundIssue`, `parseClinicPostingError(error: {code?:string;message:string}|null): string` and typed inputs for the two RPCs; no client-supplied `hpp` or `factor` accepted.

- [x] Write a failing Vitest case asserting `parseClinicPostingError({code:'P0001',message:'STOCK_SHORT: Obat A'})` returns an actionable stock shortage message; add cases for missing warehouse, invalid account, and unknown errors. The production change that must break the test is deleting each error-code branch.
- [x] Run the focused test red, implement the typed parser/RPC request types, then run the focused and full Vitest suites green. Unknown errors do not expose internal SQL details.
- [x] Contract and error parser are already in `main` through PR #5 (`58d9e6f`); the current review branch does not duplicate that change.

### Task 2: Compound issue and historical-cost restore

**Files:** Create `supabase/migrations/20260924124000_clinic_compound_issue.sql`, `supabase/tests/clinic_compound_issue.sql`; modify `src/app/(app)/klinik/rekam-medis/[visitId]/actions.ts`, `src/app/(app)/klinik/racik/actions.ts`, `src/app/(app)/klinik/rawat-inap/actions.ts`, and the recipe-cart forms that supply stable request keys.

**Interfaces:** Produce RPC `clinic_issue_compound(p_medical_record_id uuid,p_visit_id uuid,p_recipe jsonb,p_request_key text) returns uuid` and `clinic_void_compound(p_recipe_id uuid) returns void`. Create `compound_issues(recipe_id,ingredient_id,warehouse_id,item_id,qty,unit_cost,stock_layer_id,posted_invoice_item_id)` with unique issue identity and FK constraints; expose actual consumed costs to Task 3.

- [x] Write rollback-scoped SQL tests for shortage on ingredient 2, insufficient layer quantity with positive stock balance, missing warehouse, zero-cost layers, wrong-branch user, duplicate request key, one successful multibatch issue, void at original costs, and sequential last-unit protection; document the true two-session race procedure. Every failure case asserts `stock`, `stock_layers`, `stock_moves`, recipes, ingredients, and issues remain unchanged.
- [x] Run the SQL test against selected migrations in isolated PGlite/PostgreSQL 18.3; record that this is not the full Supabase migration runner.
- [x] Implement narrowly granted `security definer` RPCs with fixed empty `search_path`; require `auth.uid()`, authenticated-only execution, and explicit branch access. Resolve `medical_records.visit_id` on server and reject mismatched visit IDs. Lock stock rows and layer rows in deterministic item order, apply FEFO ordering with FIFO fallback, reject shortages/zero-cost/missing warehouse, record exact layer take and cost, insert stock moves, and commit through the RPC transaction. Keep `compound_issues` inaccessible directly to `anon`, `authenticated`, and `service_role`.
- [x] Replace all three recipe-creation routes with the RPC, route recipe void through historical-cost restoration, run SQL and Vitest. Commit `fix: issue compound ingredients atomically at historical cost`.
- [ ] Release gate: run the documented true two-session last-unit race on local PostgreSQL; it was not available in this environment.

### Task 3: Atomic invoice and one-time HPP

**Files:** Create `supabase/migrations/20260924125000_clinic_invoice_post.sql`, `supabase/tests/clinic_invoice_post.sql`; modify `src/app/(app)/klinik/pembayaran/[visitId]/actions.ts` and `src/lib/klinik-posting.ts`.

**Interfaces:** Produce RPC `clinic_post_invoice(p_visit_id uuid,p_request_key text,p_invoice jsonb,p_lines jsonb) returns uuid`. Input lines include an explicit `recipe_id` for compounds and item/unit identity for medicines. Server resolves warehouse, account IDs, existing recipe issues, and stock costs; it never trusts submitted costs or branch ID.

- [x] Write SQL assertions for ordinary medicine with FIFO layers and selected unit, shortage, zero-cost, missing warehouse/account, mixed service/free-text, compound cost attachment without second issue, duplicate recipe names, idempotency, revenue/HPP balancing, and failure rollback. Assert exact invoice-line HPP and one `5101` debit / `1301` credit pair. The true concurrent last-unit case is documented but remains pending.
- [x] Run the SQL assertions against selected migrations in isolated PGlite/PostgreSQL 18.3. This does not substitute for local Supabase/Postgres or a two-session race.
- [x] Implement `clinic_post_invoice` as an authenticated `security definer` RPC with fixed empty `search_path`, visit and branch checks, deterministic stock/layer locks, server-resolved units/costs/accounts, invoice and line insertion, explicit historical compound-cost attachment, balanced journals, request idempotency, and transaction rollback on any failure.
- [x] Replace individual CREATE and grouped CREATE paths with this RPC. Keep pricing and points/receipt side effects around the atomic core; neither CREATE path runs `potongStokObat`/`postJournal` after the RPC. `npm test` (126 files / 1174 tests), lint (0 errors; 12 existing warnings), TypeScript, and build passed.
- [ ] Run the documented real two-session checkout race on local PostgreSQL. Ordinary edit and complete void/reissue remain in the legacy lifecycle task below; compound invoice edits and voids currently fail closed.

### Task 4: Historical lifecycle and release gate

**Files:** Extend `supabase/migrations/20260924125000_clinic_invoice_post.sql`, `supabase/tests/clinic_invoice_post.sql`; modify `src/app/(app)/klinik/pembayaran/[visitId]/actions.ts`, `src/app/(app)/klinik/racik/actions.ts` and `src/lib/__tests__/klinik-posting.test.ts`.

**Interfaces:** Produce `clinic_edit_invoice(p_invoice_id uuid,p_request_key text,p_invoice jsonb,p_lines jsonb)` and `clinic_void_reissue_invoice(p_invoice_id uuid,p_request_key text)` with exact historical cost reversal; preserve public server-action signatures for UI forms.

- [ ] Write failing SQL tests for editing DP/unpaid invoice medicine quantity, void/reissue of paid invoice without a second issue, already-partially-paid invoice, compound recipe void before invoice, compound void after invoice (reject or reverse linked cost once according to accounting state), duplicate lifecycle requests, and wrong-branch access. Assert exact stock and journal balancing and no historical `buy_price` substitution.
- [ ] Run focused SQL tests; expected: lifecycle behavior failures.
- [ ] Move edit/void/reissue inventory and accounting operations into authenticated RPC boundaries. Remove app-level `kembalikanStokObat` and journal reversal calls only when their SQL equivalents pass tests. Reject unsupported lifecycle combinations before mutation with an actionable error.
- [ ] Run `supabase test db` against isolated local DB, `npm test`, `npm run lint`, and `npm run build`; expected: zero failures. Record any missing test infrastructure as a release blocker, not a pass. Commit `fix: reconcile clinic invoice lifecycle without duplicate HPP`.

## Completion gate

Check the diff against the spec and all five Review Focus inputs. Do not call this release-ready without an isolated Postgres integration run and proof that invoice/compound lifecycle RPCs pass under the authenticated role. Make a reviewable branch/PR if GitHub write credentials are available; never merge, deploy, run production migrations, or alter the spreadsheet.
