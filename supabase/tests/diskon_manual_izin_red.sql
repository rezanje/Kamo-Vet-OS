-- RED (baseline, tanpa migrasi 20261116100000): STAFF/DOCTOR/ADMIN memberi diskon manual dan LOLOS. fictional fixtures in disposable PostgreSQL only; everything rolls back.
-- Dibuktikan: STAFF/DOCTOR/ADMIN/FINANCE ditolak memberi diskon manual (petshop: kolom nota, diskon baris; klinik: kolom nota, diskon baris),
-- penyamaran sebagai promo/voucher/golongan/poin ditolak, ADMIN diizinkan hanya setelah dicentang, OWNER selalu boleh (juga bila tabel kebijakan galat),
-- promo/voucher/golongan/poin sah tetap jalan untuk STAFF, koreksi tagihan tidak bisa menaikkan diskon manual.
begin;
create function pg_temp.ok(value boolean, label text) returns void language plpgsql as $$begin
 if value is distinct from true then raise exception 'Assertion failed: %',label;end if;raise notice 'DM_PASS %',label;end$$;
create function pg_temp.accept(stmt text, label text) returns void language plpgsql as $$
declare msg text;begin
 begin execute stmt;exception when others then msg:=sqlerrm;end;
 if msg is not null then raise exception 'Expected acceptance (%): %',label,msg;end if;raise notice 'DM_PASS %',label;end$$;
create function pg_temp.reject(stmt text, expected text, label text) returns void language plpgsql as $$
declare failed boolean:=false;msg text;begin
 begin execute stmt;exception when others then failed:=true;msg:=sqlerrm;end;
 if not failed then raise exception 'Expected rejection: %',label;end if;
 if position(expected in msg)=0 then raise exception 'Unexpected rejection for %: %',label,msg;end if;
 raise notice 'DM_PASS %',label;
end$$;
create function pg_temp.as_(uid text) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',uid,true);perform set_config('request.jwt.claims','{"role":"authenticated"}',true);end$$;
create function pg_temp.anon() returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','',true);end$$;

create function pg_temp.setpol(r text, ids text[]) returns void language plpgsql as $$
declare prev_sub text:=current_setting('request.jwt.claim.sub',true);prev_claims text:=current_setting('request.jwt.claims',true);begin
 -- jalur pemeliharaan DBA (tanpa pengguna) yang disediakan penjaga pengaturan akses; setelahnya pelaku semula dipulihkan
 perform pg_temp.anon();
 if ids is null then delete from role_settings_private.action_policies where role=r::public.user_role;
 else insert into role_settings_private.action_policies(role,allowed) values(r::public.user_role,ids) on conflict(role) do update set allowed=excluded.allowed;end if;
 perform set_config('request.jwt.claim.sub',coalesce(prev_sub,''),true);perform set_config('request.jwt.claims',coalesce(prev_claims,''),true);end$$;

-- ── fixtures ──
insert into auth.users(id,raw_user_meta_data) values
 ('dd100000-0000-4000-8000-000000000001','{"full_name":"DM owner"}'),('dd100000-0000-4000-8000-000000000002','{"full_name":"DM admin"}'),
 ('dd100000-0000-4000-8000-000000000003','{"full_name":"DM finance"}'),('dd100000-0000-4000-8000-000000000004','{"full_name":"DM staff"}'),
 ('dd100000-0000-4000-8000-000000000005','{"full_name":"DM doctor"}');
update profiles set role='OWNER',is_active=true where id='dd100000-0000-4000-8000-000000000001';
update profiles set role='ADMIN',is_active=true where id='dd100000-0000-4000-8000-000000000002';
update profiles set role='FINANCE',is_active=true where id='dd100000-0000-4000-8000-000000000003';
update profiles set role='STAFF',is_active=true where id='dd100000-0000-4000-8000-000000000004';
update profiles set role='DOCTOR',is_active=true where id='dd100000-0000-4000-8000-000000000005';
insert into role_capabilities(role,all_branches,create_accounts) values('ADMIN',false,false),('FINANCE',false,false) on conflict(role) do update set all_branches=false;
insert into role_modules(role,module_id) values('STAFF','pos') on conflict do nothing;
insert into branches(id,code,name,type) values('dd200000-0000-4000-8000-000000000001','DMP','DM petshop','PETSHOP'),('dd200000-0000-4000-8000-000000000002','DMK','DM klinik','KLINIK');
insert into user_branches(user_id,branch_id)
 select u::uuid,b::uuid from (values ('dd100000-0000-4000-8000-000000000001'),('dd100000-0000-4000-8000-000000000002'),('dd100000-0000-4000-8000-000000000003'),('dd100000-0000-4000-8000-000000000004'),('dd100000-0000-4000-8000-000000000005')) a(u),
 (values ('dd200000-0000-4000-8000-000000000001'),('dd200000-0000-4000-8000-000000000002')) c(b);
insert into warehouses(id,branch_id,code,name,type) values('dd300000-0000-4000-8000-000000000001','dd200000-0000-4000-8000-000000000001','DMWH','DM gudang','RETAIL'),
 ('dd300000-0000-4000-8000-000000000002','dd200000-0000-4000-8000-000000000002','DMVET','DM vet','VET');
insert into items(id,code,name,unit,item_type,buy_price,sell_price) values
 ('dd400000-0000-4000-8000-000000000001','DMSVC','DM jasa','pcs','Jasa',0,100000),('dd400000-0000-4000-8000-000000000002','DMPROMO','DM jasa promo','pcs','Jasa',0,50000),
 ('dd400000-0000-4000-8000-000000000003','DMPCT','DM jasa persen','pcs','Jasa',0,100000),('dd400000-0000-4000-8000-000000000004','DMOBAT','DM obat','pcs','Persediaan',1000,2000);
insert into stock(warehouse_id,item_id,qty) values('dd300000-0000-4000-8000-000000000002','dd400000-0000-4000-8000-000000000004',500);
insert into stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source) values('dd300000-0000-4000-8000-000000000002','dd400000-0000-4000-8000-000000000004',current_date,500,500,1000,'purchase');
insert into coa_accounts(code,name,type,normal_balance,is_header) values
 ('110003','Kas','ASET','D',false),('1111','DM kas','ASET','D',false),('150001','Piutang','ASET','D',false),('510001','Pendapatan','PENDAPATAN','K',false),
 ('510002','Pendapatan klinik','PENDAPATAN','K',false),('520002','Diskon','PENDAPATAN','D',false),('312005','PPN','LIABILITAS','K',false),('600001','HPP','BEBAN','D',false),('170001','Persediaan','ASET','D',false)
 on conflict(code) do update set is_active=true,is_header=false;
insert into cash_accounts(id,nama,jenis,coa_code) values('dd500000-0000-4000-8000-000000000001','DM kas','Kas','1111');
insert into payment_account_map(metode,branch_id,cash_account_id) values('Tunai','dd200000-0000-4000-8000-000000000001','dd500000-0000-4000-8000-000000000001'),('Tunai','dd200000-0000-4000-8000-000000000002','dd500000-0000-4000-8000-000000000001') on conflict do nothing;
update accounting_locks set closed_until=null;
update company_settings set mode_pkp=false,ppn_rate=11;
update clinic_billing_settings set min_dp_percent=0;
-- satu shift petshop dan satu shift klinik per pengguna (shift harus milik pembuat dokumen)
insert into cashier_shifts(id,branch_id,opened_by,shift_type,opening_balance)
 select ('dd60000'||n||'-0000-4000-8000-00000000000'||t)::uuid,case t when 1 then 'dd200000-0000-4000-8000-000000000001' else 'dd200000-0000-4000-8000-000000000002' end::uuid,
        ('dd10000'||'0-0000-4000-8000-00000000000'||n)::uuid,case t when 1 then 'petshop' else 'klinik' end,0
 from generate_series(1,5) n,generate_series(1,2) t;
-- master: promo nominal 5.000/unit (DMPROMO), promo persen 10% (DMPCT), voucher 10% maks 20.000, golongan 10%, pelanggan 10.000 poin
insert into promos(id,name,promo_type,rule,is_active,auto_apply,discount_type,discount_value) values
 ('dd700000-0000-4000-8000-000000000001','DM promo nominal','diskon_produk','{}',true,true,'nominal',5000),
 ('dd700000-0000-4000-8000-000000000002','DM promo persen','diskon_produk','{}',true,true,'percent',10);
insert into promo_items(promo_id,item_id) values('dd700000-0000-4000-8000-000000000001','dd400000-0000-4000-8000-000000000002'),('dd700000-0000-4000-8000-000000000002','dd400000-0000-4000-8000-000000000003');
insert into vouchers(code,tipe,nilai,is_active,max_potongan) values('DMV10','persen',10,true,20000),('DMVN','nominal',7000,true,null);
insert into customer_categories(id,nama,diskon_persen,is_active,rupiah_per_poin) values('dd800000-0000-4000-8000-000000000001','DM golongan',10,true,1000);
insert into customers(id,name,phone,category_id,points) values('dd810000-0000-4000-8000-000000000001','DM pelanggan','080000000777','dd800000-0000-4000-8000-000000000001',10000),
 ('dd810000-0000-4000-8000-000000000002','DM pelanggan biasa','080000000778',null,0);
insert into pets(id,customer_id,name) values('dd820000-0000-4000-8000-000000000001','dd810000-0000-4000-8000-000000000001','DM hewan'),('dd820000-0000-4000-8000-000000000002','dd810000-0000-4000-8000-000000000002','DM hewan dua');
-- kunjungan 1-9: pelanggan bergolongan 10% dengan 10.000 poin; kunjungan 10-12: pelanggan biasa (tanpa golongan/poin) untuk uji penyamaran
insert into visits(id,branch_id,customer_id,pet_id) select ('dd83'||lpad(n::text,4,'0')||'-0000-4000-8000-000000000001')::uuid,'dd200000-0000-4000-8000-000000000002',
 case when n<=9 then 'dd810000-0000-4000-8000-000000000001' else 'dd810000-0000-4000-8000-000000000002' end::uuid,
 case when n<=9 then 'dd820000-0000-4000-8000-000000000001' else 'dd820000-0000-4000-8000-000000000002' end::uuid from generate_series(1,12) n;
insert into medical_records(id,visit_id) select ('dd84'||lpad(n::text,4,'0')||'-0000-4000-8000-000000000001')::uuid,('dd83'||lpad(n::text,4,'0')||'-0000-4000-8000-000000000001')::uuid from generate_series(1,12) n;

-- ── pembantu petshop ──
-- lines: [{item,qty,harga,promo_id,promo_discount,itype,ival}]; disc = sales.discount (tanpa golongan), kat = diskon_kategori, manual = kolom manual_discount
create function pg_temp.sale(ref text,uid int,lines jsonb,disc numeric,kat numeric default 0,manual numeric default 0,vcode text default null,poin int default 0,cust uuid default null,chan text default null) returns uuid language plpgsql as $$
declare doc uuid;sub numeric;tot numeric;l jsonb;u text:=('dd10000'||'0-0000-4000-8000-00000000000'||uid);sh uuid:=('dd60000'||uid||'-0000-4000-8000-000000000001')::uuid;begin
 perform pg_temp.as_(u);
 select sum((x->>'qty')::numeric*(x->>'harga')::numeric) into sub from jsonb_array_elements(lines) x;
 tot:=sub-disc-kat;
 insert into sales(branch_id,customer_id,no_struk,subtotal,discount,diskon_kategori,total,metode_bayar,bayar,kembali,poin_earned,poin_digunakan,voucher_code,channel,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint)
  values('dd200000-0000-4000-8000-000000000001',cust,ref,sub,disc,kat,tot,'Tunai',tot,0,0,poin,vcode,chan,u::uuid,sh,jsonb_build_array(jsonb_build_object('method','Tunai','amount',tot)),'k:'||ref,repeat('a',64)) returning id into doc;
 for l in select value from jsonb_array_elements(lines) loop
  insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp,promo_id,promo_discount,item_discount_type,item_discount_value)
   values(doc,(l->>'item')::uuid,'baris',(l->>'qty')::numeric,(l->>'harga')::numeric,'pcs',1,0,(l->>'promo_id')::uuid,coalesce((l->>'promo_discount')::numeric,0),l->>'itype',coalesce((l->>'ival')::numeric,0));
 end loop;
 perform finalize_pos_sale(doc);
 return doc;end$$;
create function pg_temp.svc(price numeric default 100000,qty numeric default 1,extra jsonb default '{}') returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object('item','dd400000-0000-4000-8000-000000000001','qty',qty,'harga',price)||extra)$$;
create function pg_temp.settle(ref text) returns boolean language sql as $$select exists(select 1 from public.sales where no_struk=$1 and payments_finalized_at is not null)$$;
create temp table n(k int primary key);grant all on n to authenticated;
create function pg_temp.ref(prefix text) returns text language plpgsql as $$declare c int;begin insert into n select coalesce(max(k),0)+1 from n; select max(k) into c from n; return prefix||c;end$$;


create function pg_temp.red(stmt text,label text) returns void language plpgsql as $$
declare msg text;begin
 begin execute stmt;exception when others then msg:=sqlerrm;end;
 if msg is null then raise notice 'DM_RED_ACCEPTED %',label; else raise notice 'DM_RED_REFUSED % (%)',label,msg;end if;end$$;
-- ── 4. KLINIK ──
create function pg_temp.inv(uid int,subtotal numeric,discount numeric,manual numeric default null,voucher text default null) returns jsonb language sql as $$
 select jsonb_build_object('tanggal',current_date::text,'subtotal',subtotal,'discount',discount,'tax',0,'total',subtotal-discount,'dp_amount',0,'dp_date',null,
  'paid_status','Belum Lunas','metode_bayar','Tunai','shift_id',('dd60000'||uid||'-0000-4000-8000-000000000002'),'voucher_code',voucher,'salesperson_id',null)
  ||case when manual is null then '{}'::jsonb else jsonb_build_object('manual_discount',manual) end$$;
create function pg_temp.line(price numeric,pct numeric default 0,item text default 'dd400000-0000-4000-8000-000000000001',qty int default 1,kind text default 'jasa') returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object('description','DM baris','qty',qty,'price',price,'kind',kind,'item_id',item,'discount_percent',pct))$$;
create function pg_temp.post(uid int,vis int,key text,inv jsonb,lines jsonb) returns uuid language plpgsql as $$
begin perform pg_temp.as_(('dd10000'||'0-0000-4000-8000-00000000000'||uid)); return clinic_post_invoice(('dd83'||lpad(vis::text,4,'0')||'-0000-4000-8000-000000000001')::uuid,key,inv,lines);end$$;

-- Production: semua ADMIN sudah punya kebijakan tersimpan (tanpa izin diskon manual)
select pg_temp.setpol('ADMIN',array['klinik.batalkan_penerimaan']);
select pg_temp.red($q$select pg_temp.sale('R-S1',4,pg_temp.svc(),10000)$q$,'petshop STAFF: diskon nota 10.000 (kasir)');
select pg_temp.red($q$select pg_temp.sale('R-S2',4,pg_temp.svc(100000,1,'{"itype":"percent","ival":10}'),10000)$q$,'petshop STAFF: diskon baris persen 10%');
select pg_temp.red($q$select pg_temp.sale('R-D1',5,pg_temp.svc(),10000)$q$,'petshop DOCTOR: diskon nota 10.000');
select pg_temp.red($q$select pg_temp.sale('R-A1',2,pg_temp.svc(),10000)$q$,'petshop ADMIN: diskon nota 10.000');
select pg_temp.red($q$select pg_temp.sale('R-F1',3,pg_temp.svc(),10000)$q$,'petshop FINANCE: diskon nota 10.000');
select pg_temp.red($q$select pg_temp.sale('R-S3',4,pg_temp.svc(),10000,0,0)$q$,'petshop STAFF: diskon nota TANPA label manual (klien lama / dimodifikasi)');
select pg_temp.red($q$select pg_temp.post(4,10,'r-k1',pg_temp.inv(4,100000,10000,10000),pg_temp.line(100000))$q$,'klinik STAFF: diskon nota 10.000');
select pg_temp.red($q$select pg_temp.post(5,11,'r-k2',pg_temp.inv(5,90000,0,0),pg_temp.line(100000,10))$q$,'klinik DOCTOR: diskon baris 10%');
select pg_temp.red($q$select pg_temp.post(2,12,'r-k3',pg_temp.inv(2,100000,10000),pg_temp.line(100000))$q$,'klinik ADMIN: diskon nota tanpa dasar');
rollback;
