-- P03 pesan jelas: the clinic price-floor rejection must name EVERY offending row with its net price,
-- HPP and minimum price per unit. The RULE (what is refused) is covered by p03_price_floor.sql and the
-- differential matrix (p03_price_floor_rule_matrix.sql); here only the message contract is asserted.
-- Fictional fixtures in disposable PostgreSQL only; everything rolls back.
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
-- DP minimum (ranap_tagihan_berjalan) is not under test here; without this the first accepted post stops at DP_MINIMAL.
update clinic_billing_settings set min_dp_percent=0;


-- Extra fixtures: a stock item with a fractional FIFO cost (Infus Refill, 29577.60 -> shown Rp29.578), a second package, a recipe.
insert into items(id,code,name,unit,item_type,buy_price) values
 ('f0340000-0000-4000-8000-000000000007','P03INF','Infus Refill','pcs','Persediaan',29578),
 ('f0340000-0000-4000-8000-000000000008','P03PKG2','P03 paket klinik dua','paket','Grup',0);
insert into item_group_components(group_item_id,component_item_id,qty,unit,factor) values
 ('f0340000-0000-4000-8000-000000000008','f0340000-0000-4000-8000-000000000003',1,'pcs',1);
insert into stock(warehouse_id,item_id,qty) values ('f0320000-0000-4000-8000-000000000002','f0340000-0000-4000-8000-000000000007',20);
insert into stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source) values
 ('f0320000-0000-4000-8000-000000000002','f0340000-0000-4000-8000-000000000007',current_date,20,20,29577.60,'purchase');
insert into compounding_recipes(id,medical_record_id,recipe_name,dosage_instruction,total_volume,dosage_form,compounding_steps)
 values('f03a0000-0000-4000-8000-000000000001','f0380000-0000-4000-8000-000000000007','Obat Racik Probiotik','2x1','10 ml','sirup','campur');
-- Direct-call invoice (visit 7): the checker is exercised with hand-built invoice_items so every row kind is reachable.
insert into invoices(id,visit_id) values('f03b0000-0000-4000-8000-000000000001','f0370000-0000-4000-8000-000000000007');

-- cart(rows): rows = [{d,q,p,hpp,kind,item,pkg,racik,disc,unit}]
create function pg_temp.cart(rows jsonb) returns void language plpgsql as $$
declare r jsonb;begin
 delete from invoice_items where invoice_id='f03b0000-0000-4000-8000-000000000001';
 for r in select value from jsonb_array_elements(rows) loop
  insert into invoice_items(invoice_id,deskripsi,qty,harga,jenis,item_id,hpp,diskon_persen,satuan,package_item_id,package_qty,compound_recipe_id)
  values('f03b0000-0000-4000-8000-000000000001',r->>'d',coalesce((r->>'q')::int,1),(r->>'p')::numeric,coalesce(r->>'kind','obat'),
   case when coalesce((r->>'racik')::boolean,false) then null when r ? 'item' then (r->>'item')::uuid else 'f0340000-0000-4000-8000-000000000003'::uuid end,
   case when r ? 'hpp' then (r->>'hpp')::numeric else null end,coalesce((r->>'disc')::numeric,0),coalesce(r->>'unit','pcs'),
   (r->>'pkg')::uuid,case when r ? 'pkg' then 1 end,case when coalesce((r->>'racik')::boolean,false) then 'f03a0000-0000-4000-8000-000000000001'::uuid end);
 end loop;end$$;
create function pg_temp.floor(sub numeric, disc numeric default 0) returns text language plpgsql as $$
begin
 perform clinic_private.assert_invoice_price_floor('f03b0000-0000-4000-8000-000000000001',sub,disc);
 return 'ACCEPT';
exception when others then return sqlerrm;end$$;
create function pg_temp.has(msg text, part text) returns boolean language sql as $$select position(part in msg)>0$$;
create function pg_temp.bullets(msg text) returns int language sql as $$select count(*)::int from regexp_split_to_table(msg,E'\n') l where l like '- %: harga neto %'$$;
create temp table m(label text primary key,msg text);
grant all on m to authenticated;

-- T1 several offending rows are ALL listed, the passing row is not, per-unit price/HPP/minimum shown.
select pg_temp.cart('[{"d":"Infus Refill","q":1,"p":20000,"hpp":29577.60,"item":"f0340000-0000-4000-8000-000000000007"},
 {"d":"P03 obat A","q":1,"p":900,"hpp":1000},{"d":"P03 obat B","q":1,"p":5000,"hpp":1000}]');
insert into m values('t1',pg_temp.floor(25900));
select pg_temp.ok(msg like E'PRICE_BELOW_HPP: Harga neto Infus Refill Rp20.000 di bawah HPP Rp29.578. Ada 2 baris yang ditolak; semuanya tercantum di bawah.\n%' ,'T1 head: '||replace(msg,E'\n',' // ')) from m where label='t1';
select pg_temp.ok(pg_temp.has(msg,'- Infus Refill: harga neto Rp20.000 per pcs, HPP Rp29.578 per pcs, harga minimum Rp29.578 per pcs')
 and pg_temp.has(msg,'- P03 obat A: harga neto Rp900 per pcs, HPP Rp1.000 per pcs, harga minimum Rp1.000 per pcs')
 and not pg_temp.has(msg,'P03 obat B:') and pg_temp.bullets(msg)=2,'T1 rows: '||replace(msg,E'\n',' // ')) from m where label='t1';
select pg_temp.ok(pg_temp.has(msg,'ubah Harga jual di Barang & Jasa') and not pg_temp.has(msg,'Naikkan harga atau kurangi diskon'),'T1 new hint: '||replace(msg,E'\n',' // ')) from m where label='t1';
-- T2 quantity: head shows row totals, bullets show per unit.
select pg_temp.cart('[{"d":"P03 obat A","q":3,"p":900,"hpp":3000}]');
insert into m values('t2',pg_temp.floor(2700));
select pg_temp.ok(msg like 'PRICE_BELOW_HPP: Harga neto P03 obat A Rp2.700 di bawah HPP Rp3.000.%' and pg_temp.has(msg,'harga neto Rp900 per pcs, HPP Rp1.000 per pcs, harga minimum Rp1.000 per pcs')
 and not pg_temp.has(msg,'Ada '),'T2 qty: '||replace(msg,E'\n',' // ')) from m where label='t2';
-- T3 row discount percent + invoice discount enter the minimum: price 1200, 50% row discount -> net 600 < 1000; minimum must be 2000.
select pg_temp.cart('[{"d":"P03 obat A","q":1,"p":1200,"hpp":1000,"disc":50}]');
insert into m values('t3',pg_temp.floor(600));
select pg_temp.ok(pg_temp.has(msg,'harga minimum Rp2.000 per pcs'),'T3 min with row discount: '||replace(msg,E'\n',' // ')) from m where label='t3';
-- T3b invoice discount: 1200 + 300 jasa, discount 500 -> share 2/3, net 800 -> minimum ceil(1000/(2/3)) = 1500.
select pg_temp.cart('[{"d":"P03 obat A","q":1,"p":1200,"hpp":1000},{"d":"P03 jasa","q":1,"p":300,"kind":"jasa","item":"f0340000-0000-4000-8000-000000000004"}]');
insert into m values('t3b',pg_temp.floor(1500,500));
select pg_temp.ok(pg_temp.has(msg,'harga minimum Rp1.500 per pcs') and pg_temp.has(msg,'PRICE_BELOW_HPP: Harga neto P03 obat A Rp800 '),'T3b min with invoice discount: '||replace(msg,E'\n',' // ')) from m where label='t3b';
-- T3c: the invoice is free after a 100% discount: no minimum can fix it.
select pg_temp.cart('[{"d":"P03 obat A","q":1,"p":1000,"hpp":1000}]');
insert into m values('t3c',pg_temp.floor(1000,1000));
select pg_temp.ok(msg like 'PRICE_ZERO: Harga neto P03 obat A Rp0.%' and pg_temp.has(msg,'harga minimum tidak dapat dihitung (diskon invoice 100%)'),'T3c: '||replace(msg,E'\n',' // ')) from m where label='t3c';
-- T3d (C8): the WHOLE invoice subtotal is 0 because the only row is a free obat: there is no invoice discount, the minimum
-- IS computable (HPP per unit, row discount included) and must be printed; the message must not blame a discount.
select pg_temp.cart('[{"d":"P03 obat A","q":1,"p":0,"hpp":1000}]');
insert into m values('t3d',pg_temp.floor(0));
select pg_temp.ok(msg like 'PRICE_ZERO: Harga neto P03 obat A Rp0.%' and pg_temp.has(msg,'- P03 obat A: harga neto Rp0 per pcs, HPP Rp1.000 per pcs, harga minimum Rp1.000 per pcs')
 and not pg_temp.has(msg,'diskon invoice') and not pg_temp.has(msg,'tidak dapat dihitung'),'T3d zero subtotal prints the minimum: '||replace(msg,E'\n',' // ')) from m where label='t3d';
select pg_temp.cart('[{"d":"P03 obat A","q":3,"p":0,"hpp":3000}]');
insert into m values('t3e',pg_temp.floor(0));
select pg_temp.ok(pg_temp.has(msg,'HPP Rp1.000 per pcs, harga minimum Rp1.000 per pcs') and not pg_temp.has(msg,'tidak dapat dihitung'),'T3e zero subtotal, qty 3: '||replace(msg,E'\n',' // ')) from m where label='t3e';
-- row discount 50% on a free row under a zero subtotal: the minimum still honours the row discount (1000 / 0.5)
select pg_temp.cart('[{"d":"P03 obat A","q":1,"p":0,"hpp":1000,"disc":50}]');
insert into m values('t3g',pg_temp.floor(0));
select pg_temp.ok(pg_temp.has(msg,'harga minimum Rp2.000 per pcs') and not pg_temp.has(msg,'diskon invoice'),'T3g zero subtotal with 50% row discount: '||replace(msg,E'\n',' // ')) from m where label='t3g';
-- T3f (C8): a 100% ROW discount cannot be fixed by any price: say so, naming the ROW discount (never an invoice discount).
select pg_temp.cart('[{"d":"P03 obat A","q":1,"p":1000,"hpp":1000,"disc":100}]');
insert into m values('t3f',pg_temp.floor(0));
select pg_temp.ok(msg like 'PRICE_ZERO: Harga neto P03 obat A Rp0.%' and pg_temp.has(msg,'harga minimum tidak dapat dihitung (diskon 100% pada baris)') and not pg_temp.has(msg,'diskon invoice'),'T3f 100% row discount: '||replace(msg,E'\n',' // ')) from m where label='t3f';
-- invoice discount equal to a non-zero subtotal keeps its own wording
select pg_temp.ok((select count(*) from m where label='t3c' and msg like '%harga minimum tidak dapat dihitung (diskon invoice 100%)%')=1,'T3c wording stays for a real 100% invoice discount');
-- T4 two packages + a plain row, all listed, package minimum is a package total.
select pg_temp.cart('[{"d":"P03 obat komp","q":1,"p":0,"hpp":1000,"pkg":"f0340000-0000-4000-8000-000000000005"},
 {"d":"P03 jasa","q":1,"p":800,"kind":"jasa","item":"f0340000-0000-4000-8000-000000000004","pkg":"f0340000-0000-4000-8000-000000000005"},
 {"d":"P03 obat komp2","q":1,"p":300,"hpp":500,"pkg":"f0340000-0000-4000-8000-000000000008"},
 {"d":"Zeta obat","q":1,"p":100,"hpp":50}]');
insert into m values('t4',pg_temp.floor(1200));
select pg_temp.ok(msg like 'PRICE_BELOW_HPP: Harga neto paket P03 paket klinik Rp800 di bawah total HPP komponennya Rp1.000. Ada 2 baris%'
 and pg_temp.has(msg,'- P03 paket klinik (paket): harga neto Rp800 untuk seluruh paket, total HPP komponen Rp1.000, harga minimum paket Rp1.000')
 and pg_temp.has(msg,'- P03 paket klinik dua (paket): harga neto Rp300 untuk seluruh paket, total HPP komponen Rp500, harga minimum paket Rp500')
 and pg_temp.bullets(msg)=2,'T4 packages: '||replace(msg,E'\n',' // ')) from m where label='t4';
-- T4b package minimum under an invoice discount: net 1200 * (1200-300)/1200 = 900 < 1000 -> minimum ceil(1000/0.75) = 1334.
select pg_temp.cart('[{"d":"P03 obat komp","q":1,"p":0,"hpp":1000,"pkg":"f0340000-0000-4000-8000-000000000005"},
 {"d":"P03 jasa","q":1,"p":1200,"kind":"jasa","item":"f0340000-0000-4000-8000-000000000004","pkg":"f0340000-0000-4000-8000-000000000005"}]');
insert into m values('t4b',pg_temp.floor(1200,300));
select pg_temp.ok(pg_temp.has(msg,'harga minimum paket Rp1.334'),'T4b package min with invoice discount: '||replace(msg,E'\n',' // ')) from m where label='t4b';
-- T4c (C8): a package whose whole invoice subtotal is 0: no invoice discount exists, the package minimum is printed.
select pg_temp.cart('[{"d":"P03 obat komp","q":1,"p":0,"hpp":1000,"pkg":"f0340000-0000-4000-8000-000000000005"}]');
insert into m values('t4c',pg_temp.floor(0));
select pg_temp.ok(msg like 'PRICE_ZERO: Harga neto paket P03 paket klinik Rp0.%' and pg_temp.has(msg,'harga minimum paket Rp1.000') and not pg_temp.has(msg,'tidak dapat dihitung'),'T4c zero-subtotal package: '||replace(msg,E'\n',' // ')) from m where label='t4c';
-- T5 racikan row: named, marked, and its hint points at the Owner price / dokter composition (inpatient stage) or dokter only (outpatient).
select pg_temp.cart('[{"d":"Obat Racik Probiotik","q":1,"p":50000,"hpp":50151,"racik":true,"unit":"racikan"}]');
insert into m values('t5',pg_temp.floor(50000));
select pg_temp.ok(msg like 'PRICE_BELOW_HPP: Harga neto Obat Racik Probiotik Rp50.000 di bawah HPP Rp50.151.%'
 and pg_temp.has(msg,'- Obat Racik Probiotik (racikan): harga neto Rp50.000 per racikan, HPP Rp50.151 per racikan, harga minimum Rp50.151 per racikan')
 and pg_temp.has(msg,'Untuk racikan: ubah komposisi lewat dokter.') and not pg_temp.has(msg,'harga racikan (Owner)'),'T5 racikan outpatient: '||replace(msg,E'\n',' // ')) from m where label='t5';
-- the stage RPC opens this context (clinic_private.context_begin) for the whole posting
insert into clinic_private.posting_ctx(txid,kind,visit_id) values(txid_current(),'stage','f0370000-0000-4000-8000-000000000007');
insert into m values('t5s',pg_temp.floor(50000));
select pg_temp.ok(pg_temp.has(msg,'Untuk racikan: ubah harga racikan (Owner) atau ubah komposisi lewat dokter.'),'T5 racikan stage: '||replace(msg,E'\n',' // ')) from m where label='t5s';
-- T6 inpatient stage: no discount hint at all; outpatient: discount hint present.
select pg_temp.ok(not pg_temp.has(msg,'diskon') and pg_temp.has(msg,'Naikkan Harga di baris tersebut atau ubah Harga jual di Barang & Jasa.'),'T6 stage has no discount hint: '||replace(msg,E'\n',' // ')) from m where label='t5s';
select pg_temp.ok(pg_temp.has(msg,'Naikkan Harga di baris tersebut, kurangi diskon, atau ubah Harga jual di Barang & Jasa.'),'T6 outpatient keeps discount hint: '||replace(msg,E'\n',' // ')) from m where label='t5';
delete from clinic_private.posting_ctx where txid=txid_current();
-- a corrected stage invoice is recognised by its stage_billing flag even without the context
update invoices set stage_billing=true where id='f03b0000-0000-4000-8000-000000000001';
select pg_temp.cart('[{"d":"Obat Racik Probiotik","q":1,"p":50000,"hpp":50151,"racik":true,"unit":"racikan"}]');
insert into m values('t5f',pg_temp.floor(50000));
select pg_temp.ok(not pg_temp.has(msg,'diskon') and pg_temp.has(msg,'harga racikan (Owner)'),'T6b stage flag on invoice: '||replace(msg,E'\n',' // ')) from m where label='t5f';
update invoices set stage_billing=false where id='f03b0000-0000-4000-8000-000000000001';
-- T7 PRICE_ZERO first + below later: prefix of the first failing row (zero), both listed.
select pg_temp.cart('[{"d":"A gratis","q":1,"p":0,"hpp":1000},{"d":"B murah","q":1,"p":900,"hpp":1000}]');
insert into m values('t7',pg_temp.floor(900));
select pg_temp.ok(msg like 'PRICE_ZERO: Harga neto A gratis Rp0. Obat/barang tidak boleh dijual gratis (jasa tetap boleh gratis). Ada 2 baris%'
 and pg_temp.has(msg,'- A gratis: harga neto Rp0 per pcs') and pg_temp.has(msg,'- B murah: harga neto Rp900 per pcs') and pg_temp.bullets(msg)=2,'T7: '||replace(msg,E'\n',' // ')) from m where label='t7';
-- T8 COST_MISSING: unchanged shape for one row, all names for several; below row first keeps its prefix and names the missing ones.
select pg_temp.cart('[{"d":"Z tanpa hpp","q":1,"p":900}]');
select pg_temp.ok(pg_temp.floor(900)='COST_MISSING: Z tanpa hpp','T8 single cost missing is byte-identical to before');
select pg_temp.cart('[{"d":"Y tanpa hpp","q":1,"p":900},{"d":"Z tanpa hpp","q":1,"p":900}]');
select pg_temp.ok(pg_temp.floor(1800)='COST_MISSING: Y tanpa hpp, Z tanpa hpp','T8 all cost-missing names');
select pg_temp.cart('[{"d":"A murah","q":1,"p":900,"hpp":1000},{"d":"B tanpa hpp","q":1,"p":900}]');
insert into m values('t8',pg_temp.floor(1800));
select pg_temp.ok(msg like 'PRICE_BELOW_HPP: Harga neto A murah%' and pg_temp.has(msg,E'\nHPP belum tersedia untuk: B tanpa hpp'),'T8 mixed: '||replace(msg,E'\n',' // ')) from m where label='t8';
-- T9 more than 30 offenders: 30 listed, the rest counted.
select pg_temp.cart((select jsonb_agg(jsonb_build_object('d','Baris '||lpad(n::text,2,'0'),'q',1,'p',900,'hpp',1000)) from generate_series(1,35) n));
insert into m values('t9',pg_temp.floor(31500));
select pg_temp.ok(pg_temp.bullets(msg)=30 and pg_temp.has(msg,E'\ndan 5 baris lain lagi.') and pg_temp.has(msg,'Ada 35 baris'),'T9 cap: '||pg_temp.bullets(msg)) from m where label='t9';
-- T10 a name with line breaks cannot break the line format.
select pg_temp.cart('[{"d":"Nama\nbaris   ganda","q":1,"p":900,"hpp":1000}]');
insert into m values('t10',pg_temp.floor(900));
select pg_temp.ok(pg_temp.has(msg,'- Nama baris ganda: harga neto Rp900 per pcs') and pg_temp.bullets(msg)=1,'T10 name sanitized: '||replace(msg,E'\n',' // ')) from m where label='t10';
-- T11 services are never listed or refused; accepted cart returns ACCEPT.
select pg_temp.cart('[{"d":"P03 jasa","q":1,"p":0,"kind":"jasa","item":"f0340000-0000-4000-8000-000000000004"},{"d":"Ok","q":1,"p":1000,"hpp":1000}]');
select pg_temp.ok(pg_temp.floor(1000)='ACCEPT','T11 free service + goods at HPP accepted');
select pg_temp.ok(pg_temp.floor(1000,2000) like 'INVOICE_INVALID:%','T11b invalid discount keeps INVOICE_INVALID');

-- ------------------------------------------------------------ through the real posting RPC
set local role authenticated;
select set_config('request.jwt.claim.sub','f0300000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select set_config('request.jwt.claim.role','authenticated',true);
create function pg_temp.inv(subtotal numeric, discount numeric) returns jsonb language sql as $$
 select jsonb_build_object('tanggal',current_date::text,'subtotal',subtotal,'discount',discount,'tax',0,
  'total',subtotal-discount,'dp_amount',0,'dp_date',null,'paid_status','Belum Lunas','metode_bayar','Tunai',
  'shift_id','f0330000-0000-4000-8000-000000000002','voucher_code',null,'salesperson_id',null)$$;
create function pg_temp.line(descr text, qty int, price numeric, item uuid default 'f0340000-0000-4000-8000-000000000003') returns jsonb language sql as $$
 select jsonb_build_object('description',descr,'qty',qty,'price',price,'kind','obat','item_id',item,'unit','pcs','discount_percent',0)$$;
create function pg_temp.visit(n int) returns uuid language sql as $$ select ('f0370000-0000-4000-8000-00000000000'||n)::uuid $$;
create function pg_temp.post_msg(n int, key text, sub numeric, disc numeric, lines jsonb) returns text language plpgsql as $$
begin
 perform clinic_post_invoice(pg_temp.visit(n),key,pg_temp.inv(sub,disc),lines);
 return 'ACCEPT';
exception when others then return sqlerrm;end$$;
create function pg_temp.state() returns jsonb language sql as $$
 select jsonb_build_object('layers',(select sum(qty_left) from stock_layers where warehouse_id='f0320000-0000-4000-8000-000000000002'),
  'moves',(select count(*) from stock_moves where warehouse_id='f0320000-0000-4000-8000-000000000002'),
  'invoices',(select count(*) from invoices i join visits v on v.id=i.visit_id where v.branch_id='f0310000-0000-4000-8000-000000000002'),
  'journals',(select count(*) from journal_entries where branch_id='f0310000-0000-4000-8000-000000000002'))$$;
create temp table st(label text primary key,s jsonb);
grant all on st to authenticated;
insert into st values('before',pg_temp.state());

-- P1 the real posting path: all rows listed, nothing kept, and the minimum IS sufficient / minimum-1 is not.
insert into m values('p1',pg_temp.post_msg(1,'pm-1',25900,0,jsonb_build_array(pg_temp.line('Infus Refill',1,20000,'f0340000-0000-4000-8000-000000000007'),pg_temp.line('P03 obat A',1,900),pg_temp.line('P03 obat B',1,5000))));
select pg_temp.ok(msg like 'PRICE_BELOW_HPP: Harga neto Infus Refill Rp20.000 di bawah HPP Rp29.578. Ada 2 baris%' and pg_temp.bullets(msg)=2
 and pg_temp.has(msg,'harga minimum Rp29.578 per pcs'),'P1 posting message: '||replace(msg,E'\n',' // ')) from m where label='p1';
select pg_temp.ok((select s from st where label='before')=pg_temp.state(),'P1 rejection rolls everything back');
insert into m values('p1b',pg_temp.post_msg(1,'pm-1b',29577,0,jsonb_build_array(pg_temp.line('Infus Refill',1,29577,'f0340000-0000-4000-8000-000000000007'))));
select pg_temp.ok(msg like 'PRICE_BELOW_HPP:%','P1b minimum-1 (Rp29.577) is still refused: '||replace(msg,E'\n',' // ')) from m where label='p1b';
select pg_temp.ok(pg_temp.post_msg(8,'pm-8',29578,0,jsonb_build_array(pg_temp.line('Infus Refill',1,29578,'f0340000-0000-4000-8000-000000000007')))='ACCEPT','P1c the printed minimum (Rp29.578) is accepted');
-- P2 invoice discount: printed minimum is sufficient even though raising the price also raises the subtotal.
insert into m values('p2',pg_temp.post_msg(1,'pm-2',1500,500,jsonb_build_array(pg_temp.line('P03 obat A',1,1200),
 jsonb_build_object('description','P03 jasa','qty',1,'price',300,'kind','jasa','item_id','f0340000-0000-4000-8000-000000000004','discount_percent',0))));
select pg_temp.ok(pg_temp.has(msg,'harga minimum Rp1.500 per pcs'),'P2 min: '||replace(msg,E'\n',' // ')) from m where label='p2';
select pg_temp.ok(pg_temp.post_msg(9,'pm-9',1800,500,jsonb_build_array(pg_temp.line('P03 obat A',1,1500),
 jsonb_build_object('description','P03 jasa','qty',1,'price',300,'kind','jasa','item_id','f0340000-0000-4000-8000-000000000004','discount_percent',0)))='ACCEPT','P2b minimum accepted under the invoice discount');
-- P2c (C8) the real posting path with ONLY a free obat row (subtotal 0): the minimum is printed and is sufficient.
insert into m values('p2c',pg_temp.post_msg(2,'pm-2c',0,0,jsonb_build_array(pg_temp.line('P03 obat A',1,0))));
select pg_temp.ok(msg like 'PRICE_ZERO:%' and pg_temp.has(msg,'harga minimum Rp1.000 per pcs') and not pg_temp.has(msg,'tidak dapat dihitung') and not pg_temp.has(msg,'diskon invoice'),'P2c free obat posting message: '||replace(msg,E'\n',' // ')) from m where label='p2c';
select pg_temp.ok(pg_temp.post_msg(3,'pm-3',1000,0,jsonb_build_array(pg_temp.line('P03 obat A',1,1000)))='ACCEPT','P2d the printed minimum of the free obat row (Rp1.000) is accepted');
-- P3 correction path lists every row too.
create function pg_temp.edit_msg(sub numeric, lines jsonb) returns text language plpgsql as $$
begin
 perform clinic_edit_invoice((select id from invoices where request_key='pm-8'),'pm-edit',
  jsonb_build_object('subtotal',sub,'discount',0,'tax',0,'total',sub,'dp_amount',0,'paid_status','Belum Lunas',
   'metode_bayar','Tunai','voucher_code',null,'reason','P03 test'),lines);
 return 'ACCEPT';
exception when others then return sqlerrm;end$$;
insert into m values('p3',pg_temp.edit_msg(1499,jsonb_build_array(pg_temp.line('P03 obat A',1,500),pg_temp.line('Z Infus',1,999,'f0340000-0000-4000-8000-000000000007'))));
select pg_temp.ok(msg like 'PRICE_BELOW_HPP: Harga neto P03 obat A Rp500 di bawah HPP Rp1.000. Ada 2 baris%' and pg_temp.bullets(msg)=2,'P3 correction lists both: '||replace(msg,E'\n',' // ')) from m where label='p3';
reset role;
select pg_temp.ok(not has_function_privilege('authenticated','clinic_private.assert_invoice_price_floor(uuid,numeric,numeric)','EXECUTE')
 and not has_function_privilege('anon','clinic_private.assert_invoice_price_floor(uuid,numeric,numeric)','EXECUTE')
 and (select prosecdef and proconfig=array['search_path=""'] and prorettype='void'::regtype from pg_proc where oid='clinic_private.assert_invoice_price_floor(uuid,numeric,numeric)'::regprocedure),'checker stays internal, definer, empty search_path');
rollback;
