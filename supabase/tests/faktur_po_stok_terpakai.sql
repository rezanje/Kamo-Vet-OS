-- Faktur dari PO saat sebagian barang sudah terpakai/dikirim. Data fiktif pada PostgreSQL sekali pakai; semua di-rollback.
begin;
insert into auth.users(id) values('f9000000-0000-4000-8000-000000000001');
update profiles set role='OWNER',is_active=true where id='f9000000-0000-4000-8000-000000000001';
insert into branches(id,code,name,type) values('f9100000-0000-4000-8000-000000000001','FPT-FIC','FPT fiction','KLINIK');
insert into warehouses(id,branch_id,code,name,type) values('f9200000-0000-4000-8000-000000000001','f9100000-0000-4000-8000-000000000001','FPT-WH','FPT warehouse','VET');
insert into suppliers(id,nama) values('f9300000-0000-4000-8000-000000000001','FPT fiction supplier');
insert into items(id,code,name,unit,item_type) values
 ('f9400000-0000-4000-8000-000000000001','FPT-A','FPT goods A','pcs','Persediaan'),
 ('f9400000-0000-4000-8000-000000000002','FPT-B','FPT goods B','pcs','Persediaan');
insert into item_units(item_id,unit,factor) values('f9400000-0000-4000-8000-000000000001','box',10),('f9400000-0000-4000-8000-000000000002','box',10);
insert into purchase_orders(id,no_po,supplier_id,branch_id,to_warehouse_id,status) values
 ('f9500000-0000-4000-8000-000000000001','PO.FPT.A','f9300000-0000-4000-8000-000000000001','f9100000-0000-4000-8000-000000000001','f9200000-0000-4000-8000-000000000001','Dipesan');
insert into purchase_order_items(id,po_id,item_id,nama,qty,harga_beli,satuan,faktor) values
 ('f9600000-0000-4000-8000-000000000001','f9500000-0000-4000-8000-000000000001','f9400000-0000-4000-8000-000000000001','FPT goods A',4,100,'box',10),
 ('f9600000-0000-4000-8000-000000000002','f9500000-0000-4000-8000-000000000001','f9400000-0000-4000-8000-000000000002','FPT goods B',2,100,'box',10);
insert into coa_accounts(code,name,type,normal_balance) values('170001','Fiction stock','ASET','D'),('311001','Fiction payable','LIABILITAS','K')
 on conflict(code) do update set is_active=true,is_header=false;
update coa_accounts set is_active=true,is_header=false where code in('170001','311001','311003');
update accounting_locks set closed_until=null;
update company_settings set mode_pkp=false;
create table fpt_results(name text primary key,result jsonb);
grant all on fpt_results to authenticated;
create function pg_temp.expect_error(command text,fragment text) returns void language plpgsql as $$
begin
 begin execute command;
 exception when others then
  if position(fragment in sqlerrm)=0 then raise exception 'Expected error containing "%", got: %',fragment,sqlerrm;end if;
  return;
 end;
 raise exception 'Expected failure containing "%" but the command succeeded',fragment;
end$$;
create function pg_temp.ok(cond boolean,message text) returns void language plpgsql as $$
begin if cond is distinct from true then raise exception 'Assertion failed: %',message;end if;end$$;
create function pg_temp.inv(key text,items jsonb) returns jsonb language sql as $$
 select to_jsonb(x) from create_purchase_invoice_from_po_receipts('f9500000-0000-4000-8000-000000000001','FB.FPT.',5,null,current_date,current_date,null,
  items,'[]','[]',0,key,null,(select coalesce(array_agg(id),'{}') from goods_receipts where po_id='f9500000-0000-4000-8000-000000000001' and voided_at is null)) x$$;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','f9000000-0000-4000-8000-000000000001',true);
insert into fpt_results select 'R1',receive_purchase_order('f9500000-0000-4000-8000-000000000001','fpt-r1','TB.FPT.',5,current_date,null,null,
 '[{"id":"f9600000-0000-4000-8000-000000000001","qty_terima":4},{"id":"f9600000-0000-4000-8000-000000000002","qty_terima":2}]');
reset role;

-- Barang A: 25 dari 40 pcs sudah keluar (mis. dikirim ke cabang) sebelum difakturkan. Barang B: habis.
update stock_layers set qty_left=qty_left-25 where source='purchase' and source_ref='PO.FPT.A' and item_id='f9400000-0000-4000-8000-000000000001';
update stock set qty=qty-25 where warehouse_id='f9200000-0000-4000-8000-000000000001' and item_id='f9400000-0000-4000-8000-000000000001';
update stock_layers set qty_left=0 where source='purchase' and source_ref='PO.FPT.A' and item_id='f9400000-0000-4000-8000-000000000002';
update stock set qty=0 where warehouse_id='f9200000-0000-4000-8000-000000000001' and item_id='f9400000-0000-4000-8000-000000000002';

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','f9000000-0000-4000-8000-000000000001',true);

-- 1. Harga beda dari PO + barang sudah keluar: tetap ditolak, dengan nama barang.
select pg_temp.expect_error($q$select pg_temp.inv('fpt-beda','[{"po_item_id":"f9600000-0000-4000-8000-000000000001","qty":4,"harga":110}]')$q$,
 'Sebagian barang ini (FPT goods A) sudah terpakai atau dikirim');
-- 2. Harga sama dengan PO: tersimpan walau sebagian/semua barang sudah keluar.
insert into fpt_results select 'F1',pg_temp.inv('fpt-sama','[{"po_item_id":"f9600000-0000-4000-8000-000000000001","qty":4,"harga":100},{"po_item_id":"f9600000-0000-4000-8000-000000000002","qty":2,"harga":100}]');
reset role;
select pg_temp.ok((select (result->>'total')::numeric from fpt_results where name='F1')=600,'total faktur 600');
-- Lapisan & nilai stok tidak berubah: barang yang tersisa tetap bernilai 10/pcs.
select pg_temp.ok((select bool_and(unit_cost=10) from stock_layers where source='purchase' and source_ref='PO.FPT.A'),'biaya lapisan tetap');
select pg_temp.ok((select sum(qty_left) from stock_layers where source='purchase' and source_ref='PO.FPT.A')=15,'sisa stok tetap 15');
-- Jurnal faktur seimbang dan hutang = 600.
select pg_temp.ok((select sum(l.debit)=sum(l.credit) and sum(l.debit)=600 from journal_lines l join journal_entries j on j.id=l.entry_id
 where j.source='purchase-invoice' and j.source_ref=(select result->>'no_faktur' from fpt_results where name='F1')),'jurnal faktur seimbang 600');
-- 3. Tidak bisa ditagih dua kali.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','f9000000-0000-4000-8000-000000000001',true);
select pg_temp.expect_error($q$select pg_temp.inv('fpt-dobel','[{"po_item_id":"f9600000-0000-4000-8000-000000000001","qty":1,"harga":100}]')$q$,'');
reset role;
rollback;
