-- Value corrections follow the captured accounting method; FIFO/FEFO physical
-- provenance continues to prove which acquisition layers can be restored.
create function pg_temp.patch_average_correction(p_function regprocedure,p_old text,p_new text)
returns void language plpgsql as $patch$
declare definition text:=pg_get_functiondef(p_function);
begin
 if (length(definition)-length(replace(definition,p_old,'')))/length(p_old)<>1 then
  raise exception 'Average correction patch anchor mismatch: % / %',p_function,left(p_old,100);
 end if;
 execute replace(definition,p_old,p_new);
end;
$patch$;

-- Legacy movement snapshots predate these metadata columns. Ignore a new field
-- only when that exact source snapshot did not contain it; all old fields and
-- all metadata captured by new snapshots must still match exactly.
create function public.purchase_invoice_compatible_movement_snapshot(p_source text,p_ref text,p_snapshot jsonb)
returns jsonb language sql security definer set search_path='' as $$
 select coalesce(jsonb_agg(
  to_jsonb(m) - case when prior.value ? 'cost_method' then '{}'::text[] else array['cost_method'] end
             - case when prior.value ? 'valuation_adjustment' then '{}'::text[] else array['valuation_adjustment'] end
  order by m.id),'[]'::jsonb)
 from public.stock_moves m
 left join lateral (
  select value from jsonb_array_elements(p_snapshot) where value->>'id'=m.id::text
 ) prior on true
 where m.source=p_source and m.source_ref=p_ref;
$$;
revoke all on function public.purchase_invoice_compatible_movement_snapshot(text,text,jsonb) from public,anon,authenticated,service_role;

-- Canonical PO invoices already hold aggregate stocks before receipt layers.
-- Add only the layer-value change to the independent average carrying value.
select pg_temp.patch_average_correction(
 'public.create_purchase_invoice_from_po(uuid,text,integer,text,date,date,text,jsonb,jsonb,jsonb,numeric,text,uuid)'::regprocedure,
$old$declare po public.purchase_orders%rowtype;$old$,
$new$declare v_average_row record; po public.purchase_orders%rowtype;$new$);
select pg_temp.patch_average_correction(
 'public.create_purchase_invoice_from_po(uuid,text,integer,text,date,date,text,jsonb,jsonb,jsonb,numeric,text,uuid)'::regprocedure,
$old$begin
 perform public.purchase_assert_access('invoice',null);$old$,
$new$begin
 perform public.inventory_assert_open_date(p_tanggal);
 perform public.purchase_assert_access('invoice',null);$new$);
select pg_temp.patch_average_correction(
 'public.create_purchase_invoice_from_po(uuid,text,integer,text,date,date,text,jsonb,jsonb,jsonb,numeric,text,uuid)'::regprocedure,
$old$update public.purchase_invoice_postings set movement_ids=$old$,
$new$if public.inventory_is_average() then
  for v_average_row in
   select coalesce(prior.item_id,current_layers.item_id) item_id,
    coalesce(current_layers.value,0)-coalesce(prior.value,0) delta
   from (select x.item_id,sum(x.qty_left*x.unit_cost) value from jsonb_to_recordset(before_layers)x(item_id uuid,qty_left numeric,unit_cost numeric) group by x.item_id) prior
   full join (select l.item_id,sum(l.qty_left*l.unit_cost) value from public.stock_layers l
    where l.warehouse_id=po.to_warehouse_id and l.source='purchase' and l.source_ref=po.no_po group by l.item_id) current_layers using(item_id)
   order by item_id
  loop
   perform public.inventory_apply_cost_adjustment(po.to_warehouse_id,v_average_row.item_id,v_average_row.delta,p_tanggal,'purchase-reprice',result->>'no_faktur');
  end loop;
 end if;
 update public.purchase_invoice_postings set movement_ids=$new$);

select pg_temp.patch_average_correction('public.cancel_purchase_invoice(uuid,integer,text,text,date)'::regprocedure,
$old$declare inv public.purchase_invoices%rowtype;$old$,
$new$declare v_average_before jsonb; v_average_row record; inv public.purchase_invoices%rowtype;$new$);
select pg_temp.patch_average_correction('public.cancel_purchase_invoice(uuid,integer,text,text,date)'::regprocedure,
$old$begin
 perform public.purchase_assert_access('invoice',null);$old$,
$new$begin
 perform public.inventory_assert_open_date(p_tanggal);
 perform public.purchase_assert_access('invoice',null);$new$);
select pg_temp.patch_average_correction('public.cancel_purchase_invoice(uuid,integer,text,text,date)'::regprocedure,
$old$(select coalesce(jsonb_agg(to_jsonb(m) order by m.id),'[]') from public.stock_moves m where source='faktur-langsung' and source_ref=inv.no_faktur) is distinct from proof.stock_moves$old$,
$new$public.purchase_invoice_compatible_movement_snapshot('faktur-langsung',inv.no_faktur,proof.stock_moves) is distinct from proof.stock_moves$new$);
select pg_temp.patch_average_correction('public.cancel_purchase_invoice(uuid,integer,text,text,date)'::regprocedure,
$old$ lock table public.journal_entries in share row exclusive mode;$old$,
$new$ if inv.po_id is not null and public.inventory_is_average() then
  select jsonb_agg(to_jsonb(x)) into v_average_before from (
   select l.item_id,sum(l.qty_left*l.unit_cost) value from public.stock_layers l
   where l.warehouse_id=proof.warehouse_id and l.item_id in(select item_id from public.purchase_invoice_items where invoice_id=inv.id)
   group by l.item_id
  ) x;
 end if;
 lock table public.journal_entries in share row exclusive mode;$new$);
select pg_temp.patch_average_correction('public.cancel_purchase_invoice(uuid,integer,text,text,date)'::regprocedure,
$old$ -- A PO correction changes valuation only; zero-quantity card entries retain the correction trail.$old$,
$new$ if public.inventory_is_average() then
   for v_average_row in
    select prior_value.item_id,coalesce(sum(l.qty_left*l.unit_cost),0)-prior_value.value delta
    from jsonb_to_recordset(v_average_before) prior_value(item_id uuid,value numeric)
    left join public.stock_layers l on l.warehouse_id=proof.warehouse_id and l.item_id=prior_value.item_id
    group by prior_value.item_id,prior_value.value order by prior_value.item_id
   loop
    perform public.inventory_apply_cost_adjustment(proof.warehouse_id,v_average_row.item_id,v_average_row.delta,p_tanggal,'purchase-reprice-void',inv.no_faktur);
   end loop;
  end if;
  -- A PO correction changes valuation only; zero-quantity card entries retain the correction trail.$new$);

-- This old public helper has no document date, journal identity, or idempotency
-- key. Keep FIFO compatibility; average corrections use the official invoice RPC.
select pg_temp.patch_average_correction('public.reprice_purchase_invoice_layers(jsonb,jsonb)'::regprocedure,
$old$begin
  if jsonb_typeof$old$,
$new$begin
  if public.inventory_is_average() then
    raise exception 'Penyesuaian HPP average harus melalui faktur resmi';
  end if;
  if jsonb_typeof$new$);

-- Sale values come from the issue's recorded method, never today's setting.
-- Physical takes still carry acquisition costs and prove exact restorability.
create or replace function public.assert_sale_group_cost_links(p_sale uuid) returns void
language plpgsql security definer set search_path='' as $$
declare r record;part record;ref text;raw_cost numeric;captured_qty numeric;captured_hpp numeric;
begin
 select no_struk into ref from public.sales where id=p_sale;
 if exists(select 1 from public.stock_moves m where m.source_ref=ref and m.source='sale-group' and not exists(
  select 1 from public.sale_items i join public.sale_item_group_components c on c.sale_item_id=i.id
   where i.id=m.sale_line_id and i.sale_id=p_sale and c.component_item_id=m.item_id and c.item_type='Persediaan'
 )) then raise exception 'Rincian FIFO belum terhubung ke grup sumber; rekonsiliasi diperlukan';end if;
 for r in select i.* from public.sale_items i where i.sale_id=p_sale and exists(select 1 from public.sale_item_group_components c where c.sale_item_id=i.id) order by i.id loop
  if exists(select 1 from public.sale_item_group_components where sale_item_id=r.id and item_type<>'Persediaan' and hpp<>0) then raise exception 'HPP komponen tanpa stok tidak sesuai';end if;
  for part in select component_item_id,sum(total_base_qty) qty,sum(hpp) hpp from public.sale_item_group_components where sale_item_id=r.id and item_type='Persediaan' group by component_item_id loop
   select coalesce(-sum(m.qty),0),coalesce(sum(round(case when m.cost_method='moving_average' then -m.qty*m.unit_cost
     else (select sum(x.qty*x.unit_cost) from jsonb_to_recordset(m.fifo_takes) x(qty numeric,unit_cost numeric)) end,2)),0)
    into captured_qty,captured_hpp from public.stock_moves m where m.source_ref=ref and m.source='sale-group' and m.sale_line_id=r.id and m.item_id=part.component_item_id;
   if captured_qty<>part.qty or captured_hpp<>part.hpp then raise exception 'Jumlah atau HPP komponen tidak sesuai rincian FIFO sumber';end if;
  end loop;
  select coalesce(sum(case when m.cost_method='moving_average' then -m.qty*m.unit_cost
    else (select sum(x.qty*x.unit_cost) from jsonb_to_recordset(m.fifo_takes) x(qty numeric,unit_cost numeric)) end),0)
   into raw_cost from public.stock_moves m where m.source_ref=ref and m.source='sale-group' and m.sale_line_id=r.id;
  if round(raw_cost,2)<>r.hpp then raise exception 'HPP induk grup tidak sesuai rincian FIFO sumber';end if;
 end loop;
end$$;
revoke all on function public.assert_sale_group_cost_links(uuid) from public,anon,authenticated,service_role;

select pg_temp.patch_average_correction('public.cancel_posted_sale(uuid,integer,text,text)'::regprocedure,
$old$begin
 if auth.uid()$old$,
$new$begin
 perform public.inventory_assert_open_date((now() at time zone 'Asia/Jakarta')::date);
 if auth.uid()$new$);
select pg_temp.patch_average_correction('public.cancel_posted_sale(uuid,integer,text,text)'::regprocedure,
$old$coalesce(sum(round((select sum(taken.qty*taken.unit_cost) from jsonb_to_recordset(m.fifo_takes) taken(qty numeric,unit_cost numeric)),2)),0)$old$,
$new$coalesce(sum(round(case when m.cost_method='moving_average' then -m.qty*m.unit_cost else
 (select sum(taken.qty*taken.unit_cost) from jsonb_to_recordset(m.fifo_takes) taken(qty numeric,unit_cost numeric)) end,2)),0)$new$);
select pg_temp.patch_average_correction('public.cancel_posted_sale(uuid,integer,text,text)'::regprocedure,
$old$select coalesce(sum(taken.qty*taken.unit_cost),0) into inventory_cost from public.stock_moves m cross join lateral jsonb_to_recordset(m.fifo_takes) taken(qty numeric,unit_cost numeric) where source_ref=s.no_struk and source in('sale','sale-group','sale-online');$old$,
$new$select coalesce(sum(case when m.cost_method='moving_average' then -m.qty*m.unit_cost else
 (select sum(taken.qty*taken.unit_cost) from jsonb_to_recordset(m.fifo_takes) taken(qty numeric,unit_cost numeric)) end),0)
 into inventory_cost from public.stock_moves m where source_ref=s.no_struk and source in('sale','sale-group','sale-online');$new$);
select pg_temp.patch_average_correction('public.cancel_posted_sale(uuid,integer,text,text)'::regprocedure,
$old$or round((select sum(x.qty*x.unit_cost) from jsonb_to_recordset(r.fifo_takes) x(qty numeric,unit_cost numeric)),2) is distinct from round(-r.qty*r.unit_cost,2) then$old$,
$new$or (r.cost_method is distinct from 'moving_average' and
    round((select sum(x.qty*x.unit_cost) from jsonb_to_recordset(r.fifo_takes) x(qty numeric,unit_cost numeric)),2) is distinct from round(-r.qty*r.unit_cost,2)) then$new$);

-- A receipt covering old negative stock has fewer physical units than its
-- original movement. Even a later receipt cannot make reversing the whole
-- original receipt safe: that would leave unmatched layers and old HPP/variance.
select pg_temp.patch_average_correction('public.cancel_purchase_invoice(uuid,integer,text,text,date)'::regprocedure,
$old$ if inv.voided_at is not null or inv.revision is distinct from p_expected_revision then$old$,
$new$ if inv.po_id is null and exists (
  select 1 from public.inventory_cost_events e join public.stock_moves m on m.id=e.movement_id
  where m.source='faktur-langsung' and m.source_ref=inv.no_faktur and m.warehouse_id=proof.warehouse_id
    and e.qty_delta>0 and e.qty_after-e.qty_delta<0
 ) then
  raise exception 'Stok faktur pernah menutup stok negatif. Rekonsiliasi stok dan HPP sebelum pembatalan';
 end if;
 if inv.voided_at is not null or inv.revision is distinct from p_expected_revision then$new$);
