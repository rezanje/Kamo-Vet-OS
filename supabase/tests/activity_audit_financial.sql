-- Fictional local-only acceptance tests. No source policy or guard is disabled.
begin;
do $$declare missing text;begin
 select string_agg(e,', ' order by e) into missing from unnest(array[
 'sales_receipts','sales_advances','sales_returns','sales_return_items',
 'purchase_advances','payment_orders','payment_order_items','purchase_returns','purchase_return_items',
 'invoice_payments','journal_lines','asset_depreciations','asset_changes','asset_disposals','asset_transfers',
 'po_payments','sale_payments','sale_payment_refunds','sales_invoice_delivery_allocations','purchase_invoice_layer_proofs','clinic_compound_sales']) e
 where not exists(select 1 from activity_log_sources s where s.entity=e);
 if missing is not null then raise exception 'Missing financial audit sources: %',missing;end if;
end$$;
create function pg_temp.af_assert(ok boolean, message text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception '%',message;end if;
end$$;
create function pg_temp.af_reject(command text, fragment text) returns void language plpgsql as $$begin
 begin execute command;exception when others then
  if position(fragment in sqlerrm)=0 then raise exception 'Expected %, got %',fragment,sqlerrm;end if;return;
 end;raise exception 'Expected rejection: %',command;
end$$;
insert into auth.users(id,raw_user_meta_data) values
 (md5('af-owner')::uuid,'{"full_name":"Financial audit owner"}'),
 (md5('af-admin')::uuid,'{"full_name":"Financial audit admin"}'),
 (md5('af-staff')::uuid,'{"full_name":"Financial audit staff"}');
update profiles set role='OWNER',is_active=true where id=md5('af-owner')::uuid;
update profiles set role='ADMIN',is_active=true where id=md5('af-admin')::uuid;
update profiles set role='STAFF',is_active=true where id=md5('af-staff')::uuid;
insert into role_capabilities(role,all_branches) values('ADMIN',false) on conflict(role) do update set all_branches=false;
insert into branches(id,code,name,type) values
 (md5('af-a')::uuid,'AF-A','Fictional financial A','PETSHOP'),
 (md5('af-b')::uuid,'AF-B','Fictional financial B','PETSHOP');
insert into user_branches(user_id,branch_id) values(md5('af-admin')::uuid,md5('af-a')::uuid);
insert into coa_accounts(code,name,type,normal_balance) values('1198','Fictional financial audit bank A','ASET','D'),('1197','Fictional financial audit bank B','ASET','D') on conflict(code) do nothing;
insert into cash_accounts(id,nama,jenis,coa_code,branch_id) values
 (md5('af-account-a')::uuid,'Fictional audit bank A','Bank','1198',md5('af-a')::uuid),
 (md5('af-account-b')::uuid,'Fictional audit bank B','Bank','1197',md5('af-b')::uuid);
insert into warehouses(id,code,name,type,branch_id) values(md5('af-wh')::uuid,'AF-WH','Fictional warehouse','VET',md5('af-a')::uuid);
insert into items(id,code,name) values(md5('af-item')::uuid,'AF-ITEM','PRIVATE ITEM');
insert into customers(id,name,phone) values(md5('af-customer')::uuid,'PRIVATE CUSTOMER','PRIVATE PHONE');
insert into pets(id,customer_id,name) values(md5('af-pet')::uuid,md5('af-customer')::uuid,'PRIVATE PET');
insert into suppliers(id,nama) values(md5('af-supplier')::uuid,'PRIVATE SUPPLIER');
-- Parent fixtures precede actor selection so attribution assertions target only
-- financial mutations below. Database-owner writes exercise existing triggers;
-- the real authenticated RPC and rejected client writes are tested separately.
do $$declare suffix text;branch uuid;begin
 foreach suffix in array array['a','b'] loop
  branch:=md5('af-'||suffix)::uuid;
  insert into sales(id,branch_id,no_struk) values(md5('af-sale-'||suffix)::uuid,branch,'AF-SALE-'||suffix);
  insert into sales_orders(id,no_pesanan,branch_id) values(md5('af-order-'||suffix)::uuid,'AF-ORDER-'||suffix,branch);
  insert into sales_invoices(id,no_faktur,branch_id) values(md5('af-si-'||suffix)::uuid,'AF-SI-'||suffix,branch);
  insert into purchase_orders(id,no_po,branch_id,supplier_id) values(md5('af-po-'||suffix)::uuid,'AF-PO-'||suffix,branch,md5('af-supplier')::uuid);
  insert into purchase_invoices(id,no_faktur,po_id,branch_id,supplier_id,total) values(md5('af-pi-'||suffix)::uuid,'AF-PI-'||suffix,md5('af-po-'||suffix)::uuid,branch,md5('af-supplier')::uuid,1000);
  insert into visits(id,branch_id,customer_id,pet_id) values(md5('af-visit-'||suffix)::uuid,branch,md5('af-customer')::uuid,md5('af-pet')::uuid);
  insert into invoices(id,visit_id,invoice_no) values(md5('af-invoice-'||suffix)::uuid,md5('af-visit-'||suffix)::uuid,'AF-CLINIC-'||suffix);
  insert into fixed_assets(id,nama,harga_perolehan,umur_bulan,branch_id) values(md5('af-asset-'||suffix)::uuid,'PRIVATE ASSET',1000,12,branch);
  insert into journal_entries(id,no_jurnal,branch_id,source) values(md5('af-journal-'||suffix)::uuid,'AF-JOURNAL-'||suffix,branch,'manual');
 end loop;
end$$;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',md5('af-owner')::uuid::text,true);
select set_config('kamo.audit_actor',md5('af-staff')::uuid::text,true);
insert into sales_advances(id,no_um,order_id,account_id,jumlah,catatan,created_by) values(md5('af-sales_advances')::uuid,'AF-SA',md5('af-order-a')::uuid,md5('af-account-a')::uuid,100,'PRIVATE NOTE',md5('af-staff')::uuid);
insert into sales_receipts(id,no_terima,invoice_id,account_id,jumlah,catatan,created_by) values(md5('af-sales_receipts')::uuid,'AF-SRC',md5('af-si-a')::uuid,md5('af-account-a')::uuid,100,'PRIVATE NOTE',md5('af-staff')::uuid);
insert into sales_returns(id,no_retur,sale_id,total,keterangan,created_by) values(md5('af-sales_returns')::uuid,'AF-SR',md5('af-sale-a')::uuid,100,'PRIVATE NOTE',md5('af-staff')::uuid);
insert into sales_return_items(id,return_id,nama,qty,harga) values(md5('af-sales_return_items')::uuid,md5('af-sales_returns')::uuid,'PRIVATE LINE',1,100);
insert into purchase_advances(id,no_um,po_id,account_id,supplier_id,jumlah,catatan) values(md5('af-purchase_advances')::uuid,'AF-PA',md5('af-po-a')::uuid,md5('af-account-a')::uuid,md5('af-supplier')::uuid,100,'PRIVATE NOTE');
insert into payment_orders(id,no_pp,supplier_id,total,catatan) values(md5('af-payment_orders')::uuid,'AF-PP',md5('af-supplier')::uuid,100,'PRIVATE NOTE');
insert into payment_order_items(id,order_id,invoice_id,jumlah) values(md5('af-payment_order_items')::uuid,md5('af-payment_orders')::uuid,md5('af-pi-a')::uuid,100);
insert into purchase_returns(id,no_retur,po_id,total,keterangan) values(md5('af-purchase_returns')::uuid,'AF-PR',md5('af-po-a')::uuid,100,'PRIVATE NOTE');
insert into purchase_return_items(id,return_id,nama,qty,harga) values(md5('af-purchase_return_items')::uuid,md5('af-purchase_returns')::uuid,'PRIVATE LINE',1,100);
insert into invoice_payments(id,invoice_id,amount,catatan,request_key,request_hash) values(md5('af-invoice_payments')::uuid,md5('af-invoice-a')::uuid,10,'PRIVATE MEDICAL NOTE','PRIVATE REQUEST','PRIVATE HASH');
insert into journal_lines(id,entry_id,account_id,debit,credit) select md5('af-journal_lines')::uuid,md5('af-journal-a')::uuid,id,100,0 from coa_accounts where code='1198';
insert into asset_depreciations(id,asset_id,periode,amount) values(md5('af-asset_depreciations')::uuid,md5('af-asset-a')::uuid,'2026-10',10);
insert into asset_changes(id,asset_id,jenis,nilai_lama,nilai_baru,keterangan) values(md5('af-asset_changes')::uuid,md5('af-asset-a')::uuid,'nilai',1000,1100,'PRIVATE NOTE');
insert into asset_disposals(id,asset_id,account_id,jenis,harga_jual,keterangan) values(md5('af-asset_disposals')::uuid,md5('af-asset-a')::uuid,md5('af-account-a')::uuid,'jual',100,'PRIVATE NOTE');
insert into asset_transfers(id,asset_id,dari_branch_id,ke_branch_id,keterangan) values(md5('af-asset_transfers')::uuid,md5('af-asset-a')::uuid,md5('af-a')::uuid,md5('af-b')::uuid,'PRIVATE NOTE');
insert into po_payments(id,po_id,amount,catatan) values(md5('af-po_payments')::uuid,md5('af-po-a')::uuid,100,'PRIVATE NOTE');
insert into sale_payments(id,sale_id,method,amount,coa_code,account_snapshot) values(md5('af-sale_payments')::uuid,md5('af-sale-a')::uuid,'Tunai',100,'1198','{"PRIVATE":"PAYLOAD"}');
insert into expenses(id,branch_id,kategori,jumlah) values(md5('af-refund-expense')::uuid,md5('af-a')::uuid,'Fictional refund',10);
insert into sale_payment_refunds(id,sales_return_id,sale_payment_id,expense_id,amount) values(md5('af-sale_payment_refunds')::uuid,md5('af-sales_returns')::uuid,md5('af-sale_payments')::uuid,md5('af-refund-expense')::uuid,10);
-- Composite identities and nested history: allocation => invoice line => invoice.
insert into sales_invoice_items(id,invoice_id,nama,qty,harga) values(md5('af-allocated-invoice-line')::uuid,md5('af-si-a')::uuid,'PRIVATE LINE',1,100);
insert into sales_deliveries(id,no_kirim,order_id) values(md5('af-delivery')::uuid,'AF-DELIVERY',md5('af-order-b')::uuid);
insert into sales_delivery_items(id,delivery_id,nama,qty,hpp) values(md5('af-allocated-delivery-line')::uuid,md5('af-delivery')::uuid,'PRIVATE LINE',1,50);
insert into sales_invoice_delivery_allocations(invoice_item_id,delivery_item_id,qty,hpp) values(md5('af-allocated-invoice-line')::uuid,md5('af-allocated-delivery-line')::uuid,1,50);
insert into stock_layers(id,warehouse_id,item_id,qty_in,qty_left,source) values(md5('af-layer')::uuid,md5('af-wh')::uuid,md5('af-item')::uuid,1,1,'manual');
insert into purchase_invoice_layer_proofs(invoice_id,layer_id,before_state,after_state,allocated) values(md5('af-pi-a')::uuid,md5('af-layer')::uuid,'{"PRIVATE":"BEFORE"}','{"PRIVATE":"AFTER"}',true);

-- A request-key table also holds an actual frozen selling snapshot. Exercise
-- the native formula binding/issue lifecycle; its receipt and recipe link count.
insert into medical_records(id,visit_id) values(md5('af-medical')::uuid,md5('af-visit-a')::uuid);
insert into items(id,code,name,unit,item_type,is_active,is_compound_material,sell_price) values
 (md5('af-compound-ingredient')::uuid,'AF-COMP-ING','PRIVATE INGREDIENT','gram','Persediaan',true,true,15),
 (md5('af-compound-sku')::uuid,'AF-COMP-SKU','Obat Racik PRIVATE','pcs','Persediaan',true,false,75);
insert into stock(warehouse_id,item_id,qty) values(md5('af-wh')::uuid,md5('af-compound-ingredient')::uuid,10);
insert into stock_layers(warehouse_id,item_id,qty_in,qty_left,unit_cost,source) values(md5('af-wh')::uuid,md5('af-compound-ingredient')::uuid,10,10,5,'purchase');
set local role authenticated;
do $$declare v_version uuid;formula uuid;recipe uuid;n bigint;begin
 v_version:=publish_compound_formula(null,'AF-COMP-FORMULA','PRIVATE FORMULA','puyer','PRIVATE INSTRUCTION',jsonb_build_array(jsonb_build_object('item_id',md5('af-compound-ingredient')::uuid,'quantity',1,'unit','gram')));
 select formula_id into formula from compound_formula_versions where id=v_version;
 perform bind_compound_formula_sale_item(formula,md5('af-compound-sku')::uuid);
 recipe:=clinic_issue_master_compound(md5('af-medical')::uuid,md5('af-visit-a')::uuid,md5('af-compound-sku')::uuid,null,'af-compound-command',v_version,null);
 select count(*) into n from activity_log;
 perform pg_temp.af_assert(clinic_issue_master_compound(md5('af-medical')::uuid,md5('af-visit-a')::uuid,md5('af-compound-sku')::uuid,null,'af-compound-command',v_version,null)=recipe and (select count(*) from activity_log)=n,'Clinical compound retry duplicated business/audit mutation');
 perform pg_temp.af_assert((select count(*) from activity_log where row_entity='clinic_compound_sales' and row_id='af-compound-command' and entity='visits' and entity_id=md5('af-visit-a')::uuid::text)=2,'Frozen compound sale create/link update missing');
 perform pg_temp.af_assert(not exists(select 1 from activity_log where row_entity='clinic_compound_sales' and (changed_fields<>array['metadata'] or before_state<>'{}' or after_state<>'{}' or object_label like '%PRIVATE%' or actor_id is distinct from md5('af-owner')::uuid or branch_ids<>array[md5('af-a')::uuid])),'Frozen compound sale privacy/actor/scope failure');
 perform pg_temp.af_reject('delete from clinic_compound_sales where request_key=''af-compound-command''','permission denied');
end$$;
reset role;

create temporary table af_mutable(entity text primary key,assignment text);
insert into af_mutable values
 ('sales_receipts','jumlah=101'),('sales_advances','jumlah=101'),('sales_returns','total=101'),('sales_return_items','qty=2'),
 ('purchase_advances','jumlah=101'),('payment_orders','total=101'),('payment_order_items','jumlah=101'),('purchase_returns','total=101'),('purchase_return_items','qty=2'),
 ('invoice_payments','amount=11'),('journal_lines','debit=101'),('asset_depreciations','amount=11'),('asset_changes','nilai_baru=1101'),('asset_disposals','harga_jual=101'),
 ('asset_transfers','tanggal=current_date-1'),('po_payments','amount=101');
do $$declare source record;n bigint;begin
 for source in select * from af_mutable loop
  perform pg_temp.af_assert(exists(select 1 from activity_log where row_entity=source.entity and row_id=md5('af-'||source.entity)::uuid::text and action='create'),'Missing create: '||source.entity);
  if source.entity in('payment_orders','payment_order_items') then
   perform pg_temp.af_assert(exists(select 1 from activity_log where row_entity=source.entity and row_id=md5('af-'||source.entity)::uuid::text and action='create' and scope='all'),'Unscoped payment-order history widened: '||source.entity);
  else
   perform pg_temp.af_assert(exists(select 1 from activity_log where row_entity=source.entity and row_id=md5('af-'||source.entity)::uuid::text and action='create' and scope='branches' and branch_ids @> array[md5('af-a')::uuid]),'Financial create omitted source branch: '||source.entity);
  end if;
  if source.entity in('sales_receipts','sales_advances','sales_returns','purchase_advances','purchase_returns','payment_orders') then
   perform pg_temp.af_assert(exists(select 1 from activity_log where row_entity=source.entity and row_id=md5('af-'||source.entity)::uuid::text and action='create' and entity=source.entity and entity_id=row_id),'Financial document lost independent identity: '||source.entity);
  end if;
  execute format('update public.%I set %s where id=$1',source.entity,source.assignment) using md5('af-'||source.entity)::uuid;
  perform pg_temp.af_assert(exists(select 1 from activity_log where row_entity=source.entity and row_id=md5('af-'||source.entity)::uuid::text and action='update'),'Missing update: '||source.entity);
  select count(*) into n from activity_log;
  execute format('update public.%I set %s where id=$1',source.entity,source.assignment) using md5('af-'||source.entity)::uuid;
  perform pg_temp.af_assert((select count(*) from activity_log)=n,'No-op duplicated event: '||source.entity);
 end loop;
end$$;
update purchase_invoice_layer_proofs set after_state='{"PRIVATE":"UPDATED"}' where invoice_id=md5('af-pi-a')::uuid;
select pg_temp.af_assert(exists(select 1 from activity_log where row_entity='purchase_invoice_layer_proofs' and action='update' and changed_fields=array['metadata'] and before_state='{}' and after_state='{}'),'Composite proof metadata update missing');
select pg_temp.af_assert(exists(select 1 from activity_log where row_entity='sales_invoice_delivery_allocations' and entity='sales_invoices' and entity_id=md5('af-si-a')::uuid::text and row_id like '%'||md5('af-allocated-invoice-line')::uuid::text||'%' and row_id like '%'||md5('af-allocated-delivery-line')::uuid::text||'%' and branch_ids @> array[md5('af-a')::uuid,md5('af-b')::uuid]),'Composite allocation identity/nested history/cross-branch scope lost');
-- Immutable business allocations remain immutable and rejected writes have no log.
do $$declare n bigint;begin
 select count(*) into n from activity_log;
 perform pg_temp.af_reject('update sale_payments set amount=101 where id=md5(''af-sale_payments'')::uuid','sudah tetap');
 perform pg_temp.af_reject('delete from sale_payments where id=md5(''af-sale_payments'')::uuid','sudah tetap');
 perform pg_temp.af_reject('update sale_payment_refunds set amount=11 where id=md5(''af-sale_payment_refunds'')::uuid','sudah tetap');
 perform pg_temp.af_reject('delete from sale_payment_refunds where id=md5(''af-sale_payment_refunds'')::uuid','sudah tetap');
 perform pg_temp.af_reject('update sales_invoice_delivery_allocations set qty=2','sudah tetap');
 perform pg_temp.af_reject('delete from sales_invoice_delivery_allocations','sudah tetap');
 perform pg_temp.af_assert((select count(*) from activity_log)=n,'Rejected immutable write appended audit');
end$$;

-- OLD/NEW parent scope and grouping survive moving a child between documents.
insert into sales_returns(id,no_retur,sale_id,total) values(md5('af-return-b')::uuid,'AF-SR-B',md5('af-sale-b')::uuid,10);
update sales_return_items set return_id=md5('af-return-b')::uuid where id=md5('af-sales_return_items')::uuid;
update journal_lines set entry_id=md5('af-journal-b')::uuid where id=md5('af-journal_lines')::uuid;
update invoice_payments set transferred_from=md5('af-invoice-b')::uuid where id=md5('af-invoice_payments')::uuid;
update sales_advances set account_id=md5('af-account-b')::uuid where id=md5('af-sales_advances')::uuid;
select pg_temp.af_assert(exists(select 1 from activity_log where row_id=md5('af-sales_return_items')::uuid::text and action='update' and entity_ids @> array[md5('af-sales_returns')::uuid::text,md5('af-return-b')::uuid::text] and branch_ids @> array[md5('af-a')::uuid,md5('af-b')::uuid]),'Return reparent lost old/new history or scope');
select pg_temp.af_assert(exists(select 1 from activity_log where row_id=md5('af-journal_lines')::uuid::text and action='update' and branch_ids @> array[md5('af-a')::uuid,md5('af-b')::uuid]),'Journal reparent lost branch scope');
select pg_temp.af_assert(exists(select 1 from activity_log where row_id=md5('af-invoice_payments')::uuid::text and action='update' and branch_ids @> array[md5('af-a')::uuid,md5('af-b')::uuid]),'Clinical transferred-from branch omitted');
select pg_temp.af_assert(exists(select 1 from activity_log where row_id=md5('af-sales_advances')::uuid::text and action='update' and entity='sales_advances' and branch_ids @> array[md5('af-a')::uuid,md5('af-b')::uuid]),'Advance retained only order branch and dropped changed account branch');

-- Official create + lost-response retry produces exactly one header and child.
set local role authenticated;
select set_config('af.rpc',mutate_purchase_payment_order('af-order-create','create',null,null,jsonb_build_object('supplier_id',md5('af-supplier')::uuid,'catatan','PRIVATE RPC NOTE'),jsonb_build_array(jsonb_build_object('invoice_id',md5('af-pi-a')::uuid,'jumlah',100)))::text,true);
do $$declare n bigint;r jsonb;begin
 select count(*) into n from activity_log;
 r:=mutate_purchase_payment_order('af-order-create','create',null,null,jsonb_build_object('supplier_id',md5('af-supplier')::uuid,'catatan','PRIVATE RPC NOTE'),jsonb_build_array(jsonb_build_object('invoice_id',md5('af-pi-a')::uuid,'jumlah',100)));
 perform pg_temp.af_assert(r=current_setting('af.rpc')::jsonb and (select count(*) from activity_log)=n,'Official payment-order retry duplicated mutation');
 perform pg_temp.af_assert((select count(*) from activity_log where entity='payment_orders' and entity_id=r->>'order_id' and action='create')=2,'Official payment-order header/detail not both audited');
 perform pg_temp.af_reject('insert into payment_orders(no_pp) values(''AF-FORGED'')','permission denied');
end$$;
reset role;

-- Safe numeric snapshots are retained; free text, request keys and raw payloads
-- never appear in snapshots or labels, including clinically linked payments.
select pg_temp.af_assert(not exists(select 1 from activity_log where row_entity in(select entity from af_mutable) and (before_state::text||after_state::text||object_label) like '%PRIVATE%'),'Financial snapshot disclosed private values');
select pg_temp.af_assert(not exists(select 1 from activity_log where row_entity in('sale_payments','purchase_invoice_layer_proofs') and (before_state::text||after_state::text||object_label) like '%PRIVATE%'),'Payment/proof payload disclosed');
select pg_temp.af_assert(not exists(select 1 from activity_log where row_entity='invoice_payments' and (before_state<>'{}' or after_state<>'{}' or changed_fields<>array['metadata'])),'Clinical payment retained values or field names');
select pg_temp.af_assert(not exists(select 1 from activity_log where row_entity='sale_payments' and (before_state<>'{}' or after_state<>'{}' or changed_fields<>array['metadata'])),'Frozen payment payload retained values or field names');
select pg_temp.af_assert(exists(select 1 from activity_log where row_entity='sales_receipts' and after_state->>'jumlah'='101.00'),'Financial amount snapshot missing');
select pg_temp.af_assert(not exists(select 1 from activity_log where row_id in(select md5('af-'||entity)::uuid::text from af_mutable) and (actor_id is distinct from md5('af-owner')::uuid or actor_name is distinct from 'Financial audit owner' or actor_kind is distinct from 'user' or occurred_at is null)),'Business creator or client GUC spoofed actor');

-- Delete every mutable fixture. Existing cascades must retain branch scope even
-- after the parent has disappeared; no audit FK is introduced.
delete from sales_returns where id=md5('af-sales_returns')::uuid; -- refunds cascade
delete from sales where id=md5('af-sale-a')::uuid; -- payments cascade
delete from purchase_returns where id=md5('af-purchase_returns')::uuid; -- lines cascade
delete from fixed_assets where id=md5('af-asset-a')::uuid; -- all four child families
delete from payment_orders where id=md5('af-payment_orders')::uuid; -- order items
delete from invoices where id=md5('af-invoice-a')::uuid; -- clinic payments
do $$declare source record;begin
 for source in select * from af_mutable loop
  execute format('delete from public.%I where id=$1',source.entity) using md5('af-'||source.entity)::uuid;
  perform pg_temp.af_assert(exists(select 1 from activity_log where row_entity=source.entity and row_id=md5('af-'||source.entity)::uuid::text and action='delete'),'Missing retained delete: '||source.entity);
 end loop;
end$$;
delete from purchase_invoice_layer_proofs where invoice_id=md5('af-pi-a')::uuid;
delete from clinic_compound_sales where request_key='af-compound-command';
select pg_temp.af_assert(exists(select 1 from activity_log where row_entity='clinic_compound_sales' and row_id='af-compound-command' and action='delete' and branch_ids=array[md5('af-a')::uuid]),'Frozen compound sale delete retention missing');
select pg_temp.af_assert(exists(select 1 from activity_log where row_entity='purchase_invoice_layer_proofs' and action='delete'),'Composite proof delete missing');
select pg_temp.af_assert(exists(select 1 from activity_log where row_entity='sale_payment_refunds' and action='delete' and branch_ids @> array[md5('af-a')::uuid]),'Refund cascade lost branch evidence');
select pg_temp.af_assert(exists(select 1 from activity_log where row_entity='sale_payments' and action='delete' and branch_ids @> array[md5('af-a')::uuid]),'Payment cascade lost branch evidence');
select pg_temp.af_assert(exists(select 1 from activity_log where row_entity='asset_changes' and action='delete' and scope='branches' and branch_ids=array[md5('af-a')::uuid]),'Asset cascade lost original branch');

set local role authenticated;
select set_config('request.jwt.claim.sub',md5('af-admin')::uuid::text,true);
select pg_temp.af_assert(exists(select 1 from activity_log where row_entity='sales_receipts' and action='delete'),'Authorized financial deleted history absent');
select pg_temp.af_assert(not exists(select 1 from activity_log where row_entity in('asset_transfers','payment_orders','payment_order_items','sales_invoice_delivery_allocations','purchase_invoice_layer_proofs')),'Cross-branch/all-branch/private financial disclosure');
select pg_temp.af_assert(not exists(select 1 from activity_log where row_id=md5('af-sales_return_items')::uuid::text and action='update' and cardinality(branch_ids)>1),'Reparent event disclosed across branches');
select set_config('request.jwt.claim.sub',md5('af-owner')::uuid::text,true);
select pg_temp.af_assert(not exists(select 1 from activity_log where row_entity='purchase_invoice_layer_proofs'),'Private proof metadata newly exposed to OWNER');
select set_config('request.headers',jsonb_build_object('x-kamo-operational-branch',md5('af-b')::uuid)::text,true);
select pg_temp.af_assert(not exists(select 1 from activity_log where row_entity in('payment_orders','payment_order_items') or row_entity='sales_receipts' and action='delete'),'Selected branch financial disclosure');
select set_config('request.headers','{}',true);
select set_config('request.jwt.claim.sub',md5('af-staff')::uuid::text,true);
select pg_temp.af_assert(not exists(select 1 from activity_log),'Staff financial activity disclosure');
reset role;
delete from role_modules where role='ADMIN';
insert into role_modules(role,module_id) values('ADMIN','crm');
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('af-admin')::uuid::text,true);
select pg_temp.af_assert(not exists(select 1 from activity_log where module_id in('pos','penjualan','pembelian','klinik','buku-besar','aset-tetap')),'Revoked financial module disclosure');
reset role;
-- Audit failure is transactional for a new financial row and a real official
-- command: neither its business state nor its durable retry result may survive.
create function pg_temp.af_fail_append() returns trigger language plpgsql as $$begin raise exception 'AF_INJECTED_APPEND_FAILURE';end$$;
create trigger af_fail_append before insert on activity_log for each row execute function pg_temp.af_fail_append();
select set_config('request.jwt.claim.sub',md5('af-owner')::uuid::text,true);
select pg_temp.af_reject('insert into sales_advances(id,no_um,order_id,jumlah) values(md5(''af-failed-advance'')::uuid,''AF-FAILED'',md5(''af-order-b'')::uuid,10)','AF_INJECTED_APPEND_FAILURE');
select pg_temp.af_assert(not exists(select 1 from sales_advances where id=md5('af-failed-advance')::uuid),'Advance survived failed audit append');
set local role authenticated;
select pg_temp.af_reject(format('select mutate_purchase_payment_order(%L,%L,%L,0,%L,%L)','af-failed-approve','approve',current_setting('af.rpc')::jsonb->>'order_id','{}','[]'),'AF_INJECTED_APPEND_FAILURE');
reset role;
select pg_temp.af_assert(exists(select 1 from payment_orders where id=(current_setting('af.rpc')::jsonb->>'order_id')::uuid and status='draft' and revision=0),'Official approval survived failed audit append');
select pg_temp.af_assert(not exists(select 1 from purchase_payment_order_requests where request_key='af-failed-approve'),'Failed official command retained retry result');
drop trigger af_fail_append on activity_log;
rollback;
