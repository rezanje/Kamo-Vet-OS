-- P01 READBACK — READ ONLY. Semua baris harus ok = true.
with checks(check_name, ok) as (
  select 'create_purchase_correction_request tidak lagi mensyaratkan modul Pembelian',
    pg_get_functiondef('public.create_purchase_correction_request(text,uuid,text,text)'::regprocedure) not like '%purchase_module_access%'
  union all select 'create_purchase_correction_request tetap menolak OWNER sebagai pengaju',
    pg_get_functiondef('public.create_purchase_correction_request(text,uuid,text,text)'::regprocedure) like '%actor_role = ''OWNER''%'
  union all select 'create_purchase_correction_request tetap cek cabang dokumen',
    pg_get_functiondef('public.create_purchase_correction_request(text,uuid,text,text)'::regprocedure) like '%user_can_access_branch%'
  union all select 'pembaca request tidak lagi mensyaratkan modul Pembelian',
    pg_get_functiondef('public.purchase_correction_request_visible(uuid,uuid)'::regprocedure) not like '%purchase_module_access%'
  union all select 'kedua fungsi SECURITY DEFINER', (select bool_and(prosecdef) from pg_proc where oid in ('public.create_purchase_correction_request(text,uuid,text,text)'::regprocedure,'public.purchase_correction_request_visible(uuid,uuid)'::regprocedure))
  union all select 'authenticated boleh eksekusi, anon tidak',
    has_function_privilege('authenticated','public.create_purchase_correction_request(text,uuid,text,text)','execute')
    and not has_function_privilege('anon','public.create_purchase_correction_request(text,uuid,text,text)','execute')
  union all select 'proses request tetap khusus OWNER (tidak diubah)',
    pg_get_functiondef('public.process_purchase_correction_request(uuid,text)'::regprocedure) like '%p.role=''OWNER''%'
  union all select 'P01 tercatat di riwayat migrasi', exists(select 1 from supabase_migrations.schema_migrations where version='20261028130000')
)
select check_name, ok from checks
union all select 'SUMMARY: ' || count(*) filter (where not ok) || ' failed', bool_and(ok) from checks;
