-- N01/P08 READBACK — read-only. Every row must say ok=true after apply.sql.
select 'cancel_goods_receipt applied' as check_name,
  md5(pg_get_functiondef('public.cancel_goods_receipt(uuid,text,text,date)'::regprocedure))='665ae8b79fd6051032c827d984c8d641' as ok
union all
select 'guard_purchase_advance_receipt applied', md5(pg_get_functiondef('public.guard_purchase_advance_receipt()'::regprocedure))='f1db6d1f5b115eb978de21b79c2cdd92'
union all
select 'revise_purchase_order applied', md5(pg_get_functiondef('public.revise_purchase_order(text,uuid,integer,text,jsonb,jsonb,text)'::regprocedure))='7b10b6e7265dab80c707c2aa4789cc96'
union all
select 'revise_purchase_order_prices applied', md5(pg_get_functiondef('public.revise_purchase_order_prices(text,uuid,integer,jsonb,text)'::regprocedure))='d09a46cf61d03bd584fced36f6c73386'
union all
select 'links table with RLS', (select relrowsecurity from pg_class where oid='public.purchase_invoice_receipts'::regclass)
union all
select 'one active invoice per receipt index', exists(select 1 from pg_indexes where schemaname='public' and indexname='purchase_invoice_receipts_one_active' and indexdef like '%UNIQUE%WHERE active%')
union all
select 'links readable, not writable by app users', has_table_privilege('authenticated','public.purchase_invoice_receipts','select')
  and not has_table_privilege('authenticated','public.purchase_invoice_receipts','insert')
  and not has_table_privilege('authenticated','public.purchase_invoice_receipts','delete')
union all
select 'void sync trigger on purchase_invoices', exists(select 1 from pg_trigger where tgname='purchase_invoice_receipt_active_sync' and tgrelid='public.purchase_invoices'::regclass)
union all
select 'invoice-with-receipts RPC for app users', has_function_privilege('authenticated','public.create_purchase_invoice_from_po_receipts(uuid,text,integer,text,date,date,text,jsonb,jsonb,jsonb,numeric,text,uuid,uuid[])','execute')
  and not has_function_privilege('anon','public.create_purchase_invoice_from_po_receipts(uuid,text,integer,text,date,date,text,jsonb,jsonb,jsonb,numeric,text,uuid,uuid[])','execute')
union all
select 'cascade + preview RPCs for app users (OWNER checked inside)',
  has_function_privilege('authenticated','public.cancel_purchase_advance_cascade(uuid,text,text,text)','execute')
  and has_function_privilege('authenticated','public.preview_purchase_advance_cascade(uuid)','execute')
  and not has_function_privilege('anon','public.cancel_purchase_advance_cascade(uuid,text,text,text)','execute')
union all
select 'cascade requires the preview fingerprint (no default)', (select pronargdefaults = 0 from pg_proc where oid = 'public.cancel_purchase_advance_cascade(uuid,text,text,text)'::regprocedure)
union all
select 'cascade plan is internal', not has_function_privilege('authenticated','public.purchase_advance_cascade_plan(uuid)','execute')
union all
select 'cascade evidence hidden from app users', not has_table_privilege('authenticated','public.purchase_advance_cascade_cancellations','select');
