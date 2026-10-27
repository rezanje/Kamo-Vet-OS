-- I08: production (recipe and ad hoc jobs) under the existing moving-average
-- costing method. Carried forward from draft #235 without its global zero-cost
-- average change: the inventory engine itself is not modified here.
--
-- * Material issues keep using stock_out_fifo, which returns the active average
--   cost; output receipts keep using stock_in_fifo. Frozen material cost moves
--   1301 -> 1302 (WIP) -> 1301 exactly as under FIFO.
-- * Each stage reconciles the inventory valuation events against the WIP value
--   (difference >= Rp0.005 aborts the whole stage). Unknown/zero average cost
--   therefore fails closed instead of guessing a price.
-- * Same-branch rule, function identity, ACLs, search_path and RLS unchanged.
-- Provenance anchors abort the migration if either RPC body differs from main.
do $upgrade$
declare definition text;old_guard text;anchor text;
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
 definition:=pg_get_functiondef('public.post_production_atomic(text,text,jsonb)'::regprocedure);
 -- Idempotent: a body that already carries the guard is left as is.
 if position('Valuasi average barang jadi' in definition)=0 then
 old_guard:='if average then raise exception ''Produksi ini memerlukan rekonsiliasi metode average tersendiri; tidak ada posting yang dilakukan'';end if;';
 anchor:='update public.production_orders set nilai_bahan=total where id=oid returning * into doc;';
 if position(old_guard in definition)=0 or position('average:=public.inventory_is_average();' in definition)=0 or position(anchor in definition)=0
  or position(output_anchor in definition)=0 then
  raise exception 'Production recipe source mismatch; review average rollout';
 end if;
 -- Shared costing-method lock: activation (exclusive) cannot interleave a stage.
 definition:=replace(definition,'average:=public.inventory_is_average();',
  'perform pg_advisory_xact_lock_shared(1962072401::bigint);'||E'\n '||'average:=public.inventory_is_average();');
 definition:=replace(definition,old_guard,'-- Average issues and receipts use the existing inventory costing functions.');
 definition:=replace(definition,anchor,anchor||material_guard);
 definition:=replace(definition,output_anchor,output_guard||output_anchor);
 execute definition;
 end if;

 definition:=pg_get_functiondef('public.post_production_adhoc_atomic(text,text,jsonb)'::regprocedure);
 if position('Valuasi average bahan' in definition)=0 then
 old_guard:='if average then raise exception ''Pekerjaan FIFO ini memerlukan kontrak average tersendiri; tidak ada posting'';end if;';
 if position(old_guard in definition)=0 or position('average:=public.inventory_is_average();' in definition)=0 or position(anchor in definition)=0 then
  raise exception 'Production ad hoc source mismatch; review average rollout';
 end if;
 definition:=replace(definition,'average:=public.inventory_is_average();',
  'perform pg_advisory_xact_lock_shared(1962072401::bigint);'||E'\n '||'average:=public.inventory_is_average();');
 definition:=replace(definition,old_guard,'-- Source warehouses use the existing average issue valuation.');
 definition:=replace(definition,anchor,anchor||material_guard);
 execute definition;
 end if;
end$upgrade$;
