-- P03 rule matrix: prints MX|<cart>/<discount mode>|<ACCEPT or error prefix> for every one- and two-row cart built from
-- 18 row templates (goods below/at/above HPP, zero, HPP missing, row discount, services, racikan, packages, free text).
-- Run it on a chain WITHOUT and WITH 20261106860000_price_floor_pesan_jelas.sql: the outputs must be byte-identical
-- (the message was made readable, the RULE of what is refused must not move).
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


insert into compounding_recipes(id,medical_record_id,recipe_name,dosage_instruction,total_volume,dosage_form,compounding_steps)
 values('f03a0000-0000-4000-8000-000000000001','f0380000-0000-4000-8000-000000000007','Obat Racik Probiotik','2x1','10 ml','sirup','campur');
insert into compounding_recipes(id,medical_record_id,recipe_name,dosage_instruction,total_volume,dosage_form,compounding_steps)
 values('f03a0000-0000-4000-8000-000000000002','f0380000-0000-4000-8000-000000000007','Obat Racik Dua','2x1','10 ml','sirup','campur');
insert into items(id,code,name,unit,item_type,buy_price) values
 ('f0340000-0000-4000-8000-000000000008','P03PKG2','P03 paket klinik dua','paket','Grup',0);
insert into invoices(id,visit_id) values('f03b0000-0000-4000-8000-000000000001','f0370000-0000-4000-8000-000000000007');
create temp table tpl(id int primary key,kind text,q int,p numeric,hpp numeric,disc numeric,pkg uuid,racik boolean,noitem boolean);
insert into tpl values
 (1,'obat',1,900,1000,0,null,false,false),(2,'obat',1,1000,1000,0,null,false,false),(3,'obat',1,1001,1000,0,null,false,false),
 (4,'obat',1,0,1000,0,null,false,false),(5,'obat',2,500,1000,0,null,false,false),(6,'obat',2,499,1000,0,null,false,false),
 (7,'obat',1,1000,null,0,null,false,false),(8,'obat',1,0,null,0,null,false,false),(9,'obat',1,2000,1000,50,null,false,false),
 (10,'obat',1,2000,1000,50.1,null,false,false),(11,'jasa',1,0,null,0,null,false,false),(12,'jasa',1,500,null,0,null,false,false),
 (13,'obat',1,5000,5000.50,0,null,true,false),(14,'obat',1,5001,5000.50,0,null,true,false),
 (15,'obat',1,0,1000,0,'f0340000-0000-4000-8000-000000000005',false,false),
 (16,'jasa',1,1000,null,0,'f0340000-0000-4000-8000-000000000005',false,false),
 (17,'jasa',1,999,null,0,'f0340000-0000-4000-8000-000000000005',false,false),
 (18,'obat',1,0,null,0,null,false,true);
create temp table cartdef(cid text primary key, ids int[]);
insert into cartdef select 's'||lpad(a.id::text,2,'0'), array[a.id] from tpl a;
insert into cartdef select 'p'||lpad(a.id::text,2,'0')||'_'||lpad(b.id::text,2,'0'), array[a.id,b.id] from tpl a join tpl b on a.id<b.id;
create temp table res(label text primary key, outcome text);
do $mx$
declare c record; sub numeric; mode text; disc numeric;
begin
 for c in select * from cartdef order by cid loop
  delete from invoice_items where invoice_id='f03b0000-0000-4000-8000-000000000001';
  insert into invoice_items(invoice_id,deskripsi,qty,harga,jenis,item_id,hpp,diskon_persen,satuan,package_item_id,package_qty,compound_recipe_id)
  select 'f03b0000-0000-4000-8000-000000000001','R'||lpad(t.id::text,2,'0'),t.q,t.p,t.kind,
   case when t.racik or t.noitem then null when t.kind='jasa' then 'f0340000-0000-4000-8000-000000000004'::uuid else 'f0340000-0000-4000-8000-000000000003'::uuid end,
   t.hpp,t.disc,case when t.racik then 'racikan' else 'pcs' end,t.pkg,case when t.pkg is not null then 1 end,
   case when t.racik then (case when t.id=14 then 'f03a0000-0000-4000-8000-000000000002' else 'f03a0000-0000-4000-8000-000000000001' end)::uuid end
  from tpl t where t.id=any(c.ids);
  select coalesce(sum(round(qty*harga*(1-diskon_persen/100),2)),0) into sub from invoice_items where invoice_id='f03b0000-0000-4000-8000-000000000001';
  foreach mode in array array['none','tenth','half','full'] loop
   disc:=case mode when 'none' then 0 when 'tenth' then floor(sub/10) when 'half' then floor(sub/2) else sub end;
   begin
    perform clinic_private.assert_invoice_price_floor('f03b0000-0000-4000-8000-000000000001',sub,disc);
    insert into res values(c.cid||'/'||mode,'ACCEPT');
   exception when others then insert into res values(c.cid||'/'||mode,split_part(sqlerrm,':',1));
   end;
  end loop;
 end loop;
 begin
  perform clinic_private.assert_invoice_price_floor('f03b0000-0000-4000-8000-000000000001',100,101);
  insert into res values('invalid/discount>subtotal','ACCEPT');
 exception when others then insert into res values('invalid/discount>subtotal',split_part(sqlerrm,':',1)); end;
end $mx$;
select 'MX|'||label||'|'||outcome from res order by label;
rollback;
