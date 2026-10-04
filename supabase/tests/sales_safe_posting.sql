-- Fictional fixtures only. Run against an isolated PostgreSQL/Supabase database.
begin;
do $$ begin
  if to_regprocedure('public.sales_create_delivery(uuid,text,jsonb,jsonb)') is null then
    raise exception 'Atomic sales delivery RPC is missing';
  end if;
end $$;
insert into auth.users(id,raw_user_meta_data) values
('f1000000-0000-4000-8000-000000000001','{"full_name":"Sales test"}'),
('f1000000-0000-4000-8000-000000000002','{"full_name":"Doctor test"}');
update profiles set role='STAFF' where id='f1000000-0000-4000-8000-000000000001';
update profiles set role='DOCTOR' where id='f1000000-0000-4000-8000-000000000002';
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
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$ declare r jsonb; retry jsonb; bad jsonb; cnt integer; begin
  -- One box + five pcs = seventeen base units, FIFO cost 10*2 + 7*3 = 41.
  r:=sales_create_delivery('f6000000-0000-4000-8000-000000000001','sales-shipment-1',jsonb_build_object('tanggal',current_date),
    '[{"order_item_id":"f7000000-0000-4000-8000-000000000001","qty":1},{"order_item_id":"f7000000-0000-4000-8000-000000000002","qty":5},{"order_item_id":"f7000000-0000-4000-8000-000000000003","qty":1},{"order_item_id":"f7000000-0000-4000-8000-000000000004","qty":1}]');
  retry:=sales_create_delivery('f6000000-0000-4000-8000-000000000001','sales-shipment-1',jsonb_build_object('tanggal',current_date),
    '[{"order_item_id":"f7000000-0000-4000-8000-000000000001","qty":1},{"order_item_id":"f7000000-0000-4000-8000-000000000002","qty":5},{"order_item_id":"f7000000-0000-4000-8000-000000000003","qty":1},{"order_item_id":"f7000000-0000-4000-8000-000000000004","qty":1}]');
  if r<>retry then raise exception 'Retry identity differs'; end if;
  if (select qty from stock where warehouse_id='f3000000-0000-4000-8000-000000000001' and item_id='f5000000-0000-4000-8000-000000000001')<>13 then raise exception 'Wrong base stock'; end if;
  if (select sum(hpp) from sales_delivery_items where delivery_id=(r->>'document_id')::uuid)<>41 then raise exception 'Wrong FIFO HPP'; end if;
  if (select count(*) from stock_moves where source_ref=r->>'document_no')<>2 then raise exception 'Retry doubled stock'; end if;
  begin
    perform sales_create_delivery('f6000000-0000-4000-8000-000000000001','sales-shipment-1',jsonb_build_object('tanggal',current_date),
      '[{"order_item_id":"f7000000-0000-4000-8000-000000000001","qty":0.5}]');
    raise exception 'Changed payload accepted';
  exception when sqlstate '22023' then null; end;
  begin
    perform sales_create_delivery('f6000000-0000-4000-8000-000000000001','over-shipment',jsonb_build_object('tanggal',current_date),
      '[{"order_item_id":"f7000000-0000-4000-8000-000000000001","qty":2}]');
    raise exception 'Over shipment accepted';
  exception when sqlstate '22003' then null; end;
  if (select count(*) from sales_deliveries where order_id='f6000000-0000-4000-8000-000000000001')<>1 then raise exception 'Rejected shipment persisted'; end if;
  r:=sales_create_invoice('f6000000-0000-4000-8000-000000000001','sales-invoice-1',jsonb_build_object('tanggal',current_date,'jatuh_tempo',current_date+30),
    '[{"order_item_id":"f7000000-0000-4000-8000-000000000001","qty":0.5},{"order_item_id":"f7000000-0000-4000-8000-000000000002","qty":5},{"order_item_id":"f7000000-0000-4000-8000-000000000003","qty":1},{"order_item_id":"f7000000-0000-4000-8000-000000000004","qty":1}]');
  retry:=sales_create_invoice('f6000000-0000-4000-8000-000000000001','sales-invoice-1',jsonb_build_object('tanggal',current_date,'jatuh_tempo',current_date+30),
    '[{"order_item_id":"f7000000-0000-4000-8000-000000000001","qty":0.5},{"order_item_id":"f7000000-0000-4000-8000-000000000002","qty":5},{"order_item_id":"f7000000-0000-4000-8000-000000000003","qty":1},{"order_item_id":"f7000000-0000-4000-8000-000000000004","qty":1}]');
  if r<>retry then raise exception 'Invoice retry identity differs'; end if;
  if (select dpp<>175 or ppn<>19 or total<>194 from sales_invoices where id=(r->>'document_id')::uuid) then raise exception 'Price/PKP policy changed'; end if;
  if (select sum(hpp) from sales_invoice_items where invoice_id=(r->>'document_id')::uuid)<>28 then raise exception 'Partial invoice HPP incorrect'; end if;
  if exists(select 1 from journal_entries e join journal_lines l on l.entry_id=e.id where e.branch_id='f2000000-0000-4000-8000-000000000001' group by e.id having sum(debit)<>sum(credit)) then raise exception 'Unbalanced journal'; end if;
  begin
    perform sales_create_invoice('f6000000-0000-4000-8000-000000000001','over-invoice',jsonb_build_object('tanggal',current_date),
      '[{"order_item_id":"f7000000-0000-4000-8000-000000000001","qty":1}]');
    raise exception 'Over invoice accepted';
  exception when sqlstate '22003' then null; end;
  if exists(select 1 from sales_orders where id='f6000000-0000-4000-8000-000000000002') then raise exception 'Cross branch RLS leaked order'; end if;
  begin
    perform sales_create_invoice('f6000000-0000-4000-8000-000000000002','other',jsonb_build_object('tanggal',current_date),'[]');
    raise exception 'Cross branch RPC accepted';
  exception when insufficient_privilege then null; end;
end $$;
-- Force ledger insertion failure after stock and document writes, then prove rollback.
reset role;
create function public.test_sales_reject_journal() returns trigger language plpgsql as $$ begin raise exception 'forced sales ledger failure'; end $$;
create trigger test_sales_journal before insert on journal_lines for each row execute function public.test_sales_reject_journal();
set local role authenticated;
do $$ begin
  begin
    perform sales_create_delivery('f6000000-0000-4000-8000-000000000001','ledger-fail',jsonb_build_object('tanggal',current_date),
      '[{"order_item_id":"f7000000-0000-4000-8000-000000000001","qty":1}]');
    raise exception 'Expected ledger failure';
  exception when raise_exception then if sqlerrm<>'forced sales ledger failure' then raise; end if; end;
  if (select qty_kirim from sales_order_items where id='f7000000-0000-4000-8000-000000000001')<>1
     or (select qty from stock where warehouse_id='f3000000-0000-4000-8000-000000000001' and item_id='f5000000-0000-4000-8000-000000000001')<>13
     or (select count(*) from sales_deliveries where order_id='f6000000-0000-4000-8000-000000000001')<>1 then raise exception 'Ledger failure did not rollback'; end if;
  begin
    perform sales_create_invoice('f6000000-0000-4000-8000-000000000001','invoice-ledger-fail',jsonb_build_object('tanggal',current_date),
      '[{"order_item_id":"f7000000-0000-4000-8000-000000000001","qty":0.5}]');
    raise exception 'Expected ledger failure';
  exception when raise_exception then if sqlerrm<>'forced sales ledger failure' then raise; end if; end;
  if (select qty_faktur from sales_order_items where id='f7000000-0000-4000-8000-000000000001')<>0.5
     or (select count(*) from sales_invoices where order_id='f6000000-0000-4000-8000-000000000001')<>1 then raise exception 'Invoice failure did not rollback'; end if;
end $$;
reset role;
drop trigger test_sales_journal on journal_lines;
-- Short stock failure, no warehouse failure, doctor rejection.
update stock set qty=1 where warehouse_id='f3000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin
  begin
    perform sales_create_delivery('f6000000-0000-4000-8000-000000000001','short',jsonb_build_object('tanggal',current_date),
      '[{"order_item_id":"f7000000-0000-4000-8000-000000000001","qty":1}]');
    raise exception 'Stock shortage accepted';
  exception when sqlstate '22003' then null; end;
end $$;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"f1000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$ begin
  begin
    perform sales_create_delivery('f6000000-0000-4000-8000-000000000001','doctor',jsonb_build_object('tanggal',current_date),'[]');
    raise exception 'Doctor accepted';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
