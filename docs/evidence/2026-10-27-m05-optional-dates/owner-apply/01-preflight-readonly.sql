-- M05 TANGGAL OPSIONAL — PREFLIGHT, READ ONLY. Nothing here writes; the transaction is read only and ends with rollback.
-- In the Supabase SQL editor select only the `with checks … ;` statement and Run it.
-- Every row with an expected value must show ok = true; the last row SUMMARY must say "0 failed".
begin read only;
with checks(check_name, expected, actual) as (
  select 'info: server version', null, current_setting('server_version')
  union all select 'info: database', null, current_database()::text
  union all select 'role: running as postgres (apply requires it)', 'postgres', current_user::text
  union all select 'server: PostgreSQL 16+ (pg_input_is_valid)', 'true', (current_setting('server_version_num')::int >= 160000)::text
  union all select 'history: table supabase_migrations.schema_migrations', 'true', (to_regclass('supabase_migrations.schema_migrations') is not null)::text
  union all select 'history: prerequisite M05 20261027180000 recorded', '1', (select count(*) from supabase_migrations.schema_migrations where version = '20261027180000')::text
  union all select 'history: 20261027210000 not recorded yet', '0', (select count(*) from supabase_migrations.schema_migrations where version = '20261027210000')::text
  union all select 'not yet applied: invoice/due date still NOT NULL on 3 tables (6 columns)', '6', (select count(*) from information_schema.columns where table_schema = 'public'
      and table_name in ('purchase_invoices', 'sales_invoices', 'opening_invoice_lines') and column_name in ('tanggal', 'jatuh_tempo') and is_nullable = 'NO')::text
  union all select 'name free: constraints *_tanggal_wajib_check', '0', (select count(*) from pg_constraint where conname in ('purchase_invoices_tanggal_wajib_check', 'sales_invoices_tanggal_wajib_check'))::text
  union all select 'dependency: opening_invoice_review is exactly the M05 version (md5 of body)', '7902334a2c9f7dcc8b3c4c0bcba6bc1e',
      (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.opening_invoice_review(jsonb)'))
  union all select 'dependency: column opening_batch_id on purchase_invoices and sales_invoices', '2', (select count(*) from information_schema.columns where table_schema = 'public'
      and table_name in ('purchase_invoices', 'sales_invoices') and column_name = 'opening_batch_id')::text
  union all select 'dependency: opening_invoice_lines keeps "due date not before invoice date"', 'CHECK ((jatuh_tempo >= tanggal))',
      (select pg_get_constraintdef(oid) from pg_constraint where conrelid = to_regclass('public.opening_invoice_lines') and conname = 'opening_invoice_lines_check')
  union all select 'dependency: preview/post RPCs present', '2', (select count(*) from unnest(array['public.preview_opening_invoices(jsonb)', 'public.post_opening_invoices(jsonb,text,text)']) f
      where to_regprocedure(f) is not null)::text
  union all select 'info: opening batches already posted (dates in them stay as they are)', null, (select count(*) from public.opening_invoice_batches)::text
)
select check_name, expected, actual, case when expected is null then null else actual is not distinct from expected end as ok
from checks
union all
select 'SUMMARY', '0 failed', count(*) filter (where expected is not null and actual is distinct from expected) || ' failed',
  count(*) filter (where expected is not null and actual is distinct from expected) = 0
from checks;
rollback;
