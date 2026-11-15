-- Run as: begin read only; <this file>; rollback;  (Supabase SQL editor / execute_sql). Also usable as readback after apply (online items 0, active false).
-- E4 preflight, READ-ONLY. Expect: each online WH 1 active + 1 active store WH, items/units 31/230 and 3/16,
-- negatives 0, last_move <= 2026-11-04, open_docs [], bad_items [], cost_gaps [], transit_overlap [], period_open true.
with t(urut,online_name,branch_name,store_name) as (values (1,'WH ONLINE PDRY','Kamo Petshop Panduraya','WH PDRY'),(2,'WH ONLINE TKI','Kamo Petshop TKI/Kopo','WH TKI')),
o as (select t.*, w.id online_id, w.is_active online_active, w.branch_id,
  (select count(*) from public.warehouses x join public.branches b on b.id=x.branch_id where x.name=t.online_name and x.type='ONLINE' and b.name=t.branch_name) online_matches,
  (select array_agg(s.id) from public.warehouses s where s.branch_id=w.branch_id and s.name=t.store_name and s.type='RETAIL' and s.is_active) store_ids
 from t left join public.warehouses w on w.name=t.online_name and w.type='ONLINE' and w.branch_id=(select id from public.branches where name=t.branch_name limit 1)),
l as (select o.urut, s.item_id, s.qty, s.average_cost, o.online_id, o.store_ids[1] store_id from o join public.stock s on s.warehouse_id=o.online_id and s.qty<>0),
tr as (select id from public.warehouses where type='TRANSIT' and is_active order by id limit 1)
select jsonb_pretty(jsonb_build_object(
 'costing_method',(select method from public.inventory_costing_settings where id),
 'period_open',(select coalesce((now() at time zone 'Asia/Jakarta')::date > closed_until, true) from public.accounting_locks where id)
   and (select coalesce((now() at time zone 'Asia/Jakarta')::date > closed_through, true) from public.inventory_costing_settings where id),
 'warehouses',(select jsonb_agg(jsonb_build_object('online',online_name,'matches',online_matches,'active',online_active,'store_active_matches',coalesce(cardinality(store_ids),0),
   'items',(select count(*) from l where l.urut=o.urut),'units',(select sum(qty) from l where l.urut=o.urut),
   'negatives',(select count(*) from l where l.urut=o.urut and l.qty<0),
   'last_move',(select max(tanggal) from public.stock_moves m where m.warehouse_id=o.online_id),
   'last_move_created',(select max(created_at) from public.stock_moves m where m.warehouse_id=o.online_id)) order by urut) from o),
 'open_docs',(select coalesce(jsonb_agg(d),'[]') from (
   select 'transfer '||no_pemindahan||' '||status d from public.stock_transfers where (from_warehouse_id in (select online_id from o) or to_warehouse_id in (select online_id from o)) and status in ('Sedang dikirim','Diterima Sebagian')
   union all select 'request '||id||' '||status from public.stock_requests where to_warehouse_id in (select online_id from o) and status in ('Menunggu Persetujuan','Disetujui','Dikirim')
   union all select 'opname '||no_opname from public.opname_orders where warehouse_id in (select online_id from o) and status='Terbuka'
   union all select 'po '||id||' '||status from public.purchase_orders where to_warehouse_id in (select online_id from o) and status in ('Draft','Dipesan')
   union all select 'so '||no_pesanan||' '||status from public.sales_orders where warehouse_id in (select online_id from o) and status in ('draft','diproses')
   union all select 'produksi '||po.id from public.production_orders po where po.status='berjalan' and (po.warehouse_id in (select online_id from o)
     or exists(select 1 from public.production_order_items pi where pi.order_id=po.id and pi.warehouse_id in (select online_id from o)))) x),
 'bad_items',(select coalesce(jsonb_agg(i.code||' '||i.name),'[]') from l join public.items i on i.id=l.item_id
   where not coalesce(i.is_active,false) or i.trashed_at is not null or coalesce(i.item_type,'Persediaan')<>'Persediaan'),
 'cost_gaps',(select coalesce(jsonb_agg(i.code),'[]') from l join public.items i on i.id=l.item_id
   where case when (select method from public.inventory_costing_settings where id)='moving_average' then coalesce(l.average_cost,0)<=0
   else l.qty<>coalesce((select sum(qty_left) from public.stock_layers y where y.warehouse_id=l.online_id and y.item_id=l.item_id),0) end),
 'transit_overlap',(select coalesce(jsonb_agg(distinct i.code),'[]') from l join public.items i on i.id=l.item_id
   where exists(select 1 from public.stock s where s.warehouse_id=(select id from tr) and s.item_id=l.item_id and s.qty<>0)
      or exists(select 1 from public.stock_layers y where y.warehouse_id=(select id from tr) and y.item_id=l.item_id and y.qty_left<>0)),
 'store_negative_info',(select coalesce(jsonb_agg(i.code||' toko='||s.qty),'[]') from l join public.items i on i.id=l.item_id
   join public.stock s on s.warehouse_id=l.store_id and s.item_id=l.item_id where s.qty<0),
 'value_to_move',(select round(sum(case when (select method from public.inventory_costing_settings where id)='moving_average' then l.qty*l.average_cost
   else (select sum(qty_left*unit_cost) from public.stock_layers y where y.warehouse_id=l.online_id and y.item_id=l.item_id) end),2) from l),
 'transfer_fn_anchors_ok',(select bool_and(position(a in pg_get_functiondef('public.post_stock_transfer_atomic(uuid,uuid,uuid,uuid,date,text,jsonb)'::regprocedure))>0)
   from unnest(array['perform stock_document_access(case when p_source is null then v_from.branch_id else v_to.branch_id end,''pos'');',
   'v_number:=stock_document_number(''IT'',p_date);','''transfer'',v_number,p_date);']) a),
 'b2c',(select jsonb_build_object('active',w.is_active,'items',(select count(*) from public.stock s where s.warehouse_id=w.id and s.qty<>0)) from public.warehouses w where w.name='WH B2C' limit 1)
));
