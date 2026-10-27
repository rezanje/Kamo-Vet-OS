-- I08/I09 READBACK — read-only. Run after apply.sql; every row must say ok=true.
select 'post_production_atomic is the exact applied body' as check_name,
  md5(pg_get_functiondef('public.post_production_atomic(text,text,jsonb)'::regprocedure))='75af6e84a3f76468b8ef300029094b88' as ok
union all
select 'post_production_adhoc_atomic is the exact applied body',
  md5(pg_get_functiondef('public.post_production_adhoc_atomic(text,text,jsonb)'::regprocedure))='dcb556e965cb59dedb11ccb5867577ec'
union all
select 'production RPCs still security definer, authenticated only',
  (select bool_and(p.prosecdef and has_function_privilege('authenticated',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE'))
   from pg_proc p where p.oid in('public.post_production_atomic(text,text,jsonb)'::regprocedure,'public.post_production_adhoc_atomic(text,text,jsonb)'::regprocedure,
     'public.read_production_atomic_sources(uuid[])'::regprocedure))
union all
select 'read_production_atomic_sources is the exact applied body',
  md5(pg_get_functiondef('public.read_production_atomic_sources(uuid[])'::regprocedure))='f905d9ae280797512058d7184883190f'
union all
select 'read_compound_trace present, definer, authenticated only',
  (select p.prosecdef and has_function_privilege('authenticated',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE')
   from pg_proc p where p.oid=to_regprocedure('public.read_compound_trace(uuid)'))
union all
select 'no new tables or stock rows for racikan parents',
  not exists(select 1 from public.stock_moves m join public.items i on i.id=m.item_id where m.source='racik' and coalesce(i.item_type,'Persediaan')<>'Persediaan');
