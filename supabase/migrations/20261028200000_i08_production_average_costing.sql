-- I08: production (recipe and ad hoc jobs) under the existing moving-average
-- costing method. Carried forward from draft #235 without its global zero-cost
-- average change: the inventory engine itself is not modified here.
--
-- * Material issues keep using stock_out_fifo, which returns the active average
--   cost; output receipts keep using stock_in_fifo. Frozen material cost moves
--   1301 -> 1302 (WIP) -> 1301 exactly as under FIFO.
-- * Each stage reconciles the inventory valuation events against the WIP value.
--   Material issue: any gap above 0.000001 aborts the job (the engine values an
--   issue at exactly qty x average, so no gap may accumulate between GL and
--   stock valuation). Output receipt: gap above Rp0.005 aborts (12-digit
--   average rounding and the existing cent-rounded negative-stock variance
--   journal). Unknown/zero average cost therefore fails closed, never guessed.
-- * Same-branch rule, function identity, ACLs, search_path and RLS unchanged.
-- Provenance: each body must match main's exact md5 (pg_get_functiondef, same
-- on PG16/17 and the hosted PG17.6) or this migration's own result; anything
-- else aborts. The patched body is checked against its expected md5 too.
do $upgrade$
declare definition text;h text;
 anchor text:='update public.production_orders set nilai_bahan=total where id=oid returning * into doc;';
 lock_line text:='perform pg_advisory_xact_lock_shared(1962072401::bigint);'||E'\n '||'average:=public.inventory_is_average();';
 main_recipe text:='9081430156be400a3e9d562dea6c3e5d';applied_recipe text:='75af6e84a3f76468b8ef300029094b88';
 main_adhoc text:='7281aba74319c810720a6df1389a1be0';applied_adhoc text:='dcb556e965cb59dedb11ccb5867577ec';
 output_anchor text:=$mark$if total>0 then journal:=public.production_atomic_journal(dt,branch,ref,'Barang jadi masuk produksi '$mark$;
 material_guard text:=$guard$
  if average and (
   (select count(*) from public.stock_moves m where m.source='produksi' and m.source_ref=ref and m.qty<0)
    <> (select count(*) from public.inventory_cost_events e join public.stock_moves m on m.id=e.movement_id where m.source='produksi' and m.source_ref=ref and m.qty<0)
   or exists(select 1 from public.inventory_cost_events e join public.stock_moves m on m.id=e.movement_id where m.source='produksi' and m.source_ref=ref and m.qty<0
     and (e.value_delta is null or e.value_after is null or (e.qty_after>0 and e.average_after is null)))
   or abs((select coalesce(sum(e.value_delta),0) from public.inventory_cost_events e join public.stock_moves m on m.id=e.movement_id where m.source='produksi' and m.source_ref=ref and m.qty<0)+total)>0.000001
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
   )>0.005
  ) then raise exception 'Valuasi average barang jadi tidak sesuai jurnal persediaan; penyelesaian dibatalkan';end if;
$guard$;
begin
 definition:=pg_get_functiondef('public.post_production_atomic(text,text,jsonb)'::regprocedure);h:=md5(definition);
 if h=applied_recipe then null; -- already applied
 elsif h<>main_recipe then raise exception 'post_production_atomic differs from main (md5 %); stop and review',h;
 else
  -- Shared costing-method lock: activation (exclusive) cannot interleave a stage.
  definition:=replace(definition,'average:=public.inventory_is_average();',lock_line);
  definition:=replace(definition,'if average then raise exception ''Produksi ini memerlukan rekonsiliasi metode average tersendiri; tidak ada posting yang dilakukan'';end if;',
   '-- Average issues and receipts use the existing inventory costing functions.');
  definition:=replace(definition,anchor,anchor||material_guard);
  definition:=replace(definition,output_anchor,output_guard||output_anchor);
  execute definition;
  h:=md5(pg_get_functiondef('public.post_production_atomic(text,text,jsonb)'::regprocedure));
  if h<>applied_recipe then raise exception 'post_production_atomic patch result unexpected (md5 %)',h;end if;
 end if;

 definition:=pg_get_functiondef('public.post_production_adhoc_atomic(text,text,jsonb)'::regprocedure);h:=md5(definition);
 if h=applied_adhoc then null;
 elsif h<>main_adhoc then raise exception 'post_production_adhoc_atomic differs from main (md5 %); stop and review',h;
 else
  definition:=replace(definition,'average:=public.inventory_is_average();',lock_line);
  definition:=replace(definition,'if average then raise exception ''Pekerjaan FIFO ini memerlukan kontrak average tersendiri; tidak ada posting'';end if;',
   '-- Source warehouses use the existing average issue valuation.');
  definition:=replace(definition,anchor,anchor||material_guard);
  execute definition;
  h:=md5(pg_get_functiondef('public.post_production_adhoc_atomic(text,text,jsonb)'::regprocedure));
  if h<>applied_adhoc then raise exception 'post_production_adhoc_atomic patch result unexpected (md5 %)',h;end if;
 end if;
end$upgrade$;
