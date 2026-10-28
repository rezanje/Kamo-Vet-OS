-- READ-ONLY. Jalankan setelah apply.sql.
-- Harapan: tiga fungsi edit baris PO ada (preview + simpan bisa dipanggil akun login, run tidak);
--   mesin koreksi faktur 9 argumen ada, versi 8 argumen hilang; migrasi tercatat;
--   jumlah koreksi faktur & permintaan PO sama dengan preflight.
select 'preview edit baris PO (authenticated)', has_function_privilege('authenticated', 'public.preview_purchase_order_line_correction(uuid,numeric,numeric,numeric,date)', 'execute')::text as nilai
union all select 'simpan edit baris PO (authenticated)', has_function_privilege('authenticated', 'public.correct_purchase_order_line(text,uuid,integer,numeric,numeric,numeric,date,text,jsonb)', 'execute')::text
union all select 'run edit baris PO tertutup untuk authenticated', (not has_function_privilege('authenticated', 'public.purchase_order_line_correction_run(uuid,numeric,numeric,numeric,date,text,text,jsonb,boolean)', 'execute'))::text
union all select 'mesin koreksi faktur 9 argumen ada', (to_regprocedure('public.purchase_invoice_line_correction_run(uuid,numeric,numeric,date,text,text,jsonb,boolean,boolean)') is not null)::text
union all select 'mesin koreksi faktur 8 argumen hilang', (to_regprocedure('public.purchase_invoice_line_correction_run(uuid,numeric,numeric,date,text,text,jsonb,boolean)') is null)::text
union all select 'koreksi faktur biasa tetap ada', has_function_privilege('authenticated', 'public.correct_purchase_invoice_line(text,uuid,integer,numeric,numeric,date,text,jsonb)', 'execute')::text
union all select 'migrasi 20261029150000 tercatat', coalesce((select version from supabase_migrations.schema_migrations where version = '20261029150000'), '-')
union all select 'koreksi faktur tercatat', count(*)::text from public.purchase_invoice_corrections
union all select 'permintaan PO tercatat', count(*)::text from public.purchase_order_requests;
