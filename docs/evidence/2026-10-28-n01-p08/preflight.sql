-- N01/P08 PREFLIGHT — read-only. Every row of the first query must say ok=true before apply.sql.
-- Safe to run any time; it changes nothing.
-- Exact md5 of pg_get_functiondef: main's body (= hosted PG17.6, local PG16/17),
-- or the exact body this package produces (already applied). Nothing else passes.
select 'cancel_goods_receipt is main or already applied' as check_name,
  md5(pg_get_functiondef('public.cancel_goods_receipt(uuid,text,text,date)'::regprocedure)) in('03b31359e9f7b0764993761c9074a411','665ae8b79fd6051032c827d984c8d641') as ok
union all
select 'guard_purchase_advance_receipt is main or already applied',
  md5(pg_get_functiondef('public.guard_purchase_advance_receipt()'::regprocedure)) in('e99841e188e4470563456bfdf89e162b','f1db6d1f5b115eb978de21b79c2cdd92')
union all
select 'revise_purchase_order is main or already applied',
  md5(pg_get_functiondef('public.revise_purchase_order(text,uuid,integer,text,jsonb,jsonb,text)'::regprocedure)) in('1abc1231704fb392e3634065a1a4fa93','7b10b6e7265dab80c707c2aa4789cc96')
union all
select 'revise_purchase_order_prices is main or already applied',
  md5(pg_get_functiondef('public.revise_purchase_order_prices(text,uuid,integer,jsonb,text)'::regprocedure)) in('2cd59070532a340c4e769deb243e9830','d09a46cf61d03bd584fced36f6c73386')
-- Called unchanged by the new RPCs: must be exactly main.
union all
select 'create_purchase_invoice_from_po (13 args) is main',
  md5(pg_get_functiondef('public.create_purchase_invoice_from_po(uuid,text,integer,text,date,date,text,jsonb,jsonb,jsonb,numeric,text,uuid)'::regprocedure))='3d6acbcaefde9f9a62d4b789d504c2be'
union all
select 'cancel_purchase_payment is main',
  md5(pg_get_functiondef('public.cancel_purchase_payment(uuid,integer,text,text)'::regprocedure))='a74d7a1099b5fcb5d88c25ac47c06943'
union all
select 'cancel_purchase_advance_atomic is main',
  md5(pg_get_functiondef('public.cancel_purchase_advance_atomic(uuid)'::regprocedure))='dd593619e0b8798eb17baa3001e55dea'
union all
select 'goods receipt cancellation (P08 20261028190000) present', exists(select 1 from information_schema.columns where table_schema='public' and table_name='goods_receipts' and column_name='voided_at')
union all
select 'purchase_invoice_layer_proofs exists', to_regclass('public.purchase_invoice_layer_proofs') is not null
union all
select 'purchase_operations exists', to_regclass('public.purchase_operations') is not null
union all
select 'purchase_advance_cancellations exists', to_regclass('public.purchase_advance_cancellations') is not null;

-- Informational (no pass/fail): already applied? and how many active PO invoices exist (all stay "no link").
select to_regclass('public.purchase_invoice_receipts') is not null as links_table_present,
  to_regprocedure('public.cancel_purchase_advance_cascade(uuid,text,text,text)') is not null as cascade_rpc_present,
  (select count(*) from public.purchase_invoices where po_id is not null and voided_at is null) as active_po_invoices,
  (select count(*) from public.purchase_advances where status='aktif' and terpakai>0) as used_active_advances;
