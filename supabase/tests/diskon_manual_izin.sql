-- Diskon manual = izin khusus (migrasi 20261116100000): fictional fixtures in disposable PostgreSQL only; everything rolls back.
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
insert into items(id,code,name,unit,item_type,buy_price,sell_price,default_discount) values('dd400000-0000-4000-8000-000000000005','DMDEF','DM jasa diskon bawaan','pcs','Jasa',0,100000,10);
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
set constraints all immediate;
alter table promos disable trigger user;
insert into promos(id,name,promo_type,rule,is_active,auto_apply,discount_type,discount_value,valid_until,branch_ids) values
 ('dd700000-0000-4000-8000-000000000003','DM promo nonaktif','diskon_produk','{}',false,true,'nominal',8000,null,null),
 ('dd700000-0000-4000-8000-000000000004','DM promo kedaluwarsa','diskon_produk','{}',true,true,'nominal',6000,current_date-1,null),
 ('dd700000-0000-4000-8000-000000000005','DM promo cabang lain','diskon_produk','{}',true,true,'nominal',7000,null,array['dd200000-0000-4000-8000-000000000002']::uuid[]);
set constraints all immediate;
alter table promos enable trigger user;
insert into promo_items(promo_id,item_id) select id,'dd400000-0000-4000-8000-000000000001' from promos where id in('dd700000-0000-4000-8000-000000000003','dd700000-0000-4000-8000-000000000004','dd700000-0000-4000-8000-000000000005');
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
 insert into sales(branch_id,customer_id,no_struk,subtotal,discount,diskon_kategori,manual_discount,total,metode_bayar,bayar,kembali,poin_earned,poin_digunakan,voucher_code,channel,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint)
  values('dd200000-0000-4000-8000-000000000001',cust,ref,sub,disc,kat,manual,tot,'Tunai',tot,0,0,poin,vcode,chan,u::uuid,sh,jsonb_build_array(jsonb_build_object('method','Tunai','amount',tot)),'k:'||ref,repeat('a',64)) returning id into doc;
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

-- ── 0. katalog + fungsi izin ──
select pg_temp.ok((select count(*)=1 from role_settings_private.action_catalog where id='kasir.diskon_manual' and enforced),'katalog: izin kasir.diskon_manual (migrasi 20261112072724) enforced');
select pg_temp.ok((select count(*)=0 from role_settings_private.action_policies where 'kasir.diskon_manual'=any(allowed)),'bawaan: tidak ada kebijakan tersimpan yang memuatnya');
select pg_temp.as_('dd100000-0000-4000-8000-000000000001');
select pg_temp.ok(manual_discount_allowed(),'OWNER selalu boleh');
select pg_temp.as_('dd100000-0000-4000-8000-000000000004');
select pg_temp.ok(not manual_discount_allowed(),'STAFF tidak boleh (bawaan)');
select pg_temp.as_('dd100000-0000-4000-8000-000000000005');
select pg_temp.ok(not manual_discount_allowed(),'DOCTOR tidak boleh (bawaan)');
select pg_temp.as_('dd100000-0000-4000-8000-000000000002');
select pg_temp.ok(manual_discount_allowed(),'ADMIN TANPA kebijakan tersimpan: bawaan live (20261112072724) boleh; di Production semua ADMIN sudah punya kebijakan tersimpan');
select pg_temp.setpol('ADMIN',array['klinik.batalkan_penerimaan']);
select pg_temp.as_('dd100000-0000-4000-8000-000000000002');
select pg_temp.ok(not manual_discount_allowed(),'ADMIN dengan kebijakan tersimpan tanpa izin ini: tidak boleh sampai Owner mencentang');
select pg_temp.as_('dd100000-0000-4000-8000-000000000003');
select pg_temp.ok(not manual_discount_allowed(),'FINANCE tidak boleh (bawaan)');
select pg_temp.anon();
select pg_temp.ok(not manual_discount_allowed(),'tanpa pengguna: ditolak');

-- ── 1. PETSHOP: STAFF ──
select pg_temp.accept($q$select pg_temp.sale('DM-S0',4,pg_temp.svc(),0)$q$,'STAFF: struk tanpa diskon tetap jalan');
select pg_temp.ok(pg_temp.settle('DM-S0'),'STAFF: struk tanpa diskon final');
select pg_temp.reject($q$select pg_temp.sale('DM-S1',4,pg_temp.svc(),10000,0,10000)$q$,'Anda tidak punya izin memberi diskon manual. Minta Owner mengaktifkannya di Pengaturan > Akses Grup.','STAFF: diskon nota ketikan (kolom manual) ditolak');
select pg_temp.reject($q$select pg_temp.sale('DM-S1b',4,pg_temp.svc(),0,0,0.01)$q$,'Anda tidak punya izin memberi diskon manual.','STAFF: batas 0,01 pada kolom manual ditolak');
select pg_temp.reject($q$select pg_temp.sale('DM-S2',4,pg_temp.svc(),10000,0,0)$q$,'Diskon melebihi yang bisa dibenarkan promo, voucher, golongan, atau poin.','STAFF: klien memalsukan label (manual=0, diskon 10.000 tanpa sumber) ditolak oleh database');
select pg_temp.reject($q$select pg_temp.sale('DM-S3',4,pg_temp.svc(100000,1,'{"promo_discount":10000}'),10000,0,0)$q$,'Diskon melebihi yang bisa dibenarkan','STAFF: potongan promo karangan (tanpa promo) ditolak');
select pg_temp.reject($q$select pg_temp.sale('DM-S4',4,pg_temp.svc(100000,1,'{"promo_discount":10000,"promo_id":"dd700000-0000-4000-8000-000000000001"}'),10000,0,0)$q$,'Diskon melebihi yang bisa dibenarkan','STAFF: promo asli tetapi barangnya bukan sasaran promo ditolak');
select pg_temp.reject($q$select pg_temp.sale('DM-S5',4,pg_temp.svc(100000,1,'{"itype":"percent","ival":10}'),10000,0,0)$q$,'Anda tidak punya izin memberi diskon manual.','STAFF: diskon baris persen ditolak (pada baris)');
select pg_temp.reject($q$select pg_temp.sale('DM-S5b',4,pg_temp.svc(100000,1,'{"itype":"nominal","ival":0.01}'),0,0,0)$q$,'Anda tidak punya izin memberi diskon manual.','STAFF: diskon baris nominal 0,01 ditolak');
select pg_temp.accept($q$select pg_temp.sale('DM-S5c',4,pg_temp.svc(100000,1,'{"itype":"percent","ival":0}'),0,0,0)$q$,'STAFF: baris dengan nilai diskon 0 tidak dihitung diskon manual');
-- diskon bawaan barang dari master (persen, nilainya sama dengan master) bukan diskon manual
select pg_temp.accept($q$select pg_temp.sale('DM-B1',4,jsonb_build_array(jsonb_build_object('item','dd400000-0000-4000-8000-000000000005','qty',1,'harga',100000,'itype','percent','ival',10)),10000)$q$,'STAFF: diskon bawaan barang dari master (10% = master) tetap jalan');
select pg_temp.reject($q$select pg_temp.sale('DM-B2',4,jsonb_build_array(jsonb_build_object('item','dd400000-0000-4000-8000-000000000005','qty',1,'harga',100000,'itype','percent','ival',11)),11000)$q$,'Anda tidak punya izin memberi diskon manual.','STAFF: diskon baris persen di atas master ditolak');
select pg_temp.reject($q$select pg_temp.sale('DM-B3',4,jsonb_build_array(jsonb_build_object('item','dd400000-0000-4000-8000-000000000005','qty',1,'harga',100000,'itype','nominal','ival',10)),10)$q$,'Anda tidak punya izin memberi diskon manual.','STAFF: diskon baris nominal pada barang ber-diskon-bawaan ditolak (bukan persen master)');
select pg_temp.reject($q$select pg_temp.sale('DM-B4',4,jsonb_build_array(jsonb_build_object('item','dd400000-0000-4000-8000-000000000005','qty',1,'harga',100000,'itype','percent','ival',10)),20000)$q$,'Diskon melebihi yang bisa dibenarkan','STAFF: diskon bawaan sah + diskon nota ketikan ditolak (menumpuk)');
select pg_temp.reject($q$select pg_temp.sale('DM-B5',4,jsonb_build_array(jsonb_build_object('item','dd400000-0000-4000-8000-000000000001','qty',1,'harga',100000,'itype','percent','ival',10)),10000)$q$,'Anda tidak punya izin memberi diskon manual.','STAFF: diskon 10% pada barang TANPA diskon bawaan di master ditolak');
-- sah: promo nominal (2 unit x 5.000), batas
select pg_temp.accept($q$select pg_temp.sale('DM-P1',4,jsonb_build_array(jsonb_build_object('item','dd400000-0000-4000-8000-000000000002','qty',2,'harga',50000,'promo_id','dd700000-0000-4000-8000-000000000001','promo_discount',10000)),10000)$q$,'STAFF: promo master nominal sah tetap jalan');
select pg_temp.accept($q$select pg_temp.sale('DM-P2',4,jsonb_build_array(jsonb_build_object('item','dd400000-0000-4000-8000-000000000003','qty',1,'harga',100000,'promo_id','dd700000-0000-4000-8000-000000000002','promo_discount',10000)),10000)$q$,'STAFF: promo master persen sah tetap jalan');
select pg_temp.reject($q$select pg_temp.sale('DM-P3',4,jsonb_build_array(jsonb_build_object('item','dd400000-0000-4000-8000-000000000002','qty',2,'harga',50000,'promo_id','dd700000-0000-4000-8000-000000000001','promo_discount',10003)),10003)$q$,'Diskon melebihi yang bisa dibenarkan','STAFF: promo di atas batas master (+toleransi pembulatan) ditolak');
select pg_temp.reject($q$select pg_temp.sale('DM-P4',4,jsonb_build_array(jsonb_build_object('item','dd400000-0000-4000-8000-000000000002','qty',2,'harga',50000,'promo_id','dd700000-0000-4000-8000-000000000001','promo_discount',10000)),20000)$q$,'Diskon melebihi yang bisa dibenarkan','STAFF: promo sah ditambah diskon ketikan di nota (menumpuk) ditolak');
-- voucher
select pg_temp.accept($q$select pg_temp.sale('DM-V1',4,pg_temp.svc(),10000,0,0,'DMV10')$q$,'STAFF: voucher persen 10% sah tetap jalan');
select pg_temp.accept($q$select pg_temp.sale('DM-V2',4,pg_temp.svc(),7000,0,0,'DMVN')$q$,'STAFF: voucher nominal sah tetap jalan');
select pg_temp.reject($q$select pg_temp.sale('DM-V3',4,pg_temp.svc(),30000,0,0,'DMV10')$q$,'Diskon melebihi yang bisa dibenarkan','STAFF: voucher dipakai untuk menutupi diskon di atas nilainya ditolak');
-- golongan
select pg_temp.accept($q$select pg_temp.sale('DM-G1',4,pg_temp.svc(),0,10000,0,null,0,'dd810000-0000-4000-8000-000000000001')$q$,'STAFF: diskon golongan 10% sah tetap jalan');
select pg_temp.reject($q$select pg_temp.sale('DM-G2',4,pg_temp.svc(),0,20000,0,null,0,'dd810000-0000-4000-8000-000000000001')$q$,'Diskon melebihi yang bisa dibenarkan','STAFF: diskon golongan di atas persen master ditolak');
select pg_temp.reject($q$select pg_temp.sale('DM-G3',4,pg_temp.svc(),0,10000,0,null,0,'dd810000-0000-4000-8000-000000000002')$q$,'Diskon melebihi yang bisa dibenarkan','STAFF: diskon golongan untuk pelanggan tanpa golongan ditolak');
-- poin (1 poin = Rp1)
select pg_temp.accept($q$select pg_temp.sale('DM-T1',4,pg_temp.svc(),5000,0,0,null,5000,'dd810000-0000-4000-8000-000000000001')$q$,'STAFF: penukaran poin sah tetap jalan');
select pg_temp.reject($q$select pg_temp.sale('DM-T2',4,pg_temp.svc(),8000,0,0,null,5000,'dd810000-0000-4000-8000-000000000001')$q$,'Diskon melebihi yang bisa dibenarkan','STAFF: potongan di atas poin yang ditukar ditolak');
-- DOCTOR sama
select pg_temp.reject($q$select pg_temp.sale('DM-D1',5,pg_temp.svc(),10000,0,10000)$q$,'Anda tidak punya izin memberi diskon manual.','DOCTOR: diskon manual ditolak');
select pg_temp.accept($q$select pg_temp.sale('DM-D2',5,pg_temp.svc(),0)$q$,'DOCTOR: struk tanpa diskon tetap jalan');
-- marketplace (potongan platform): tidak diperiksa
-- struk marketplace: potongan platform, bukan diskon kasir. Ditanam tanpa trigger lain (impor marketplace punya jalurnya sendiri), lalu STAFF menambah baris berdiskon.
alter table sales disable trigger user;
insert into sales(id,branch_id,no_struk,channel,subtotal,discount,total,metode_bayar,bayar,kembali,cashier_id,checkout_key,checkout_fingerprint)
 values('dd900000-0000-4000-8000-000000000001','dd200000-0000-4000-8000-000000000001','DM-M1','Shopee',100000,15000,85000,'Tunai',85000,0,'dd100000-0000-4000-8000-000000000004','k:m1',repeat('a',64));
alter table sales enable trigger user;
select pg_temp.as_('dd100000-0000-4000-8000-000000000004');
select pg_temp.accept($q$insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp,item_discount_type,item_discount_value) values('dd900000-0000-4000-8000-000000000001','dd400000-0000-4000-8000-000000000001','x',1,100000,'pcs',1,0,'nominal',5000)$q$,'STAFF: baris berdiskon pada struk marketplace tidak dihalangi');
select pg_temp.accept($q$update sales set manual_discount=5000 where id='dd900000-0000-4000-8000-000000000001'$q$,'STAFF: struk marketplace: kolom diskon tidak dihalangi');
select pg_temp.reject($q$insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp,item_discount_type,item_discount_value) select id,'dd400000-0000-4000-8000-000000000001','x',1,100000,'pcs',1,0,'nominal',5000 from sales where no_struk='DM-S0'$q$,'Anda tidak punya izin memberi diskon manual.','pembanding: baris berdiskon pada struk kasir biasa tetap ditolak');

alter table sales disable trigger user;
insert into sales(id,branch_id,no_struk,channel,subtotal,discount,total,metode_bayar,bayar,kembali,cashier_id,payment_plan,checkout_key,checkout_fingerprint)
 values('dd900000-0000-4000-8000-000000000003','dd200000-0000-4000-8000-000000000001','DM-M4','Shopee',100000,0,100000,'Tunai',100000,0,'dd100000-0000-4000-8000-000000000004','[{"method":"Tunai","amount":100000}]','k:m4',repeat('a',64));
alter table sales enable trigger user;
select pg_temp.as_('dd100000-0000-4000-8000-000000000004');
select pg_temp.reject($q$insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp,item_discount_type,item_discount_value) values('dd900000-0000-4000-8000-000000000003','dd400000-0000-4000-8000-000000000001','x',1,100000,'pcs',1,0,'nominal',5000)$q$,'Anda tidak punya izin memberi diskon manual.','STAFF: baris berdiskon pada sale berlabel marketplace TETAPI membawa rencana pembayaran POS: ditolak (label tidak membebaskan)');
select pg_temp.reject($q$update sales set manual_discount=5000 where id='dd900000-0000-4000-8000-000000000003'$q$,'Anda tidak punya izin memberi diskon manual.','STAFF: kolom diskon pada sale berlabel marketplace dengan rencana POS: ditolak');
select pg_temp.reject($q$select pg_temp.sale('DM-M2',4,pg_temp.svc(),10000,0,0,null,0,null,'Shopee')$q$,'','STAFF: label marketplace pada struk POS (ada rencana pembayaran) tidak membebaskan diskon (ditolak; finalisasi POS menolak label channel, penjaga diskon juga tidak membebaskan)');
select pg_temp.reject($q$select pg_temp.sale('DM-M3',4,pg_temp.svc(100000,1,'{"itype":"percent","ival":10}'),10000,0,0,null,0,null,'WA')$q$,'','STAFF: label WA pada struk POS tidak membebaskan diskon baris (ditolak)');
select pg_temp.reject($q$select pg_temp.sale('DM-X1',4,pg_temp.svc(),8000)$q$,'Diskon melebihi yang bisa dibenarkan','STAFF: promo NONAKTIF tidak membenarkan diskon');
select pg_temp.reject($q$select pg_temp.sale('DM-X2',4,pg_temp.svc(),6000)$q$,'Diskon melebihi yang bisa dibenarkan','STAFF: promo KEDALUWARSA tidak membenarkan diskon');
select pg_temp.reject($q$select pg_temp.sale('DM-X3',4,pg_temp.svc(),7000)$q$,'Diskon melebihi yang bisa dibenarkan','STAFF: promo untuk CABANG LAIN tidak membenarkan diskon');
-- baris berdiskon disisipkan lewat jalur sistem (tanpa pengguna), lalu STAFF memfinalkan: pemeriksaan penuh saat finalisasi tetap menolak
create function pg_temp.late(ref text) returns void language plpgsql as $$ declare doc uuid;begin
 perform pg_temp.as_('dd100000-0000-4000-8000-000000000004');
 insert into sales(branch_id,no_struk,subtotal,discount,total,metode_bayar,bayar,kembali,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint)
  values('dd200000-0000-4000-8000-000000000001',ref,100000,0,100000,'Tunai',100000,0,'dd100000-0000-4000-8000-000000000004','dd600004-0000-4000-8000-000000000001','[{"method":"Tunai","amount":100000}]','k:'||ref,repeat('a',64)) returning id into doc;
 perform pg_temp.anon();
 insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp,item_discount_type,item_discount_value) values(doc,'dd400000-0000-4000-8000-000000000001','x',1,100000,'pcs',1,0,'nominal',5000);
 perform pg_temp.as_('dd100000-0000-4000-8000-000000000004');
 perform finalize_pos_sale(doc);end$$;
select pg_temp.reject($q$select pg_temp.late('DM-LATE')$q$,'Anda tidak punya izin memberi diskon manual.','STAFF memfinalkan struk yang barisnya berdiskon (disisipkan jalur sistem): ditolak saat finalisasi');

-- ── 2. PETSHOP: ADMIN/FINANCE menunggu izin, OWNER selalu ──
select pg_temp.reject($q$select pg_temp.sale('DM-A1',2,pg_temp.svc(),10000,0,10000)$q$,'Anda tidak punya izin memberi diskon manual.','ADMIN: ditolak sebelum dicentang');
select pg_temp.reject($q$select pg_temp.sale('DM-F1',3,pg_temp.svc(),10000,0,10000)$q$,'Anda tidak punya izin memberi diskon manual.','FINANCE: ditolak sebelum dicentang');
select pg_temp.setpol('ADMIN',array['kasir.diskon_manual']);
select pg_temp.accept($q$select pg_temp.sale('DM-A3',2,pg_temp.svc(),10000,0,10000)$q$,'ADMIN setelah dicentang: diskon manual nota boleh');
select pg_temp.accept($q$select pg_temp.sale('DM-A4',2,pg_temp.svc(100000,1,'{"itype":"percent","ival":10}'),10000,0,0)$q$,'ADMIN setelah dicentang: diskon baris boleh');
select pg_temp.accept($q$select pg_temp.sale('DM-A5',2,pg_temp.svc(),10000,0,0)$q$,'ADMIN setelah dicentang: diskon tanpa label pun boleh');
select pg_temp.as_('dd100000-0000-4000-8000-000000000002');
select pg_temp.ok(manual_discount_allowed(),'ADMIN: boleh sesudah dicentang');
select pg_temp.setpol('ADMIN',array['klinik.batalkan_penerimaan']);
select pg_temp.reject($q$select pg_temp.sale('DM-A6',2,pg_temp.svc(),10000,0,10000)$q$,'Anda tidak punya izin memberi diskon manual.','ADMIN setelah izin dicabut: ditolak lagi');
select pg_temp.accept($q$select pg_temp.sale('DM-O1',1,pg_temp.svc(),10000,0,10000)$q$,'OWNER: diskon manual nota boleh');
select pg_temp.accept($q$select pg_temp.sale('DM-O2',1,pg_temp.svc(100000,1,'{"itype":"percent","ival":10}'),10000,0,0)$q$,'OWNER: diskon baris boleh');
select pg_temp.accept($q$select pg_temp.sale('DM-O3',1,pg_temp.svc(),99999,0,99999)$q$,'OWNER: tidak dibatasi master');
-- tabel kebijakan galat/hilang: OWNER tetap boleh; peran lain gagal-tertutup
alter table role_settings_private.action_policies rename to action_policies_x;
select pg_temp.accept($q$select pg_temp.sale('DM-O4',1,pg_temp.svc(),10000,0,10000)$q$,'OWNER: tabel kebijakan hilang tidak mengunci Owner');
select pg_temp.reject($q$select pg_temp.sale('DM-A7',2,pg_temp.svc(),10000,0,10000)$q$,'Anda tidak punya izin memberi diskon manual.','ADMIN: tabel kebijakan hilang = ditolak (gagal tertutup)');
select pg_temp.as_('dd100000-0000-4000-8000-000000000001');
select pg_temp.ok(manual_discount_allowed(),'OWNER: fungsi izin tidak membaca tabel kebijakan');
alter table role_settings_private.action_policies_x rename to action_policies;
-- tanpa pengguna (SQL editor / tugas sistem) dan nonaktif
select pg_temp.as_('dd100000-0000-4000-8000-000000000004');
insert into sales(id,branch_id,no_struk,subtotal,discount,total,metode_bayar,bayar,kembali,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint)
 values('dd900000-0000-4000-8000-000000000002','dd200000-0000-4000-8000-000000000001','DM-PEND',100000,0,100000,'Tunai',100000,0,'dd100000-0000-4000-8000-000000000004','dd600004-0000-4000-8000-000000000001','[{"method":"Tunai","amount":100000}]','k:pend',repeat('a',64));
select pg_temp.anon();
select pg_temp.accept($q$insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp,item_discount_type,item_discount_value) values('dd900000-0000-4000-8000-000000000002','dd400000-0000-4000-8000-000000000001','x',1,100000,'pcs',1,0,'nominal',5000)$q$,'tanpa pengguna (SQL editor/tugas sistem): tidak diperiksa');
select pg_temp.as_('dd100000-0000-4000-8000-000000000004');
select pg_temp.reject($q$update sale_items set item_discount_value=7000 where sale_id='dd900000-0000-4000-8000-000000000002'$q$,'Anda tidak punya izin memberi diskon manual.','STAFF: mengubah nilai diskon baris pada struk belum final ditolak');
select pg_temp.accept($q$update sale_items set item_discount_value=5000 where sale_id='dd900000-0000-4000-8000-000000000002'$q$,'STAFF: UPDATE tanpa mengubah nilai diskon baris tidak dihitung');
update profiles set is_active=false where id='dd100000-0000-4000-8000-000000000001';
select pg_temp.as_('dd100000-0000-4000-8000-000000000001');
select pg_temp.ok(not manual_discount_allowed(),'OWNER nonaktif: ditolak');
update profiles set is_active=true where id='dd100000-0000-4000-8000-000000000001';

-- ── 3. jejak: kolom manual_discount terekam, pelaku ada di dokumen ──
select pg_temp.ok((select manual_discount=10000 and cashier_id='dd100000-0000-4000-8000-000000000001' from sales where no_struk='DM-O1'),'jejak: nilai diskon manual dan kasir tercatat di struk');
select pg_temp.ok((select manual_discount=0 from sales where no_struk='DM-P1'),'jejak: struk promo tidak bertanda diskon manual');

-- ── 4. KLINIK ──
create function pg_temp.inv(uid int,subtotal numeric,discount numeric,manual numeric default null,voucher text default null) returns jsonb language sql as $$
 select jsonb_build_object('tanggal',current_date::text,'subtotal',subtotal,'discount',discount,'tax',0,'total',subtotal-discount,'dp_amount',0,'dp_date',null,
  'paid_status','Belum Lunas','metode_bayar','Tunai','shift_id',('dd60000'||uid||'-0000-4000-8000-000000000002'),'voucher_code',voucher,'salesperson_id',null)
  ||case when manual is null then '{}'::jsonb else jsonb_build_object('manual_discount',manual) end$$;
create function pg_temp.line(price numeric,pct numeric default 0,item text default 'dd400000-0000-4000-8000-000000000001',qty int default 1,kind text default 'jasa') returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object('description','DM baris','qty',qty,'price',price,'kind',kind,'item_id',item,'discount_percent',pct))$$;
create function pg_temp.post(uid int,vis int,key text,inv jsonb,lines jsonb) returns uuid language plpgsql as $$
begin perform pg_temp.as_(('dd10000'||'0-0000-4000-8000-00000000000'||uid)); return clinic_post_invoice(('dd83'||lpad(vis::text,4,'0')||'-0000-4000-8000-000000000001')::uuid,key,inv,lines);end$$;
select pg_temp.accept($q$select pg_temp.post(4,1,'dm-k0',pg_temp.inv(4,100000,0,0),pg_temp.line(100000))$q$,'klinik STAFF: tagihan tanpa diskon tetap jalan (kunci manual 0)');
select pg_temp.reject($q$select pg_temp.post(4,2,'dm-k1',pg_temp.inv(4,100000,10000,10000),pg_temp.line(100000))$q$,'Anda tidak punya izin memberi diskon manual.','klinik STAFF: diskon nota ketikan ditolak');
select pg_temp.reject($q$select pg_temp.post(5,2,'dm-k1d',pg_temp.inv(5,100000,10000,10000),pg_temp.line(100000))$q$,'Anda tidak punya izin memberi diskon manual.','klinik DOCTOR: diskon nota ketikan ditolak');
select pg_temp.reject($q$select pg_temp.post(4,2,'dm-k2',pg_temp.inv(4,90000,0,0),pg_temp.line(100000,10))$q$,'Anda tidak punya izin memberi diskon manual.','klinik STAFF: diskon baris persen ditolak');
select pg_temp.reject($q$select pg_temp.post(4,2,'dm-k2b',pg_temp.inv(4,99900,0,0),pg_temp.line(100000,0.1))$q$,'Anda tidak punya izin memberi diskon manual.','klinik STAFF: diskon baris 0,1% ditolak');
select pg_temp.accept($q$select pg_temp.post(4,2,'dm-k2c',pg_temp.inv(4,100000,0,0),pg_temp.line(100000,0))$q$,'klinik STAFF: baris dengan diskon 0 tidak dihitung diskon manual');
select pg_temp.reject($q$select pg_temp.post(4,10,'dm-k3',pg_temp.inv(4,100000,10000,0),pg_temp.line(100000))$q$,'Diskon melebihi yang bisa dibenarkan','klinik STAFF: label dipalsukan (manual 0, diskon 10.000 tanpa sumber) ditolak');
select pg_temp.reject($q$select pg_temp.post(4,11,'dm-k4',pg_temp.inv(4,100000,10000),pg_temp.line(100000))$q$,'Diskon melebihi yang bisa dibenarkan','klinik STAFF: klien lama tanpa kunci manual, diskon tak berdasar ditolak');
-- sah: promo/voucher/golongan/poin (pelanggan kunjungan punya golongan 10% dan 10.000 poin)
select pg_temp.accept($q$select pg_temp.post(4,3,'dm-kp',pg_temp.inv(4,100000,5000,0),jsonb_build_array(jsonb_build_object('description','promo','qty',1,'price',100000,'kind','jasa','item_id','dd400000-0000-4000-8000-000000000002','discount_percent',0,'promo_discount',5000)))$q$,'klinik STAFF: promo master sah tetap jalan');
select pg_temp.accept($q$select pg_temp.post(4,4,'dm-kv',pg_temp.inv(4,100000,10000,0,'DMV10'),pg_temp.line(100000))$q$,'klinik STAFF: voucher sah tetap jalan');
select pg_temp.accept($q$select pg_temp.post(4,5,'dm-kg',pg_temp.inv(4,100000,10000,0),pg_temp.line(100000))$q$,'klinik STAFF: diskon golongan sah tetap jalan (golongan 10%)');
select pg_temp.reject($q$select pg_temp.post(4,6,'dm-kgx',pg_temp.inv(4,100000,60000,0),pg_temp.line(100000))$q$,'Diskon melebihi yang bisa dibenarkan','klinik STAFF: di atas golongan + poin yang mungkin... (golongan 10.000 + poin 10.000 = 20.000) ditolak');
-- ADMIN
select pg_temp.reject($q$select pg_temp.post(2,7,'dm-ka1',pg_temp.inv(2,100000,10000,10000),pg_temp.line(100000))$q$,'Anda tidak punya izin memberi diskon manual.','klinik ADMIN: ditolak sebelum dicentang');
select pg_temp.setpol('ADMIN',array['kasir.diskon_manual']);
select pg_temp.accept($q$select pg_temp.post(2,7,'dm-ka3',pg_temp.inv(2,100000,10000,10000),pg_temp.line(100000))$q$,'klinik ADMIN setelah dicentang: diskon nota manual boleh');
select pg_temp.accept($q$select pg_temp.post(2,8,'dm-ka4',pg_temp.inv(2,90000,0,0),pg_temp.line(100000,10))$q$,'klinik ADMIN setelah dicentang: diskon baris boleh');
select pg_temp.ok((select manual_discount=10000 from invoices where request_key='dm-ka3'),'jejak klinik: manual_discount tercatat pada tagihan');
-- id katalog yang tidak lagi berlaku (enforced=false) tidak memberi izin walau tertulis di kebijakan
create function pg_temp.enf(v boolean) returns void language plpgsql as $$ declare ps text:=current_setting('request.jwt.claim.sub',true);pc text:=current_setting('request.jwt.claims',true);begin
 perform pg_temp.anon();update role_settings_private.action_catalog set enforced=v where id='kasir.diskon_manual';
 perform set_config('request.jwt.claim.sub',coalesce(ps,''),true);perform set_config('request.jwt.claims',coalesce(pc,''),true);end$$;
select pg_temp.enf(false);
select pg_temp.reject($q$select pg_temp.post(2,9,'dm-ka5',pg_temp.inv(2,100000,10000,10000),pg_temp.line(100000))$q$,'Anda tidak punya izin memberi diskon manual.','klinik ADMIN: id katalog tidak enforced = tidak memberi izin walau tertulis');
select pg_temp.enf(true);
select pg_temp.setpol('ADMIN',array['klinik.batalkan_penerimaan']);
-- OWNER
select pg_temp.accept($q$select pg_temp.post(1,10,'dm-ko1',pg_temp.inv(1,90000,30000,30000),pg_temp.line(100000,10))$q$,'klinik OWNER: diskon nota dan baris boleh');
select pg_temp.reject($q$select pg_temp.post(1,11,'dm-ko2',pg_temp.inv(1,100000,10000,20000),pg_temp.line(100000))$q$,'INVOICE_INVALID: diskon manual tidak valid','klinik OWNER: kunci manual lebih besar dari diskon = tidak valid (semua peran)');
select pg_temp.reject($q$select pg_temp.post(1,11,'dm-ko3',pg_temp.inv(1,100000,10000,-1),pg_temp.line(100000))$q$,'INVOICE_INVALID: diskon manual tidak valid','klinik OWNER: kunci manual negatif = tidak valid');
alter table role_settings_private.action_policies rename to action_policies_x;
select pg_temp.accept($q$select pg_temp.post(1,12,'dm-ko4',pg_temp.inv(1,100000,0,0),pg_temp.line(100000))$q$,'klinik OWNER: tabel kebijakan hilang tidak mengunci Owner (tagihan 2, kunjungan sama diperbolehkan lewat tahap)');
alter table role_settings_private.action_policies_x rename to action_policies;

-- ── 5. koreksi tagihan: diskon manual tidak boleh naik oleh peran tanpa izin ──
create function pg_temp.edit(uid int,inv uuid,key text,hdr jsonb,lines jsonb) returns uuid language plpgsql as $$
begin perform pg_temp.as_(('dd10000'||'0-0000-4000-8000-00000000000'||uid)); return clinic_edit_invoice(inv,key,hdr,lines);end$$;
create function pg_temp.edithdr(subtotal numeric,discount numeric,manual numeric default null) returns jsonb language sql as $$
 select jsonb_build_object('subtotal',subtotal,'discount',discount,'tax',0,'total',subtotal-discount,'dp_amount',0,'paid_status','Belum Lunas','metode_bayar','Tunai','voucher_code',null,'reason','koreksi uji')
  ||case when manual is null then '{}'::jsonb else jsonb_build_object('manual_discount',manual) end$$;
select pg_temp.ok((select id from invoices where request_key='dm-ko1') is not null,'koreksi: tagihan OWNER ber-diskon manual ada');
-- STAFF mengoreksi tagihan yang sudah ada diskon manual dari Owner: tidak boleh naik, boleh tetap/turun
select pg_temp.accept($q$select pg_temp.edit(4,(select id from invoices where request_key='dm-ko1'),'dm-e1',pg_temp.edithdr(90000,30000,30000),pg_temp.line(100000,10))$q$,'koreksi: STAFF boleh menyimpan ulang tagihan dengan diskon manual Owner TANPA perubahan');
select pg_temp.reject($q$select pg_temp.edit(4,(select id from invoices where request_key='dm-ko1'),'dm-e2',pg_temp.edithdr(80000,40000,40000),pg_temp.line(100000,20))$q$,'Anda tidak punya izin memberi diskon manual.','koreksi: STAFF tidak boleh menaikkan diskon baris');
select pg_temp.reject($q$select pg_temp.edit(4,(select id from invoices where request_key='dm-ko1'),'dm-e3',pg_temp.edithdr(90000,40000,40000),pg_temp.line(100000,10))$q$,'Anda tidak punya izin memberi diskon manual.','koreksi: STAFF tidak boleh menaikkan diskon nota manual');
select pg_temp.reject($q$select pg_temp.edit(4,(select id from invoices where request_key='dm-ko1'),'dm-e4',pg_temp.edithdr(90000,40000),pg_temp.line(100000,10))$q$,'Diskon melebihi yang bisa dibenarkan','koreksi: klien lama tanpa kunci menaikkan diskon tanpa dasar ditolak');
select pg_temp.accept($q$select pg_temp.edit(4,(select id from invoices where request_key='dm-ko1'),'dm-e5',pg_temp.edithdr(100000,0,0),pg_temp.line(100000,0))$q$,'koreksi: STAFF boleh MENURUNKAN diskon manual sampai nol');
select pg_temp.ok((select manual_discount=0 from invoices where request_key='dm-ko1'),'koreksi: kolom manual ikut turun');
select pg_temp.accept($q$select pg_temp.edit(1,(select id from invoices where request_key='dm-ko1'),'dm-e6',pg_temp.edithdr(80000,30000,30000),pg_temp.line(100000,20))$q$,'koreksi: OWNER boleh menaikkan');
select pg_temp.ok((select manual_discount=30000 from invoices where request_key='dm-ko1'),'koreksi: kolom manual tercatat oleh Owner');
select pg_temp.accept($q$select pg_temp.edit(4,(select id from invoices where request_key='dm-ko1'),'dm-e7',pg_temp.edithdr(80000,30001.5),pg_temp.line(100000,20))$q$,'koreksi: klien lama tanpa kunci; diskon Owner yang sudah ada tetap dibenarkan (selisih pembulatan 1,5 dalam toleransi)');

-- ── 6. tagihan terbit ulang membawa kolom jejak (definisi fungsi; terbit ulang butuh tagihan lunas, dibuktikan di suite pembayaran klinik) ──
select pg_temp.ok(position('created_at,manual_discount)' in pg_get_functiondef('public.clinic_void_reissue_invoice_core(uuid,text,text)'::regprocedure))>0
 and position('v_invoice.manual_discount)' in pg_get_functiondef('public.clinic_void_reissue_invoice_core(uuid,text,text)'::regprocedure))>0,'terbit ulang: kolom manual_discount dibawa ke tagihan pengganti (definisi)');

-- ── 7. akses langsung ke tabel oleh klien yang dimodifikasi ──
select pg_temp.as_('dd100000-0000-4000-8000-000000000004');
select pg_temp.reject($q$insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp,item_discount_type,item_discount_value) select id,'dd400000-0000-4000-8000-000000000001','x',1,100000,'pcs',1,0,'nominal',5000 from sales where no_struk='DM-S0'$q$,'Anda tidak punya izin memberi diskon manual.','sisip baris berdiskon langsung ke sale_items oleh STAFF ditolak');
select pg_temp.accept($q$insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp,item_discount_type,item_discount_value) select id,'dd400000-0000-4000-8000-000000000005','x',1,100000,'pcs',1,0,'percent',10 from sales where no_struk='DM-PEND'$q$,'sisip baris: persen = diskon bawaan master (10%) lolos untuk STAFF');
select pg_temp.reject($q$insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp,item_discount_type,item_discount_value) select id,'dd400000-0000-4000-8000-000000000005','x',1,100000,'pcs',1,0,'percent',11 from sales where no_struk='DM-PEND'$q$,'Anda tidak punya izin memberi diskon manual.','sisip baris: persen 11% di atas master (10%) ditolak seketika, bukan hanya saat finalisasi');
select pg_temp.ok(true,'selesai');
rollback;
