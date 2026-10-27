# C04 — production verification record, read-only (27 Oct 2026, UTC)

No write, flag change or deployment. Access used: the Supabase Management API and Vercel API tokens already
configured in this session's environment (no new token, grant or permission). SQL went through
`/v1/projects/{ref}/database/query` with `read_only: true`; a `create temp table` probe was refused first
(`25006 cannot execute CREATE TABLE in a read-only transaction`, role `supabase_read_only_user`).

## Target

- Supabase: the only project visible to the token, `koaglxcyjqfmgfzxszkj`, ACTIVE_HEALTHY, ap-northeast-2,
  PostgreSQL 17.6 (`17.6.1.127`). Newest app sign-in 2026-10-27 02:47:46Z (after the 02:45Z Production deploy).
  The Vercel value of `NEXT_PUBLIC_SUPABASE_URL` is stored as *sensitive* and cannot be read back, so the
  Vercel→Supabase link is established by the single project, its live history matching main and the sign-in
  timing, not by reading that value.
- Vercel: project `kamo-vet-os` (`prj_1TsfC077JVwOax0quRQGUG6IeDAV`), production branch `main`; alias
  `kamo-vet-os.vercel.app` → `dpl_ApQb7y1F4qVW7Usg5gG9X1vjtxv9`, READY, commit `906bc98c` (includes C04 app merge
  `e7737406`). Project env keys: `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_URL` — **no
  `PROMO_PACKAGE_TOTAL_ENABLED`** (flag off).

## Backup

`GET /v1/projects/{ref}/database/backups`: PITR **off**, daily physical backups, newest COMPLETED
2026-10-26T15:20:57Z (previous 10-25, 10-24, 10-23). K02 was applied at 2026-10-26T17:16:58Z, after that backup;
the next daily backup is expected around 15:15Z today. Plan the C04 slot after a newer completed backup, or take an
on-demand backup first (dashboard, owner).

## Preflight Query A (verbatim, 03:32:44Z) — `SUMMARY 0 failed`

```
info: server version |  | 17.6 | 
info: database |  | postgres | 
prerequisite: public.edit_promo(uuid,text,jsonb,uuid[]) exists | true | true | True
editor security definer | true | true | True
editor search_path empty | true | true | True
editor grant: anon | false | false | True
editor grant: service_role | false | false | True
owner of editor (SQL Editor applies as postgres) | postgres | postgres | True
owner of public.promos | postgres | postgres | True
owner of public.promo_items | postgres | postgres | True
info: transactions open > 1 minute |  | 0 | 
editor grant: authenticated | true | true | True
prerequisite: promo_configuration_guard triggers | 2 | 2 | True
info: promos total |  | 4 | 
info: active promos |  | 4 | 
not yet applied: constraint promos_discount_mode_valid | 0 | 0 | True
not yet applied: public.assert_active_package_promo_target() absent | true | true | True
not yet applied: C04 triggers | 0 | 0 | True
fingerprint (same as repository): public.edit_promo(uuid,text,jsonb,uuid[]) | f4a53d51521eecb175dd646f66ee82e9 | f4a53d51521eecb175dd646f66ee82e9 | True
anchor 1 found exactly once | 1 | 1 | True
anchor 2 found exactly once | 1 | 1 | True
anchor 3 found exactly once | 1 | 1 | True
anchor 4 found exactly once | 1 | 1 | True
data: promos already storing discount_mode (app flag is off, expect none) | 0 | 0 | True
SUMMARY | 0 failed | 0 failed | True
```

## Preflight Query B (verbatim) — no `20261026002100`

```
20261026100000 | k02_procedure_bmhp
20261026090000 | 20261026090000_inpatient_rx_evidence
20261026000345 | 20261026000345_private_report_sales_performer_filter
20261025180000 | 20261025180000_inpatient_forced_discharge
20261025173500 | 20261025173500_private_report_opname_preset
20261025110800 | 20261025110800_private_report_branch_filter
20261025110600 | 20261025110600_quest_config_write_guard
20261025110500 | 20261025110500_opname_price_snapshot_report
20261025091500 | 20261025091500_sales_return_branch_isolation
20261025090000 | clinic_compound_unposted_guard
20261025070000 | promo_excel_batch
20261025060000 | cashier_atomic_fifo_floor
20261025050000 | purchase_advance_stop_at_receipt
20261025040000 | branch_grooming_requirements
```

Newest applied is `20261026100000` (K02); `20261027090000` (R05) is **not** applied. C04 is therefore applied out
of order, as rehearsed. Long-running transactions at the time: 0.

## Query C

`production-preflight-queryC.csv` (pre-C04 `edit_promo` definition; sha256
`d62bb439a338195c7a05cc8b386611250f3c1f3e853aef6b6b4009fd55fedbea`). Fallback rollback only.

Re-run Query A immediately before Step 3 in the release slot; this record is a point-in-time check.
