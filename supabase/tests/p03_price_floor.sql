-- P03 jual di bawah HPP: fictional fixtures in disposable PostgreSQL only; everything rolls back.
-- Petshop cashier: a Grup line is judged against the summed FIFO HPP of its stock components.
-- Clinic cashier: goods (obat/barang/racikan) are blocked at zero or below actual HPP, services
-- stay free, packages are judged as a whole, corrections obey the same floor.
begin;
create function pg_temp.ok(value boolean, label text) returns void language plpgsql as $$begin
 if value is distinct from true then raise exception 'Assertion failed: %',label;end if;end$$;
create function pg_temp.reject(stmt text, expected text, label text) returns void language plpgsql as $$
declare failed boolean:=false;msg text;begin
 begin execute stmt;exception when others then failed:=true;msg:=sqlerrm;end;
 if not failed then raise exception 'Expected rejection: %',label;end if;
 if position(expected in msg)=0 then raise exception 'Unexpected rejection for %: %',label,msg;end if;
end$$;

insert into auth.users(id,raw_user_meta_data) values
 ('f0300000-0000-4000-8000-000000000001','{"full_name":"P03 cashier"}'),
 ('f0300000-0000-4000-8000-000000000002','{"full_name":"P03 clinic cashier"}');
update profiles set role='STAFF',is_active=true where id='f0300000-0000-4000-8000-000000000001';
update profiles set role='OWNER',is_active=true where id='f0300000-0000-4000-8000-000000000002';
insert into role_modules(role,module_id) values('STAFF','pos') on conflict do nothing;
insert into branches(id,code,name,type) values
 ('f0310000-0000-4000-8000-000000000001','P03SHOP','P03 shop','PETSHOP'),
 ('f0310000-0000-4000-8000-000000000002','P03VET','P03 clinic','KLINIK');
insert into user_branches(user_id,branch_id) values
 ('f0300000-0000-4000-8000-000000000001','f0310000-0000-4000-8000-000000000001'),
 ('f0300000-0000-4000-8000-000000000002','f0310000-0000-4000-8000-000000000002');
insert into warehouses(id,branch_id,code,name,type) values
 ('f0320000-0000-4000-8000-000000000001','f0310000-0000-4000-8000-000000000001','P03SHOPWH','P03 shop warehouse','RETAIL'),
 ('f0320000-0000-4000-8000-000000000002','f0310000-0000-4000-8000-000000000002','P03VETWH','P03 clinic warehouse','VET');
insert into cashier_shifts(id,branch_id,opened_by,shift_type,status) values
 ('f0330000-0000-4000-8000-000000000001','f0310000-0000-4000-8000-000000000001','f0300000-0000-4000-8000-000000000001','petshop','open'),
 ('f0330000-0000-4000-8000-000000000002','f0310000-0000-4000-8000-000000000002','f0300000-0000-4000-8000-000000000002','klinik','open');
insert into items(id,code,name,unit,item_type,buy_price) values
 ('f0340000-0000-4000-8000-000000000001','P03STOCK','P03 kibble','pcs','Persediaan',20),
 ('f0340000-0000-4000-8000-000000000002','P03BUNDLE','P03 bundle','set','Grup',0),
 ('f0340000-0000-4000-8000-000000000003','P03MED','P03 obat','pcs','Persediaan',1000),
 ('f0340000-0000-4000-8000-000000000004','P03SVC','P03 jasa','jasa','Jasa',0),
 ('f0340000-0000-4000-8000-000000000005','P03PKG','P03 paket klinik','paket','Grup',0),
 ('f0340000-0000-4000-8000-000000000006','P03PKGSVC','P03 paket jasa','paket','Grup',0);
insert into item_group_components(group_item_id,component_item_id,qty,unit,factor) values
 ('f0340000-0000-4000-8000-000000000002','f0340000-0000-4000-8000-000000000001',1,'pcs',1),
 ('f0340000-0000-4000-8000-000000000005','f0340000-0000-4000-8000-000000000003',1,'pcs',1),
 ('f0340000-0000-4000-8000-000000000005','f0340000-0000-4000-8000-000000000004',1,'jasa',1),
 ('f0340000-0000-4000-8000-000000000006','f0340000-0000-4000-8000-000000000004',1,'jasa',1);
insert into stock(warehouse_id,item_id,qty) values
 ('f0320000-0000-4000-8000-000000000002','f0340000-0000-4000-8000-000000000003',20);
insert into stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source) values
 ('f0320000-0000-4000-8000-000000000001','f0340000-0000-4000-8000-000000000001',(now() at time zone 'Asia/Jakarta')::date,20,20,20,'purchase'),
 ('f0320000-0000-4000-8000-000000000002','f0340000-0000-4000-8000-000000000003',current_date,20,20,1000,'purchase');
insert into customers(id,name,phone) values('f0350000-0000-4000-8000-000000000001','P03 customer','080000000303');
insert into pets(id,customer_id,name) values('f0360000-0000-4000-8000-000000000001','f0350000-0000-4000-8000-000000000001','P03 pet');
insert into visits(id,branch_id,customer_id,pet_id)
select ('f0370000-0000-4000-8000-00000000000'||n)::uuid,'f0310000-0000-4000-8000-000000000002',
 'f0350000-0000-4000-8000-000000000001','f0360000-0000-4000-8000-000000000001' from generate_series(1,9) n;
insert into medical_records(id,visit_id)
select ('f0380000-0000-4000-8000-00000000000'||n)::uuid,('f0370000-0000-4000-8000-00000000000'||n)::uuid from generate_series(1,9) n;
insert into coa_accounts(code,name,type,normal_balance,is_header) values
 ('110003','Kas','ASET','D',false),('1111','Test cash','ASET','D',false),('150001','Piutang','ASET','D',false),
 ('510001','Sales','PENDAPATAN','K',false),('520002','Discount','PENDAPATAN','D',false),
 ('510002','Pendapatan klinik','PENDAPATAN','K',false),('312005','VAT','LIABILITAS','K',false),
 ('600001','COGS','BEBAN','D',false),('170001','Inventory','ASET','D',false)
 on conflict(code) do update set is_active=true,is_header=false;
insert into cash_accounts(id,nama,jenis,coa_code) values('f0390000-0000-4000-8000-000000000001','P03 cash','Kas','1111')
 on conflict do nothing;
insert into payment_account_map(metode,branch_id,cash_account_id) values
 ('Tunai','f0310000-0000-4000-8000-000000000001',(select id from cash_accounts where coa_code='1111')) on conflict do nothing;
update accounting_locks set closed_until=null;
update company_settings set mode_pkp=false;

create function pg_temp.sale(ref text, gross numeric, net numeric) returns uuid language plpgsql as $$
declare result uuid;begin
 insert into sales(branch_id,no_struk,subtotal,discount,total,metode_bayar,bayar,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint)
 values('f0310000-0000-4000-8000-000000000001',ref,gross,gross-net,net,'Tunai',net,auth.uid(),
 'f0330000-0000-4000-8000-000000000001',case when net=0 then '[]'::jsonb else jsonb_build_array(jsonb_build_object('method','Tunai','amount',net)) end,
 'sql:'||ref,repeat('b',64)) returning id into result;
 return result;
end$$;
create function pg_temp.bundle(ref text, price numeric, net numeric) returns void language plpgsql as $$
declare line uuid;doc uuid;begin
 doc:=pg_temp.sale(ref,price,net);
 insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp)
 values(doc,'f0340000-0000-4000-8000-000000000002','P03 bundle',1,price,'set',1,0) returning id into line;
 insert into sale_item_group_components(sale_item_id,component_item_id,component_name,item_type,qty_per_group,unit,factor,total_base_qty,hpp)
 values(line,'f0340000-0000-4000-8000-000000000001','P03 kibble','Persediaan',1,'pcs',1,1,0);
end$$;
create function pg_temp.post(ref text) returns jsonb language sql as $$
 select cashier_post_stock_atomic((select id from sales where no_struk=ref),'f0320000-0000-4000-8000-000000000001')$$;

set local role authenticated;
select set_config('request.jwt.claim.sub','f0300000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select set_config('request.jwt.claim.role','authenticated',true);

-- Petshop: Grup line below the summed component FIFO HPP (20) is rejected, nothing issued.
select pg_temp.bundle('P03.GRUP.BELOW',15,15);
select pg_temp.reject($q$select pg_temp.post('P03.GRUP.BELOW')$q$,
 'Harga neto paket Grup di bawah total HPP FIFO komponen; penjualan ditolak: P03 bundle','grup below FIFO');
select pg_temp.ok((select count(*)=0 from stock_moves where source_ref='P03.GRUP.BELOW'),'grup below rolls stock back');
select pg_temp.ok((select payments_finalized_at is null from sales where no_struk='P03.GRUP.BELOW'),'grup below stays pending');
-- A basket-wide discount that pushes the Grup line below its component HPP is rejected too.
select pg_temp.bundle('P03.GRUP.DISC',30,18);
select pg_temp.reject($q$select pg_temp.post('P03.GRUP.DISC')$q$,'di bawah total HPP FIFO komponen','grup basket discount');
-- Zero net Grup with stock components is rejected.
select pg_temp.bundle('P03.GRUP.ZERO',30,0);
select pg_temp.reject($q$select pg_temp.post('P03.GRUP.ZERO')$q$,'Harga neto paket Grup nol','grup zero net');
select pg_temp.ok((select count(*)=0 from stock_moves where source_ref in('P03.GRUP.DISC','P03.GRUP.ZERO')),'grup rejections issue nothing');
-- Equal to the component HPP posts and keeps the FIFO attribution.
select pg_temp.bundle('P03.GRUP.EQUAL',20,20);
select pg_temp.ok((pg_temp.post('P03.GRUP.EQUAL')->>'finalized')::boolean,'grup at component HPP posts');
select pg_temp.ok((select i.hpp=20 from sale_items i join sales s on s.id=i.sale_id where s.no_struk='P03.GRUP.EQUAL'),'grup HPP attributed');
-- Plain stock line messages keep the original phrase and now name the line.
select pg_temp.sale('P03.STOCK.BELOW',10,10);
insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp)
select id,'f0340000-0000-4000-8000-000000000001','P03 kibble',1,10,'pcs',1,0 from sales where no_struk='P03.STOCK.BELOW';
select pg_temp.reject($q$select pg_temp.post('P03.STOCK.BELOW')$q$,
 'Harga neto Persediaan di bawah HPP FIFO; penjualan ditolak: P03 kibble','stock below names the line');

-- ---------------------------------------------------------------- clinic
select set_config('request.jwt.claim.sub','f0300000-0000-4000-8000-000000000002',true);
create function pg_temp.inv(subtotal numeric, discount numeric) returns jsonb language sql as $$
 select jsonb_build_object('tanggal',current_date::text,'subtotal',subtotal,'discount',discount,'tax',0,
  'total',subtotal-discount,'dp_amount',0,'dp_date',null,'paid_status','Belum Lunas','metode_bayar','Tunai',
  'shift_id','f0330000-0000-4000-8000-000000000002','voucher_code',null,'salesperson_id',null)$$;
create function pg_temp.obat(qty int, price numeric, pkg boolean default false) returns jsonb language sql as $$
 select jsonb_build_object('description','P03 obat','qty',qty,'price',price,'kind','obat',
  'item_id','f0340000-0000-4000-8000-000000000003','unit','pcs','discount_percent',0)
  || case when pkg then jsonb_build_object('package_item_id','f0340000-0000-4000-8000-000000000005','package_qty',qty) else '{}'::jsonb end$$;
create function pg_temp.jasa(price numeric, pkg uuid default null) returns jsonb language sql as $$
 select jsonb_build_object('description','P03 jasa','qty',1,'price',price,'kind','jasa',
  'item_id','f0340000-0000-4000-8000-000000000004','discount_percent',0)
  || case when pkg is not null then jsonb_build_object('package_item_id',pkg,'package_qty',1) else '{}'::jsonb end$$;
create function pg_temp.visit(n int) returns uuid language sql as $$ select ('f0370000-0000-4000-8000-00000000000'||n)::uuid $$;
create function pg_temp.clinic_state() returns jsonb language sql as $$
 select jsonb_build_object('stock',(select qty from stock where warehouse_id='f0320000-0000-4000-8000-000000000002'),
  'layers',(select sum(qty_left) from stock_layers where warehouse_id='f0320000-0000-4000-8000-000000000002'),
  'moves',(select count(*) from stock_moves where warehouse_id='f0320000-0000-4000-8000-000000000002'),
  'invoices',(select count(*) from invoices i join visits v on v.id=i.visit_id where v.branch_id='f0310000-0000-4000-8000-000000000002'),
  'journals',(select count(*) from journal_entries where branch_id='f0310000-0000-4000-8000-000000000002'))$$;
create temp table p03_state(label text primary key, state jsonb);
grant all on p03_state to authenticated;
insert into p03_state values('before',pg_temp.clinic_state());

-- Below actual HPP (1 x 1000) and zero price are rejected with the reason; nothing is kept.
select pg_temp.reject($q$select clinic_post_invoice(pg_temp.visit(1),'p03-below',pg_temp.inv(900,0),jsonb_build_array(pg_temp.obat(1,900)))$q$,
 'PRICE_BELOW_HPP: Harga neto P03 obat Rp900 di bawah HPP Rp1.000','clinic below HPP');
select pg_temp.reject($q$select clinic_post_invoice(pg_temp.visit(1),'p03-zero',pg_temp.inv(0,0),jsonb_build_array(pg_temp.obat(1,0)))$q$,
 'PRICE_ZERO: Harga neto P03 obat Rp0','clinic zero price');
-- A free service does not rescue a goods line whose share of the invoice discount drops below HPP.
select pg_temp.reject($q$select clinic_post_invoice(pg_temp.visit(1),'p03-disc',pg_temp.inv(1500,500),
 jsonb_build_array(pg_temp.obat(1,1200),pg_temp.jasa(300)))$q$,'PRICE_BELOW_HPP','clinic invoice discount allocated');
select pg_temp.ok((select state from p03_state where label='before')=pg_temp.clinic_state(),'clinic rejections roll back stock, invoice and journals');

-- At HPP plus a free service posts.
select pg_temp.ok(clinic_post_invoice(pg_temp.visit(2),'p03-ok',pg_temp.inv(1000,0),
 jsonb_build_array(pg_temp.obat(1,1000),pg_temp.jasa(0))) is not null,'clinic at HPP with free service posts');
-- A services-only invoice may be completely free.
select pg_temp.ok(clinic_post_invoice(pg_temp.visit(3),'p03-free-service',pg_temp.inv(0,0),
 jsonb_build_array(pg_temp.jasa(0))) is not null,'clinic free service posts');

-- Packages: judged as one unit against the summed component HPP.
select pg_temp.ok(clinic_post_invoice(pg_temp.visit(4),'p03-pkg-ok',pg_temp.inv(1200,0),
 jsonb_build_array(pg_temp.obat(1,0,true),pg_temp.jasa(1200,'f0340000-0000-4000-8000-000000000005'))) is not null,
 'package whose total covers component HPP posts even with a zero-priced goods component');
select pg_temp.reject($q$select clinic_post_invoice(pg_temp.visit(5),'p03-pkg-below',pg_temp.inv(800,0),
 jsonb_build_array(pg_temp.obat(1,0,true),pg_temp.jasa(800,'f0340000-0000-4000-8000-000000000005')))$q$,
 'PRICE_BELOW_HPP: Harga neto paket P03 paket klinik Rp800 di bawah total HPP komponennya Rp1.000','package below HPP');
select pg_temp.reject($q$select clinic_post_invoice(pg_temp.visit(5),'p03-pkg-zero',pg_temp.inv(0,0),
 jsonb_build_array(pg_temp.obat(1,0,true),pg_temp.jasa(0,'f0340000-0000-4000-8000-000000000005')))$q$,
 'PRICE_ZERO: Harga neto paket P03 paket klinik Rp0','package zero');
select pg_temp.ok(clinic_post_invoice(pg_temp.visit(6),'p03-pkg-service',pg_temp.inv(0,0),
 jsonb_build_array(pg_temp.jasa(0,'f0340000-0000-4000-8000-000000000006'))) is not null,'service-only package may be free');

-- Corrections obey the same floor; a valid correction still saves.
select pg_temp.reject($q$select clinic_edit_invoice((select id from invoices where request_key='p03-ok'),'p03-edit-below',
 jsonb_build_object('subtotal',500,'discount',0,'tax',0,'total',500,'dp_amount',0,'paid_status','Belum Lunas',
  'metode_bayar','Tunai','voucher_code',null,'reason','P03 test'),jsonb_build_array(pg_temp.obat(1,500),pg_temp.jasa(0)))$q$,
 'PRICE_BELOW_HPP','correction below HPP');
select pg_temp.ok(clinic_edit_invoice((select id from invoices where request_key='p03-ok'),'p03-edit-ok',
 jsonb_build_object('subtotal',1100,'discount',0,'tax',0,'total',1100,'dp_amount',0,'paid_status','Belum Lunas',
  'metode_bayar','Tunai','voucher_code',null,'reason','P03 test'),jsonb_build_array(pg_temp.obat(1,1100),pg_temp.jasa(0)))
 =(select id from invoices where request_key='p03-ok'),'valid correction saves');

-- The floor is internal: callers reach it only through the posting RPCs.
reset role;
select pg_temp.ok(not has_function_privilege('authenticated','clinic_private.assert_invoice_price_floor(uuid,numeric,numeric)','EXECUTE'),
 'floor checker not directly callable');
select pg_temp.ok((select prosecdef from pg_proc where oid='public.clinic_post_invoice(uuid,text,jsonb,jsonb)'::regprocedure)
 and has_function_privilege('authenticated','public.clinic_post_invoice(uuid,text,jsonb,jsonb)','EXECUTE')
 and not has_function_privilege('anon','public.clinic_post_invoice(uuid,text,jsonb,jsonb)','EXECUTE')
 and has_function_privilege('authenticated','public.cashier_post_stock_atomic(uuid,uuid)','EXECUTE')
 and not has_function_privilege('anon','public.cashier_post_stock_atomic(uuid,uuid)','EXECUTE'),'grants preserved');
rollback;
