-- I08/I09 PREFLIGHT — read-only. Every row must say ok=true before apply.sql.
-- Safe to run any time; it changes nothing.
select 'post_production_atomic body matches main (average still blocked)' as check_name,
  position('Produksi ini memerlukan rekonsiliasi metode average tersendiri' in pg_get_functiondef('public.post_production_atomic(text,text,jsonb)'::regprocedure))>0
  or position('Valuasi average barang jadi' in pg_get_functiondef('public.post_production_atomic(text,text,jsonb)'::regprocedure))>0 as ok
union all
select 'post_production_adhoc_atomic body matches main',
  position('Pekerjaan FIFO ini memerlukan kontrak average tersendiri' in pg_get_functiondef('public.post_production_adhoc_atomic(text,text,jsonb)'::regprocedure))>0
  or position('Valuasi average bahan' in pg_get_functiondef('public.post_production_adhoc_atomic(text,text,jsonb)'::regprocedure))>0
union all
select 'read_production_atomic_sources exists', to_regprocedure('public.read_production_atomic_sources(uuid[])') is not null
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
