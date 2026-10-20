-- Fictional local acceptance suite. Caller must load the real repository migrations,
-- then run this file in one transaction against an isolated PostgreSQL instance.
begin;
insert into auth.users(id) values
 ('a0000000-0000-4000-8000-000000000001'),('a0000000-0000-4000-8000-000000000002');
insert into profiles(id,role,is_active) values
 ('a0000000-0000-4000-8000-000000000001','OWNER',true),
 ('a0000000-0000-4000-8000-000000000002','ADMIN',true)
 on conflict (id) do update set role=excluded.role,is_active=excluded.is_active;
insert into branches(id,code,name,type,is_active) values
 ('a1000000-0000-4000-8000-000000000001','PO-ACC','PO acceptance','KLINIK',true),
 ('a1000000-0000-4000-8000-000000000002','PO-OFF','PO inactive','KLINIK',false);
insert into warehouses(id,branch_id,code,name,type,is_active) values
 ('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','PO-WH','PO warehouse','VET',true),
 ('a2000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000002','PO-OFF','Inactive warehouse','VET',false);
insert into items(id,code,name,unit,item_type,is_active) values
 ('a3000000-0000-4000-8000-000000000001','PO-SKU','PO item','pcs','Persediaan',true);
insert into item_units(item_id,unit,factor) values ('a3000000-0000-4000-8000-000000000001','box',10);

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000001',true);
do $$declare a jsonb; b jsonb; failed boolean; po uuid; audit uuid;
begin
  a:=create_purchase_order_atomic('po-create','PO.ACC.',4,null,'a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',current_date,'[{"nama":"PO item","item_id":"a3000000-0000-4000-8000-000000000001","satuan":"box","faktor":999,"qty":2,"harga_beli":100}]');
  b:=create_purchase_order_atomic('po-create','PO.ACC.',4,null,'a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',current_date,'[{"nama":"PO item","item_id":"a3000000-0000-4000-8000-000000000001","satuan":"box","faktor":999,"qty":2,"harga_beli":100}]');
  if a is distinct from b or (select count(*) from purchase_orders where id=(a->>'po_id')::uuid)<>1 then raise exception 'identical create retry duplicated PO'; end if;
  if (select faktor from purchase_order_items where po_id=(a->>'po_id')::uuid)<>10 then raise exception 'submitted unit factor was trusted'; end if;
  failed:=false; begin perform create_purchase_order_atomic('po-create','PO.ACC.',4,null,'a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',current_date,'[{"nama":"PO item","qty":3,"harga_beli":100}]'); exception when others then failed:=true; end;
  if not failed then raise exception 'changed create payload accepted'; end if;
  failed:=false; begin perform create_purchase_order_atomic('po-bad','PO.ACC.',4,null,'a2000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000002',current_date,'[{"nama":"PO item","qty":2,"harga_beli":100}]'); exception when others then failed:=true; end;
  if not failed or exists(select 1 from purchase_order_requests where request_key='po-bad') then raise exception 'inactive branch or warehouse created PO'; end if;
  po:=(a->>'po_id')::uuid;
  b:=revise_purchase_order('po-edit',po,0,'edit',jsonb_build_object('supplier_id',null,'to_warehouse_id','a2000000-0000-4000-8000-000000000001','tanggal',current_date),'[{"nama":"PO item","item_id":"a3000000-0000-4000-8000-000000000001","qty":4,"harga_beli":125}]','Koreksi isi');
  if (select revision from purchase_orders where id=po)<>1 or (select total from purchase_orders where id=po)<>500 or not exists(select 1 from purchase_order_revisions where id=(b->>'revision_id')::uuid and action='edit') then raise exception 'edit did not preserve audit or total'; end if;
  if (select (after_value->'po'->>'id') from purchase_order_revisions where id=(b->>'revision_id')::uuid) is null then raise exception 'audit after value missing'; end if;
  failed:=false; begin perform revise_purchase_order('stale',po,0,'void','{}','[]','Batal stale'); exception when others then failed:=true; end;
  if not failed then raise exception 'stale revision accepted'; end if;
  b:=revise_purchase_order('po-void',po,1,'void','{}','[]','PO dibatalkan');
  if (select status::text from purchase_orders where id=po)<>'Batal' or (select revision from purchase_orders where id=po)<>2 then raise exception 'void did not update guarded status'; end if;
  failed:=false; begin perform revise_purchase_order('null-action',po,2,null,'{}','[]','invalid'); exception when others then failed:=true; end;
  if not failed then raise exception 'null action accepted'; end if;
end$$;

reset role;
update accounting_locks set closed_until=current_date where id;
set local role authenticated;
do $$declare failed boolean:=false;begin
  begin perform create_purchase_order_atomic('po-closed','PO.ACC.',4,null,'a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',current_date,'[{"nama":"PO item","item_id":"a3000000-0000-4000-8000-000000000001","qty":1,"harga_beli":100}]'); exception when others then failed:=true; end;
  if not failed then raise exception 'create accepted in closed period'; end if;
end$$;
reset role;
update accounting_locks set closed_until=null where id;
set local role authenticated;
select create_purchase_order_atomic('po-future','PO.ACC.',4,null,'a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',current_date+1,'[{"nama":"PO item","item_id":"a3000000-0000-4000-8000-000000000001","qty":1,"harga_beli":100}]');
reset role;
update accounting_locks set closed_until=current_date where id;
set local role authenticated;
do $$declare failed boolean:=false; po uuid; result jsonb;begin
  result:=get_purchase_order_result('po-future');
  if result is null or result->>'po_id' is null then raise exception 'durable PO result was not readable through recovery RPC'; end if;
  po:=(result->>'po_id')::uuid;
  begin perform revise_purchase_order('po-closed-edit',po,0,'edit',jsonb_build_object('to_warehouse_id','a2000000-0000-4000-8000-000000000001','tanggal',current_date),'[{"nama":"PO item","item_id":"a3000000-0000-4000-8000-000000000001","qty":1,"harga_beli":100}]','Closed date'); exception when others then failed:=true; end;
  if not failed then raise exception 'edit accepted into closed period'; end if;
end$$;
reset role;
update accounting_locks set closed_until=null where id;
set local role authenticated;
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000002',true);
do $$declare failed boolean; po uuid;begin
  select id into po from purchase_orders where tanggal=current_date+1 order by created_at desc limit 1;
  if po is null then raise exception 'future PO fixture missing'; end if;
  failed:=false; begin perform revise_purchase_order('admin-edit',po,0,'edit',jsonb_build_object('to_warehouse_id','a2000000-0000-4000-8000-000000000001','tanggal',current_date+1),'[{"nama":"PO item","item_id":"a3000000-0000-4000-8000-000000000001","qty":1,"harga_beli":100}]','Admin edit'); exception when others then failed:=true; end;
  if not failed then raise exception 'non-owner edited PO'; end if;
  failed:=false; begin perform revise_purchase_order('admin-void',po,0,'void','{}','[]','Admin void'); exception when others then failed:=true; end;
  if not failed then raise exception 'non-owner voided PO'; end if;
end$$;
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000001',true);

reset role;
set local role authenticated;
do $$declare failed boolean:=false; po uuid;begin
  select id into po from purchase_orders where no_po like 'PO.ACC.%' order by created_at limit 1;
  begin update purchase_orders set status='Dipesan' where id=po; exception when others then failed:=true; end;
  if not failed then raise exception 'direct PO status mutation bypassed guard'; end if;
  failed:=false; begin delete from purchase_order_items where po_id=po; exception when others then failed:=true; end;
  if not failed then raise exception 'direct PO item mutation bypassed guard'; end if;
end$$;
reset role;
set local role service_role;
do $$declare failed boolean:=false; po uuid;begin
  select id into po from purchase_orders where no_po like 'PO.ACC.%' order by created_at limit 1;
  begin update purchase_orders set status='Dipesan' where id=po; exception when others then failed:=true; end;
  if not failed then raise exception 'service_role direct PO mutation bypassed guard'; end if;
end$$;
reset role;
set local role authenticated;
do $$declare failed boolean; po uuid;begin
  po:=(get_purchase_order_result('po-create')->>'po_id')::uuid;
  failed:=false; begin insert into purchase_advances(no_um,po_id,tanggal,jumlah) values ('UM-VOID-PO',po,current_date,10); exception when others then failed:=true; end;
  if not failed then raise exception 'advance insert bypassed cancelled PO guard'; end if;
end$$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000001',true);
select create_purchase_order_atomic('po-deactivated','PO.ACC.',4,null,'a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',current_date,'[{"nama":"PO item","item_id":"a3000000-0000-4000-8000-000000000001","qty":1,"harga_beli":100}]');
reset role;
update profiles set role='STAFF',is_active=false where id='a0000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$declare failed boolean:=false;begin
  begin perform create_purchase_order_atomic('po-deactivated','PO.ACC.',4,null,'a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',current_date,'[{"nama":"PO item","item_id":"a3000000-0000-4000-8000-000000000001","qty":1,"harga_beli":100}]'); exception when others then failed:=true; end;
  if not failed then raise exception 'deactivated owner recovered identical create'; end if;
end$$;
reset role;
update profiles set role='OWNER',is_active=true where id='a0000000-0000-4000-8000-000000000001';
set local role rezanje;
do $$begin
  insert into purchase_orders(id,no_po,branch_id,to_warehouse_id,status,total) values
    ('a4000000-0000-4000-8000-000000000001','PO-CHILD-1','a1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','Dipesan',100),
    ('a4000000-0000-4000-8000-000000000002','PO-CHILD-2','a1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','Dipesan',100),
    ('a4000000-0000-4000-8000-000000000003','PO-CHILD-3','a1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','Dipesan',100),
    ('a4000000-0000-4000-8000-000000000004','PO-CHILD-4','a1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','Dipesan',100),
    ('a4000000-0000-4000-8000-000000000005','PO-CHILD-5','a1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','Dipesan',100),
    ('a4000000-0000-4000-8000-000000000006','PO-LEGACY','a1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','Dipesan',100);
  insert into purchase_order_items(id,po_id,item_id,nama,qty,harga_beli,qty_terima) values
    ('a5000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','PO item',1,100,0),
    ('a5000000-0000-4000-8000-000000000002','a4000000-0000-4000-8000-000000000002','a3000000-0000-4000-8000-000000000001','PO item',1,100,0),
    ('a5000000-0000-4000-8000-000000000003','a4000000-0000-4000-8000-000000000003','a3000000-0000-4000-8000-000000000001','PO item',1,100,0),
    ('a5000000-0000-4000-8000-000000000004','a4000000-0000-4000-8000-000000000004','a3000000-0000-4000-8000-000000000001','PO item',1,100,0),
    ('a5000000-0000-4000-8000-000000000005','a4000000-0000-4000-8000-000000000005','a3000000-0000-4000-8000-000000000001','PO item',1,100,0),
    ('a5000000-0000-4000-8000-000000000006','a4000000-0000-4000-8000-000000000006','a3000000-0000-4000-8000-000000000001','PO item',1,100,1);
  insert into goods_receipts(id,no_terima,po_id) values ('a6000000-0000-4000-8000-000000000001','TB-CHILD-1','a4000000-0000-4000-8000-000000000001');
  insert into purchase_invoices(id,no_faktur,po_id) values ('a7000000-0000-4000-8000-000000000001','FB-CHILD-2','a4000000-0000-4000-8000-000000000002');
  insert into po_payments(po_id,amount) values ('a4000000-0000-4000-8000-000000000003',10);
  insert into purchase_advances(no_um,po_id,tanggal,jumlah) values ('UM-CHILD-4','a4000000-0000-4000-8000-000000000004',current_date,10);
  insert into purchase_returns(id,no_retur,po_id) values ('a8000000-0000-4000-8000-000000000001','RB-CHILD-5','a4000000-0000-4000-8000-000000000005');
end$$;
set local role authenticated;
do $$declare failed boolean; po uuid; before_revision integer; before_status text; before_qty numeric; k text;begin
  for po,k in select x::uuid,y from (values ('a4000000-0000-4000-8000-000000000001','receipt'),('a4000000-0000-4000-8000-000000000002','invoice'),('a4000000-0000-4000-8000-000000000003','payment'),('a4000000-0000-4000-8000-000000000004','advance'),('a4000000-0000-4000-8000-000000000005','return'),('a4000000-0000-4000-8000-000000000006','legacy')) v(x,y) loop
    select revision,status::text into before_revision,before_status from purchase_orders where id=po;
    select qty into before_qty from purchase_order_items where po_id=po;
    failed:=false; begin perform revise_purchase_order('edit-'||k,po,0,'edit',jsonb_build_object('to_warehouse_id','a2000000-0000-4000-8000-000000000001','tanggal',current_date),'[{"nama":"Changed","item_id":"a3000000-0000-4000-8000-000000000001","qty":2,"harga_beli":200}]','blocked dependency'); exception when others then failed:=true; end;
    if not failed then raise exception 'edit accepted with descendant %',k; end if;
    failed:=false; begin perform revise_purchase_order('void-'||k,po,0,'void','{}','[]','blocked dependency'); exception when others then failed:=true; end;
    if not failed then raise exception 'void accepted with descendant %',k; end if;
    if (select revision from purchase_orders where id=po)<>before_revision or (select status::text from purchase_orders where id=po)<>before_status or (select qty from purchase_order_items where po_id=po)<>before_qty or exists(select 1 from purchase_order_revisions where purchase_order_id=po) then raise exception 'blocked dependency mutated %',k; end if;
  end loop;
end$$;
rollback;
