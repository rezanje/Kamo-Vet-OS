CREATE OR REPLACE FUNCTION public.create_purchase_invoice_from_po(p_po_id uuid, p_no_faktur_prefix text, p_no_faktur_digits integer, p_no_faktur_pemasok text, p_tanggal date, p_jatuh_tempo date, p_keterangan text, p_items jsonb, p_layer_updates jsonb, p_layer_inserts jsonb, p_ppn numeric, p_request_key text, p_replaces_invoice_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(invoice_id uuid, no_faktur character varying, no_jurnal character varying, total numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_average_row record; po public.purchase_orders%rowtype;r record;u record;layer public.stock_layers%rowtype;cfg record;
 payload jsonb;result jsonb;canonical jsonb;trusted jsonb:='[]';updates jsonb:='[]';inserts jsonb:='[]';before_layers jsonb;allocated uuid[]:='{}';
 total_value numeric;billed numeric;accepted numeric;dpp numeric;ppn numeric;remaining numeric;take numeric;new_cost numeric;old_cost numeric;v_invoice uuid;v_journal uuid;wh uuid;has_returns boolean;
begin
 perform public.inventory_assert_open_date(p_tanggal);
 perform public.purchase_assert_access('invoice',null);
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)=0 then raise exception 'Rincian faktur tidak valid';end if;
 select jsonb_agg(jsonb_build_object('po_item_id',x->>'po_item_id','qty',(x->>'qty')::numeric,'harga',(x->>'harga')::numeric) order by x->>'po_item_id') into canonical from jsonb_array_elements(p_items)x;
 payload:=jsonb_build_object('po_id',p_po_id,'tanggal',p_tanggal,'jatuh_tempo',p_jatuh_tempo,'no_faktur_pemasok',p_no_faktur_pemasok,'keterangan',p_keterangan,'items',canonical);
 if p_replaces_invoice_id is not null then payload:=payload||jsonb_build_object('replaces_invoice_id',p_replaces_invoice_id);end if;
 result:=public.recover_purchase_operation('invoice',p_request_key,payload);
 select * into po from public.purchase_orders where id=p_po_id for update;
 perform public.purchase_invoice_scope(po.branch_id,po.to_warehouse_id,po.supplier_id);
 if result is not null then return query select (result->>'invoice_id')::uuid,(result->>'no_faktur')::varchar(30),(result->>'no_jurnal')::varchar(24),(result->>'total')::numeric;return;end if;
 perform public.purchase_payment_period(p_tanggal,p_tanggal);
 if p_jatuh_tempo is null or not isfinite(p_jatuh_tempo) or p_jatuh_tempo<p_tanggal then raise exception 'Jatuh tempo faktur tidak valid';end if;
 perform 1 from public.purchase_invoices where po_id=p_po_id order by id for update;
 perform public.purchase_invoice_replacement(p_replaces_invoice_id,p_po_id,po.supplier_id,po.branch_id,po.to_warehouse_id);
 if p_replaces_invoice_id is not null then perform public.purchase_effective_date_check('invoice-replace',p_tanggal,(select i.tanggal from public.purchase_invoices i where i.id=p_replaces_invoice_id),p_keterangan,'faktur yang dibatalkan',true);end if;
 has_returns:=exists(select 1 from public.purchase_returns where voided_at is null and po_id=p_po_id);
 -- Old unproven invoices could already have repriced the same receipt. Never guess ownership.
 if exists(select 1 from public.purchase_invoices i where i.po_id=p_po_id and i.voided_at is null and not exists(select 1 from public.purchase_invoice_postings p where p.invoice_id=i.id)) then raise exception 'Faktur lama memerlukan rekonsiliasi asal nilai stok sebelum faktur tambahan';end if;
 for r in select x.*,i.item_id,i.harga_beli,i.faktor,i.satuan from jsonb_to_recordset(canonical)x(po_item_id uuid,qty numeric,harga numeric) left join public.purchase_order_items i on i.id=x.po_item_id and i.po_id=p_po_id order by i.item_id,x.po_item_id loop
  if r.item_id is null or r.qty is null or r.qty<=0 or r.qty>1e9 or r.harga is null or r.harga<0 or r.harga>1e12 or r.qty::text in ('NaN','Infinity','-Infinity') or r.harga::text in ('NaN','Infinity','-Infinity') or r.qty*r.harga<>round(r.qty*r.harga,2) then raise exception 'Qty dan harga faktur tidak valid';end if;
  select coalesce(sum(ii.qty*ii.faktor),0) into billed from public.purchase_invoice_items ii join public.purchase_invoices i on i.id=ii.invoice_id where i.po_id=p_po_id and i.voided_at is null and ii.po_item_id=r.po_item_id;
  select coalesce(i.qty_terima,i.qty)*i.faktor into accepted from public.purchase_order_items i where i.id=r.po_item_id;
  if billed+r.qty*r.faktor>accepted then raise exception 'Qty faktur melebihi sisa baris PO setelah konversi satuan.';end if;
  select * into u from public.unit_posting_factor(r.item_id,r.satuan);
  if u.factor is distinct from r.faktor or r.harga_beli<0 or r.harga_beli>1e12 or r.qty*r.harga_beli<>round(r.qty*r.harga_beli,2) then raise exception 'Harga atau satuan PO memerlukan rekonsiliasi';end if;
  if not exists(select 1 from public.items where id=r.item_id and coalesce(item_type,'Persediaan')='Persediaan') then raise exception 'Faktur ini khusus barang persediaan';end if;
  trusted:=trusted||jsonb_build_array(jsonb_build_object('po_item_id',r.po_item_id,'qty',r.qty,'harga',r.harga,'expected_harga_po',r.harga_beli,'expected_faktor',r.faktor));
 end loop;
 select sum((x->>'qty')::numeric*(x->>'harga')::numeric) into total_value from jsonb_array_elements(canonical)x;
 select mode_pkp,ppn_rate into cfg from public.company_settings where id for share;
 if cfg.mode_pkp and (cfg.ppn_rate is null or cfg.ppn_rate<0 or cfg.ppn_rate>100 or cfg.ppn_rate::text in ('NaN','Infinity','-Infinity')) then raise exception 'Tarif PPN tidak valid';end if;
 dpp:=case when coalesce(cfg.mode_pkp,false) then least(total_value,round(total_value*100/(100+cfg.ppn_rate))) else total_value end;ppn:=total_value-dpp;
 if p_ppn is distinct from ppn then raise exception 'Pajak berubah. Periksa kembali faktur';end if;
 -- A pre-invoice return already reduced AP and inventory at the PO cost. Only a
 -- first gross invoice at that exact cost can transfer all GRNI without repricing.
 if has_returns and (ppn<>0 or exists(select 1 from public.purchase_invoices where po_id=p_po_id)
  or exists(select 1 from public.purchase_order_items i left join jsonb_to_recordset(canonical)x(po_item_id uuid,qty numeric,harga numeric) on x.po_item_id=i.id
    where i.po_id=p_po_id and coalesce(i.qty_terima,i.qty)>0 and (x.qty is distinct from coalesce(i.qty_terima,i.qty) or x.harga is distinct from i.harga_beli))
  or exists(select 1 from public.purchase_return_items ri join public.purchase_returns rt on rt.id=ri.return_id left join public.purchase_order_items i on i.id=ri.source_line_id and i.po_id=p_po_id
    where rt.voided_at is null and rt.po_id=p_po_id and (i.id is null or ri.item_id is distinct from i.item_id or ri.harga is distinct from i.harga_beli/i.faktor or ri.hpp is distinct from ri.qty*i.harga_beli/i.faktor))) then
  raise exception 'Retur sebelum faktur hanya mendukung faktur bruto pertama dengan biaya PO yang sama. Rekonsiliasi perubahan harga atau pajak';
 end if;
 -- Aggregate-stock rows precede all layers, as in receipt and consumption families.
 for r in select distinct i.item_id from public.purchase_order_items i join jsonb_array_elements(canonical)x on i.id=(x->>'po_item_id')::uuid order by i.item_id loop
  perform 1 from public.stock where warehouse_id=po.to_warehouse_id and item_id=r.item_id for update;
  if not found then raise exception 'Stok penerimaan tidak ditemukan. Rekonsiliasi PO';end if;
 end loop;
 perform 1 from public.stock_layers where warehouse_id=po.to_warehouse_id and source='purchase' and source_ref=po.no_po order by id for update;
 select coalesce(jsonb_agg(to_jsonb(l)),'[]') into before_layers from public.stock_layers l where warehouse_id=po.to_warehouse_id and source='purchase' and source_ref=po.no_po;
 -- Receipt layers have no PO-line ID: unequal invoice costs for identical receipt costs are ambiguous.
 if exists(select 1 from jsonb_to_recordset(trusted)x(qty numeric,harga numeric,expected_harga_po numeric,expected_faktor numeric,po_item_id uuid) join public.purchase_order_items i on i.id=x.po_item_id group by i.item_id,x.expected_harga_po/x.expected_faktor having count(distinct x.harga/x.expected_faktor)>1) then raise exception 'Harga faktur berbeda pada asal stok yang sama. Rekonsiliasi baris PO';end if;
 for r in select i.item_id,sum(x.qty*x.expected_faktor) qty,x.expected_harga_po/x.expected_faktor old_cost,x.harga/x.expected_faktor*dpp/total_value new_cost from jsonb_to_recordset(trusted)x(qty numeric,harga numeric,expected_harga_po numeric,expected_faktor numeric,po_item_id uuid) join public.purchase_order_items i on i.id=x.po_item_id group by i.item_id,x.expected_harga_po/x.expected_faktor,x.harga/x.expected_faktor order by i.item_id loop
  if has_returns then
   if exists(select 1 from public.stock_layers l where l.warehouse_id=po.to_warehouse_id and l.item_id=r.item_id and l.source='purchase' and l.source_ref=po.no_po and l.unit_cost<>r.old_cost)
    or (select coalesce(sum(l.qty_in),0) from public.stock_layers l where l.warehouse_id=po.to_warehouse_id and l.item_id=r.item_id and l.source='purchase' and l.source_ref=po.no_po)<>r.qty
    or (select coalesce(sum(l.qty_left),0) from public.stock_layers l where l.warehouse_id=po.to_warehouse_id and l.item_id=r.item_id and l.source='purchase' and l.source_ref=po.no_po)<>r.qty-(select coalesce(sum(ri.qty),0) from public.purchase_return_items ri join public.purchase_returns rt on rt.id=ri.return_id where rt.voided_at is null and rt.po_id=p_po_id and ri.item_id=r.item_id)
    or r.new_cost<>r.old_cost then raise exception 'Asal nilai stok setelah retur tidak cocok. Rekonsiliasi sebelum faktur';end if;
   allocated:=allocated||array(select l.id from public.stock_layers l where l.warehouse_id=po.to_warehouse_id and l.item_id=r.item_id and l.source='purchase' and l.source_ref=po.no_po);
   continue;
  end if;
  remaining:=r.qty;
  for layer in select l.* from public.stock_layers l where l.warehouse_id=po.to_warehouse_id and l.item_id=r.item_id and l.source='purchase' and l.source_ref=po.no_po and l.unit_cost=r.old_cost and l.qty_left>0
   and not exists(select 1 from public.purchase_invoice_layer_proofs proof join public.purchase_invoices inv on inv.id=proof.invoice_id where proof.layer_id=l.id and proof.allocated and inv.voided_at is null)
   order by l.tanggal,l.created_at,l.id loop
   exit when remaining<=0;take:=least(remaining,layer.qty_left);
   updates:=updates||jsonb_build_array(jsonb_build_object('id',layer.id,'expected_qty_in',layer.qty_in,'expected_qty_left',layer.qty_left,'expected_unit_cost',layer.unit_cost)||case when take=layer.qty_left then jsonb_build_object('unit_cost',r.new_cost) else jsonb_build_object('qty_in',layer.qty_in-take,'qty_left',layer.qty_left-take) end);
   if take=layer.qty_left then allocated:=array_append(allocated,layer.id);
   else inserts:=inserts||jsonb_build_array((to_jsonb(layer)-'id'-'created_at')||jsonb_build_object('qty_in',take,'qty_left',take,'unit_cost',r.new_cost));end if;
   remaining:=remaining-take;
  end loop;
  if remaining>0 then raise exception 'Stok PO sudah terpakai atau asal biaya tidak lengkap. Rekonsiliasi sebelum faktur';end if;
 end loop;
 lock table public.journal_entries in share row exclusive mode;
 select to_jsonb(x) into result from public.create_purchase_invoice_from_po_internal(p_po_id,p_no_faktur_prefix,p_no_faktur_digits,p_no_faktur_pemasok,p_tanggal,p_jatuh_tempo,p_keterangan,trusted,updates,inserts,ppn)x;
 v_invoice:=(result->>'invoice_id')::uuid;
 if p_replaces_invoice_id is not null then perform public.purchase_backdate_record('invoice-replace',v_invoice,result->>'no_faktur',po.branch_id,p_tanggal,(select i.tanggal from public.purchase_invoices i where i.id=p_replaces_invoice_id),p_keterangan,null,p_request_key);end if;
 update public.purchase_invoices set branch_id=po.branch_id,warehouse_id=po.to_warehouse_id,replaces_invoice_id=p_replaces_invoice_id where id=v_invoice;
 select id into v_journal from public.journal_entries where source='purchase-invoice' and source_ref=result->>'no_faktur';
 insert into public.purchase_invoice_postings(invoice_id,branch_id,warehouse_id,journal_id,journal_snapshot,dpp,ppn) values(v_invoice,po.branch_id,po.to_warehouse_id,v_journal,public.purchase_invoice_journal_snapshot(v_journal),dpp,ppn);
 -- Recheck and hold the actual posted accounts after any legacy numbering wait.
 perform public.purchase_invoice_source_active(v_invoice);
 insert into public.purchase_invoice_layer_proofs(invoice_id,layer_id,before_state,after_state,allocated)
 select v_invoice,l.id,b.value,to_jsonb(l),b.value is null or l.id=any(allocated) from public.stock_layers l left join jsonb_array_elements(before_layers)b on (b.value->>'id')::uuid=l.id
 where l.warehouse_id=po.to_warehouse_id and l.source='purchase' and l.source_ref=po.no_po and (b.value is distinct from to_jsonb(l) or l.id=any(allocated));
 if public.inventory_is_average() then
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
 update public.purchase_invoice_postings set movement_ids=array(select m.id from public.stock_moves m where m.warehouse_id=po.to_warehouse_id and m.item_id in(select ii.item_id from public.purchase_invoice_items ii where ii.invoice_id=v_invoice)) where purchase_invoice_postings.invoice_id=v_invoice;
 perform public.purchase_invoice_scope(po.branch_id,po.to_warehouse_id,po.supplier_id);
 insert into public.purchase_operations(actor_id,kind,request_key,payload,result,branch_id) values(auth.uid(),'invoice',p_request_key,payload,result,po.branch_id);
 return query select v_invoice,(result->>'no_faktur')::varchar(30),(result->>'no_jurnal')::varchar(24),(result->>'total')::numeric;
end$function$

