-- Fictional local fixtures only; this suite rolls back all changes.
begin;
insert into auth.users(id)values('dc000000-0000-4000-8000-000000000001'),('dc000000-0000-4000-8000-000000000002');
update profiles set role='OWNER'where id='dc000000-0000-4000-8000-000000000001';
insert into branches(id,code,name,type)values('dc100000-0000-4000-8000-000000000001','PURCH-FIC','Fiction purchase','KLINIK');
insert into warehouses(id,branch_id,code,name,type)values('dc200000-0000-4000-8000-000000000001','dc100000-0000-4000-8000-000000000001','PURCH-WH','Fiction warehouse','VET');
insert into items(id,code,name,unit,item_type)values('dc300000-0000-4000-8000-000000000001','PURCH-SKU','Fiction medicine','pcs','Persediaan');
insert into item_units(item_id,unit,factor)values('dc300000-0000-4000-8000-000000000001','box',10);
insert into purchase_orders(id,no_po,branch_id,to_warehouse_id,status)values('dc400000-0000-4000-8000-000000000001','PO-FICTION','dc100000-0000-4000-8000-000000000001','dc200000-0000-4000-8000-000000000001','Dipesan');
insert into purchase_order_items(id,po_id,item_id,nama,qty,harga_beli,satuan,faktor)values('dc500000-0000-4000-8000-000000000001','dc400000-0000-4000-8000-000000000001','dc300000-0000-4000-8000-000000000001','Fiction medicine',4,100,'box',10);
create function public.purchase_test_failure()returns trigger language plpgsql as $$begin
 if current_setting('purchase.test_failure',true)=TG_ARGV[0]then raise exception 'Fiction forced failure';end if;return new;end$$;
create trigger purchase_test_stock before insert on public.stock_moves for each row execute function public.purchase_test_failure('stock');
create trigger purchase_test_journal before insert on public.journal_lines for each row execute function public.purchase_test_failure('journal');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','dc000000-0000-4000-8000-000000000001',true);
do $$declare first jsonb; retry jsonb; second jsonb; failed boolean;failure text;bad_rows jsonb; rows jsonb:='[{"id":"dc500000-0000-4000-8000-000000000001","qty_terima":2,"qty_rusak":1,"batches":[{"qty":1,"exp_date":"2027-01-01"},{"qty":1,"exp_date":"2028-01-01"}]}]';
begin
 -- Both faults occur after the receipt and cumulative quantities have been written.
 for failure in select unnest(array['stock','journal'])loop
  perform set_config('purchase.test_failure',failure,true);
  failed:=false;begin perform receive_purchase_order('dc400000-0000-4000-8000-000000000001','failure-'||failure,'TB.FIC.',5,current_date,null,null,rows);exception when others then failed:=true;end;
  if not failed or exists(select 1 from goods_receipts)or exists(select 1 from stock)or exists(select 1 from stock_layers)or exists(select 1 from stock_moves)or exists(select 1 from journal_entries)or(select qty_terima from purchase_order_items where id='dc500000-0000-4000-8000-000000000001')is not null then raise exception 'receipt % failure left partial effects',failure;end if;
 end loop;
 perform set_config('purchase.test_failure','',true);
 for bad_rows in select unnest(array[
  '[{"id":"dc500000-0000-4000-8000-000000000099","qty_terima":1}]'::jsonb,
  '[{"id":"dc500000-0000-4000-8000-000000000001","qty_terima":1},{"id":"dc500000-0000-4000-8000-000000000001","qty_terima":1}]'::jsonb,
  '[{"id":"dc500000-0000-4000-8000-000000000001","qty_terima":5}]'::jsonb,
  '[{"id":"dc500000-0000-4000-8000-000000000001","qty_terima":1,"batches":[{"qty":2,"exp_date":"2027-01-01"}]}]'::jsonb,
  '[{"id":"dc500000-0000-4000-8000-000000000001","qty_terima":"NaN"}]'::jsonb,
  '[{"id":"dc500000-0000-4000-8000-000000000001","qty_terima":-1}]'::jsonb
 ])loop
  failed:=false;begin perform receive_purchase_order('dc400000-0000-4000-8000-000000000001','invalid','TB.FIC.',5,current_date,null,null,bad_rows);exception when others then failed:=true;end;
  if not failed or exists(select 1 from goods_receipts)then raise exception 'invalid receipt input accepted or partially saved';end if;
 end loop;
 first:=receive_purchase_order('dc400000-0000-4000-8000-000000000001','receipt-first','TB.FIC.',5,current_date,null,null,rows);
 retry:=receive_purchase_order('dc400000-0000-4000-8000-000000000001','receipt-first','TB.FIC.',5,current_date,null,null,rows);
 if get_purchase_operation_result('receipt','receipt-first')is distinct from first then raise exception 'read-only receipt recovery failed';end if;
 if first<>retry or (select qty from stock where item_id='dc300000-0000-4000-8000-000000000001')<>20 or (select count(*)from goods_receipts)<>1 then raise exception 'receipt identical retry duplicated effects';end if;
 failed:=false;begin perform receive_purchase_order('dc400000-0000-4000-8000-000000000001','receipt-first','TB.FIC.',5,current_date,null,'changed',rows);exception when sqlstate 'P0001'then failed:=true;end;
 if not failed then raise exception 'changed receipt retry accepted';end if;
 update accounting_locks set closed_until=current_date where id;
 failed:=false;begin perform receive_purchase_order('dc400000-0000-4000-8000-000000000001','locked-damage','TB.FIC.',5,current_date,null,null,'[{"id":"dc500000-0000-4000-8000-000000000001","qty_terima":0,"qty_rusak":1}]');exception when sqlstate 'P0001'then failed:=true;end;
 if not failed then raise exception 'closed period accepted damaged-only receipt';end if;
 if get_purchase_operation_result('receipt','receipt-first')is distinct from first then raise exception 'closed period blocked committed result recovery';end if;
 update accounting_locks set closed_until=null where id;
 rows:=jsonb_set(rows,'{0,qty_rusak}','0');
 second:=receive_purchase_order('dc400000-0000-4000-8000-000000000001','receipt-second','TB.FIC.',5,current_date,null,null,rows);
 if second->>'receipt_id'=first->>'receipt_id'or(select count(*)from journal_entries where source='purchase')<>2 or(select qty from stock where item_id='dc300000-0000-4000-8000-000000000001')<>40 or(select status from purchase_orders where no_po='PO-FICTION')<>'Diterima'then raise exception 'staged receipt not fully posted';end if;
 if(select qty_rusak from purchase_order_items where id='dc500000-0000-4000-8000-000000000001')<>1 then raise exception 'damaged goods claim was lost';end if;
 if exists(select 1 from stock_layers where source_ref<>'PO-FICTION')then raise exception 'receipt broke invoice layer lookup';end if;
end$$;
-- A changed master unit stops acceptance without an effect; restore for other cases.
reset role;
update purchase_order_items set qty=5 where id='dc500000-0000-4000-8000-000000000001';
update purchase_orders set status='Dipesan'where id='dc400000-0000-4000-8000-000000000001';
update item_units set factor=12 where item_id='dc300000-0000-4000-8000-000000000001';
set local role authenticated;
do $$declare failed boolean:=false;begin
 begin perform receive_purchase_order('dc400000-0000-4000-8000-000000000001','unit-change','TB.FIC.',5,current_date,null,null,'[{"id":"dc500000-0000-4000-8000-000000000001","qty_terima":1}]');exception when others then failed:=true;end;
 if not failed or(select count(*)from goods_receipts)<>2 then raise exception 'changed unit conversion accepted';end if;
end$$;
reset role;
update item_units set factor=10 where item_id='dc300000-0000-4000-8000-000000000001';
update purchase_order_items set qty=4 where id='dc500000-0000-4000-8000-000000000001';
update purchase_orders set status='Diterima'where id='dc400000-0000-4000-8000-000000000001';
set local role authenticated;

-- Partial invoices can reprice the PO layers, including a split from a staged receipt.
do $$declare first record; retry record; failed boolean; layer record; after_qty numeric;
 items jsonb:='[{"po_item_id":"dc500000-0000-4000-8000-000000000001","qty":0.5,"harga":120,"expected_harga_po":100,"expected_faktor":10}]';
 updates jsonb; inserts jsonb; payload jsonb;
begin
 failed:=false;begin perform create_purchase_invoice_from_po('dc400000-0000-4000-8000-000000000001','FB.FIC.',5,null,current_date,current_date+30,null,'[{"po_item_id":"dc500000-0000-4000-8000-000000000001","qty":1,"harga":"NaN","expected_harga_po":100,"expected_faktor":10}]','[]','[]',0,'nonfinite-invoice');exception when sqlstate 'P0001'then failed:=true;end;
 if not failed then raise exception 'nonfinite invoice price accepted';end if;
 select * into layer from stock_layers order by id limit 1;
 updates:=jsonb_build_array(jsonb_build_object('id',layer.id,'expected_qty_in',layer.qty_in,'expected_qty_left',layer.qty_left,'expected_unit_cost',layer.unit_cost,'qty_in',5,'qty_left',5,'unit_cost',10));
 inserts:=jsonb_build_array(jsonb_build_object('warehouse_id',layer.warehouse_id,'item_id',layer.item_id,'tanggal',layer.tanggal,'qty_in',5,'qty_left',5,'unit_cost',12,'source','purchase','source_ref','PO-FICTION'));
 perform set_config('purchase.test_failure','journal',true);
 failed:=false;begin perform create_purchase_invoice_from_po('dc400000-0000-4000-8000-000000000001','FB.FIC.',5,null,current_date,current_date+30,null,items,updates,inserts,0,'invoice-one');exception when others then failed:=true;end;
 if not failed or exists(select 1 from purchase_invoices)or(select qty_left from stock_layers where id=layer.id)<>10 or(select count(*)from stock_layers)<>4 then raise exception 'invoice journal failure left partial invoice or reprice';end if;
 perform set_config('purchase.test_failure','',true);
 select * into first from create_purchase_invoice_from_po('dc400000-0000-4000-8000-000000000001','FB.FIC.',5,null,current_date,current_date+30,null,items,updates,inserts,0,'invoice-one');
 select * into retry from create_purchase_invoice_from_po('dc400000-0000-4000-8000-000000000001','FB.FIC.',5,null,current_date,current_date+30,null,items,updates,inserts,0,'invoice-one');
 if first.invoice_id<>retry.invoice_id or first.no_jurnal<>retry.no_jurnal or(select count(*)from purchase_invoices)<>1 or(select qty_left from stock_layers where id=layer.id)<>5 or(select count(*)from stock_layers where unit_cost=12 and qty_left=5)<>1 then raise exception 'invoice retry failed or changed reprice';end if;
 payload:=jsonb_build_object('po_id','dc400000-0000-4000-8000-000000000001','tanggal',current_date,'jatuh_tempo',current_date+30,'no_faktur_pemasok',null,'keterangan',null,'items',jsonb_build_array(jsonb_build_object('po_item_id','dc500000-0000-4000-8000-000000000001','qty',0.5,'harga',120)));
 if (recover_purchase_operation('invoice','invoice-one',payload)->>'invoice_id')::uuid<>first.invoice_id then raise exception 'lost response invoice recovery failed';end if;
 failed:=false;begin perform create_purchase_invoice_from_po('dc400000-0000-4000-8000-000000000001','FB.FIC.',5,null,current_date,current_date+30,'changed',items,'[]','[]',0,'invoice-one');exception when sqlstate 'P0001'then failed:=true;end;
 if not failed then raise exception 'changed invoice payload accepted';end if;
 select * into retry from create_purchase_invoice_from_po('dc400000-0000-4000-8000-000000000001','FB.FIC.',5,null,current_date,current_date+30,null,items,'[]','[]',0,'invoice-two');
 if first.invoice_id=retry.invoice_id or(select sum(qty*faktor)from purchase_invoice_items)<>10 or(select qty from stock where item_id='dc300000-0000-4000-8000-000000000001')<>40 then raise exception 'partial invoices corrupted base quantities';end if;
end$$;

-- Fixed assets preserve the existing Tunai/Bank funding and active mapped account rules.
do $$declare category uuid;first uuid;retry uuid;failed boolean;begin
 select id into category from asset_categories where nama='Peralatan';
 failed:=false;begin perform create_fixed_asset_purchase('Fiction nonfinite',category,current_date,'NaN',0,48,null,'Tunai','1101','nonfinite-asset');exception when sqlstate 'P0001'then failed:=true;end;
 if not failed then raise exception 'nonfinite asset price accepted';end if;
 perform set_config('purchase.test_failure','journal',true);
 failed:=false;begin perform create_fixed_asset_purchase('Fiction asset',category,current_date,1000,0,48,'dc100000-0000-4000-8000-000000000001','Tunai','1101','asset-one');exception when others then failed:=true;end;
 if not failed or exists(select 1 from fixed_assets)then raise exception 'asset journal failure left partial asset';end if;
 perform set_config('purchase.test_failure','',true);
 first:=create_fixed_asset_purchase('Fiction asset',category,current_date,1000,0,48,'dc100000-0000-4000-8000-000000000001','Tunai','1101','asset-one');
 retry:=create_fixed_asset_purchase('Fiction asset',category,current_date,1000,0,48,'dc100000-0000-4000-8000-000000000001','Tunai','1101','asset-one');
 if first<>retry or(select count(*)from fixed_assets)<>1 or(select count(*)from journal_entries where source='asset-purchase')<>1 then raise exception 'asset identical retry duplicated purchase';end if;
 failed:=false;begin perform create_fixed_asset_purchase('Changed asset',category,current_date,1000,0,48,'dc100000-0000-4000-8000-000000000001','Tunai','1101','asset-one');exception when sqlstate 'P0001'then failed:=true;end;
 if not failed then raise exception 'changed asset payload accepted';end if;
 failed:=false;begin perform create_fixed_asset_purchase('Fiction debt',category,current_date,1000,0,48,null,'Hutang','1101','asset-bad');exception when sqlstate 'P0001'then failed:=true;end;
 if not failed then raise exception 'unsupported asset funding accepted';end if;
end$$;

-- Revoke current role, then branch access: even existing-result recovery is gated.
reset role;
update profiles set role='STAFF'where id='dc000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$declare failed boolean:=false;begin
 begin perform recover_purchase_operation('invoice','invoice-one',jsonb_build_object('po_id','dc400000-0000-4000-8000-000000000001'));exception when insufficient_privilege then failed:=true;end;
 if not failed then raise exception 'wrong role recovered a posted invoice';end if;
 failed:=false;begin perform get_purchase_operation_result('receipt','receipt-first');exception when insufficient_privilege then failed:=true;end;
 if not failed then raise exception 'wrong role read a receipt result';end if;
 failed:=false;begin perform receive_purchase_order('dc400000-0000-4000-8000-000000000001','wrong-role','TB.FIC.',5,current_date,null,null,'[{"id":"dc500000-0000-4000-8000-000000000001","qty_terima":1}]');exception when insufficient_privilege then failed:=true;end;
 if not failed then raise exception 'wrong role posted a receipt';end if;
 failed:=false;begin perform create_fixed_asset_purchase('Unauthorized asset',(select id from asset_categories where nama='Peralatan'),current_date,1000,0,48,null,'Tunai','1101','wrong-role');exception when insufficient_privilege then failed:=true;end;
 if not failed then raise exception 'wrong role posted an asset';end if;
end$$;
reset role;
update profiles set role='DOCTOR'where id='dc000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$declare failed boolean:=false;begin
 begin perform recover_purchase_operation('invoice','invoice-one',jsonb_build_object('po_id','dc400000-0000-4000-8000-000000000001'));exception when insufficient_privilege then failed:=true;end;
 if not failed then raise exception 'wrong branch recovered a posted invoice';end if;
end$$;
reset role;
insert into user_branches(user_id,branch_id)values('dc000000-0000-4000-8000-000000000001','dc100000-0000-4000-8000-000000000001');
insert into role_modules(role,module_id)values('DOCTOR','klinik');
set local role authenticated;
do $$declare failed boolean:=false;begin
 begin perform recover_purchase_operation('invoice','invoice-one',jsonb_build_object('po_id','dc400000-0000-4000-8000-000000000001'));exception when insufficient_privilege then failed:=true;end;
 if not failed then raise exception 'current module override was ignored';end if;
end$$;
-- Disabled actors with a still-valid JWT cannot use any of the purchase gates.
reset role;
do $$declare actor_role text;failed boolean;message text;before_assets integer;before_receipts integer;begin
 select count(*)into before_assets from fixed_assets;select count(*)into before_receipts from goods_receipts;
 foreach actor_role in array array['OWNER','ADMIN','FINANCE','DOCTOR','STAFF']loop
  update profiles set role=actor_role::user_role,is_active=false where id='dc000000-0000-4000-8000-000000000001';
  execute 'set local role authenticated';
  failed:=false;begin perform get_purchase_operation_result('asset','asset-one');exception when insufficient_privilege then get stacked diagnostics message=message_text;failed:=message='Akun pengguna tidak aktif.';end;
  if not failed then raise exception 'disabled % recovered a prior asset',actor_role;end if;
  failed:=false;begin perform create_fixed_asset_purchase('Fiction disabled',(select id from asset_categories where nama='Peralatan'),current_date,1000,0,48,null,'Tunai','1101','disabled-actor');exception when insufficient_privilege then get stacked diagnostics message=message_text;failed:=message='Akun pengguna tidak aktif.';end;
  if not failed then raise exception 'disabled % posted an asset',actor_role;end if;
  failed:=false;begin perform receive_purchase_order('dc400000-0000-4000-8000-000000000001','disabled-actor','TB.FIC.',5,current_date,null,null,'[{"id":"dc500000-0000-4000-8000-000000000001","qty_terima":1}]');exception when insufficient_privilege then get stacked diagnostics message=message_text;failed:=message='Akun pengguna tidak aktif.';end;
  if not failed then raise exception 'disabled % reached receipt mutation',actor_role;end if;
  failed:=false;begin perform recover_purchase_operation('invoice','invoice-one',jsonb_build_object('po_id','dc400000-0000-4000-8000-000000000001'));exception when insufficient_privilege then get stacked diagnostics message=message_text;failed:=message='Akun pengguna tidak aktif.';end;
  if not failed then raise exception 'disabled % recovered an invoice',actor_role;end if;
  execute 'reset role';
 end loop;
 update profiles set is_active=true where id='dc000000-0000-4000-8000-000000000001';
 if(select count(*)from fixed_assets)<>before_assets or(select count(*)from goods_receipts)<>before_receipts then raise exception 'disabled actor produced purchase effects';end if;
end$$;
reset role;
update profiles set role='OWNER'where id='dc000000-0000-4000-8000-000000000001';
insert into purchase_orders(id,no_po,branch_id,to_warehouse_id,status)values('dc400000-0000-4000-8000-000000000002','PO-OMITTED','dc100000-0000-4000-8000-000000000001','dc200000-0000-4000-8000-000000000001','Dipesan');
insert into purchase_order_items(id,po_id,item_id,nama,qty,harga_beli,satuan,faktor)values
 ('dc500000-0000-4000-8000-000000000002','dc400000-0000-4000-8000-000000000002','dc300000-0000-4000-8000-000000000001','Fiction box',1,100,'box',10),
 ('dc500000-0000-4000-8000-000000000003','dc400000-0000-4000-8000-000000000002','dc300000-0000-4000-8000-000000000001','Fiction pcs',5,10,'pcs',1);
set local role authenticated;
do $$begin
 perform receive_purchase_order('dc400000-0000-4000-8000-000000000002','omitted-row','TB.FIC.',5,current_date,null,null,'[{"id":"dc500000-0000-4000-8000-000000000002","qty_terima":1}]');
 if(select qty_terima from purchase_order_items where id='dc500000-0000-4000-8000-000000000003')is not null
  or(select status from purchase_orders where id='dc400000-0000-4000-8000-000000000002')<>'Dipesan'
  or(select qty from stock)<>50 then raise exception 'omitted receipt row silently arrived';end if;
end$$;
reset role;
do $$begin
 if has_table_privilege('authenticated','public.purchase_operations','INSERT')or has_function_privilege('authenticated','public.create_fixed_asset_purchase_internal(text,uuid,date,numeric,numeric,integer,uuid,text,text)','EXECUTE')or has_function_privilege('authenticated','public.create_purchase_invoice_from_po_internal(uuid,text,integer,text,date,date,text,jsonb,jsonb,jsonb,numeric)','EXECUTE')then raise exception 'private transaction storage/helper exposed to callers';end if;
 if(select count(*)from purchase_operations where request_key like 'failure-%')<>0 then raise exception 'rolled back receipt left a recovery result';end if;
end$$;
rollback;
