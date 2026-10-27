-- I08/I09 READBACK — read-only. Run after apply.sql; every row must say ok=true.
select 'recipe production reconciles average' as check_name,
  position('Valuasi average barang jadi' in pg_get_functiondef('public.post_production_atomic(text,text,jsonb)'::regprocedure))>0
  and position('Produksi ini memerlukan rekonsiliasi metode average tersendiri' in pg_get_functiondef('public.post_production_atomic(text,text,jsonb)'::regprocedure))=0 as ok
union all
select 'ad hoc production reconciles average',
  position('Valuasi average bahan' in pg_get_functiondef('public.post_production_adhoc_atomic(text,text,jsonb)'::regprocedure))>0
union all
select 'production RPCs still security definer, authenticated only',
  (select bool_and(p.prosecdef and has_function_privilege('authenticated',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE'))
   from pg_proc p where p.oid in('public.post_production_atomic(text,text,jsonb)'::regprocedure,'public.post_production_adhoc_atomic(text,text,jsonb)'::regprocedure,
     'public.read_production_atomic_sources(uuid[])'::regprocedure))
union all
select 'job->completion links in source reader',
  position('''completion''' in pg_get_functiondef('public.read_production_atomic_sources(uuid[])'::regprocedure))>0
union all
select 'read_compound_trace present, definer, authenticated only',
  (select p.prosecdef and has_function_privilege('authenticated',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE')
   from pg_proc p where p.oid=to_regprocedure('public.read_compound_trace(uuid)'))
union all
select 'no new tables or stock rows for racikan parents',
  not exists(select 1 from public.stock_moves m join public.items i on i.id=m.item_id where m.source='racik' and coalesce(i.item_type,'Persediaan')<>'Persediaan');
