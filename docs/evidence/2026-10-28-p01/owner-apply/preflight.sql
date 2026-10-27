-- P01 PREFLIGHT — READ ONLY. Semua baris harus ok = true.
with checks(check_name, ok) as (
  select 'A02 sudah terpasang: tabel purchase_correction_requests ada', to_regclass('public.purchase_correction_requests') is not null
  union all select 'A02: fungsi create_purchase_correction_request(text,uuid,text,text) ada', to_regprocedure('public.create_purchase_correction_request(text,uuid,text,text)') is not null
  union all select 'A02: fungsi purchase_correction_request_visible(uuid,uuid) ada', to_regprocedure('public.purchase_correction_request_visible(uuid,uuid)') is not null
  union all select 'fungsi user_can_access_branch(uuid) ada', to_regprocedure('public.user_can_access_branch(uuid)') is not null
  union all select 'P01 belum tercatat di riwayat migrasi', not exists(select 1 from supabase_migrations.schema_migrations where version='20261028130000')
)
select check_name, ok from checks
union all select 'SUMMARY: ' || count(*) filter (where not ok) || ' failed', bool_and(ok) from checks;
