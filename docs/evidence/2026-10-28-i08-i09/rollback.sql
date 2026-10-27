-- I08/I09 ROLLBACK — WRITES. Run only after an explicit owner decision.
-- One transaction. It restores main's behaviour: average production blocked
-- again, source reader without completion links, trace RPC removed. No data
-- rows are touched (the I08/I09 change wrote none).
-- Refuses while moving average is active and a job is running, because that job
-- could then never be completed; finish or reconcile it first.
begin;
do $guard$
begin
 if (select method='moving_average' from public.inventory_costing_settings where id)
  and exists(select 1 from public.production_orders where status='berjalan') then
  raise exception 'Rollback ditolak: produksi average masih berjalan. Selesaikan dulu.';
 end if;
end$guard$;

do $restore$
declare definition text;anchor text:='update public.production_orders set nilai_bahan=total where id=oid returning * into doc;';
 lock_line text:='perform pg_advisory_xact_lock_shared(1962072401::bigint);'||E'\n '||'average:=public.inventory_is_average();';
 output_anchor text:=$mark$if total>0 then journal:=public.production_atomic_journal(dt,branch,ref,'Barang jadi masuk produksi '$mark$;
 material_guard text:=$guard$
  if average and (
   (select count(*) from public.stock_moves m where m.source='produksi' and m.source_ref=ref and m.qty<0)
    <> (select count(*) from public.inventory_cost_events e join public.stock_moves m on m.id=e.movement_id where m.source='produksi' and m.source_ref=ref and m.qty<0)
   or exists(select 1 from public.inventory_cost_events e join public.stock_moves m on m.id=e.movement_id where m.source='produksi' and m.source_ref=ref and m.qty<0
     and (e.value_delta is null or e.value_after is null or (e.qty_after>0 and e.average_after is null)))
   or abs((select coalesce(sum(e.value_delta),0) from public.inventory_cost_events e join public.stock_moves m on m.id=e.movement_id where m.source='produksi' and m.source_ref=ref and m.qty<0)+total)>=0.005
  ) then raise exception 'Valuasi average bahan tidak sesuai WIP; seluruh pekerjaan dibatalkan';end if;
$guard$;
 output_guard text:=$guard$
  if average and (
   (select count(*) from public.stock_moves m where m.source='produksi' and m.source_ref=ref and m.item_id=output_id and m.qty>0)
    <> (select count(*) from public.inventory_cost_events e join public.stock_moves m on m.id=e.movement_id where m.source='produksi' and m.source_ref=ref and m.item_id=output_id and m.qty>0)
   or exists(select 1 from public.inventory_cost_events e join public.stock_moves m on m.id=e.movement_id where m.source='produksi' and m.source_ref=ref and m.item_id=output_id and m.qty>0
     and (e.value_delta is null or e.value_after is null or (e.qty_after>0 and e.average_after is null)))
   or abs(
    (select coalesce(sum(e.value_delta),0) from public.inventory_cost_events e join public.stock_moves m on m.id=e.movement_id where m.source='produksi' and m.source_ref=ref and m.item_id=output_id and m.qty>0)
    - total
    - (select coalesce(sum(l.debit-l.credit),0) from public.journal_entries j join public.journal_lines l on l.entry_id=j.id join public.coa_accounts a on a.id=l.account_id
       where j.source='inventory-variance' and a.code='1301' and j.source_ref in
        (select m.id::text from public.stock_moves m where m.source='produksi' and m.source_ref=ref and m.item_id=output_id and m.qty>0))
   )>=0.005
  ) then raise exception 'Valuasi average barang jadi tidak sesuai jurnal persediaan; penyelesaian dibatalkan';end if;
$guard$;
begin
 -- Exact inverse of 20261028200000 (same literal guard texts).
 definition:=pg_get_functiondef('public.post_production_atomic(text,text,jsonb)'::regprocedure);
 if position(output_guard in definition)>0 then
  definition:=replace(definition,anchor||material_guard,anchor);
  definition:=replace(definition,output_guard||output_anchor,output_anchor);
  definition:=replace(definition,lock_line,'average:=public.inventory_is_average();');
  definition:=replace(definition,'-- Average issues and receipts use the existing inventory costing functions.',
   'if average then raise exception ''Produksi ini memerlukan rekonsiliasi metode average tersendiri; tidak ada posting yang dilakukan'';end if;');
  execute definition;
 end if;
 definition:=pg_get_functiondef('public.post_production_adhoc_atomic(text,text,jsonb)'::regprocedure);
 if position(material_guard in definition)>0 then
  definition:=replace(definition,anchor||material_guard,anchor);
  definition:=replace(definition,lock_line,'average:=public.inventory_is_average();');
  definition:=replace(definition,'-- Source warehouses use the existing average issue valuation.',
   'if average then raise exception ''Pekerjaan FIFO ini memerlukan kontrak average tersendiri; tidak ada posting'';end if;');
  execute definition;
 end if;
end$restore$;

-- Source reader exactly as in 20261023161000_production_adhoc_warehouses.sql.
create or replace function public.read_production_atomic_sources(p_order_ids uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$declare result jsonb:='{}';r record;branch uuid;begin
 if auth.uid() is null or coalesce(auth.role(),'')<>'authenticated' or not exists(select 1 from public.profiles where id=auth.uid() and is_active and role in('OWNER','ADMIN')) then raise exception 'Akses sumber produksi ditolak' using errcode='42501';end if;
 if coalesce(cardinality(p_order_ids),0)>100 then raise exception 'Terlalu banyak produksi';end if;
 for r in select p.order_id,p.source_snapshot,o.warehouse_id from public.production_atomic_postings p join public.production_orders o on o.id=p.order_id where p.kind='start' and p.order_id=any(p_order_ids) loop
  select branch_id into branch from public.warehouses where id=r.warehouse_id;
  if not found or not public.user_can_access_branch(branch) then continue;end if;
  begin perform public.stock_document_access(branch,'pos');exception when insufficient_privilege or raise_exception then continue;end;
  result:=result||jsonb_build_object(r.order_id::text,jsonb_build_object('recipe_name',r.source_snapshot#>>'{recipe,nama}','output_name',r.source_snapshot->>'output_name','unit',r.source_snapshot->>'output_unit','planned_qty',r.source_snapshot->'planned_qty','materials',coalesce(r.source_snapshot->'material','[]'::jsonb)));
 end loop;return result;end$$;

drop function if exists public.read_compound_trace(uuid);
commit;
