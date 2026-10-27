-- P08 PEMBATALAN PENERIMAAN — READBACK, READ ONLY. Run after 02. Last row SUMMARY must say "0 failed".
begin read only;
with checks(check_name, expected, actual) as (
  select 'history: 20261028120000 recorded once', '1', (select count(*) from supabase_migrations.schema_migrations where version = '20261028120000')::text
  union all select 'columns: goods_receipts void columns', '5', (select count(*) from information_schema.columns where table_schema = 'public'
      and table_name = 'goods_receipts' and column_name in ('voided_at', 'voided_on', 'voided_by', 'void_reason', 'reversal_journal_id'))::text
  union all select 'table: purchase_receipt_cancellations with RLS on', 'true',
      (select relrowsecurity from pg_class where oid = to_regclass('public.purchase_receipt_cancellations'))::text
  union all select 'rpc: cancel_goods_receipt is SECURITY DEFINER', 'true',
      (select prosecdef from pg_proc where oid = to_regprocedure('public.cancel_goods_receipt(uuid,text,text,date)'))::text
  union all select 'rpc: authenticated may execute', 'true', has_function_privilege('authenticated', 'public.cancel_goods_receipt(uuid,text,text,date)', 'execute')::text
  union all select 'rpc: anon may not execute', 'false', has_function_privilege('anon', 'public.cancel_goods_receipt(uuid,text,text,date)', 'execute')::text
  union all select 'guards: 7 P08 triggers present', '7', (select count(*) from pg_trigger where not tgisinternal and tgname in (
      'purchase_receipt_cancellation_immutable', 'purchase_receipt_cancellation_no_truncate', 'goods_receipt_void_guard', 'goods_receipt_item_void_guard',
      'purchase_receipt_void_move_guard', 'purchase_receipt_void_journal_guard', 'purchase_receipt_void_journal_lines_guard'))::text
  union all select 'average: valuation treats purchase-receipt-void like invoice void', 'true',
      (select position('purchase-receipt-void' in prosrc) > 0 from pg_proc where oid = to_regprocedure('public.inventory_record_valuation()'))::text
  union all select 'data: no receipt cancelled by the apply itself', '0', (select count(*) from public.goods_receipts where voided_at is not null)::text
  union all select 'data: no cancellation rows yet', '0', (select count(*) from public.purchase_receipt_cancellations)::text
)
select check_name, expected, actual, actual is not distinct from expected as ok from checks
union all
select 'SUMMARY', '0 failed', count(*) filter (where actual is distinct from expected) || ' failed', count(*) filter (where actual is distinct from expected) = 0
from checks;
rollback;
