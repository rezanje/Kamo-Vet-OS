-- PO lifecycle: durable create/revise requests and append-only correction history.
alter table public.purchase_orders add column if not exists revision integer not null default 0;

create table public.purchase_order_revisions (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete restrict,
  branch_id uuid references public.branches(id) on delete set null,
  action text not null check (action in ('edit','void')),
  reason text not null,
  before_value jsonb not null,
  after_value jsonb not null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index purchase_order_revisions_po_idx on public.purchase_order_revisions(purchase_order_id, created_at);
alter table public.purchase_order_revisions enable row level security;
revoke all on public.purchase_order_revisions from public, anon, authenticated, service_role;
grant select on public.purchase_order_revisions to authenticated;
create policy purchase_order_revisions_read on public.purchase_order_revisions for select to authenticated
  using (public.user_can_access_branch(branch_id));

create table public.purchase_order_requests (
  actor_id uuid not null references public.profiles(id) on delete cascade,
  request_key text not null check (length(request_key) between 1 and 120),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete restrict,
  payload jsonb not null,
  result jsonb not null,
  branch_id uuid references public.branches(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (actor_id, request_key)
);
alter table public.purchase_order_requests enable row level security;
revoke all on public.purchase_order_requests from public, anon, authenticated, service_role;

create or replace function public.create_purchase_order_atomic(
  p_request_key text, p_no_po_prefix text, p_no_po_digits integer,
  p_supplier_id uuid, p_to_warehouse_id uuid, p_branch_id uuid,
  p_tanggal date, p_items jsonb
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_prior public.purchase_order_requests%rowtype;
  v_po public.purchase_orders%rowtype;
  v_row jsonb; v_item public.items%rowtype; v_unit public.item_units%rowtype;
  v_payload jsonb; v_result jsonb; v_no text; v_seq bigint; v_constraint text;
  v_qty numeric; v_price numeric; v_factor numeric; v_unit_name text;
begin
  if auth.uid() is null or auth.role() <> 'authenticated' or nullif(btrim(p_request_key),'') is null
     or length(p_request_key)>120 or p_tanggal is null
     or p_to_warehouse_id is null or p_branch_id is null
     or p_no_po_digits is null or p_no_po_digits not between 1 and 8
     or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)=0 then
    raise exception 'Data PO tidak lengkap atau tidak valid';
  end if;
  v_payload:=jsonb_build_object('supplier_id',p_supplier_id,'to_warehouse_id',p_to_warehouse_id,'branch_id',p_branch_id,'tanggal',p_tanggal,'items',p_items);
  perform pg_advisory_xact_lock(hashtextextended('vetos:purchase-order:'||auth.uid()::text||':'||p_request_key,0));
  if not exists(select 1 from public.branches b where b.id=p_branch_id and b.is_active)
     or not exists(select 1 from public.warehouses w where w.id=p_to_warehouse_id and w.branch_id=p_branch_id and w.is_active) then
    raise exception 'Cabang atau gudang tujuan tidak aktif';
  end if;
  perform public.purchase_assert_access('receipt',p_branch_id);
  if exists(select 1 from public.accounting_locks where id and closed_until>=p_tanggal) then raise exception 'Periode PO sudah ditutup'; end if;
  select * into v_prior from public.purchase_order_requests where actor_id=auth.uid() and request_key=p_request_key;
  if found then
    if v_prior.payload is distinct from v_payload then raise exception 'Kunci PO sudah dipakai dengan rincian berbeda'; end if;
    perform public.purchase_assert_access('receipt',v_prior.branch_id);
    return v_prior.result;
  end if;
  
  if p_supplier_id is not null and not exists(select 1 from public.suppliers where id=p_supplier_id) then raise exception 'Supplier tidak ditemukan'; end if;
  if p_no_po_prefix is null or length(p_no_po_prefix)=0 or length(p_no_po_prefix)+p_no_po_digits>30 then raise exception 'Format nomor PO tidak valid'; end if;
  perform pg_advisory_xact_lock(hashtextextended('vetos:purchase-order-number:'||p_no_po_prefix,0));
  select coalesce(max(substring(no_po,length(p_no_po_prefix)+1)::bigint),0)+1 into v_seq from public.purchase_orders
    where left(no_po,length(p_no_po_prefix))=p_no_po_prefix and substring(no_po,length(p_no_po_prefix)+1)~'^[0-9]+$';
  loop
    if length(v_seq::text)>p_no_po_digits then raise exception 'Nomor PO sudah mencapai batas format'; end if;
    v_no:=p_no_po_prefix||lpad(v_seq::text,p_no_po_digits,'0');
    begin
      insert into public.purchase_orders(no_po,supplier_id,to_warehouse_id,branch_id,tanggal,total,status)
        values(v_no,p_supplier_id,p_to_warehouse_id,p_branch_id,p_tanggal,0,'Draft') returning * into v_po;
      exit;
    exception when unique_violation then get stacked diagnostics v_constraint=constraint_name;
      if v_constraint<>'purchase_orders_no_po_key' then raise; end if; v_seq:=v_seq+1;
    end;
  end loop;
  for v_row in select x from jsonb_array_elements(p_items) x loop
    v_qty:=(v_row->>'qty')::numeric; v_price:=(v_row->>'harga_beli')::numeric;
    if nullif(btrim(v_row->>'nama'),'') is null or v_qty is null or v_qty<=0 or v_qty>1000000000000
       or v_price is null or v_price<0 or v_price>1000000000000
       or v_qty::text in ('NaN','Infinity','-Infinity') or v_price::text in ('NaN','Infinity','-Infinity') then raise exception 'Qty atau harga item PO tidak valid'; end if;
    v_unit_name:=nullif(btrim(v_row->>'satuan'),''); v_factor:=1; v_item:=null;
    if nullif(v_row->>'item_id','') is not null then
      select * into v_item from public.items where id=(v_row->>'item_id')::uuid and is_active;
      if not found then raise exception 'Barang PO tidak ditemukan atau tidak aktif'; end if;
      if v_unit_name is null or v_unit_name=v_item.unit then v_factor:=1; v_unit_name:=v_item.unit;
      else select * into v_unit from public.item_units where item_id=v_item.id and unit=v_unit_name; if not found then raise exception 'Satuan item PO tidak sesuai master'; end if; v_factor:=v_unit.factor; end if;
    else v_unit_name:=null; end if;
    insert into public.purchase_order_items(po_id,item_id,nama,qty,harga_beli,satuan,faktor) values(v_po.id,nullif(v_row->>'item_id','')::uuid,left(btrim(v_row->>'nama'),160),v_qty,v_price,v_unit_name,v_factor);
    v_po.total:=v_po.total+v_qty*v_price;
  end loop;
  if v_po.total<=0 then raise exception 'Total PO harus lebih dari 0'; end if;
  update public.purchase_orders set total=v_po.total where id=v_po.id;
  v_result:=jsonb_build_object('po_id',v_po.id,'no_po',v_po.no_po,'revision',0);
  insert into public.purchase_order_requests(actor_id,request_key,purchase_order_id,payload,result,branch_id) values(auth.uid(),p_request_key,v_po.id,v_payload,v_result,p_branch_id);
  return v_result;
end $$;
revoke all on function public.create_purchase_order_atomic(text,text,integer,uuid,uuid,uuid,date,jsonb) from public,anon,service_role;
grant execute on function public.create_purchase_order_atomic(text,text,integer,uuid,uuid,uuid,date,jsonb) to authenticated;

create or replace function public.get_purchase_order_result(p_request_key text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_request public.purchase_order_requests%rowtype; v_profile public.profiles%rowtype;
begin
  if auth.uid() is null or nullif(btrim(p_request_key),'') is null or length(p_request_key)>120 then raise exception 'Kunci PO tidak valid'; end if;
  select * into v_profile from public.profiles where id=auth.uid() for share;
  if not found or not v_profile.is_active then raise exception 'Akun pengguna tidak aktif' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('vetos:purchase-order-recovery:'||auth.uid()::text||':'||p_request_key,0));
  select * into v_request from public.purchase_order_requests where actor_id=auth.uid() and request_key=p_request_key;
  if not found then return null; end if;
  perform public.purchase_assert_access('receipt',v_request.branch_id);
  return v_request.result;
end $$;
revoke all on function public.get_purchase_order_result(text) from public,anon,service_role;
grant execute on function public.get_purchase_order_result(text) to authenticated;

create or replace function public.revise_purchase_order(
  p_request_key text, p_purchase_order_id uuid, p_expected_revision integer,
  p_action text, p_header jsonb, p_items jsonb, p_reason text
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_po public.purchase_orders%rowtype; v_prior public.purchase_order_requests%rowtype;
  v_profile public.profiles%rowtype; v_audit uuid:=gen_random_uuid(); v_payload jsonb; v_result jsonb;
  v_row jsonb; v_item public.items%rowtype; v_unit public.item_units%rowtype; v_qty numeric; v_price numeric; v_factor numeric; v_unit_name text; v_total numeric:=0; v_closed date; v_target_date date;
begin
  if auth.uid() is null or nullif(btrim(p_request_key),'') is null or length(p_request_key)>120 or p_purchase_order_id is null
    or p_expected_revision is null or p_expected_revision<0 or p_action is null or p_action not in ('edit','void')
    or length(btrim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'Identitas atau alasan koreksi PO tidak valid'; end if;
  v_payload:=jsonb_build_object('purchase_order_id',p_purchase_order_id,'revision',p_expected_revision,'action',p_action,'header',coalesce(p_header,'{}'::jsonb),'items',coalesce(p_items,'[]'::jsonb),'reason',btrim(p_reason));
  perform pg_advisory_xact_lock(hashtextextended('vetos:purchase-order-correction:'||auth.uid()::text||':'||p_request_key,0));
  select * into v_po from public.purchase_orders where id=p_purchase_order_id for update;
  if not found then raise exception 'PO tidak ditemukan'; end if;
  select * into v_profile from public.profiles where id=auth.uid() for update;
  if not found or not v_profile.is_active or v_profile.role<>'OWNER' then raise exception 'Hanya Super Admin aktif yang bisa mengoreksi PO' using errcode='42501'; end if;
  perform public.purchase_assert_access('receipt',v_po.branch_id);
  select * into v_prior from public.purchase_order_requests where actor_id=auth.uid() and request_key=p_request_key;
  if found then if v_prior.payload is distinct from v_payload then raise exception 'Kunci koreksi sudah dipakai dengan rincian berbeda'; end if; return v_prior.result; end if;
  if v_po.revision<>p_expected_revision then raise exception 'PO sudah berubah. Muat ulang sebelum mengoreksi'; end if;
  if v_po.status not in ('Draft','Dipesan') then raise exception 'PO yang sudah selesai atau batal tidak bisa dikoreksi'; end if;
  select closed_until into v_closed from public.accounting_locks where id for update;
  if v_closed is not null and v_po.tanggal<=v_closed then raise exception 'Periode PO sudah ditutup'; end if;
  if exists(select 1 from public.purchase_order_items where po_id=v_po.id and coalesce(qty_terima,0)>0)
     or exists(select 1 from public.goods_receipts where po_id=v_po.id) or exists(select 1 from public.purchase_invoices where po_id=v_po.id)
     or exists(select 1 from public.po_payments where po_id=v_po.id) or exists(select 1 from public.purchase_returns where po_id=v_po.id)
     or exists(select 1 from public.purchase_advances where po_id=v_po.id) then raise exception 'PO sudah memiliki transaksi turunan dan tidak bisa dikoreksi'; end if;
  insert into public.purchase_order_revisions(id,purchase_order_id,branch_id,action,reason,before_value,after_value,created_by)
    values(v_audit,v_po.id,v_po.branch_id,p_action,btrim(p_reason),jsonb_build_object('po',to_jsonb(v_po),'items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb) from public.purchase_order_items i where i.po_id=v_po.id)), '{}'::jsonb,auth.uid());
  if p_action='void' then
    update public.purchase_orders set status='Batal',revision=revision+1 where id=v_po.id;
  else
    if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)=0 then raise exception 'Item PO wajib diisi'; end if;
    if p_header->>'supplier_id' is not null and nullif(p_header->>'supplier_id','') is not null and not exists(select 1 from public.suppliers where id=(p_header->>'supplier_id')::uuid) then raise exception 'Supplier tidak ditemukan'; end if;
    if not exists(select 1 from public.branches b where b.id=v_po.branch_id and b.is_active)
       or not exists(select 1 from public.warehouses w where w.id=(p_header->>'to_warehouse_id')::uuid and w.branch_id=v_po.branch_id and w.is_active) then raise exception 'Gudang tujuan tidak sesuai cabang PO'; end if;
    v_target_date:=coalesce(nullif(p_header->>'tanggal','')::date,v_po.tanggal);
    if v_closed is not null and v_target_date<=v_closed then raise exception 'Periode PO tujuan sudah ditutup'; end if;
    delete from public.purchase_order_items where po_id=v_po.id;
    for v_row in select x from jsonb_array_elements(p_items) x loop
      v_qty:=(v_row->>'qty')::numeric; v_price:=(v_row->>'harga_beli')::numeric; v_unit_name:=nullif(btrim(v_row->>'satuan'),''); v_factor:=1;
      if nullif(btrim(v_row->>'nama'),'') is null or v_qty is null or v_qty<=0 or v_qty>1000000000000 or v_price is null or v_price<0 or v_price>1000000000000 then raise exception 'Qty atau harga item PO tidak valid'; end if;
      if nullif(v_row->>'item_id','') is not null then select * into v_item from public.items where id=(v_row->>'item_id')::uuid and is_active; if not found then raise exception 'Barang PO tidak ditemukan atau tidak aktif'; end if; if v_unit_name is null or v_unit_name=v_item.unit then v_factor:=1; v_unit_name:=v_item.unit; else select * into v_unit from public.item_units where item_id=v_item.id and unit=v_unit_name; if not found then raise exception 'Satuan item PO tidak sesuai master'; end if; v_factor:=v_unit.factor; end if; else v_unit_name:=null; end if;
      insert into public.purchase_order_items(po_id,item_id,nama,qty,harga_beli,satuan,faktor) values(v_po.id,nullif(v_row->>'item_id','')::uuid,left(btrim(v_row->>'nama'),160),v_qty,v_price,v_unit_name,v_factor); v_total:=v_total+v_qty*v_price;
    end loop;
    if v_total<=0 then raise exception 'Total PO harus lebih dari 0'; end if;
    update public.purchase_orders set supplier_id=nullif(p_header->>'supplier_id','')::uuid,to_warehouse_id=(p_header->>'to_warehouse_id')::uuid,tanggal=coalesce(nullif(p_header->>'tanggal','')::date,tanggal),total=v_total,revision=revision+1 where id=v_po.id;
  end if;
  update public.purchase_order_revisions set after_value=jsonb_build_object('po',(select to_jsonb(p) from public.purchase_orders p where p.id=v_po.id),'items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb) from public.purchase_order_items i where i.po_id=v_po.id)) where id=v_audit;
  v_result:=jsonb_build_object('po_id',v_po.id,'revision',(select revision from public.purchase_orders where id=v_po.id),'action',p_action,'revision_id',v_audit);
  insert into public.purchase_order_requests(actor_id,request_key,purchase_order_id,payload,result,branch_id) values(auth.uid(),p_request_key,v_po.id,v_payload,v_result,v_po.branch_id);
  return v_result;
end $$;
revoke all on function public.revise_purchase_order(text,uuid,integer,text,jsonb,jsonb,text) from public,anon,service_role;
grant execute on function public.revise_purchase_order(text,uuid,integer,text,jsonb,jsonb,text) to authenticated;

create or replace function public.transition_purchase_order_status(p_purchase_order_id uuid, p_status text)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_po public.purchase_orders%rowtype;
begin
  select * into v_po from public.purchase_orders where id=p_purchase_order_id for update;
  if not found then raise exception 'PO tidak ditemukan'; end if;
  perform public.purchase_assert_access('receipt',v_po.branch_id);
  if p_status is null or p_status <> 'Dipesan' or v_po.status <> 'Draft' then raise exception 'Perubahan status PO tidak diizinkan'; end if;
  update public.purchase_orders set status='Dipesan' where id=v_po.id;
end $$;
revoke all on function public.transition_purchase_order_status(uuid,text) from public,anon,service_role;
grant execute on function public.transition_purchase_order_status(uuid,text) to authenticated;

create or replace function public.guard_purchase_order_direct_write() returns trigger
language plpgsql security invoker set search_path = pg_catalog, public as $$
begin
  if current_user in ('authenticated','anon','service_role') then
    raise exception 'PO hanya dapat diubah melalui jalur transaksi resmi' using errcode='42501';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
drop trigger if exists purchase_order_direct_write_guard on public.purchase_orders;
create trigger purchase_order_direct_write_guard before insert or update or delete on public.purchase_orders
for each row execute function public.guard_purchase_order_direct_write();
drop trigger if exists purchase_order_item_direct_write_guard on public.purchase_order_items;
create trigger purchase_order_item_direct_write_guard before insert or update or delete on public.purchase_order_items
for each row execute function public.guard_purchase_order_direct_write();

-- Uang muka masih memakai jalur insert lama. Kunci PO di trigger ini supaya
-- koreksi PO dan pembuatan uang muka selalu terserialisasi, termasuk saat PO
-- baru saja dibatalkan atau pemasoknya baru saja diganti.
create or replace function public.guard_purchase_advance_parent() returns trigger
language plpgsql security invoker set search_path = pg_catalog, public as $$
declare v_status text; v_supplier uuid;
begin
  if new.po_id is null then return new; end if;
  select status, supplier_id into v_status, v_supplier
    from public.purchase_orders where id=new.po_id for update;
  if not found then raise exception 'PO uang muka tidak ditemukan'; end if;
  if v_status not in ('Draft','Dipesan') then raise exception 'PO uang muka sudah tidak aktif'; end if;
  -- PO lama boleh belum memiliki supplier; dalam kasus itu uang muka tetap
  -- boleh memilih supplier seperti alur sebelumnya. Jika PO punya supplier,
  -- supplier uang muka wajib sama.
  if v_supplier is not null and new.supplier_id is distinct from v_supplier then raise exception 'Pemasok uang muka tidak sesuai PO'; end if;
  return new;
end $$;
drop trigger if exists purchase_advance_parent_guard on public.purchase_advances;
create trigger purchase_advance_parent_guard before insert or update of po_id, supplier_id on public.purchase_advances
for each row execute function public.guard_purchase_advance_parent();
