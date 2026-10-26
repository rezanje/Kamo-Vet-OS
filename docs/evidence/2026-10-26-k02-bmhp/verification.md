# K02 BMHP tindakan — verification & owner apply runbook

Approved semantics (Founder, 26 Oct 2026 09:25): BMHP is recorded as actual usage on the clinical procedure row; stock is issued once when the clinic invoice posts (existing FIFO / moving-average path); its cost becomes that procedure line's HPP (existing `klinik-hpp` 5101/1301 journal); void/reissue/edit reverse it through the existing correction paths. Selling price, revenue lines, commission rules, roles and grants are unchanged.

## Files
- `supabase/migrations/20261026100000_k02_procedure_bmhp.sql` (sha256 `513f9c0937fa74a91e5c84a6bbfcc1fd7763d00686120277e599bd8c5aad9cbd`)
- `supabase/tests/clinic_procedure_bmhp.sql` (sha256 `638147821d45eb934b6cc851ff6721ac6e944fa5c23997f3ba3f2c459cbd5582`; was `bca94d31…690e` before the 26 Oct direct-void/delete assertions were added)
- `scripts/test-procedure-bmhp-postgres.py` — official disposable runner (Docker `postgres:16`, same bootstrap as `test-compound-catalog-postgres.py`; never accepts a DB URL).

## What the migration does (additive)
- Nullable `bmhp_components jsonb` on `prescription_items` and `invoice_items`.
- `clinic_bmhp_supported()` capability probe (authenticated only), so the app sends BMHP only after the migration; before it, saves keep the previous payload and BMHP entry is refused with a clear message.
- Row guards: BMHP only on `jenis='jasa'` rows bound to a `Jasa` master item; components must be active `Persediaan` items with a known unit; names/factors come from master data, never from the client; saved BMHP is immutable; invoice snapshots can be written only by posting/correction RPCs.
- Private helpers in `clinic_private` (no grants): `bmhp_issue` (existing `stock_out_fifo`, source `klinik-bmhp`, stock check, cost-missing guard) and `bmhp_edit_plan` (kept rows retain BMHP/HPP; removed rows return stock at historical cost via `stock_in_fifo` 'klinik-edit'; a BMHP procedure cannot be re-added through correction).
- Exact-anchor patches (fail on drift, signatures/ACL unchanged) to `clinic_save_initial_record`, `clinic_save_inpatient_log`, `clinic_post_invoice` (lock order includes BMHP items; HPP on the procedure line), `clinic_void_reissue_invoice_core` (copies snapshot; stock not moved, same as medicines), `clinic_edit_invoice_core`, `clinic_refund_source_core` (BMHP invoices fail closed to manual reconciliation, same as compounds).

## Evidence (isolated PGlite PostgreSQL 18.6, all 267 repository migrations, fictional data, rolled back)
- `sql-red.log`: the K02 test fails on main without the migration.
- `sql-final.log`: K02 test passes (FIFO and moving average); existing clinic SQL suites `clinic_invoice_post`, `clinic_billing_lifecycle`, `clinic_compound_issue`, `clinic_manual_invoice_units`, `clinic_inpatient_action_category`, `official_compound_catalog`, `compound_catalog_sku_binding` pass unchanged.
- `sql-mutation.log`: removing the HPP assignment makes the K02 test fail.
- Limitation: PGlite is PostgreSQL 18 in WASM, not the Supabase PostgreSQL 15/16 runtime. Run `python3 scripts/test-procedure-bmhp-postgres.py` (Docker) before apply.

## App scope
- Rekam medis and rawat inap carts: optional `BMHP dipakai` picker on procedure (`Jasa`) rows, sourced from the same active stock items list; only `{item_id, qty, unit}` is sent, and only when `clinic_bmhp_supported()` is true (otherwise the save is refused with a clear message and the previous payload is unchanged).
- Clinic cashier screen and printed invoice are unchanged in this candidate (BMHP is not a billable line); a read-only BMHP display at the cashier can follow after the migration is live.

## Owner apply path (requires existing Supabase owner/DB access; no new token is requested)
Full rehearsed package (preflight, apply, readback, rollback SQL): `owner-apply/OWNER-RUNBOOK.md`. Summary:
1. Preflight read-only on the target: every repository migration before this one must already be applied (latest on main before K02 is `20261026090000_inpatient_rx_evidence.sql`); record the newest completed backup time.
2. Run `python3 scripts/test-procedure-bmhp-postgres.py` locally (Docker) — must print every suite as passed.
3. Apply exactly this file once (Supabase CLI `supabase db push` from a checkout of this PR head, or SQL Editor with the file whose sha256 matches above). It runs in one transaction; any anchor drift aborts with `K02 expected exactly one anchor`.
4. Readback (read-only): `select public.clinic_bmhp_supported();` → `true`; `select count(*) from information_schema.columns where table_schema='public' and column_name='bmhp_components';` → `2`; `select count(*) from public.invoice_items where bmhp_components is not null;` → `0`.
5. Keep this PR unmerged until steps 1-4 pass on the target, then merge to main and verify the exact-SHA Production deployment. The app half is gated by `clinic_bmhp_supported()`, so an app deploy without the migration only refuses BMHP entry and changes nothing else.
6. Rollback before any BMHP use: drop the two triggers/helpers/columns and re-run the previous function definitions; after BMHP use, roll forward only.
