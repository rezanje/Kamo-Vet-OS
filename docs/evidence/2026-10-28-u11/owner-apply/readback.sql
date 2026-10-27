-- U11 READBACK — READ ONLY. Semua baris harus ok = true.
with checks(check_name, ok) as (
  select 'fungsi create_branch ada', to_regprocedure('public.create_branch(text,text,text,boolean)') is not null
  union all select 'create_branch SECURITY DEFINER dengan search_path kosong',
    (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid=to_regprocedure('public.create_branch(text,text,text,boolean)'))
  union all select 'create_branch cek OWNER aktif di database',
    pg_get_functiondef(to_regprocedure('public.create_branch(text,text,text,boolean)')) like '%p.role=''OWNER'' and p.is_active%'
  union all select 'authenticated boleh eksekusi, anon tidak',
    has_function_privilege('authenticated',to_regprocedure('public.create_branch(text,text,text,boolean)'),'execute')
    and not has_function_privilege('anon',to_regprocedure('public.create_branch(text,text,text,boolean)'),'execute')
  union all select 'index unik lower(code) ada', exists(select 1 from pg_index i where i.indexrelid = to_regclass('public.branches_code_lower_key') and i.indisunique and i.indisvalid)
  union all select 'branches tetap tanpa policy INSERT', not exists(select 1 from pg_policies where schemaname='public' and tablename='branches' and cmd in ('INSERT','ALL'))
  union all select 'U11 tercatat di riwayat migrasi', exists(select 1 from supabase_migrations.schema_migrations where version='20261028131000')
)
select check_name, coalesce(ok,false) from checks
union all select 'SUMMARY: ' || count(*) filter (where not coalesce(ok,false)) || ' failed', bool_and(coalesce(ok,false)) from checks;
