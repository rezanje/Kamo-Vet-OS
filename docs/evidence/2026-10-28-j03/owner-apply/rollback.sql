-- J03 ROLLBACK — only if the owner decides to withdraw J03 BEFORE any clinic refund is used.
-- Refuses when any clinic refund or request exists (money already moved / requested).
begin;
do $$begin
 if to_regclass('public.clinic_refunds') is not null and (exists(select 1 from public.clinic_refunds) or exists(select 1 from public.clinic_refund_requests)) then
  raise exception 'J03 rollback refused: clinic refunds/requests exist. Reconcile instead of dropping.';end if;
 if exists(select 1 from public.sales_refund_payouts where point_delta<>0) then
  raise exception 'J03 rollback refused: petshop refunds already deducted points. Reconcile instead.';end if;
end$$;

-- Reverse the text patches (exact inverse replacements).
do $patch$declare body text;begin
 body:=pg_get_functiondef('public.pos_sale_post_refund_selected(public.sales,uuid,text,date,numeric,jsonb,text,jsonb)'::regprocedure);
 body:=replace(body,$n$values(p_doc,p_sale.id,p_sale.branch_id,method,expense,request.id,to_jsonb(account),p_total,auth.uid());
 update public.sales_refund_payouts set point_delta=-public.refund_point_deduction(p_sale.customer_id,coalesce(p_sale.poin_earned,0),(select coalesce(-sum(x.point_delta),0)::integer from public.sales_refund_payouts x where x.sale_id=p_sale.id),cumulative,p_sale.total,p_no,'Refund '||p_no||' (struk '||p_sale.no_struk||')') where return_id=p_doc;$n$,
  $o$values(p_doc,p_sale.id,p_sale.branch_id,method,expense,request.id,to_jsonb(account),p_total,auth.uid());$o$);execute body;
 body:=pg_get_functiondef('public.sales_refund_quote(uuid,jsonb,uuid)'::regprocedure);
 body:=replace(body,$n$null; -- J03: earned points are deducted proportionally when the refund posts$n$,
  $o$raise exception 'Transaksi berpoin memerlukan rekonsiliasi pembalikan poin. Refund baru belum diposting';$o$);execute body;
 body:=pg_get_functiondef('public.refresh_customer_spending(uuid)'::regprocedure);
 body:=replace(body,$n$for s in select i.total-coalesce((select sum(f.total) from public.clinic_refunds f where f.invoice_id=i.id),0) as total from public.invoices i join public.visits v on v.id=i.visit_id$n$,
  $o$for s in select i.total from public.invoices i join public.visits v on v.id=i.visit_id$o$);execute body;
 body:=pg_get_functiondef('public.clinic_refund_source_core(uuid)'::regprocedure);
 body:=replace(body,$n$or(x.jenis='obat'and x.item_id is not null and x.compound_recipe_id is null and(x.faktor is null$n$,
  $o$or x.compound_recipe_id is not null or x.bmhp_components is not null or(x.jenis='obat'and(x.item_id is null or x.faktor is null$o$);
 body:=replace(body,$n$where invoice_id=i.id and jenis='obat'and item_id is not null and compound_recipe_id is null group by item_id loop$n$,
  $o$where invoice_id=i.id and jenis='obat'group by item_id loop$o$);execute body;
end$patch$;

drop trigger if exists clinic_refund_invoice_guard on public.invoices;
drop trigger if exists clinic_refund_invoice_line_guard on public.invoice_items;
drop trigger if exists clinic_refund_expense_guard on public.expenses;
delete from public.activity_log_sources where entity in('clinic_refunds','clinic_refund_requests');
drop function if exists public.post_clinic_refund(uuid,text,jsonb,jsonb);
drop function if exists public.claim_clinic_refund_request(uuid);
drop function if exists public.complete_clinic_refund_request(uuid,date,uuid,text);
drop function if exists public.cancel_clinic_refund_request(uuid,text,boolean);
drop function if exists public.get_clinic_refund_result(text);
drop function if exists public.get_clinic_refund_requests(uuid,boolean,text,integer);
drop function if exists public.clinic_refund_apply(uuid,date,uuid,uuid);
drop function if exists public.clinic_refund_quote(uuid,jsonb,uuid);
drop table if exists public.clinic_refund_items;
alter table if exists public.clinic_refund_requests drop constraint if exists clinic_refund_requests_refund_fk;
drop table if exists public.clinic_refunds;
drop table if exists public.clinic_refund_requests;
drop function if exists public.guard_refunded_clinic_invoice();
drop function if exists public.guard_clinic_refund_expense();
drop function if exists public.guard_clinic_refund_immutable();
drop function if exists public.guard_clinic_refund_header();
drop function if exists public.clinic_refund_actor_access(uuid,text);
drop function if exists public.clinic_refund_finance_access(uuid);
drop function if exists public.clinic_refund_number(date);
drop function if exists public.refund_point_deduction(uuid,integer,integer,numeric,numeric,text,text);
commit;
