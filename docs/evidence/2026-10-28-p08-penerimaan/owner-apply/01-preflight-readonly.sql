-- P08 PEMBATALAN PENERIMAAN — PREFLIGHT, READ ONLY. Nothing here writes; the transaction is read only and ends with rollback.
-- In the Supabase SQL editor select only the `with checks … ;` statement and Run it.
-- Every row with an expected value must show ok = true; the last row SUMMARY must say "0 failed".
begin read only;
with checks(check_name, expected, actual) as (
  select 'info: server version', null, current_setting('server_version')
  union all select 'info: database', null, current_database()::text
  union all select 'role: running as postgres (apply requires it)', 'postgres', current_user::text
  union all select 'history: table supabase_migrations.schema_migrations', 'true', (to_regclass('supabase_migrations.schema_migrations') is not null)::text
  union all select 'history: 20261028120000 not recorded yet', '0', (select count(*) from supabase_migrations.schema_migrations where version = '20261028120000')::text
  union all select 'not yet applied: goods_receipts has no void columns', '0', (select count(*) from information_schema.columns where table_schema = 'public'
      and table_name = 'goods_receipts' and column_name in ('voided_at', 'voided_on', 'voided_by', 'void_reason', 'reversal_journal_id'))::text
  union all select 'not yet applied: table purchase_receipt_cancellations absent', 'true', (to_regclass('public.purchase_receipt_cancellations') is null)::text
  union all select 'not yet applied: function cancel_goods_receipt absent', 'true', (to_regprocedure('public.cancel_goods_receipt(uuid,text,text,date)') is null)::text
  union all select 'dependency: receipt/invoice/stock functions present', '7', (select count(*) from unnest(array[
      'public.receive_purchase_order(uuid,text,text,integer,date,text,text,jsonb)', 'public.purchase_assert_access(text,uuid)',
      'public.inventory_assert_open_date(date)', 'public.clinic_write_journal(date,text,text,text,uuid,jsonb)',
      'public.inventory_record_valuation()', 'public.cancel_purchase_invoice(uuid,integer,text,text,date)',
      'public.close_purchase_order_remainder(uuid,text,jsonb,text,boolean)']) f where to_regprocedure(f) is not null)::text
  union all select 'dependency: tables purchase_order_receipt_closures, purchase_returns, purchase_invoices.voided_at', '3',
      ((to_regclass('public.purchase_order_receipt_closures') is not null)::int + (to_regclass('public.purchase_returns') is not null)::int
       + (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'purchase_invoices' and column_name = 'voided_at'))::text
  union all select 'dependency: journal_entries.voided_at present', '1', (select count(*) from information_schema.columns where table_schema = 'public'
      and table_name = 'journal_entries' and column_name = 'voided_at')::text
  union all select 'dependency: moving-average anchor appears exactly once in inventory_record_valuation', '1',
      ((length(prosrc) - length(replace(prosrc, 'new.source=''purchase-invoice-void''', ''))) / length('new.source=''purchase-invoice-void'''))::text
      from pg_proc where oid = to_regprocedure('public.inventory_record_valuation()')
  union all select 'dependency: COA 1301 and 2102 active, not header', '2', (select count(*) from public.coa_accounts where code in ('1301', '2102') and is_active and not is_header)::text
  union all select 'name free: no stock move/journal with source purchase-receipt-void', '0',
      ((select count(*) from public.stock_moves where source = 'purchase-receipt-void') + (select count(*) from public.journal_entries where source = 'purchase-receipt-void'))::text
  union all select 'info: goods receipts on file (none is changed by the apply)', null, (select count(*) from public.goods_receipts)::text
)
select check_name, expected, actual, case when expected is null then null else actual is not distinct from expected end as ok
from checks
union all
select 'SUMMARY', '0 failed', count(*) filter (where expected is not null and actual is distinct from expected) || ' failed',
  count(*) filter (where expected is not null and actual is distinct from expected) = 0
from checks;
rollback;
