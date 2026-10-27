-- M05 PREFLIGHT — READ ONLY. Nothing here writes; the transaction is read only and ends with rollback.
-- In the Supabase SQL editor select only the `with checks … ;` statement and Run it.
-- Every row with an expected value must show ok = true; the last row SUMMARY must say "0 failed".
begin read only;
with checks(check_name, expected, actual) as (
  select 'info: server version', null, current_setting('server_version')
  union all select 'info: database', null, current_database()::text
  union all select 'role: running as postgres (apply requires it)', 'postgres', current_user::text
  union all select 'server: PostgreSQL 16+ (pg_input_is_valid)', 'true', (current_setting('server_version_num')::int >= 160000)::text
  union all select 'history: table supabase_migrations.schema_migrations', 'true', (to_regclass('supabase_migrations.schema_migrations') is not null)::text
  union all select 'history: prerequisite 20261027153000 recorded', '1', (select count(*) from supabase_migrations.schema_migrations where version = '20261027153000')::text
  union all select 'history: M05 20261027180000 not recorded', '0', (select count(*) from supabase_migrations.schema_migrations where version = '20261027180000')::text
  union all select 'not yet applied: table opening_invoice_batches absent', 'true', (to_regclass('public.opening_invoice_batches') is null)::text
  union all select 'not yet applied: table opening_invoice_lines absent', 'true', (to_regclass('public.opening_invoice_lines') is null)::text
  union all select 'not yet applied: column opening_batch_id absent', '0', (select count(*) from information_schema.columns where table_schema = 'public' and table_name in ('purchase_invoices', 'sales_invoices') and column_name = 'opening_batch_id')::text
  union all select 'not yet applied: M05 functions absent', '0', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in
      ('opening_invoice_norm', 'guard_opening_invoice', 'guard_opening_invoice_journal', 'guard_saldo_awal_opening_invoices', 'opening_invoice_review', 'preview_opening_invoices', 'post_opening_invoices'))::text
  union all select 'not yet applied: M05 trigger names free', '0', (select count(*) from pg_trigger where not tgisinternal and tgname in
      ('opening_invoice_guard', 'opening_invoice_journal_guard', 'opening_invoice_journal_lines_guard', 'opening_invoice_saldo_awal_guard'))::text
  union all select 'name free: M05 indexes', '0', (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname in
      ('purchase_invoices_opening_batch_idx', 'sales_invoices_opening_batch_idx', 'opening_invoice_lines_ap_no', 'opening_invoice_lines_ar_no'))::text
  union all select 'dependency: constraint purchase_invoices_asal_check unchanged', 'CHECK (((po_id IS NOT NULL) OR (warehouse_id IS NOT NULL)))',
      (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.purchase_invoices'::regclass and conname = 'purchase_invoices_asal_check')
  union all select 'dependency: tables', '11', (select count(*) from unnest(array['purchase_invoices', 'sales_invoices', 'purchase_invoice_items', 'sales_invoice_items', 'journal_entries',
      'journal_lines', 'coa_accounts', 'suppliers', 'customers', 'branches', 'document_numbering']) t where to_regclass('public.' || t) is not null)::text
  union all select 'dependency: tables accounting_locks/profiles/role_modules', '3', (select count(*) from unnest(array['accounting_locks', 'profiles', 'role_modules']) t where to_regclass('public.' || t) is not null)::text
  union all select 'dependency: functions', '6', (select count(*) from unnest(array['public.clinic_write_journal(date,text,text,text,uuid,jsonb)', 'public.sales_next_number(text,date)',
      'public.user_can_access_branch(uuid)', 'public.has_role_capability(text)', 'public.pay_purchase_invoice_atomic(text,uuid,date,numeric,text,text,uuid,uuid,uuid)',
      'public.receive_wholesale_payment(text,uuid,date,numeric,text,uuid,uuid,text)']) f where to_regprocedure(f) is not null)::text
  union all select 'dependency: suppliers.is_active/trashed_at, customers.name', '3', (select count(*) from information_schema.columns where table_schema = 'public' and
      ((table_name = 'suppliers' and column_name in ('is_active', 'trashed_at')) or (table_name = 'customers' and column_name = 'name')))::text
  union all select 'dependency: COA 2101/1201/3101 active detail accounts', '3', (select count(*) from public.coa_accounts where code in ('2101', '1201', '3101') and is_active and not is_header)::text
  union all select 'dependency: roles anon/authenticated/service_role', '3', (select count(*) from pg_roles where rolname in ('anon', 'authenticated', 'service_role'))::text
  union all select 'info: account-level saldo-awal already carries 2101 (AP import would be refused)', null, (select count(*) > 0 from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
      join public.coa_accounts a on a.id = l.account_id where e.source = 'saldo-awal' and a.code = '2101')::text
  union all select 'info: account-level saldo-awal already carries 1201 (AR import would be refused)', null, (select count(*) > 0 from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
      join public.coa_accounts a on a.id = l.account_id where e.source = 'saldo-awal' and a.code = '1201')::text
)
select check_name, expected, actual, case when expected is null then null else actual is not distinct from expected end as ok
from checks
union all
select 'SUMMARY', '0 failed', count(*) filter (where expected is not null and actual is distinct from expected) || ' failed',
  count(*) filter (where expected is not null and actual is distinct from expected) = 0
from checks;
rollback;
