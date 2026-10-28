-- READ-ONLY. Jalankan setelah apply.sql.
select 'migrasi 20261029160000 tercatat' as cek, coalesce((select version from supabase_migrations.schema_migrations where version = '20261029160000'), '-') as nilai
union all select 'md5 fungsi edit baris PO', coalesce((select md5(prosrc) from pg_proc where oid = to_regprocedure('public.purchase_order_line_correction_run(uuid,numeric,numeric,numeric,date,text,text,jsonb,boolean)')), '-')
union all select 'run tetap tertutup untuk authenticated', (not has_function_privilege('authenticated', 'public.purchase_order_line_correction_run(uuid,numeric,numeric,numeric,date,text,text,jsonb,boolean)', 'execute'))::text
union all select 'simpan edit baris PO (authenticated)', has_function_privilege('authenticated', 'public.correct_purchase_order_line(text,uuid,integer,numeric,numeric,numeric,date,text,jsonb)', 'execute')::text;
