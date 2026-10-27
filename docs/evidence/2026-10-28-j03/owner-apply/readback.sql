-- J03 READBACK — READ ONLY. Run after apply; every row must show ok = true.
with checks(name, ok) as (values
 ('tables installed with RLS', (select count(*) from pg_class where oid in(to_regclass('public.clinic_refunds'),to_regclass('public.clinic_refund_items'),to_regclass('public.clinic_refund_requests')) and relrowsecurity)=3),
 ('bank destinations not readable directly', not has_table_privilege('authenticated','public.clinic_refund_requests','SELECT')),
 ('public RPCs granted', has_function_privilege('authenticated','public.post_clinic_refund(uuid,text,jsonb,jsonb)','EXECUTE')
   and has_function_privilege('authenticated','public.claim_clinic_refund_request(uuid)','EXECUTE')
   and has_function_privilege('authenticated','public.complete_clinic_refund_request(uuid,date,uuid,text)','EXECUTE')
   and has_function_privilege('authenticated','public.cancel_clinic_refund_request(uuid,text,boolean)','EXECUTE')
   and has_function_privilege('authenticated','public.get_clinic_refund_requests(uuid,boolean,text,integer)','EXECUTE')
   and has_function_privilege('authenticated','public.get_clinic_refund_result(text)','EXECUTE')),
 ('internal functions not callable', not has_function_privilege('authenticated','public.clinic_refund_apply(uuid,date,uuid,uuid)','EXECUTE')
   and not has_function_privilege('authenticated','public.clinic_refund_quote(uuid,jsonb,uuid)','EXECUTE')
   and not has_function_privilege('authenticated','public.refund_point_deduction(uuid,integer,integer,numeric,numeric,text,text)','EXECUTE')),
 ('guards installed', (select count(*) from pg_trigger where tgname in('clinic_refund_invoice_guard','clinic_refund_invoice_line_guard','clinic_refund_expense_guard','clinic_refund_items_immutable','clinic_refunds_immutable'))=5),
 ('source core accepts money-only lines', position($n$or(x.jenis='obat'and x.item_id is not null and x.compound_recipe_id is null and(x.faktor is null$n$ in pg_get_functiondef('public.clinic_refund_source_core(uuid)'::regprocedure))>0),
 ('petshop point refusal lifted', position('Transaksi berpoin memerlukan' in pg_get_functiondef('public.sales_refund_quote(uuid,jsonb,uuid)'::regprocedure))=0),
 ('petshop payout deducts points', position('refund_point_deduction' in pg_get_functiondef('public.pos_sale_post_refund_selected(public.sales,uuid,text,date,numeric,jsonb,text,jsonb)'::regprocedure))>0),
 ('customer spending net of clinic refunds', position('public.clinic_refunds' in pg_get_functiondef('public.refresh_customer_spending(uuid)'::regprocedure))>0),
 ('activity index registered', (select count(*) from public.activity_log_sources where entity in('clinic_refunds','clinic_refund_requests'))=2),
 ('no refund rows yet (fresh install)', (select count(*) from public.clinic_refunds)=0 and (select count(*) from public.clinic_refund_requests)=0)
)
select name, ok from checks
union all select 'SUMMARY: '||count(*) filter(where not ok)||' failed', count(*) filter(where not ok)=0 from checks;
