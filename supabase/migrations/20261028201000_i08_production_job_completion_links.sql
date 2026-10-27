-- I08: link a production job (bahan keluar) to its completion (barang jadi masuk).
-- Same authorization and 100-ID ceiling as the existing source reader; it only
-- adds the two stage journals and the completion receipt so the screen can show
-- job -> completion with clickable document numbers. Read-only, no new grants.
create or replace function public.read_production_atomic_sources(p_order_ids uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$declare result jsonb:='{}';r record;branch uuid;fin public.production_atomic_postings%rowtype;begin
 if auth.uid() is null or coalesce(auth.role(),'')<>'authenticated' or not exists(select 1 from public.profiles where id=auth.uid() and is_active and role in('OWNER','ADMIN')) then raise exception 'Akses sumber produksi ditolak' using errcode='42501';end if;
 if coalesce(cardinality(p_order_ids),0)>100 then raise exception 'Terlalu banyak produksi';end if;
 for r in select p.order_id,p.source_snapshot,p.receipt,o.warehouse_id,o.no_produksi from public.production_atomic_postings p join public.production_orders o on o.id=p.order_id where p.kind='start' and p.order_id=any(p_order_ids) loop
  select branch_id into branch from public.warehouses where id=r.warehouse_id;
  if not found or not public.user_can_access_branch(branch) then continue;end if;
  begin perform public.stock_document_access(branch,'pos');exception when insufficient_privilege or raise_exception then continue;end;
  select * into fin from public.production_atomic_postings where order_id=r.order_id and kind='finish';
  result:=result||jsonb_build_object(r.order_id::text,jsonb_build_object(
   'recipe_name',r.source_snapshot#>>'{recipe,nama}','output_name',r.source_snapshot->>'output_name','unit',r.source_snapshot->>'output_unit','planned_qty',r.source_snapshot->'planned_qty','materials',coalesce(r.source_snapshot->'material','[]'::jsonb),
   'branch_name',(select b.name from public.branches b where b.id=branch),
   'start_journal',(select j.no_jurnal from public.journal_entries j where j.id=(r.receipt->>'journal_id')::uuid),
   'completion',case when fin.id is null then null else jsonb_build_object(
     'qty',fin.receipt->'qty_jadi','tanggal',fin.receipt->>'tanggal','value',fin.receipt->'value',
     'journal',(select j.no_jurnal from public.journal_entries j where j.id=(fin.receipt->>'journal_id')::uuid),
     'received_qty',(select coalesce(sum(m.qty),0) from public.stock_moves m where m.source='produksi' and m.source_ref=r.no_produksi and m.qty>0),
     'received_value',(select coalesce(sum(m.qty*m.unit_cost),0) from public.stock_moves m where m.source='produksi' and m.source_ref=r.no_produksi and m.qty>0)) end));
 end loop;return result;end$$;
revoke all on function public.read_production_atomic_sources(uuid[]) from public,anon,service_role;
grant execute on function public.read_production_atomic_sources(uuid[]) to authenticated;
