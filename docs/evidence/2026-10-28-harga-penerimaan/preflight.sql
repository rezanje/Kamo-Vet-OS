-- READ-ONLY. Jalankan sebelum apply.sql. Tidak mengubah apa pun.
select 'migrasi 20261029150000 tercatat' as cek, coalesce((select version from supabase_migrations.schema_migrations where version = '20261029150000'), '-') as nilai
union all select 'migrasi 20261029160000 tercatat', coalesce((select version from supabase_migrations.schema_migrations where version = '20261029160000'), '-')
union all select 'md5 fungsi edit baris PO', coalesce((select md5(prosrc) from pg_proc where oid = to_regprocedure('public.purchase_order_line_correction_run(uuid,numeric,numeric,numeric,date,text,text,jsonb,boolean)')), '-')
union all select 'edit baris PO tercatat', count(*)::text from public.purchase_order_revisions where after_value->>'mode' = 'line';
