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
insert into sales_quotations(id,no_penawaran,customer_id,branch_id,total) values
('f8000000-0000-4000-8000-000000000001','SQ.TEST','f4000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001',220);
insert into sales_quotation_items(quotation_id,item_id,nama,satuan,faktor,qty,harga) values
('f8000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000001','Box quote','box',12,2,110);
create function public.test_sales_reject_order_line() returns trigger language plpgsql as $$ begin raise exception 'forced quotation line failure'; end $$;
create trigger test_sales_quote_line before insert on sales_order_items for each row execute function public.test_sales_reject_order_line();
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$ begin
  begin
    perform sales_convert_quotation('f8000000-0000-4000-8000-000000000001');
    raise exception 'Expected quotation line failure';
  exception when raise_exception then if sqlerrm<>'forced quotation line failure' then raise; end if; end;
  if exists(select 1 from sales_orders where quotation_id='f8000000-0000-4000-8000-000000000001')
    or (select status from sales_quotations where id='f8000000-0000-4000-8000-000000000001')<>'draft' then raise exception 'Quotation accepted after failed conversion'; end if;
end $$;
reset role;
drop trigger test_sales_quote_line on sales_order_items;
set local role authenticated;
do $$ declare r jsonb; again jsonb; begin
  r:=sales_convert_quotation('f8000000-0000-4000-8000-000000000001');
  again:=sales_convert_quotation('f8000000-0000-4000-8000-000000000001');
  if r<>again or (select count(*) from sales_orders where quotation_id='f8000000-0000-4000-8000-000000000001')<>1 then raise exception 'Quotation retry duplicated'; end if;
  if not exists(select 1 from sales_order_items where order_id=(r->>'order_id')::uuid and faktor=12 and satuan='box' and qty=2 and harga=110) then raise exception 'Quotation lost snapshot'; end if;
end $$;
do $$ declare r jsonb; retry jsonb; bad jsonb; cnt integer; begin
  if has_function_privilege('anon','public.sales_create_delivery(uuid,text,jsonb,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.sales_post_order(text,uuid,text,jsonb,jsonb)','EXECUTE') then raise exception 'Internal or anonymous RPC exposed'; end if;
  begin
    perform sales_create_delivery('f6000000-0000-4000-8000-000000000001','duplicate-line',jsonb_build_object('tanggal',current_date),
      '[{"order_item_id":"f7000000-0000-4000-8000-000000000001","qty":1},{"order_item_id":"f7000000-0000-4000-8000-000000000001","qty":1}]');
    raise exception 'Duplicate line accepted';
  exception when sqlstate '22023' then null; end;
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
  begin
    perform sales_cancel_order('f6000000-0000-4000-8000-000000000001');
    raise exception 'Cancellation after shipment accepted';
  exception when raise_exception then if sqlerrm not like 'Sebagian barang%' then raise; end if; end;
  r:=sales_create_invoice('f6000000-0000-4000-8000-000000000001','sales-invoice-1',jsonb_build_object('tanggal',current_date,'jatuh_tempo',current_date+30),
    '[{"order_item_id":"f7000000-0000-4000-8000-000000000001","qty":0.5},{"order_item_id":"f7000000-0000-4000-8000-000000000002","qty":5},{"order_item_id":"f7000000-0000-4000-8000-000000000003","qty":1},{"order_item_id":"f7000000-0000-4000-8000-000000000004","qty":1}]');
  retry:=sales_create_invoice('f6000000-0000-4000-8000-000000000001','sales-invoice-1',jsonb_build_object('tanggal',current_date,'jatuh_tempo',current_date+30),
    '[{"order_item_id":"f7000000-0000-4000-8000-000000000001","qty":0.5},{"order_item_id":"f7000000-0000-4000-8000-000000000002","qty":5},{"order_item_id":"f7000000-0000-4000-8000-000000000003","qty":1},{"order_item_id":"f7000000-0000-4000-8000-000000000004","qty":1}]');
  if r<>retry then raise exception 'Invoice retry identity differs'; end if;
  if (select count(*) from sales_invoice_delivery_allocations a join sales_invoice_items ii on ii.id=a.invoice_item_id where ii.invoice_id=(r->>'document_id')::uuid)<>4 then raise exception 'Retry duplicated HPP allocations'; end if;
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
-- The ledger can be read within branch scope, but authenticated direct writes fail.
do $$ begin
  if has_table_privilege('authenticated','public.sales_invoice_delivery_allocations','INSERT')
    or has_table_privilege('authenticated','public.sales_invoice_delivery_allocations','UPDATE')
    or has_table_privilege('authenticated','public.sales_invoice_delivery_allocations','DELETE') then raise exception 'Allocation ledger directly writable'; end if;
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
do $$ begin
  begin
    update sales_invoice_delivery_allocations set hpp=hpp+1;
    raise exception 'Historical allocation mutable';
  exception when raise_exception then if sqlerrm not like 'Alokasi HPP faktur sudah tetap%' then raise; end if; end;
  begin
    update sales_invoice_items set hpp=hpp+1 where order_item_id='f7000000-0000-4000-8000-000000000001';
    raise exception 'Allocated invoice cost mutable';
  exception when raise_exception then if sqlerrm not like 'Baris dengan alokasi HPP%' then raise; end if; end;
  begin
    update sales_delivery_items set hpp=hpp+1 where order_item_id='f7000000-0000-4000-8000-000000000001';
    raise exception 'Allocated shipment cost mutable';
  exception when raise_exception then if sqlerrm not like 'Baris dengan alokasi HPP%' then raise; end if; end;
end $$;
-- Allocation insertion is part of the same rollback boundary.
create function public.test_sales_reject_allocation() returns trigger language plpgsql as $$ begin raise exception 'forced allocation failure'; end $$;
create trigger test_sales_allocation before insert on sales_invoice_delivery_allocations for each row execute function public.test_sales_reject_allocation();
set local role authenticated;
do $$ begin
  begin
    perform sales_create_invoice('f6000000-0000-4000-8000-000000000001','allocation-fail',jsonb_build_object('tanggal',current_date),
      '[{"order_item_id":"f7000000-0000-4000-8000-000000000001","qty":0.5}]');
    raise exception 'Expected allocation failure';
  exception when raise_exception then if sqlerrm<>'forced allocation failure' then raise; end if; end;
  if (select qty_faktur from sales_order_items where id='f7000000-0000-4000-8000-000000000001')<>0.5
    or (select count(*) from sales_invoices where order_id='f6000000-0000-4000-8000-000000000001')<>1
    or (select count(*) from sales_invoice_delivery_allocations a join sales_invoice_items ii on ii.id=a.invoice_item_id where ii.order_item_id between 'f7000000-0000-4000-8000-000000000001' and 'f7000000-0000-4000-8000-000000000004')<>4 then raise exception 'Allocation failure did not rollback'; end if;
end $$;
reset role;
drop trigger test_sales_allocation on sales_invoice_delivery_allocations;
-- A fictional partially billed historical order has no immutable allocations.
insert into sales_orders(id,no_pesanan,branch_id) values ('f9000000-0000-4000-8000-000000000001','SO.LEGACY','f2000000-0000-4000-8000-000000000001');
insert into sales_order_items(id,order_id,item_id,nama,satuan,faktor,qty,harga,qty_kirim,qty_faktur) values
('fa000000-0000-4000-8000-000000000001','f9000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000001','Legacy pcs','pcs',1,2,10,2,1);
insert into sales_invoices(id,no_faktur,order_id,branch_id,tanggal,jatuh_tempo,dpp,total) values
('fb000000-0000-4000-8000-000000000001','FJ.LEGACY','f9000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001',current_date,current_date,10,10);
insert into sales_invoice_items(invoice_id,order_item_id,item_id,nama,satuan,faktor,qty,harga,hpp) values
('fb000000-0000-4000-8000-000000000001','fa000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000001','Legacy pcs','pcs',1,1,10,3);
set local role authenticated;
do $$ begin
  begin
    perform sales_create_invoice('f9000000-0000-4000-8000-000000000001','legacy-remainder',jsonb_build_object('tanggal',current_date),
      '[{"order_item_id":"fa000000-0000-4000-8000-000000000001","qty":1}]');
    raise exception 'Unlinked legacy HPP accepted';
  exception when sqlstate '22023' then if sqlerrm not like '%keuangan%rekonsiliasi%' then raise; end if; end;
  if (select count(*) from sales_invoices where order_id='f9000000-0000-4000-8000-000000000001')<>1 then raise exception 'Legacy rejection leaked invoice'; end if;
end $$;
reset role;
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
reset role;
update stock set qty=13 where warehouse_id='f3000000-0000-4000-8000-000000000001';
update sales_orders set warehouse_id=null where id='f6000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin
  begin
    perform sales_create_delivery('f6000000-0000-4000-8000-000000000001','no-warehouse',jsonb_build_object('tanggal',current_date),
      '[{"order_item_id":"f7000000-0000-4000-8000-000000000001","qty":1}]');
    raise exception 'Missing warehouse accepted';
  exception when raise_exception then if sqlerrm not like 'Pilih gudang%' then raise; end if; end;
end $$;
reset role;
update sales_orders set warehouse_id='f3000000-0000-4000-8000-000000000001' where id='f6000000-0000-4000-8000-000000000001';
update stock_layers set unit_cost=0 where warehouse_id='f3000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin
  begin
    perform sales_create_delivery('f6000000-0000-4000-8000-000000000001','zero-cost',jsonb_build_object('tanggal',current_date),
      '[{"order_item_id":"f7000000-0000-4000-8000-000000000001","qty":1}]');
    raise exception 'Zero cost accepted';
  exception when raise_exception then if sqlerrm not like 'Lapisan stok%HPP positif%' then raise; end if; end;
end $$;
reset role;
update stock_layers set unit_cost=3,qty_left=least(qty_left,5) where warehouse_id='f3000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin
  begin
    perform sales_create_delivery('f6000000-0000-4000-8000-000000000001','short-layers',jsonb_build_object('tanggal',current_date),
      '[{"order_item_id":"f7000000-0000-4000-8000-000000000001","qty":1}]');
    raise exception 'Short layers accepted';
  exception when sqlstate '22003' then null; end;
  if (select sum(qty_left) from stock_layers where warehouse_id='f3000000-0000-4000-8000-000000000001')<>5
     or (select qty from stock where warehouse_id='f3000000-0000-4000-8000-000000000001')<>13
     or (select count(*) from sales_deliveries where order_id='f6000000-0000-4000-8000-000000000001')<>1 then raise exception 'Short layer failure leaked changes'; end if;
end $$;
reset role;
update stock_layers set qty_left=13 where warehouse_id='f3000000-0000-4000-8000-000000000001' and qty_left>0;
update coa_accounts set is_active=false where code='5101';
set local role authenticated;
do $$ begin
  begin
    perform sales_create_delivery('f6000000-0000-4000-8000-000000000001','missing-account',jsonb_build_object('tanggal',current_date),
      '[{"order_item_id":"f7000000-0000-4000-8000-000000000001","qty":1}]');
    raise exception 'Missing account accepted';
  exception when raise_exception then if sqlerrm not like 'Akun 5101%' then raise; end if; end;
end $$;
reset role;
update coa_accounts set is_active=true where code='5101';
update accounting_locks set closed_until=current_date;
set local role authenticated;
do $$ begin
  begin
    perform sales_create_invoice('f6000000-0000-4000-8000-000000000001','closed-period',jsonb_build_object('tanggal',current_date),
      '[{"order_item_id":"f7000000-0000-4000-8000-000000000001","qty":0.5}]');
    raise exception 'Closed period accepted';
  exception when raise_exception then if sqlerrm not like 'Periode akuntansi%' then raise; end if; end;
end $$;
reset role;
update accounting_locks set closed_until=null;
-- Fixtures share one transaction's now(); establish shipment chronology explicitly.
update sales_deliveries set created_at=now()-interval '1 minute' where order_id='f6000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ declare r jsonb; begin
  perform sales_create_delivery('f6000000-0000-4000-8000-000000000001','sales-shipment-2',jsonb_build_object('tanggal',current_date-1),
    '[{"order_item_id":"f7000000-0000-4000-8000-000000000001","qty":1}]');
  r:=sales_create_invoice('f6000000-0000-4000-8000-000000000001','sales-invoice-2',jsonb_build_object('tanggal',current_date),
    '[{"order_item_id":"f7000000-0000-4000-8000-000000000001","qty":1.5}]');
  if (select sum(hpp) from sales_invoice_items where invoice_id=(r->>'document_id')::uuid)<>49 then raise exception 'Backdated shipment reordered already billed HPP'; end if;
  if (select sum(a.hpp) from sales_invoice_delivery_allocations a join sales_invoice_items ii on ii.id=a.invoice_item_id where ii.order_item_id between 'f7000000-0000-4000-8000-000000000001' and 'f7000000-0000-4000-8000-000000000004')<>77 then raise exception 'Allocated costs do not reconcile to shipments'; end if;
  if (select status from sales_orders where id='f6000000-0000-4000-8000-000000000001')<>'selesai' then raise exception 'Order not completed'; end if;
  if (select sum(qty) from stock_moves where warehouse_id='f3000000-0000-4000-8000-000000000001' and source='sales-delivery')<>-29 then raise exception 'Wrong final base stock movement'; end if;
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
