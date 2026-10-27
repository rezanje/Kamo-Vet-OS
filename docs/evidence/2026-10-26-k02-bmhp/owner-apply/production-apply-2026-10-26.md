# K02 + branch-name normalization — production apply record (26 Oct 2026, UTC)

Applied by Claude Code (cloud session) on Reza's instruction, using the Supabase Management API
(`/v1/projects/{ref}/database/query`) with the owner's access token. Read-only steps were sent with
`read_only: true` (verified first: a `create temp table` probe was refused with SQLSTATE 25006).

## Target

- Supabase project `koaglxcyjqfmgfzxszkj` (the only project on the account; ACTIVE_HEALTHY, ap-northeast-2, PostgreSQL 17.6).
  Live migration history matched the repository up to `20261026090000_inpatient_rx_evidence` before apply.
- Vercel project `kamo-vet-os` (team `kamo-group`), production branch `main`, domain `kamo-vet-os.vercel.app`.
- Newest completed backup before apply: 2026-10-26T15:20:57Z (daily physical backup; PITR off).
- Activity check 17:16:49Z: 0 invoices in the last 15 minutes (newest invoice 2026-10-23), 1 active client connection.

## K02 (PR243 head `797f90abc305ccf0b0422e0cff29792132e3b868`, technical checks success)

- sha256 of all four package files matched OWNER-RUNBOOK.md before running anything.
- Preflight Query A: 41 rows, `SUMMARY 0 failed`, no `ok = false`. Query B: newest `20261026090000`, no K02 row.
  Query C: exported to `production-preflight-queryC.csv` (sha256 `8f99f88a7a4013483ff8ad68037b82e3fdc979a5499bdbce574af5dc8473794e`).
- Apply (Path 1, single transaction: `begin` + migration + history insert `20261026100000 k02_procedure_bmhp` + `commit`)
  at 2026-10-26T17:16:58Z: no error.
- Readback Query A: 54 rows, `SUMMARY 0 failed`, no `ok = false`; both `rows with BMHP` = 0.
  Query B: exactly one row `20261026100000 k02_procedure_bmhp`.

## Branch-name normalization (`20260916221928_normalize_clinic_branch_names.sql`, already on main)

Origin: the "normalize clinic branch names" change from `codex/grup-barang-accurate-import-24kse3`
(`20260915163000_...`), ported to main on 2026-09-17 under version `20260916221928` but never applied live.
Applied in one transaction with history row `20260916221928 normalize_clinic_branch_names`. Display labels only;
codes, ids and transactions unchanged. `VET_RE` is not in the list and was not touched.

| code | before | after |
|---|---|---|
| VET_CIAW | Kamo Pets Clinic Ciawi | Kamo Pets Clinic Ciawi |
| VET_CMGG | Kamo Klinik Cimanggu | Kamo Pets Clinic Cimanggu |
| VET_CMS | Pets Klinik Ciomas | Kamo Pets Clinic Ciomas |
| VET_GRDA | HPY Garuda | Kamo Pets Clinic Garuda |
| VET_GRLG | HPY Pets Clinic Gerlong | Kamo Pets Clinic Gerlong |
| VET_PDRY | Klinik Panduraya | Kamo Pets Clinic Panduraya |
| VET_SRKN | Pet Clinic Surken | Kamo Pets Clinic Surken |
| VET_TKI | Kamo Klinik TKI | Kamo Pets Clinic TKI |

Rollback, only if decided: `update public.branches set name = <before> where code = <code>` per row above.
Accurate initial-stock import resolves branches through stored scope mappings (branch id), so the rename does
not break saved mappings; an unmapped file whose branch label only resembles the new name asks for a choice.

## Other two codex database changes — already live, nothing applied

- Pet ownership transfer (`20260914131111_pet_ownership_transfer.sql`, byte-identical on main): table, trigger and
  RPC already exist live (0 transfer rows). No history row under that version; objects were created earlier.
- Recurring journal limit (`20260930030655_recurring_journal_limit.sql` on the codex branch): superseded on main by
  `20261005051500_recurring_occurrence_limit.sql`, which is live (history row present, `max_occurrences` exists).
  The codex file must NOT be applied: it adds the same column again and would fail.

## Codex branch itself — not merged

`codex/grup-barang-accurate-import-24kse3` is 11 commits ahead and 548 behind main. Three commits are already on
main by content; the rest include the HRIS pilot work (`20260906181244_hris_pilot_access.sql`, not on main) and
98 files that differ from main. Merging it as-is would also add the duplicate recurring-limit migration (fails on
a fresh database / CI). Left untouched pending an explicit decision.

## Preflight Query A (verbatim)

```
info: server version |  | 17.6 | 
info: database |  | postgres | 
prerequisite: 20261026090000 inpatient_rx_evidence present | true | true | true
not yet applied: clinic_bmhp_supported() absent | true | true | true
not yet applied: bmhp_components columns | 0 | 0 | true
not yet applied: K02 triggers | 0 | 0 | true
dependency: schema clinic_private | true | true | true
dependency: public.stock_out_fifo | true | true | true
dependency: public.stock_in_fifo | true | true | true
dependency: public.inventory_is_average | true | true | true
fingerprint (same as repository): public.clinic_save_initial_record(uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid,uuid,text,text,text) | 903658a7807016e17f9929686ca6217d | 903658a7807016e17f9929686ca6217d | true
fingerprint (same as repository): public.clinic_save_inpatient_log(uuid,uuid,jsonb,jsonb,jsonb,text) | 05e2fb17873611496541cf1aaa2c3e09 | 05e2fb17873611496541cf1aaa2c3e09 | true
fingerprint (same as repository): public.clinic_post_invoice(uuid,text,jsonb,jsonb) | cfcfeee4d135a04d4f5477ed23093a2b | cfcfeee4d135a04d4f5477ed23093a2b | true
fingerprint (same as repository): public.clinic_void_reissue_invoice_core(uuid,text,text) | 4e28398cde4146575636d4e0de4e3f25 | 4e28398cde4146575636d4e0de4e3f25 | true
fingerprint (same as repository): public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb) | fcd2e7ffbe990448ce9ffd5ca1a3a2a2 | fcd2e7ffbe990448ce9ffd5ca1a3a2a2 | true
fingerprint (same as repository): public.clinic_refund_source_core(uuid) | 6879a31e67a2fcbc97b12bcd410aee1d | 6879a31e67a2fcbc97b12bcd410aee1d | true
security definer: public.clinic_save_initial_record(uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid,uuid,text,text,text) | false | false | true
security definer: public.clinic_save_inpatient_log(uuid,uuid,jsonb,jsonb,jsonb,text) | false | false | true
security definer: public.clinic_post_invoice(uuid,text,jsonb,jsonb) | true | true | true
security definer: public.clinic_void_reissue_invoice_core(uuid,text,text) | true | true | true
security definer: public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb) | true | true | true
security definer: public.clinic_refund_source_core(uuid) | true | true | true
anchor 01 found exactly once: public.clinic_save_initial_record(uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid,uuid,text,text,text) | 1 | 1 | true
anchor 02 found exactly once: public.clinic_save_initial_record(uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid,uuid,text,text,text) | 1 | 1 | true
anchor 03 found exactly once: public.clinic_save_inpatient_log(uuid,uuid,jsonb,jsonb,jsonb,text) | 1 | 1 | true
anchor 04 found exactly once: public.clinic_save_inpatient_log(uuid,uuid,jsonb,jsonb,jsonb,text) | 1 | 1 | true
anchor 05 found exactly once: public.clinic_post_invoice(uuid,text,jsonb,jsonb) | 1 | 1 | true
anchor 06 found exactly once: public.clinic_post_invoice(uuid,text,jsonb,jsonb) | 1 | 1 | true
anchor 07 found exactly once: public.clinic_post_invoice(uuid,text,jsonb,jsonb) | 1 | 1 | true
anchor 08 found exactly once: public.clinic_post_invoice(uuid,text,jsonb,jsonb) | 1 | 1 | true
anchor 09 found exactly once: public.clinic_post_invoice(uuid,text,jsonb,jsonb) | 1 | 1 | true
anchor 10 found exactly once: public.clinic_post_invoice(uuid,text,jsonb,jsonb) | 1 | 1 | true
anchor 11 found exactly once: public.clinic_void_reissue_invoice_core(uuid,text,text) | 1 | 1 | true
anchor 12 found exactly once: public.clinic_void_reissue_invoice_core(uuid,text,text) | 1 | 1 | true
anchor 13 found exactly once: public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb) | 1 | 1 | true
anchor 14 found exactly once: public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb) | 1 | 1 | true
anchor 15 found exactly once: public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb) | 1 | 1 | true
anchor 16 found exactly once: public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb) | 1 | 1 | true
anchor 17 found exactly once: public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb) | 1 | 1 | true
anchor 18 found exactly once: public.clinic_refund_source_core(uuid) | 1 | 1 | true
SUMMARY | 0 failed | 0 failed | true
```

## Readback Query A (verbatim)

```
info: server version |  | 17.6 | 
info: database |  | postgres | 
applied: clinic_bmhp_supported() present | true | true | true
applied: bmhp_components columns | 2 | 2 | true
applied: K02 triggers enabled | 2 | 2 | true
fingerprint (same as tested): public.clinic_save_initial_record(uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid,uuid,text,text,text) | c4f156691ab7d7f7826c6a23814c0c9c | c4f156691ab7d7f7826c6a23814c0c9c | true
fingerprint (same as tested): public.clinic_save_inpatient_log(uuid,uuid,jsonb,jsonb,jsonb,text) | bb69ea642a637b70ecf73748cae6946c | bb69ea642a637b70ecf73748cae6946c | true
fingerprint (same as tested): public.clinic_post_invoice(uuid,text,jsonb,jsonb) | 5fe068f8eb9f49df1b487ec9378dce79 | 5fe068f8eb9f49df1b487ec9378dce79 | true
fingerprint (same as tested): public.clinic_void_reissue_invoice_core(uuid,text,text) | 8a4b418a76773408c6032182720e5d38 | 8a4b418a76773408c6032182720e5d38 | true
fingerprint (same as tested): public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb) | 3cefa8d903191d69acbddf90f25000c9 | 3cefa8d903191d69acbddf90f25000c9 | true
fingerprint (same as tested): public.clinic_refund_source_core(uuid) | 18a01416e388ef5429f2ba4623b81c39 | 18a01416e388ef5429f2ba4623b81c39 | true
fingerprint (same as tested): public.clinic_bmhp_supported() | 36788f88936cdaeac7d5e519c67d3b33 | 36788f88936cdaeac7d5e519c67d3b33 | true
fingerprint (same as tested): public.guard_prescription_bmhp() | 61d01872932dcc133b8f857e427a1531 | 61d01872932dcc133b8f857e427a1531 | true
fingerprint (same as tested): public.guard_invoice_item_bmhp() | bc23eae317eca55a26ef47600923405f | bc23eae317eca55a26ef47600923405f | true
fingerprint (same as tested): clinic_private.bmhp_issue(uuid,uuid,text,date) | cc5084605253baf4434871a851869f43 | cc5084605253baf4434871a851869f43 | true
fingerprint (same as tested): clinic_private.bmhp_edit_plan(uuid,jsonb,uuid,text) | 4f03a06c5b11dff767524ef72bd6599b | 4f03a06c5b11dff767524ef72bd6599b | true
security definer: public.clinic_save_initial_record(uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid,uuid,text,text,text) | false | false | true
security definer: public.clinic_save_inpatient_log(uuid,uuid,jsonb,jsonb,jsonb,text) | false | false | true
security definer: public.clinic_post_invoice(uuid,text,jsonb,jsonb) | true | true | true
security definer: public.clinic_void_reissue_invoice_core(uuid,text,text) | true | true | true
security definer: public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb) | true | true | true
security definer: public.clinic_refund_source_core(uuid) | true | true | true
security definer: public.clinic_bmhp_supported() | false | false | true
security definer: public.guard_prescription_bmhp() | true | true | true
security definer: public.guard_invoice_item_bmhp() | true | true | true
security definer: clinic_private.bmhp_issue(uuid,uuid,text,date) | false | false | true
security definer: clinic_private.bmhp_edit_plan(uuid,jsonb,uuid,text) | false | false | true
grant: authenticated may call clinic_bmhp_supported() | true | true | true
grant: anon may call clinic_bmhp_supported() | false | false | true
grant: authenticated may call public.guard_prescription_bmhp() | false | false | true
grant: authenticated may call public.guard_invoice_item_bmhp() | false | false | true
grant: authenticated may call clinic_private.bmhp_issue(uuid,uuid,text,date) | false | false | true
grant: authenticated may call clinic_private.bmhp_edit_plan(uuid,jsonb,uuid,text) | false | false | true
patch 01 present exactly once: public.clinic_save_initial_record(uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid,uuid,text,text,text) | 1 | 1 | true
patch 02 present exactly once: public.clinic_save_initial_record(uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid,uuid,text,text,text) | 1 | 1 | true
patch 03 present exactly once: public.clinic_save_inpatient_log(uuid,uuid,jsonb,jsonb,jsonb,text) | 1 | 1 | true
patch 04 present exactly once: public.clinic_save_inpatient_log(uuid,uuid,jsonb,jsonb,jsonb,text) | 1 | 1 | true
patch 05 present exactly once: public.clinic_post_invoice(uuid,text,jsonb,jsonb) | 1 | 1 | true
patch 06 present exactly once: public.clinic_post_invoice(uuid,text,jsonb,jsonb) | 1 | 1 | true
patch 07 present exactly once: public.clinic_post_invoice(uuid,text,jsonb,jsonb) | 1 | 1 | true
patch 08 present exactly once: public.clinic_post_invoice(uuid,text,jsonb,jsonb) | 1 | 1 | true
patch 09 present exactly once: public.clinic_post_invoice(uuid,text,jsonb,jsonb) | 1 | 1 | true
patch 10 present exactly once: public.clinic_post_invoice(uuid,text,jsonb,jsonb) | 1 | 1 | true
patch 11 present exactly once: public.clinic_void_reissue_invoice_core(uuid,text,text) | 1 | 1 | true
patch 12 present exactly once: public.clinic_void_reissue_invoice_core(uuid,text,text) | 1 | 1 | true
patch 13 present exactly once: public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb) | 1 | 1 | true
patch 14 present exactly once: public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb) | 1 | 1 | true
patch 15 present exactly once: public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb) | 1 | 1 | true
patch 16 present exactly once: public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb) | 1 | 1 | true
patch 17 present exactly once: public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb) | 1 | 1 | true
patch 18 present exactly once: public.clinic_refund_source_core(uuid) | 1 | 1 | true
info: rows with BMHP in prescription_items |  | 0 | 
info: rows with BMHP in invoice_items |  | 0 | 
SUMMARY | 0 failed | 0 failed | true
```
