-- I08/I09 PREFLIGHT — read-only. Every row of the first query must say ok=true before apply.sql.
-- Safe to run any time; it changes nothing.
-- Exact md5 of pg_get_functiondef: main's body (= hosted PG17.6, local PG16/17),
-- or the exact body this package produces (already applied). Nothing else passes.
select 'post_production_atomic is main or already applied' as check_name,
  md5(pg_get_functiondef('public.post_production_atomic(text,text,jsonb)'::regprocedure)) in('9081430156be400a3e9d562dea6c3e5d','75af6e84a3f76468b8ef300029094b88') as ok
union all
select 'post_production_adhoc_atomic is main or already applied',
  md5(pg_get_functiondef('public.post_production_adhoc_atomic(text,text,jsonb)'::regprocedure)) in('7281aba74319c810720a6df1389a1be0','dcb556e965cb59dedb11ccb5867577ec')
union all
select 'read_production_atomic_sources is main or already applied',
  md5(pg_get_functiondef('public.read_production_atomic_sources(uuid[])'::regprocedure)) in('ceeacc6fb3d31d67e5fc21b1f8da4f33','f905d9ae280797512058d7184883190f')
union all
select 'compound_issues ledger exists', to_regclass('public.compound_issues') is not null
union all
select 'journal_entries.no_jurnal exists', exists(select 1 from information_schema.columns where table_schema='public' and table_name='journal_entries' and column_name='no_jurnal')
union all
select 'role_modules exists', to_regclass('public.role_modules') is not null;

-- Informational (no pass/fail): current method and production volume.
select (select method from public.inventory_costing_settings where id) as costing_method,
  (select count(*) from public.production_orders) as production_orders,
  (select count(*) from public.production_orders where status='berjalan') as running_jobs,
  (select count(*) from public.compound_issues) as compound_issue_rows,
  to_regprocedure('public.read_compound_trace(uuid)') is not null as trace_rpc_already_present;
