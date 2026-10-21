-- Keep FEFO provenance independent of the cost recognized when dispensing.
-- Existing issues were valued at their physical layer cost under FIFO.
alter table public.compound_issues add column physical_unit_cost numeric;
update public.compound_issues set physical_unit_cost=unit_cost;
alter table public.compound_issues alter column physical_unit_cost set not null;

-- Guard every surgical replacement so a changed upstream definition fails the
-- migration instead of silently leaving one stock-writing branch on FIFO.
create function pg_temp.patch_average_caller(p_function regprocedure,p_old text,p_new text)
returns void language plpgsql as $patch$
declare v_definition text:=pg_get_functiondef(p_function);
begin
  if (length(v_definition)-length(replace(v_definition,p_old,'')))/length(p_old)<>1 then
    raise exception 'Moving-average caller patch anchor mismatch: % / %',p_function,left(p_old,100);
  end if;
  execute replace(v_definition,p_old,p_new);
end;
$patch$;

select pg_temp.patch_average_caller('public.clinic_post_invoice(uuid,text,jsonb,jsonb)'::regprocedure,
$old$  v_layer record;$old$,
$new$  v_layer record;
  v_average boolean;
  v_effective_cost numeric;$new$);

select pg_temp.patch_average_caller('public.clinic_post_invoice(uuid,text,jsonb,jsonb)'::regprocedure,
$old$begin
  v_call_role := coalesce($old$,
$new$begin
  perform public.inventory_assert_open_date(nullif(p_invoice ->> 'tanggal', '')::date);
  v_average := public.inventory_is_average();
  v_call_role := coalesce($new$);

select pg_temp.patch_average_caller('public.clinic_post_invoice(uuid,text,jsonb,jsonb)'::regprocedure,
$old$if v_layer.unit_cost <= 0 then$old$,
$new$if not v_average and (v_layer.unit_cost is null or v_layer.unit_cost <= 0) then$new$);

select pg_temp.patch_average_caller('clinic_private.clinic_issue_compound(uuid,uuid,jsonb,text)'::regprocedure,
$old$  v_layer record;$old$,
$new$  v_layer record;
  v_average boolean;
  v_effective_cost numeric;$new$);

select pg_temp.patch_average_caller('clinic_private.clinic_issue_compound(uuid,uuid,jsonb,text)'::regprocedure,
$old$begin
  v_call_role := coalesce($old$,
$new$begin
  perform public.inventory_assert_open_date(current_date);
  v_average := public.inventory_is_average();
  v_call_role := coalesce($new$);

select pg_temp.patch_average_caller('clinic_private.clinic_issue_compound(uuid,uuid,jsonb,text)'::regprocedure,
$old$if v_layer.unit_cost <= 0 then$old$,
$new$if not v_average and (v_layer.unit_cost is null or v_layer.unit_cost <= 0) then$new$);

select pg_temp.patch_average_caller('public.clinic_post_invoice(uuid,text,jsonb,jsonb)'::regprocedure,
$old$      v_line_hpp := 0;$old$,
$new$      v_line_hpp := 0;
      v_effective_cost := null;
      if v_average then
        v_effective_cost := public.inventory_effective_unit_cost(v_warehouse_id,v_item_id);
        if v_effective_cost is null or v_effective_cost <= 0 or v_effective_cost::text in ('NaN','Infinity','-Infinity') then
          raise exception using errcode='P0001', message=format('COST_MISSING: %s',coalesce(v_item_name,v_description));
        end if;
      end if;$new$);

select pg_temp.patch_average_caller('public.clinic_post_invoice(uuid,text,jsonb,jsonb)'::regprocedure,
$old$v_line_hpp := v_line_hpp + v_take * v_layer.unit_cost;$old$,
$new$v_line_hpp := v_line_hpp + v_take * coalesce(v_effective_cost,v_layer.unit_cost);$new$);

select pg_temp.patch_average_caller('public.clinic_post_invoice(uuid,text,jsonb,jsonb)'::regprocedure,
$old$(v_line_hpp / nullif(v_base_qty, 0)), 'klinik'$old$,
$new$(case when v_average then v_effective_cost else v_line_hpp / nullif(v_base_qty, 0) end), 'klinik'$new$);

select pg_temp.patch_average_caller('clinic_private.clinic_issue_compound(uuid,uuid,jsonb,text)'::regprocedure,
$old$    v_cost := 0;$old$,
$new$    v_cost := 0;
    v_effective_cost := null;
    if v_average then
      v_effective_cost := public.inventory_effective_unit_cost(v_warehouse_id,v_ingredient.item_id);
      if v_effective_cost is null or v_effective_cost <= 0 or v_effective_cost::text in ('NaN','Infinity','-Infinity') then
        raise exception using errcode='P0001', message=format('COST_MISSING: %s',coalesce(v_item_name,'bahan racikan'));
      end if;
    end if;$new$);

select pg_temp.patch_average_caller('clinic_private.clinic_issue_compound(uuid,uuid,jsonb,text)'::regprocedure,
$old$stock_layer_id, qty, unit_cost, exp_date$old$,
$new$stock_layer_id, qty, unit_cost, physical_unit_cost, exp_date$new$);

select pg_temp.patch_average_caller('clinic_private.clinic_issue_compound(uuid,uuid,jsonb,text)'::regprocedure,
$old$v_layer.id, v_take, v_layer.unit_cost, v_layer.exp_date$old$,
$new$v_layer.id, v_take, coalesce(v_effective_cost,v_layer.unit_cost), v_layer.unit_cost, v_layer.exp_date$new$);

select pg_temp.patch_average_caller('clinic_private.clinic_issue_compound(uuid,uuid,jsonb,text)'::regprocedure,
$old$v_cost := v_cost + (v_take * v_layer.unit_cost);$old$,
$new$v_cost := v_cost + (v_take * coalesce(v_effective_cost,v_layer.unit_cost));$new$);

select pg_temp.patch_average_caller('public.clinic_void_compound(uuid)'::regprocedure,
$old$begin
  v_call_role := coalesce($old$,
$new$begin
  perform public.inventory_assert_open_date(current_date);
  v_call_role := coalesce($new$);

select pg_temp.patch_average_caller('public.clinic_void_compound(uuid)'::regprocedure,
$old$select i.id, i.warehouse_id, i.item_id, i.qty, i.unit_cost, i.exp_date$old$,
$new$select i.id, i.warehouse_id, i.item_id, i.qty, i.unit_cost, i.physical_unit_cost, i.exp_date$new$);

select pg_temp.patch_average_caller('public.clinic_void_compound(uuid)'::regprocedure,
$old$v_issue.qty, v_issue.qty, v_issue.unit_cost, 'racik'$old$,
$new$v_issue.qty, v_issue.qty, v_issue.physical_unit_cost, 'racik'$new$);

select pg_temp.patch_average_caller('public.sales_post_order(text,uuid,text,jsonb,jsonb)'::regprocedure,
$old$  v_is_inventory boolean; v_lines jsonb:='[]'; v_count integer;$old$,
$new$  v_is_inventory boolean; v_lines jsonb:='[]'; v_count integer;
  v_average boolean; v_effective_cost numeric;$new$);

select pg_temp.patch_average_caller('public.sales_post_order(text,uuid,text,jsonb,jsonb)'::regprocedure,
$old$begin
  if p_kind not in$old$,
$new$begin
  v_average:=public.inventory_is_average();
  if p_kind not in$new$);

-- Keep the established accounting-period error while checking the inventory
-- close before any stock balance/layer locks. The method read above already
-- acquires the global shared lock before the order row is locked.
select pg_temp.patch_average_caller('public.sales_post_order(text,uuid,text,jsonb,jsonb)'::regprocedure,
$old$if exists(select 1 from public.accounting_locks where id and v_date<=closed_until) then raise exception 'Periode akuntansi sudah ditutup'; end if;$old$,
$new$if exists(select 1 from public.accounting_locks where id and v_date<=closed_until) then raise exception 'Periode akuntansi sudah ditutup'; end if;
  perform public.inventory_assert_open_date(v_date);$new$);

select pg_temp.patch_average_caller('public.sales_post_order(text,uuid,text,jsonb,jsonb)'::regprocedure,
$old$        v_left:=v_qty;$old$,
$new$        v_left:=v_qty;
        v_effective_cost:=null;
        if v_average then
          v_effective_cost:=public.inventory_effective_unit_cost(v_warehouse,v_row.item_id);
          if v_effective_cost is null or v_effective_cost<=0 or v_effective_cost::text in ('NaN','Infinity','-Infinity') then
            raise exception 'COST_MISSING: %',v_row.nama;
          end if;
        end if;$new$);

select pg_temp.patch_average_caller('public.sales_post_order(text,uuid,text,jsonb,jsonb)'::regprocedure,
$old$if v_layer.unit_cost is null or v_layer.unit_cost<=0 then$old$,
$new$if not v_average and (v_layer.unit_cost is null or v_layer.unit_cost<=0) then$new$);

select pg_temp.patch_average_caller('public.sales_post_order(text,uuid,text,jsonb,jsonb)'::regprocedure,
$old$v_hpp:=v_hpp+v_take*v_layer.unit_cost;$old$,
$new$v_hpp:=v_hpp+v_take*coalesce(v_effective_cost,v_layer.unit_cost);$new$);

select pg_temp.patch_average_caller('public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)'::regprocedure,
$old$begin
  if coalesce(auth.role()$old$,
$new$begin
  perform public.inventory_assert_open_date(current_date);
  if coalesce(auth.role()$new$);

select pg_temp.patch_average_caller('public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)'::regprocedure,
$old$if v_out.shortfall>0 or v_out.cost<=0 or exists(
          select 1 from jsonb_array_elements(v_out.takes) x where (x.value->>'unit_cost')::numeric<=0) then$old$,
$new$if v_out.shortfall>0 or v_out.cost<=0 or (not public.inventory_is_average() and exists(
          select 1 from jsonb_array_elements(v_out.takes) x where (x.value->>'unit_cost')::numeric<=0)) then$new$);

drop function pg_temp.patch_average_caller(regprocedure,text,text);
