-- Recompute derived statistics from complete global history without returning
-- cross-branch transactions. Existing table ACL/RLS and points remain unchanged.
create function public.refresh_customer_spending(p_customer uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare spending numeric:=0; s record; returned numeric; goods numeric; cfg public.tier_settings;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and is_active) then
  raise exception 'ACCESS_DENIED' using errcode='42501';
 end if;
 -- Source eligibility is checked with the caller's live branch authorization.
 -- Global aggregates below are write-only: no hidden transaction DTO is exposed.
 if not exists(select 1 from public.sales where customer_id=p_customer and public.user_can_access_branch(branch_id))
 and not exists(select 1 from public.visits where customer_id=p_customer and public.user_can_access_branch(branch_id)) then
  raise exception 'ACCESS_DENIED' using errcode='42501';
 end if;
 perform 1 from public.customers where id=p_customer for update;
 if not found then raise exception 'CUSTOMER_NOT_FOUND';end if;
 select * into cfg from public.tier_settings where id=1;
 if found and (cfg.bronze_min::text in ('NaN','Infinity','-Infinity') or cfg.silver_min::text in ('NaN','Infinity','-Infinity') or cfg.gold_min::text in ('NaN','Infinity','-Infinity') or cfg.platinum_min::text in ('NaN','Infinity','-Infinity')) then
  raise exception 'CUSTOMER_TIER_SETTINGS_INVALID';
 end if;
 for s in select id,total,merchant_fee_total from public.sales
 where customer_id=p_customer and voided_at is null and (payment_plan is null or payments_finalized_at is not null) loop
  select coalesce(sum(total),0) into returned from public.sales_returns where sale_id=s.id and voided_at is null;
  if s.total::text in ('NaN','Infinity','-Infinity') or s.merchant_fee_total::text in ('NaN','Infinity','-Infinity')
   or returned::text in ('NaN','Infinity','-Infinity') or s.total<0 or s.merchant_fee_total<0 or s.merchant_fee_total>s.total
   or returned<0 or returned>s.total
   or exists(select 1 from public.sales_returns where sale_id=s.id and voided_at is null and (total<0 or total<>round(total,2))) then
   raise exception 'CUSTOMER_RETURN_VALUE_INVALID';
  end if;
  -- Same cumulative cent allocation used by the source return journal.
  goods:=s.total-coalesce(s.merchant_fee_total,0)-returned+case when s.total>0 then round(coalesce(s.merchant_fee_total,0)*returned/s.total,2) else 0 end;
  spending:=spending+goods;
 end loop;
 for s in select i.total from public.invoices i join public.visits v on v.id=i.visit_id
 where v.customer_id=p_customer and i.paid_status='Lunas' and i.voided_at is null loop
  if s.total is null or s.total::text in ('NaN','Infinity','-Infinity') or s.total<0 then raise exception 'CUSTOMER_INVOICE_VALUE_INVALID';end if;
  spending:=spending+s.total;
 end loop;
 update public.customers set total_spending=spending,tier=case
  when spending>=coalesce(cfg.platinum_min,50000000) then 'Platinum'
  when spending>=coalesce(cfg.gold_min,15000000) then 'Gold'
  when spending>=coalesce(cfg.silver_min,5000000) then 'Silver'
  when spending>=coalesce(cfg.bronze_min,1000000) then 'Bronze' else 'New' end where id=p_customer;
 return true;
end $$;
revoke all on function public.refresh_customer_spending(uuid) from public,anon;
grant execute on function public.refresh_customer_spending(uuid) to authenticated;

-- Keep legacy online and cancellation writes from restoring gross pre-return
-- customer statistics. Replace one reviewed source anchor per function, preserving
-- function identity, ownership and ACL; fail rollout on unexpected schema drift.
do $patch$ declare definition text; anchor text; signature text; customer_expr text;begin
 signature:='public.post_online_order(text,jsonb,jsonb)';
 definition:=pg_get_functiondef(signature::regprocedure);
 anchor:=$anchor$  update public.customers set total_spending=spending,tier=case when spending>=coalesce((select platinum_min from public.tier_settings where id=1),50000000) then 'Platinum' when spending>=coalesce((select gold_min from public.tier_settings where id=1),15000000) then 'Gold' when spending>=coalesce((select silver_min from public.tier_settings where id=1),5000000) then 'Silver' when spending>=coalesce((select bronze_min from public.tier_settings where id=1),1000000) then 'Bronze' else 'New' end where id=customer;$anchor$;
 if position(anchor in definition)=0 or length(definition)-length(replace(definition,anchor,''))<>length(anchor) then
  raise exception 'CUSTOMER_SPENDING_SCHEMA_DRIFT: %',signature;
 end if;
 execute replace(definition,anchor,anchor||E'\n  perform public.refresh_customer_spending(customer);');
 signature:='public.cancel_posted_sale(uuid,integer,text,text)';
 definition:=pg_get_functiondef(signature::regprocedure);
 anchor:=$anchor$  update public.customers set points=balance-v_delta,total_spending=spending,tier=case when spending>=coalesce((select platinum_min from public.tier_settings where id=1),50000000) then 'Platinum' when spending>=coalesce((select gold_min from public.tier_settings where id=1),15000000) then 'Gold' when spending>=coalesce((select silver_min from public.tier_settings where id=1),5000000) then 'Silver' when spending>=coalesce((select bronze_min from public.tier_settings where id=1),1000000) then 'Bronze' else 'New' end where id=s.customer_id;$anchor$;
 if position(anchor in definition)=0 or length(definition)-length(replace(definition,anchor,''))<>length(anchor) then
  raise exception 'CUSTOMER_SPENDING_SCHEMA_DRIFT: %',signature;
 end if;
 execute replace(definition,anchor,anchor||E'\n  perform public.refresh_customer_spending(s.customer_id);');
end $patch$;
