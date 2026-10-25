-- Snapshot laporan harga dibuat dalam transaksi posting, tanpa mengubah posting stok/jurnal.
do $$ begin
 if to_regclass('public.opname_posting_receipts') is null
  or not (select relrowsecurity from pg_class where oid='public.opname_posting_receipts'::regclass)
  or has_table_privilege('authenticated','public.opname_posting_receipts','SELECT')
  or to_regprocedure('public.post_opname_atomic(uuid,date,jsonb)') is null
  or position('issue_stock_document_recorded' in pg_get_functiondef('public.post_opname_atomic(uuid,date,jsonb)'::regprocedure))=0
  or position('insert into public.opname_posting_receipts' in pg_get_functiondef('public.post_opname_atomic(uuid,date,jsonb)'::regprocedure))=0
  or not has_function_privilege('authenticated','public.post_opname_atomic(uuid,date,jsonb)','EXECUTE')
 then raise exception 'OPNAME_PRICE_SOURCE_CHANGED: review private receipt and posting contract';end if;
end $$;

create function public.capture_opname_price_report() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_wh public.warehouses%rowtype; v_order public.opname_orders%rowtype;
 v_item record; v_stock numeric; v_layer_qty numeric; v_layer_value numeric;
 v_issue_cost numeric; v_sale numeric; v_code text; v_rows jsonb:='[]'; v_method text;
begin
 select * into v_order from public.opname_orders where id=new.order_id;
 select * into v_wh from public.warehouses where id=v_order.warehouse_id;
 if v_order.id is null or v_wh.id is null or new.result_id is null
  or not exists(select 1 from public.opname_results r where r.id=new.result_id and r.order_id=new.order_id)
  or jsonb_typeof(new.source_snapshot->'rows') is distinct from 'array'
  or jsonb_array_length(new.source_snapshot->'rows')=0 then
  raise exception 'Snapshot sumber opname belum lengkap';end if;
 select method into v_method from public.inventory_costing_settings where id=true;
 if v_method not in ('fifo','moving_average') or v_method is null then raise exception 'Metode biaya opname tidak tersedia';end if;
 for v_item in
  select * from jsonb_to_recordset(new.source_snapshot->'rows') as x(
   item_id uuid,qty_sistem numeric,qty_fisik numeric,selisih numeric,
   buy_price numeric,sell_price numeric,name text,unit text)
 loop
  if v_item.item_id is null or v_item.qty_sistem is null or v_item.qty_fisik is null
   or v_item.selisih is null or v_item.unit is null or v_item.buy_price is null
   or v_item.sell_price is null or v_item.selisih is distinct from v_item.qty_fisik-v_item.qty_sistem
   or v_item.buy_price<0 or v_item.sell_price<0
   or v_item.qty_sistem::text in ('NaN','Infinity','-Infinity')
   or v_item.qty_fisik::text in ('NaN','Infinity','-Infinity')
   or v_item.selisih::text in ('NaN','Infinity','-Infinity')
   or v_item.buy_price::text in ('NaN','Infinity','-Infinity')
   or v_item.sell_price::text in ('NaN','Infinity','-Infinity') then
   raise exception 'Baris harga opname tidak lengkap';end if;
  select s.qty into v_stock from public.stock s
   where s.warehouse_id=v_wh.id and s.item_id=v_item.item_id;
  select coalesce(sum(l.qty_left),0),coalesce(sum(l.qty_left*l.unit_cost),0)
   into v_layer_qty,v_layer_value from public.stock_layers l
   where l.warehouse_id=v_wh.id and l.item_id=v_item.item_id;
  if v_stock is null or greatest(v_stock,0) is distinct from v_layer_qty
   or v_layer_value<0 or v_stock::text in ('NaN','Infinity','-Infinity')
   or v_layer_qty::text in ('NaN','Infinity','-Infinity')
   or v_layer_value::text in ('NaN','Infinity','-Infinity') then
   raise exception 'Nilai lapisan opname tidak konsisten';end if;
  v_issue_cost:=null;
  if v_item.selisih<0 then
   select (p.result->>'cost')::numeric into v_issue_cost
    from public.stock_document_issue_proofs p
    where p.kind='opname' and p.document_id=new.result_id and p.item_id=v_item.item_id;
   if v_issue_cost is null or v_issue_cost<0
    or v_issue_cost::text in ('NaN','Infinity','-Infinity') then
    raise exception 'HPP FIFO selisih opname belum lengkap';end if;
  end if;
  select coalesce((select bp.sell_price from public.item_branch_prices bp
    where bp.item_id=v_item.item_id and bp.branch_id=v_wh.branch_id and bp.unit=v_item.unit),
   v_item.sell_price) into v_sale;
  select code into v_code from public.items where id=v_item.item_id;
  if v_sale is null or v_sale<0 or v_sale::text in ('NaN','Infinity','-Infinity') then
   raise exception 'Harga jual cabang opname tidak valid';end if;
  if v_code is null then raise exception 'Kode barang opname tidak tersedia';end if;
  v_rows:=v_rows||jsonb_build_array(jsonb_build_object(
   'item_id',v_item.item_id,'code',v_code,'name',v_item.name,'unit',v_item.unit,
   'qty_sistem',v_item.qty_sistem,'qty_fisik',v_item.qty_fisik,'selisih',v_item.selisih,
   'qty_stok_setelah',v_stock,'nilai_lapisan_setelah',case when v_method='fifo' and v_stock>=0 then v_layer_value::text else null end,
   'modal_satuan',case when v_method<>'fifo' then null
     when v_item.selisih<0 then v_issue_cost/(-v_item.selisih)
     when v_item.selisih>0 then v_item.buy_price
     when v_stock>0 then v_layer_value/v_stock else null end::text,
   'sumber_modal',case when v_method<>'fifo' then 'Metode average; HPP FIFO tidak tersedia'
     when v_item.selisih<0 then 'HPP FIFO selisih keluar per unit'
     when v_item.selisih>0 then 'Biaya masuk/acuan PO yang dijurnal per unit'
     when v_stock<0 then 'Stok negatif; modal lapisan FIFO tidak tersedia'
     when v_stock>0 then 'Rata-rata nilai lapisan FIFO setelah posting' else 'Tidak tersedia' end,
   'hpp_selisih_keluar',case when v_method='fifo' then v_issue_cost::text else null end,
   'nilai_selisih_modal',case when v_method<>'fifo' then null
     when v_item.selisih<0 then (-v_issue_cost)::text
     when v_item.selisih>0 then (v_item.selisih*v_item.buy_price)::text else '0' end,
   'sumber_nilai_modal',case when v_method<>'fifo' then 'Tidak tersedia'
     when v_item.selisih<0 then 'HPP FIFO keluar yang dijurnal'
     when v_item.selisih>0 then 'Biaya masuk dari acuan PO yang dijurnal'
     else 'Tidak ada selisih' end,
   'harga_jual_cabang',v_sale::text,'nilai_selisih_jual',(v_item.selisih*v_sale)::text));
 end loop;
 new.source_snapshot:=jsonb_set(new.source_snapshot,'{price_report}',jsonb_build_object(
  'version',1,'method',v_method,'branch_id',v_wh.branch_id,'warehouse_id',v_wh.id,
  'scope',case when exists(select 1 from public.opname_order_items where order_id=new.order_id)
   then 'Sebagian' else 'Seluruh' end,'rows',v_rows));
 return new;
end $$;
revoke all on function public.capture_opname_price_report() from public,anon,authenticated,service_role;
create trigger opname_price_report_before_receipt
 before insert on public.opname_posting_receipts for each row
 execute function public.capture_opname_price_report();

-- Hanya proyeksi laporan; receipt dan bukti biaya tetap tidak punya izin SELECT langsung.
create function public.read_opname_price_report(p_result_id uuid) returns jsonb
language plpgsql security definer stable set search_path='' as $$
declare v_role text;v_branch uuid;v_warehouse uuid;v_report jsonb;
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated' or p_result_id is null then
  raise exception 'Akses laporan opname ditolak' using errcode='42501';end if;
 select role::text into v_role from public.profiles
  where id=auth.uid() and is_active;
 if v_role not in ('OWNER','FINANCE') or v_role is null then
  raise exception 'Akses laporan opname ditolak' using errcode='42501';end if;
 if v_role<>'OWNER' and exists(select 1 from public.role_modules where role=v_role::public.user_role)
  and not exists(select 1 from public.role_modules where role=v_role::public.user_role and module_id='laporan') then
  raise exception 'Akses modul laporan ditolak' using errcode='42501';end if;
 select w.branch_id,w.id into v_branch,v_warehouse from public.opname_results r
  join public.opname_orders o on o.id=r.order_id
  join public.warehouses w on w.id=o.warehouse_id where r.id=p_result_id;
 if v_branch is null or not public.user_can_access_branch(v_branch) then
  raise exception 'Cabang laporan opname ditolak' using errcode='42501';end if;
 select p.source_snapshot->'price_report' into v_report
  from public.opname_posting_receipts p
  join public.opname_results r on r.id=p.result_id and r.order_id=p.order_id
  where p.result_id=p_result_id;
 if v_report is null then return null;end if;
 if (v_report->>'branch_id')::uuid is distinct from v_branch
  or (v_report->>'warehouse_id')::uuid is distinct from v_warehouse then
  raise exception 'Snapshot harga opname tidak cocok dengan cabang asal';end if;
 return v_report||jsonb_build_object('correction_revision',
  (select max(c.revision) from public.stock_document_corrections c
   where c.kind='opname' and c.document_id=p_result_id));
end $$;
revoke all on function public.read_opname_price_report(uuid) from public,anon,service_role;
grant execute on function public.read_opname_price_report(uuid) to authenticated;
