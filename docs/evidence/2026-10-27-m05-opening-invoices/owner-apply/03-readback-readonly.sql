-- M05 READBACK — READ ONLY. Run after 02-apply.sql. Last row SUMMARY must say "0 failed".
-- In the Supabase SQL editor select only the `with checks … ;` statement and Run it.
begin read only;
with fn(sig, definer, auth_exec) as (values
  ('public.opening_invoice_norm(text)', false, false),
  ('public.guard_opening_invoice()', false, false),
  ('public.guard_opening_invoice_journal()', false, false),
  ('public.guard_saldo_awal_opening_invoices()', true, false),
  ('public.opening_invoice_review(jsonb)', true, false),
  ('public.preview_opening_invoices(jsonb)', true, true),
  ('public.post_opening_invoices(jsonb,text,text)', true, true)
), trg(rel, name) as (values
  ('public.purchase_invoices', 'opening_invoice_guard'), ('public.sales_invoices', 'opening_invoice_guard'),
  ('public.purchase_invoice_items', 'opening_invoice_guard'), ('public.sales_invoice_items', 'opening_invoice_guard'),
  ('public.journal_entries', 'opening_invoice_journal_guard'), ('public.journal_lines', 'opening_invoice_journal_lines_guard'),
  ('public.journal_lines', 'opening_invoice_saldo_awal_guard')
), checks(check_name, expected, actual) as (
  select 'history: 20261027180000 recorded', '1', (select count(*) from supabase_migrations.schema_migrations where version = '20261027180000')::text
  union all select 'tables: opening_invoice_batches/lines exist, owned by postgres, RLS on', '2', (select count(*) from pg_class c where c.oid in
      (to_regclass('public.opening_invoice_batches'), to_regclass('public.opening_invoice_lines')) and c.relrowsecurity and pg_get_userbyid(c.relowner) = 'postgres')::text
  union all select 'policies: one read policy per new table', '2', (select count(*) from pg_policy where polrelid in (to_regclass('public.opening_invoice_batches'), to_regclass('public.opening_invoice_lines')) and polcmd = 'r')::text
  union all select 'grants: authenticated may SELECT but not write new tables', 'true', (select bool_and(has_table_privilege('authenticated', t, 'SELECT')
      and not has_table_privilege('authenticated', t, 'INSERT,UPDATE,DELETE,TRUNCATE')) from unnest(array['public.opening_invoice_batches', 'public.opening_invoice_lines']) t)::text
  union all select 'grants: anon and service_role cannot read or write new tables', 'false', (select bool_or(has_table_privilege(r, t, 'SELECT,INSERT,UPDATE,DELETE'))
      from unnest(array['public.opening_invoice_batches', 'public.opening_invoice_lines']) t cross join unnest(array['anon', 'service_role']) r)::text
  union all select 'columns: opening_batch_id on purchase_invoices and sales_invoices', '2', (select count(*) from information_schema.columns where table_schema = 'public'
      and table_name in ('purchase_invoices', 'sales_invoices') and column_name = 'opening_batch_id' and data_type = 'uuid')::text
  union all select 'constraint: purchase_invoices_asal_check allows opening', 'CHECK (((po_id IS NOT NULL) OR (warehouse_id IS NOT NULL) OR (opening_batch_id IS NOT NULL)))',
      (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.purchase_invoices'::regclass and conname = 'purchase_invoices_asal_check')
  union all select 'indexes: 4 M05 indexes', '4', (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'i' and relname in
      ('purchase_invoices_opening_batch_idx', 'sales_invoices_opening_batch_idx', 'opening_invoice_lines_ap_no', 'opening_invoice_lines_ar_no'))::text
  union all select 'triggers: 7 enabled', '7', (select count(*) from trg join pg_trigger t on t.tgrelid = trg.rel::regclass and t.tgname = trg.name and t.tgenabled = 'O')::text
  union all select 'functions: 7 present, owned by postgres, empty search_path', '7', (select count(*) from fn join pg_proc p on p.oid = to_regprocedure(fn.sig)
      where pg_get_userbyid(p.proowner) = 'postgres' and p.proconfig @> array['search_path=""'])::text
  union all select 'functions: SECURITY DEFINER exactly where intended', '7', (select count(*) from fn join pg_proc p on p.oid = to_regprocedure(fn.sig) where p.prosecdef = fn.definer)::text
  union all select 'functions: authenticated EXECUTE only on preview/post', '7', (select count(*) from fn where has_function_privilege('authenticated', fn.sig, 'execute') = fn.auth_exec)::text
  union all select 'functions: anon cannot execute any M05 function', '0', (select count(*) from fn where has_function_privilege('anon', fn.sig, 'execute'))::text
  union all select 'data: no batch posted yet', '0', (select count(*) from public.opening_invoice_batches)::text
)
select check_name, expected, actual, actual is not distinct from expected as ok from checks
union all
select 'SUMMARY', '0 failed', count(*) filter (where actual is distinct from expected) || ' failed', count(*) filter (where actual is distinct from expected) = 0 from checks;
rollback;
