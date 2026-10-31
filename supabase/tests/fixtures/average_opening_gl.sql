-- FICTIONAL TEST SUPPORT ONLY. Never install this temporary function in public.
-- Old average fixtures inserted physical stock without its accounting side.
-- Supply a deliberately designated fictional equity account and balanced opening
-- journal before their activation; do not bypass the production eligibility guard.
create function pg_temp.seed_average_opening_gl() returns void
language plpgsql security definer set search_path='' as $$
declare r record;
begin
 if public.inventory_is_average() then raise exception 'Fixture opening must precede activation';end if;
 insert into public.coa_accounts(code,name,type,normal_balance,is_header)
 values('3198','Fiction test-only designated opening equity','EKUITAS','K',false)
 on conflict(code) do nothing;
 for r in
  with physical as(select w.branch_id,sum(l.qty_left*l.unit_cost) value from public.stock_layers l join public.warehouses w on w.id=l.warehouse_id group by 1),
  ledger as(select e.branch_id,sum(l.debit-l.credit) value from public.journal_lines l join public.journal_entries e on e.id=l.entry_id join public.coa_accounts a on a.id=l.account_id where a.code='170001' group by 1)
  select p.branch_id,coalesce(p.value,0)-coalesce(g.value,0) delta from physical p full join ledger g using(branch_id)
 loop
  if r.delta=0 then continue;end if;
  perform public.sales_write_journal(current_date,r.branch_id,'manual','TEST-AVG-'||left(coalesce(r.branch_id::text,'GLOBAL'),8),'Fiction explicit opening audit fixture',jsonb_build_array(
   jsonb_build_object('code','170001','debit',greatest(r.delta,0),'credit',greatest(-r.delta,0)),
   jsonb_build_object('code','3198','debit',greatest(-r.delta,0),'credit',greatest(r.delta,0))));
 end loop;
end $$;
