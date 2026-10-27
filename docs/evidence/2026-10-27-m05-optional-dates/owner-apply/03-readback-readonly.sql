-- M05 TANGGAL OPSIONAL — READBACK, READ ONLY. Run after 02-apply.sql. Last row SUMMARY must say "0 failed".
-- In the Supabase SQL editor select only the `with checks … ;` statement and Run it.
begin read only;
with checks(check_name, expected, actual) as (
  select 'history: 20261027210000 recorded', '1', (select count(*) from supabase_migrations.schema_migrations where version = '20261027210000')::text
  union all select 'columns: invoice/due date nullable on 3 tables (6 columns)', '6', (select count(*) from information_schema.columns where table_schema = 'public'
      and table_name in ('purchase_invoices', 'sales_invoices', 'opening_invoice_lines') and column_name in ('tanggal', 'jatuh_tempo') and is_nullable = 'YES')::text
  union all select 'columns: regular-invoice defaults kept (today / today+30)', '4', (select count(*) from information_schema.columns where table_schema = 'public'
      and table_name in ('purchase_invoices', 'sales_invoices') and ((column_name = 'tanggal' and column_default = 'CURRENT_DATE') or (column_name = 'jatuh_tempo' and column_default = '(CURRENT_DATE + 30)')))::text
  union all select 'constraint: purchase_invoices_tanggal_wajib_check validated', 'CHECK (((opening_batch_id IS NOT NULL) OR ((tanggal IS NOT NULL) AND (jatuh_tempo IS NOT NULL))))|true',
      (select pg_get_constraintdef(oid) || '|' || convalidated from pg_constraint where conrelid = 'public.purchase_invoices'::regclass and conname = 'purchase_invoices_tanggal_wajib_check')
  union all select 'constraint: sales_invoices_tanggal_wajib_check validated', 'CHECK (((opening_batch_id IS NOT NULL) OR ((tanggal IS NOT NULL) AND (jatuh_tempo IS NOT NULL))))|true',
      (select pg_get_constraintdef(oid) || '|' || convalidated from pg_constraint where conrelid = 'public.sales_invoices'::regclass and conname = 'sales_invoices_tanggal_wajib_check')
  union all select 'constraint: opening_invoice_lines due date not before invoice date', 'CHECK ((jatuh_tempo >= tanggal))',
      (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.opening_invoice_lines'::regclass and conname = 'opening_invoice_lines_check')
  union all select 'function: opening_invoice_review is the new version (md5 of body)', '21e8cca732648c114ea9e5b64a75d79b',
      (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.opening_invoice_review(jsonb)'))
  union all select 'function: opening_invoice_review owned by postgres, SECURITY DEFINER, empty search_path', 'true', (select pg_get_userbyid(proowner) = 'postgres' and prosecdef
      and proconfig @> array['search_path=""'] from pg_proc where oid = to_regprocedure('public.opening_invoice_review(jsonb)'))::text
  union all select 'function: nobody but postgres may call opening_invoice_review directly', 'false', (select bool_or(has_function_privilege(r, 'public.opening_invoice_review(jsonb)', 'execute'))
      from unnest(array['anon', 'authenticated', 'service_role']) r)::text
  union all select 'function: authenticated still calls preview/post; anon cannot', 'true|false',
      (select bool_and(has_function_privilege('authenticated', f, 'execute'))::text || '|' || bool_or(has_function_privilege('anon', f, 'execute'))::text
       from unnest(array['public.preview_opening_invoices(jsonb)', 'public.post_opening_invoices(jsonb,text,text)']) f)
  union all select 'data: no regular (non-opening) purchase invoice without a date', '0', (select count(*) from public.purchase_invoices where opening_batch_id is null and (tanggal is null or jatuh_tempo is null))::text
  union all select 'data: no regular (non-opening) sales invoice without a date', '0', (select count(*) from public.sales_invoices where opening_batch_id is null and (tanggal is null or jatuh_tempo is null))::text
)
select check_name, expected, actual, actual is not distinct from expected as ok from checks
union all
select 'SUMMARY', '0 failed', count(*) filter (where actual is distinct from expected) || ' failed', count(*) filter (where actual is distinct from expected) = 0 from checks;
rollback;
