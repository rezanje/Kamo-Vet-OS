-- Fictional transaction fixtures only; never execute on a production database.
begin;
do $$ begin
 if to_regprocedure('public.post_unit_return(text,uuid,text,jsonb,jsonb)') is null then raise exception 'Atomic return posting RPC missing'; end if;
 if to_regprocedure('public.post_online_order(text,jsonb,jsonb)') is null then raise exception 'Atomic online posting RPC missing'; end if;
end $$;
insert into auth.users(id,raw_user_meta_data) values
('f1000000-0000-4000-8000-000000000001','{"full_name":"Sales test"}'),
('f1000000-0000-4000-8000-000000000002','{"full_name":"Doctor test"}');
update profiles set role='OWNER' where id='f1000000-0000-4000-8000-000000000001';
update profiles set role='DOCTOR' where id='f1000000-0000-4000-8000-000000000002';
insert into role_modules(role,module_id) values('STAFF','penjualan') on conflict do nothing;
insert into branches(id,code,name,type) values
('f2000000-0000-4000-8000-000000000001','SALESTEST','Sales test','PETSHOP'),
('f2000000-0000-4000-8000-000000000002','SALESOTHER','Other branch','KLINIK');
insert into user_branches(user_id,branch_id) values
('f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001'),
('f1000000-0000-4000-8000-000000000002','f2000000-0000-4000-8000-000000000001');
insert into warehouses(id,branch_id,code,name,type) values
('f3000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','SALESWH','Sales warehouse','RETAIL');
insert into customers(id,name,phone) values ('f4000000-0000-4000-8000-000000000001','Fictional sales customer','000-sale-test');
insert into items(id,code,name,unit,buy_price,sell_price,item_type) values
('f5000000-0000-4000-8000-000000000001','SALESGOOD','Box plus pcs','pcs',2,10,'Persediaan'),
('f5000000-0000-4000-8000-000000000002','SALESSERVICE','Service','unit',0,50,'Jasa');
insert into item_units(item_id,unit,factor,sell_price,buy_price) values
('f5000000-0000-4000-8000-000000000001','box',12,110,24);
insert into stock(warehouse_id,item_id,qty) values
('f3000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000001',30);
insert into stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source) values
('f3000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000001',current_date-1,10,10,2,'purchase'),
('f3000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000001',current_date,20,20,3,'purchase');
insert into coa_accounts(code,name,type,normal_balance,is_header) values
('1201','Receivable','ASET','D',false),('1301','Inventory','ASET','D',false),
('4101','Sales','PENDAPATAN','K',false),('5101','COGS','BEBAN','D',false),('2201','VAT','LIABILITAS','K',false)
on conflict(code) do update set is_active=true,is_header=false;
insert into sales_orders(id,no_pesanan,customer_id,branch_id,warehouse_id) values
('f6000000-0000-4000-8000-000000000001','SO.SALES.TEST','f4000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001'),
('f6000000-0000-4000-8000-000000000002','SO.OTHER.TEST','f4000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000002',null);
insert into sales_order_items(id,order_id,item_id,nama,satuan,faktor,qty,harga) values
('f7000000-0000-4000-8000-000000000001','f6000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000001','Box','box',12,2,110),
('f7000000-0000-4000-8000-000000000002','f6000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000001','Pcs','pcs',1,5,10),
('f7000000-0000-4000-8000-000000000003','f6000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000002','Service','unit',1,1,50),
('f7000000-0000-4000-8000-000000000004','f6000000-0000-4000-8000-000000000001',null,'Free text',null,1,1,20);
update accounting_locks set closed_until=null;
update company_settings set mode_pkp=true,ppn_rate=11;

insert into customers(id,name,phone,points) values ('f4000000-0000-4000-8000-000000000002','Unrelated customer','000-unit-unrelated',7);
insert into warehouses(id,branch_id,code,name,type) values ('f3000000-0000-4000-8000-000000000002','f2000000-0000-4000-8000-000000000001','ONLINETEST','Online test','ONLINE');
insert into stock(warehouse_id,item_id,qty) values ('f3000000-0000-4000-8000-000000000002','f5000000-0000-4000-8000-000000000001',30);
insert into stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source) values ('f3000000-0000-4000-8000-000000000002','f5000000-0000-4000-8000-000000000001',current_date,30,30,3,'purchase');
insert into coa_accounts(code,name,type,normal_balance,is_header) values ('2101','Payable','LIABILITAS','K',false),('5902','Loss','BEBAN','D',false) on conflict(code) do update set is_active=true,is_header=false;
update coa_accounts set is_active=true,is_header=false where code in ('1101','1102','1202');
insert into purchase_orders(id,no_po,to_warehouse_id,branch_id,status,total) values ('f6000000-0000-4000-8000-000000000010','PO.UNIT.TEST','f3000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','Diterima',220);
insert into purchase_order_items(id,po_id,item_id,nama,qty,qty_terima,harga_beli,satuan,faktor) values
('f7000000-0000-4000-8000-000000000010','f6000000-0000-4000-8000-000000000010','f5000000-0000-4000-8000-000000000001','Box',1,1,120,'box',12),
('f7000000-0000-4000-8000-000000000011','f6000000-0000-4000-8000-000000000010','f5000000-0000-4000-8000-000000000001','Pcs',5,5,20,'pcs',1);
insert into sales(id,no_struk,branch_id,subtotal,total,metode_bayar) values ('f6000000-0000-4000-8000-000000000011','SALE.UNIT.TEST','f2000000-0000-4000-8000-000000000001',220,198,'Tunai');
insert into sale_items(id,sale_id,item_id,nama,qty,harga,satuan,faktor,hpp) values
('f7000000-0000-4000-8000-000000000020','f6000000-0000-4000-8000-000000000011','f5000000-0000-4000-8000-000000000001','Box',1,120,'box',12,36),
('f7000000-0000-4000-8000-000000000021','f6000000-0000-4000-8000-000000000011','f5000000-0000-4000-8000-000000000001','Pcs',5,20,'pcs',1,20);
insert into items(id,code,name,unit,buy_price,sell_price,item_type) values ('f5000000-0000-4000-8000-000000000003','UNITGROUP','Source group','grup',0,50,'Grup');
insert into sales(id,no_struk,branch_id,subtotal,total,metode_bayar) values ('f6000000-0000-4000-8000-000000000012','SALE.GROUP.UNIT','f2000000-0000-4000-8000-000000000001',100,100,'Tunai');
insert into sale_items(id,sale_id,item_id,nama,qty,harga,satuan,faktor,hpp) values ('f7000000-0000-4000-8000-000000000022','f6000000-0000-4000-8000-000000000012','f5000000-0000-4000-8000-000000000003','Group',2,50,'grup',1,null);
insert into sale_item_group_components(sale_item_id,component_item_id,component_name,item_type,qty_per_group,unit,factor,total_base_qty,hpp) values ('f7000000-0000-4000-8000-000000000022','f5000000-0000-4000-8000-000000000001','Component','Persediaan',2,'pcs',1,4,12);
insert into sales(id,no_struk,branch_id,subtotal,total,metode_bayar) values ('f6000000-0000-4000-8000-000000000013','SALE.TINY.HPP','f2000000-0000-4000-8000-000000000001',40,40,'Tunai');
insert into sale_items(id,sale_id,item_id,nama,qty,harga,satuan,faktor,hpp) values ('f7000000-0000-4000-8000-000000000023','f6000000-0000-4000-8000-000000000013','f5000000-0000-4000-8000-000000000001','Tiny cost',4,10,'pcs',1,0.02);
select sales_write_journal(current_date,'f2000000-0000-4000-8000-000000000001','sale','SALE.UNIT.TEST','Original source','[{"code":"1101","debit":198,"credit":0},{"code":"4101","debit":0,"credit":178},{"code":"2201","debit":0,"credit":20}]');
select sales_write_journal(current_date,'f2000000-0000-4000-8000-000000000001','sale','SALE.GROUP.UNIT','Original group source','[{"code":"1101","debit":100,"credit":0},{"code":"4101","debit":0,"credit":90},{"code":"2201","debit":0,"credit":10}]');
select sales_write_journal(current_date,'f2000000-0000-4000-8000-000000000001','sale','SALE.TINY.HPP','Original tiny source','[{"code":"1101","debit":40,"credit":0},{"code":"4101","debit":0,"credit":36},{"code":"2201","debit":0,"credit":4}]');
insert into sales(id,no_struk,branch_id) values ('f6000000-0000-4000-8000-000000000014','UNPOSTED.DRAFT','f2000000-0000-4000-8000-000000000001');
insert into sale_items(id,sale_id,item_id,nama,qty,harga,satuan,faktor,hpp) values ('f7000000-0000-4000-8000-000000000024','f6000000-0000-4000-8000-000000000014','f5000000-0000-4000-8000-000000000001','Draft',1,10,'pcs',1,1);
insert into purchase_orders(id,no_po,to_warehouse_id,branch_id,status) values ('f6000000-0000-4000-8000-000000000015','PO.UNPOSTED.DRAFT','f3000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','Draft');
insert into purchase_order_items(id,po_id,item_id,nama,qty,qty_terima,harga_beli,satuan,faktor) values ('f7000000-0000-4000-8000-000000000025','f6000000-0000-4000-8000-000000000015','f5000000-0000-4000-8000-000000000001','Draft',1,1,10,'pcs',1);
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$ declare r jsonb; retry jsonb; header jsonb:=jsonb_build_object('tanggal',current_date); items jsonb;before_stock numeric;count_before integer; begin
 begin
  update sale_items set faktor=1,qty=99,hpp=100 where id='f7000000-0000-4000-8000-000000000020';raise exception 'Posted sale source forged';
 exception when sqlstate '22023' then null;end;
 begin
  update sale_items set sale_id='f6000000-0000-4000-8000-000000000011',qty=99,hpp=100 where id='f7000000-0000-4000-8000-000000000024';raise exception 'Draft line reparented into posted source';
 exception when sqlstate '22023' then null;end;
 begin
  update sales set total=999 where id='f6000000-0000-4000-8000-000000000011';raise exception 'Posted sale header forged';
 exception when sqlstate '22023' then null;end;
 items:='[{"item_id":"f5000000-0000-4000-8000-000000000001","source_line_id":"f7000000-0000-4000-8000-000000000010","qty":0.5,"satuan":"box"}]';
 r:=post_unit_return('purchase','f6000000-0000-4000-8000-000000000010','purchase-half',header,items);
 retry:=post_unit_return('purchase','f6000000-0000-4000-8000-000000000010','purchase-half',header,items);
 if r<>retry then raise exception 'Purchase retry identity differs';end if;
 if (select total from purchase_returns where id=(r->>'document_id')::uuid)<>60 then raise exception 'Purchase used last-line price instead of exact source cost';end if;
 if (select sum(l.credit) from journal_lines l join journal_entries j on j.id=l.entry_id join coa_accounts a on a.id=l.account_id where j.source='purchase-return' and j.source_ref=r->>'document_no' and a.code='1301')<>12 then raise exception 'Purchase inventory credit must equal actual FIFO cost, not PO debt';end if;
 if (select sum(l.credit) from journal_lines l join journal_entries j on j.id=l.entry_id join coa_accounts a on a.id=l.account_id where j.source='purchase-return' and j.source_ref=r->>'document_no' and a.code='5902')<>48 then raise exception 'Purchase positive variance missing';end if;

 if not exists(select 1 from purchase_return_items where return_id=(r->>'document_id')::uuid and qty=6 and selected_qty=0.5 and faktor=12 and harga=10) then raise exception 'Purchase lost selectable snapshot';end if;
 if (select qty from stock where warehouse_id='f3000000-0000-4000-8000-000000000001' and item_id='f5000000-0000-4000-8000-000000000001')<>24 then raise exception 'Purchase retry consumed stock twice';end if;
 if not exists(select 1 from purchase_return_items where return_id=(r->>'document_id')::uuid and hpp=12) then raise exception 'Purchase actual FIFO snapshot missing';end if;
 begin
  update purchase_order_items set qty_terima=99 where id='f7000000-0000-4000-8000-000000000010';raise exception 'Returned PO source forged';
 exception when sqlstate '22023' then null;end;
 begin
  update purchase_order_items set po_id='f6000000-0000-4000-8000-000000000010',qty_terima=99 where id='f7000000-0000-4000-8000-000000000025';raise exception 'Draft line reparented into returned PO';
 exception when sqlstate '22023' then null;end;
 update stock_layers set unit_cost=30 where warehouse_id='f3000000-0000-4000-8000-000000000001' and unit_cost=2;
 r:=post_unit_return('purchase','f6000000-0000-4000-8000-000000000010','purchase-negative-variance',header,'[{"item_id":"f5000000-0000-4000-8000-000000000001","source_line_id":"f7000000-0000-4000-8000-000000000011","qty":1,"satuan":"pcs"}]');
 if (select total from purchase_returns where id=(r->>'document_id')::uuid)<>20 or not exists(select 1 from purchase_return_items where return_id=(r->>'document_id')::uuid and hpp=30) then raise exception 'Negative variance lost debt or actual cost';end if;
 if (select sum(l.debit) from journal_lines l join journal_entries j on j.id=l.entry_id join coa_accounts a on a.id=l.account_id where j.source='purchase-return' and j.source_ref=r->>'document_no' and a.code='5902')<>10 then raise exception 'Negative purchase variance not debited';end if;
 update stock_layers set unit_cost=2 where warehouse_id='f3000000-0000-4000-8000-000000000001' and unit_cost=30;

 begin
  perform post_unit_return('purchase','f6000000-0000-4000-8000-000000000010','purchase-duplicate',header,items||items);
  raise exception 'Duplicate source accepted';
 exception when sqlstate '22023' then null;end;
 begin
  perform post_unit_return('purchase','f6000000-0000-4000-8000-000000000010','purchase-over',header,jsonb_set(items,'{0,qty}','0.6'));
  raise exception 'Purchase ceiling exceeded';
 exception when sqlstate '22003' then null;end;
 items:='[{"item_id":"f5000000-0000-4000-8000-000000000001","source_line_id":"f7000000-0000-4000-8000-000000000020","qty":0.5,"satuan":"box","kondisi":"baik"}]';
 r:=post_unit_return('sales','f6000000-0000-4000-8000-000000000011','sale-half',header,items);
 retry:=post_unit_return('sales','f6000000-0000-4000-8000-000000000011','sale-half',header,items);
 if r<>retry then raise exception 'Sales retry identity differs';end if;
 if (select total from sales_returns where id=(r->>'document_id')::uuid)<>54 then raise exception 'Sales refund lost source price/paid ratio';end if;
 if not exists(select 1 from sales_return_items where return_id=(r->>'document_id')::uuid and qty=6 and hpp=18 and faktor=12 and selected_qty=0.5) then raise exception 'Sales lost source HPP/unit snapshot';end if;
 if (select count(*) from expenses where deskripsi like '%'||(r->>'document_no')||'%')<>1 then raise exception 'Retry duplicated refund';end if;
 r:=post_unit_return('sales','f6000000-0000-4000-8000-000000000012','group-return',header,'[{"item_id":"f5000000-0000-4000-8000-000000000003","source_line_id":"f7000000-0000-4000-8000-000000000022","qty":1,"satuan":"grup","kondisi":"baik"}]');
 if not exists(select 1 from sales_return_items where return_id=(r->>'document_id')::uuid and hpp=6) or not exists(select 1 from stock_moves where source='retur-jual-group' and source_ref=r->>'document_no' and qty=2 and unit_cost=3) then raise exception 'Group return lost component snapshot HPP or quantities';end if;


 for count_before in 1..4 loop
  r:=post_unit_return('sales','f6000000-0000-4000-8000-000000000013','tiny-hpp-'||count_before,header,'[{"item_id":"f5000000-0000-4000-8000-000000000001","source_line_id":"f7000000-0000-4000-8000-000000000023","qty":1,"satuan":"pcs","kondisi":"baik"}]');
 end loop;
 if (select sum(hpp) from sales_return_items where source_line_id='f7000000-0000-4000-8000-000000000023')<>0.02 or exists(select 1 from sales_return_items where source_line_id='f7000000-0000-4000-8000-000000000023' and hpp<0) then raise exception 'Tiny partial HPP overran source snapshot';end if;
 header:=jsonb_build_object('tanggal',current_date,'channel','Shopee','warehouse_id','f3000000-0000-4000-8000-000000000002');
 items:='[{"item_id":"f5000000-0000-4000-8000-000000000001","qty":0.5,"satuan":"box","harga":120,"faktor":1}]';
 r:=post_online_order('online-half',header,items);
 retry:=post_online_order('online-half',header,items);
 if r<>retry then raise exception 'Online retry identity differs';end if;
 if not exists(select 1 from sale_items where sale_id=(r->>'document_id')::uuid and qty=0.5 and satuan='box' and faktor=12 and hpp=18) then raise exception 'Online trusted client factor or lost HPP';end if;
 if (select qty from stock where warehouse_id='f3000000-0000-4000-8000-000000000002' and item_id='f5000000-0000-4000-8000-000000000001')<>24 then raise exception 'Online wrong base stock';end if;
 if get_unit_posting_result('online','online-half')<>r then raise exception 'Lost response recovery differs';end if;
 r:=post_online_order('online-wa',jsonb_build_object('tanggal',current_date,'channel','WA','warehouse_id','f3000000-0000-4000-8000-000000000002','customer_id','f4000000-0000-4000-8000-000000000001'),'[{"item_id":"f5000000-0000-4000-8000-000000000001","qty":1,"satuan":"pcs","harga":2000}]');
 if (select points from customers where id='f4000000-0000-4000-8000-000000000001')<>2 or (select points from customers where id='f4000000-0000-4000-8000-000000000002')<>7 then raise exception 'WA points changed unrelated customer';end if;
 if (select total_spending from customers where id='f4000000-0000-4000-8000-000000000001')<>2000 then raise exception 'WA tier spending incorrect';end if;
 update stock_layers set qty_left=0 where warehouse_id='f3000000-0000-4000-8000-000000000002';
 begin
  perform post_online_order('missing-cost-layers',header,items);
  raise exception 'Online invented FIFO cost for missing layers';
 exception when sqlstate '22003' then null;end;
 update stock_layers set qty_left=23 where warehouse_id='f3000000-0000-4000-8000-000000000002';


 begin
  perform post_online_order('deleted-unit',header,jsonb_set(items,'{0,satuan}','"deleted"'));
  raise exception 'Deleted unit accepted';
 exception when sqlstate '22023' then null;end;
end $$;
reset role;
-- A journal failure must roll back document, return detail, refund, and stock.
create function public.test_unit_reject_journal() returns trigger language plpgsql as $$ begin raise exception 'forced unit journal failure';end $$;
create trigger test_unit_reject_journal before insert on journal_entries for each row execute function public.test_unit_reject_journal();
set local role authenticated;
do $$ declare stock_before numeric; count_before integer; begin
 select qty into stock_before from stock where warehouse_id='f3000000-0000-4000-8000-000000000001' and item_id='f5000000-0000-4000-8000-000000000001';
 select count(*) into count_before from expenses;
 begin
  perform post_unit_return('sales','f6000000-0000-4000-8000-000000000011','rollback-test',jsonb_build_object('tanggal',current_date),'[{"item_id":"f5000000-0000-4000-8000-000000000001","source_line_id":"f7000000-0000-4000-8000-000000000021","qty":1,"satuan":"pcs","kondisi":"baik"}]');
  raise exception 'Journal failure accepted';
 exception when raise_exception then if sqlerrm<>'forced unit journal failure' then raise;end if;end;

 begin
  perform post_unit_return('purchase','f6000000-0000-4000-8000-000000000010','rollback-purchase',jsonb_build_object('tanggal',current_date),'[{"item_id":"f5000000-0000-4000-8000-000000000001","source_line_id":"f7000000-0000-4000-8000-000000000011","qty":1,"satuan":"pcs"}]');
  raise exception 'Purchase journal failure accepted';
 exception when raise_exception then if sqlerrm<>'forced unit journal failure' then raise;end if;end;
 begin
  perform post_online_order('rollback-online',jsonb_build_object('tanggal',current_date,'channel','Shopee','warehouse_id','f3000000-0000-4000-8000-000000000002'),'[{"item_id":"f5000000-0000-4000-8000-000000000001","qty":1,"satuan":"pcs","harga":10}]');
  raise exception 'Online journal failure accepted';
 exception when raise_exception then if sqlerrm<>'forced unit journal failure' then raise;end if;end;
 if (select count(*) from sales where channel is not null)<>2 or (select count(*) from purchase_returns)<>2 or (select qty from stock where warehouse_id='f3000000-0000-4000-8000-000000000002' and item_id='f5000000-0000-4000-8000-000000000001')<>23 then raise exception 'Rollback left purchase/online document or stock effect';end if;
 if stock_before<>(select qty from stock where warehouse_id='f3000000-0000-4000-8000-000000000001' and item_id='f5000000-0000-4000-8000-000000000001') or count_before<>(select count(*) from expenses) or get_unit_posting_result('sales-return:f6000000-0000-4000-8000-000000000011','rollback-test') is not null then raise exception 'Rollback left partial return effects';end if;
end $$;
rollback;
