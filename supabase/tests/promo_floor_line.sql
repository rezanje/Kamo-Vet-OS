-- Lantai harga klinik (P03) dengan promo per baris: fictional fixtures in disposable PostgreSQL only; everything rolls back.
-- Kasus nyata 11 Nov 2026: GROOM11 (50% hanya Grooming) + Anthel Cat 1 x Rp18.000 (HPP Rp11.287,29) ditolak "neto Rp10.500".
-- Aturan: potongan PROMO hanya memotong baris yang membawanya; sisa diskon (voucher/poin/golongan/manual) tetap dibagi menurut porsi;
-- tiap baris obat/paket tetap harus neto >= HPP; aplikasi lama (tanpa promo_discount) berperilaku persis seperti dulu.
begin;
create function pg_temp.ok(value boolean, label text) returns void language plpgsql as $$begin
 if value is distinct from true then raise exception 'Assertion failed: %',label;end if;raise notice 'PF_PASS %',label;end$$;
create function pg_temp.reject(stmt text, expected text, label text) returns void language plpgsql as $$
declare failed boolean:=false;msg text;begin
 begin execute stmt;exception when others then failed:=true;msg:=sqlerrm;end;
 if not failed then raise exception 'Expected rejection: %',label;end if;
 if position(expected in msg)=0 then raise exception 'Unexpected rejection for %: %',label,msg;end if;
 raise notice 'PF_PASS %',label;
end$$;

insert into auth.users(id,raw_user_meta_data) values ('f0500000-0000-4000-8000-000000000001','{"full_name":"PF clinic cashier"}');
update profiles set role='OWNER',is_active=true where id='f0500000-0000-4000-8000-000000000001';
insert into branches(id,code,name,type) values ('f0510000-0000-4000-8000-000000000002','PFVET','PF clinic','KLINIK');
insert into user_branches(user_id,branch_id) values ('f0500000-0000-4000-8000-000000000001','f0510000-0000-4000-8000-000000000002');
insert into warehouses(id,branch_id,code,name,type) values ('f0520000-0000-4000-8000-000000000002','f0510000-0000-4000-8000-000000000002','PFVETWH','PF clinic warehouse','VET');
insert into cashier_shifts(id,branch_id,opened_by,shift_type,status) values
 ('f0530000-0000-4000-8000-000000000002','f0510000-0000-4000-8000-000000000002','f0500000-0000-4000-8000-000000000001','klinik','open');
insert into items(id,code,name,unit,item_type,buy_price) values
 ('f0540000-0000-4000-8000-000000000001','PFANT','Anthel Cat','pcs','Persediaan',11287.29),
 ('f0540000-0000-4000-8000-000000000002','PFOBT2','PF obat dua','pcs','Persediaan',5000),
 ('f0540000-0000-4000-8000-000000000003','PFGRM1','Grooming VET Lengkap','jasa','Jasa',0),
 ('f0540000-0000-4000-8000-000000000004','PFPKG','PF paket klinik','paket','Grup',0),
 ('f0540000-0000-4000-8000-000000000005','PFGRM2','Grooming Mandi','jasa','Jasa',0);
insert into item_group_components(group_item_id,component_item_id,qty,unit,factor) values
 ('f0540000-0000-4000-8000-000000000004','f0540000-0000-4000-8000-000000000002',1,'pcs',1),
 ('f0540000-0000-4000-8000-000000000004','f0540000-0000-4000-8000-000000000003',1,'jasa',1);
insert into stock(warehouse_id,item_id,qty) values
 ('f0520000-0000-4000-8000-000000000002','f0540000-0000-4000-8000-000000000001',200),
 ('f0520000-0000-4000-8000-000000000002','f0540000-0000-4000-8000-000000000002',200);
insert into stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source) values
 ('f0520000-0000-4000-8000-000000000002','f0540000-0000-4000-8000-000000000001',current_date,200,200,11287.29,'purchase'),
 ('f0520000-0000-4000-8000-000000000002','f0540000-0000-4000-8000-000000000002',current_date,200,200,5000,'purchase');
insert into customers(id,name,phone) values('f0550000-0000-4000-8000-000000000001','PF customer','080000000505');
insert into pets(id,customer_id,name) values('f0560000-0000-4000-8000-000000000001','f0550000-0000-4000-8000-000000000001','PF pet');
insert into visits(id,branch_id,customer_id,pet_id)
select ('f0570000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,'f0510000-0000-4000-8000-000000000002',
 'f0550000-0000-4000-8000-000000000001','f0560000-0000-4000-8000-000000000001' from generate_series(1,60) n;
insert into medical_records(id,visit_id)
select ('f0580000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,('f0570000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid from generate_series(1,60) n;
insert into prescription_items(id,medical_record_id,nama_obat,item_id,qty,satuan,faktor,harga,jenis) values
 ('f05c0000-0000-4000-8000-000000000001','f0580000-0000-4000-8000-000000000030','Anthel Cat','f0540000-0000-4000-8000-000000000001',1,'pcs',1,18000,'obat'),
 ('f05c0000-0000-4000-8000-000000000002','f0580000-0000-4000-8000-000000000030','Grooming VET Lengkap','f0540000-0000-4000-8000-000000000003',1,'jasa',1,90000,'jasa');
insert into coa_accounts(code,name,type,normal_balance,is_header) values
 ('110003','Kas','ASET','D',false),('1111','Test cash','ASET','D',false),('150001','Piutang','ASET','D',false),
 ('510001','Sales','PENDAPATAN','K',false),('520002','Discount','PENDAPATAN','D',false),
 ('510002','Pendapatan klinik','PENDAPATAN','K',false),('312005','VAT','LIABILITAS','K',false),
 ('600001','COGS','BEBAN','D',false),('170001','Inventory','ASET','D',false)
 on conflict(code) do update set is_active=true,is_header=false;
update accounting_locks set closed_until=null;
update company_settings set mode_pkp=false;
update clinic_billing_settings set min_dp_percent=0;

create function pg_temp.visit(n int) returns uuid language sql as $$ select ('f0570000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid $$;
create function pg_temp.inv(subtotal numeric, discount numeric) returns jsonb language sql as $$
 select jsonb_build_object('tanggal',current_date::text,'subtotal',subtotal,'discount',discount,'tax',0,
  'total',subtotal-discount,'dp_amount',0,'dp_date',null,'paid_status','Belum Lunas','metode_bayar','Tunai',
  'shift_id','f0530000-0000-4000-8000-000000000002','voucher_code',null,'salesperson_id',null)$$;
-- baris obat (Anthel = 1, obat dua = 2) dan jasa (Grooming = 3, Mandi = 5); promo null = kunci tidak dikirim (aplikasi lama)
create function pg_temp.obat(n int, qty int, price numeric, promo numeric default null, pct numeric default 0, pkg boolean default false) returns jsonb language sql as $$
 select jsonb_build_object('description',case n when 1 then 'Anthel Cat' else 'PF obat dua' end,'qty',qty,'price',price,'kind','obat',
  'item_id','f0540000-0000-4000-8000-00000000000'||n,'unit','pcs','discount_percent',pct)
  || case when promo is not null then jsonb_build_object('promo_discount',promo) else '{}'::jsonb end
  || case when pkg then jsonb_build_object('package_item_id','f0540000-0000-4000-8000-000000000004','package_qty',qty) else '{}'::jsonb end$$;
create function pg_temp.jasa(n int, price numeric, promo numeric default null, pct numeric default 0, pkg boolean default false) returns jsonb language sql as $$
 select jsonb_build_object('description',case n when 3 then 'Grooming VET Lengkap' else 'Grooming Mandi' end,'qty',1,'price',price,'kind','jasa',
  'item_id','f0540000-0000-4000-8000-00000000000'||n,'discount_percent',pct)
  || case when promo is not null then jsonb_build_object('promo_discount',promo) else '{}'::jsonb end
  || case when pkg then jsonb_build_object('package_item_id','f0540000-0000-4000-8000-000000000004','package_qty',1) else '{}'::jsonb end$$;
create function pg_temp.post(v int, key text, subtotal numeric, discount numeric, lines jsonb) returns uuid language sql as $$
 select clinic_post_invoice(pg_temp.visit(v),key,pg_temp.inv(subtotal,discount),lines)$$;
create function pg_temp.post_sql(v int, key text, subtotal numeric, discount numeric, lines jsonb) returns text language sql as $$
 select format('select clinic_post_invoice(%L,%L,%L::jsonb,%L::jsonb)',pg_temp.visit(v),key,pg_temp.inv(subtotal,discount)::text,lines::text)$$;
create function pg_temp.promo_of(invno text, descr text) returns numeric language sql as $$
 select ii.promo_discount from invoice_items ii join invoices i on i.id=ii.invoice_id where i.request_key=invno and ii.deskripsi=descr$$;

set local role authenticated;
select set_config('request.jwt.claim.sub','f0500000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select set_config('request.jwt.claim.role','authenticated',true);

-- ===== A. Kasus nyata GROOM11: Grooming 1 x 90.000 (promo 45.000) + Anthel Cat 1 x 18.000 (HPP 11.287,29)
select pg_temp.ok(pg_temp.post(1,'pf-groom11',108000,45000,jsonb_build_array(pg_temp.obat(1,1,18000,0),pg_temp.jasa(3,90000,45000))) is not null,
 'A1 GROOM11: promo hanya di Grooming, Anthel tetap Rp18.000 lolos lantai');
select pg_temp.ok(pg_temp.promo_of('pf-groom11','Grooming VET Lengkap')=45000 and pg_temp.promo_of('pf-groom11','Anthel Cat')=0,
 'A2 promo tercatat di baris Grooming saja');
select pg_temp.ok((select subtotal=108000 and discount=45000 and total=63000 from invoices where request_key='pf-groom11'),'A3 invoices.discount tetap total diskon (promo ikut)');
-- aplikasi lama (tanpa promo_discount): perilaku lama persis, pesan lama persis
select pg_temp.reject(pg_temp.post_sql(2,'pf-groom11-old',108000,45000,jsonb_build_array(pg_temp.obat(1,1,18000),pg_temp.jasa(3,90000))),
 'PRICE_BELOW_HPP: Harga neto Anthel Cat Rp10.500 di bawah HPP Rp11.287.','A4 tanpa promo_discount = aturan lama (neto Rp10.500)');
select pg_temp.reject(pg_temp.post_sql(2,'pf-groom11-old',108000,45000,jsonb_build_array(pg_temp.obat(1,1,18000),pg_temp.jasa(3,90000))),
 'harga minimum Rp19.350 per pcs','A5 tanpa promo_discount = harga minimum lama Rp19.350');
select pg_temp.ok((select count(*)=0 from invoices where request_key='pf-groom11-old'),'A6 penolakan tidak menyimpan invoice');
-- promo = 0 di semua baris = aturan lama
select pg_temp.reject(pg_temp.post_sql(2,'pf-zero-promo',108000,45000,jsonb_build_array(pg_temp.obat(1,1,18000,0),pg_temp.jasa(3,90000,0))),
 'PRICE_BELOW_HPP: Harga neto Anthel Cat Rp10.500','A7 promo 0 di semua baris = aturan lama');

-- ===== B. Promo yang benar-benar menurunkan baris obat di bawah HPP tetap ditolak (aturan di bawah HPP tidak longgar)
select pg_temp.reject(pg_temp.post_sql(3,'pf-promo-on-anthel',108000,9000,jsonb_build_array(pg_temp.obat(1,1,18000,9000),pg_temp.jasa(3,90000,0))),
 'PRICE_BELOW_HPP: Harga neto Anthel Cat Rp9.000 di bawah HPP Rp11.287.','B1 Anthel sendiri dipromo ke Rp9.000 ditolak');
select pg_temp.reject(pg_temp.post_sql(3,'pf-promo-on-anthel',108000,9000,jsonb_build_array(pg_temp.obat(1,1,18000,9000),pg_temp.jasa(3,90000,0))),
 'harga minimum Rp20.288 per pcs','B2 harga minimum ikut promo baris (11.287,29 + 9.000 = 20.288)');
select pg_temp.ok(pg_temp.post(4,'pf-promo-edge-ok',108000,6712.71,jsonb_build_array(pg_temp.obat(1,1,18000,6712.71),pg_temp.jasa(3,90000,0))) is not null,
 'B3 batas: neto tepat sama HPP (11.287,29) lolos');
select pg_temp.reject(pg_temp.post_sql(5,'pf-promo-edge-below',108000,6712.72,jsonb_build_array(pg_temp.obat(1,1,18000,6712.72),pg_temp.jasa(3,90000,0))),
 'PRICE_BELOW_HPP: Harga neto Anthel Cat Rp11.287 di bawah HPP Rp11.287.','B4 batas: neto 1 sen di bawah HPP ditolak');
select pg_temp.reject(pg_temp.post_sql(5,'pf-promo-100',108000,18000,jsonb_build_array(pg_temp.obat(1,1,18000,18000),pg_temp.jasa(3,90000,0))),
 'PRICE_ZERO: Harga neto Anthel Cat Rp0','B5 obat dipromo 100% = PRICE_ZERO');
select pg_temp.reject(pg_temp.post_sql(5,'pf-all-free',108000,108000,jsonb_build_array(pg_temp.obat(1,1,18000,18000),pg_temp.jasa(3,90000,90000))),
 'PRICE_ZERO','B6 diskon 100% seluruh invoice tetap ditolak (obat tidak boleh gratis)');
select pg_temp.ok(pg_temp.post(6,'pf-service-free',108000,90000,jsonb_build_array(pg_temp.obat(1,1,18000,0),pg_temp.jasa(3,90000,90000))) is not null,
 'B7 jasa boleh gratis 100% oleh promo; obat tetap Rp18.000');

-- ===== C. Voucher/poin/manual (diskon non-promo) tetap dibagi menurut porsi
select pg_temp.ok(pg_temp.post(7,'pf-manual-ok',108000,55800,jsonb_build_array(pg_temp.obat(1,1,18000,0),pg_temp.jasa(3,90000,45000))) is not null,
 'C1 promo 45.000 + diskon lain 10.800: Anthel neto 14.914 lolos');
select pg_temp.reject(pg_temp.post_sql(8,'pf-manual-big',108000,70000,jsonb_build_array(pg_temp.obat(1,1,18000,0),pg_temp.jasa(3,90000,45000))),
 'PRICE_BELOW_HPP: Harga neto Anthel Cat Rp10.857 di bawah HPP Rp11.287.','C2 promo 45.000 + diskon lain 25.000: sisa diskon dibagi ke Anthel -> Rp10.857 ditolak');
select pg_temp.ok(pg_temp.post(9,'pf-manual-only-ok',108000,40000,jsonb_build_array(pg_temp.obat(1,1,18000),pg_temp.jasa(3,90000))) is not null,
 'C3 diskon manual murni (tanpa promo) 40.000: dibagi rata, Anthel neto 11.333 lolos seperti dulu');
select pg_temp.reject(pg_temp.post_sql(41,'pf-manual-only-bad',108000,41000,jsonb_build_array(pg_temp.obat(1,1,18000),pg_temp.jasa(3,90000))),
 'PRICE_BELOW_HPP: Harga neto Anthel Cat Rp11.167','C4 diskon manual murni 41.000: pembagian rata lama, Anthel Rp11.167 ditolak');
select pg_temp.reject(pg_temp.post_sql(41,'pf-manual-bad-zero',108000,41000,jsonb_build_array(pg_temp.obat(1,1,18000,0),pg_temp.jasa(3,90000,0))),
 'PRICE_BELOW_HPP: Harga neto Anthel Cat Rp11.167','C5 sama dengan C4 bila kunci promo_discount = 0');

-- ===== D. Klaim promo per baris dari klien divalidasi database (zero-sum, tidak ada celah menurunkan lantai)
select pg_temp.reject(pg_temp.post_sql(10,'pf-claim-over-d',108000,45000,jsonb_build_array(pg_temp.obat(1,1,18000,0),pg_temp.jasa(3,90000,50000))),
 'INVOICE_INVALID: jumlah potongan promo per baris melebihi diskon invoice','D1 jumlah promo baris > diskon invoice ditolak');
select pg_temp.reject(pg_temp.post_sql(10,'pf-claim-over-line',108000,20000,jsonb_build_array(pg_temp.obat(1,1,18000,18001),pg_temp.jasa(3,90000,0))),
 'LINE_INVALID: potongan promo baris tidak valid','D2 promo baris > nilai barisnya ditolak');
select pg_temp.reject(pg_temp.post_sql(10,'pf-claim-negative',108000,45000,jsonb_build_array(pg_temp.obat(1,1,18000,-1000),pg_temp.jasa(3,90000,46000))),
 'LINE_INVALID: potongan promo baris tidak valid','D3 promo negatif di satu baris (jumlah masih <= diskon) ditolak');
select pg_temp.reject(pg_temp.post_sql(10,'pf-claim-negative-sum',108000,45000,jsonb_build_array(pg_temp.obat(1,1,18000,-5),pg_temp.jasa(3,90000,0))),
 'INVOICE_INVALID: jumlah potongan promo per baris melebihi diskon invoice','D4 jumlah promo negatif ditolak');
select pg_temp.reject(pg_temp.post_sql(10,'pf-claim-3dp',108000,45000.01,jsonb_build_array(pg_temp.obat(1,1,18000,0),pg_temp.jasa(3,90000,45000.005))),
 'LINE_INVALID: potongan promo baris tidak valid','D5 lebih dari dua desimal ditolak');
select pg_temp.reject(pg_temp.post_sql(10,'pf-claim-over-jasa',108000,100000,jsonb_build_array(pg_temp.obat(1,1,18000,0),pg_temp.jasa(3,90000,90001))),
 'LINE_INVALID: potongan promo baris tidak valid','D6 promo jasa > nilai jasa ditolak');
select pg_temp.reject(pg_temp.post_sql(10,'pf-claim-text',108000,45000,jsonb_build_array(pg_temp.obat(1,1,18000,0),pg_temp.jasa(3,90000,0)) || jsonb_build_array(jsonb_set(pg_temp.jasa(5,0),'{promo_discount}','"abc"'))),
 'invalid input syntax','D7 promo bukan angka ditolak');
-- memindahkan seluruh diskon ke baris lain tidak menurunkan lantai baris obat: diskon 45.000 diklaim promo di Anthel (maks 18.000) tidak bisa
select pg_temp.reject(pg_temp.post_sql(10,'pf-shift-all-to-anthel',108000,45000,jsonb_build_array(pg_temp.obat(1,1,18000,45000),pg_temp.jasa(3,90000,0))),
 'LINE_INVALID','D8 seluruh diskon diklaim di baris obat melebihi nilainya ditolak');
-- memindahkan diskon dari baris murah ke baris margin besar sah (jumlah tetap): Anthel tetap Rp18.000, ongkos tetap dijaga per baris
select pg_temp.ok(pg_temp.post(11,'pf-shift-ok',108000,45000,jsonb_build_array(pg_temp.obat(1,1,18000,0),pg_temp.obat(2,1,18000,0),pg_temp.jasa(3,0),pg_temp.jasa(5,72000,45000))) is not null,
 'D9 diskon dibebankan ke jasa bermargin besar, dua obat utuh: lolos');

-- ===== E. qty > 1, banyak baris berpromo, diskon baris persen
select pg_temp.ok(pg_temp.post(12,'pf-qty3-ok',132000,45000,jsonb_build_array(pg_temp.obat(1,3,14000,0),pg_temp.jasa(3,90000,45000))) is not null,
 'E1 qty 3 x Rp14.000 (HPP 33.861,87) lolos karena promo hanya di Grooming');
select pg_temp.reject(pg_temp.post_sql(13,'pf-qty3-old',132000,45000,jsonb_build_array(pg_temp.obat(1,3,14000),pg_temp.jasa(3,90000))),
 'PRICE_BELOW_HPP: Harga neto Anthel Cat Rp27.682 di bawah HPP Rp33.862.','E2 qty 3 tanpa promo_discount = aturan lama');
select pg_temp.ok(pg_temp.post(14,'pf-two-promo-lines',200000,95000,jsonb_build_array(pg_temp.obat(1,1,18000,0),pg_temp.obat(2,1,12000,0),pg_temp.jasa(3,90000,45000),pg_temp.jasa(5,80000,50000))) is not null,
 'E3 dua baris jasa berpromo, dua obat utuh');
select pg_temp.ok(pg_temp.post(15,'pf-line-pct',99000,40500,jsonb_build_array(pg_temp.obat(1,1,18000,0),pg_temp.jasa(3,90000,40500,10))) is not null,
 'E4 diskon baris 10% + promo 40.500 (nilai baris 81.000) lolos');
select pg_temp.reject(pg_temp.post_sql(16,'pf-line-pct-over',99000,81001,jsonb_build_array(pg_temp.obat(1,1,18000,0),pg_temp.jasa(3,90000,81000.01,10))),
 'LINE_INVALID','E5 promo > nilai baris setelah diskon baris ditolak');
select pg_temp.reject(pg_temp.post_sql(16,'pf-pct-below',16200,5000,jsonb_build_array(pg_temp.obat(1,1,18000,5000,10),pg_temp.jasa(3,0))),
 'PRICE_BELOW_HPP: Harga neto Anthel Cat Rp11.200 di bawah HPP Rp11.287.','E6 diskon baris 10% + promo 5.000 pada Anthel: neto 11.200 ditolak');
select pg_temp.reject(pg_temp.post_sql(16,'pf-pct-below',16200,5000,jsonb_build_array(pg_temp.obat(1,1,18000,5000,10),pg_temp.jasa(3,0))),
 'harga minimum Rp18.097 per pcs','E7 harga minimum memperhitungkan diskon baris 10% dan promo baris');

-- ===== F. Paket klinik: dinilai utuh terhadap total HPP komponen, promo hanya pada baris paket yang membawanya
select pg_temp.ok(pg_temp.post(17,'pf-pkg-ok',23600,6600,jsonb_build_array(pg_temp.obat(1,1,18000,6600),pg_temp.obat(2,1,0,0,0,true),pg_temp.jasa(3,5600,0,0,true))) is not null,
 'F1 promo 6.600 di Anthel (neto 11.400); paket Rp5.600 >= HPP komponen 5.000 lolos');
select pg_temp.reject(pg_temp.post_sql(18,'pf-pkg-old',23600,6600,jsonb_build_array(pg_temp.obat(1,1,18000),pg_temp.obat(2,1,0,null,0,true),pg_temp.jasa(3,5600,null,0,true))),
 'PRICE_BELOW_HPP: Harga neto paket PF paket klinik Rp4.034','F2 tanpa promo_discount paket jadi Rp4.034 ditolak (aturan lama)');
select pg_temp.reject(pg_temp.post_sql(18,'pf-pkg-promo-below',23600,700,jsonb_build_array(pg_temp.obat(1,1,18000,0),pg_temp.obat(2,1,0,0,0,true),pg_temp.jasa(3,5600,700,0,true))),
 'PRICE_BELOW_HPP: Harga neto paket PF paket klinik Rp4.900 di bawah total HPP komponennya Rp5.000.','F3 promo pada baris paket menurunkan paket ke Rp4.900: ditolak');
select pg_temp.reject(pg_temp.post_sql(18,'pf-pkg-promo-below',23600,700,jsonb_build_array(pg_temp.obat(1,1,18000,0),pg_temp.obat(2,1,0,0,0,true),pg_temp.jasa(3,5600,700,0,true))),
 'harga minimum paket Rp5.700','F4 harga minimum paket = HPP + promo paket');

-- ===== G. Koreksi tagihan (clinic_edit_invoice): promo diwarisi DARI DATABASE hanya untuk baris yang tidak berubah
create function pg_temp.src(key text, descr text) returns uuid language sql as $$
 select ii.id from invoice_items ii join invoices i on i.id=ii.invoice_id where i.request_key=key and ii.deskripsi=descr$$;
create function pg_temp.with_src(key text, line jsonb) returns jsonb language sql as $$
 select line || jsonb_build_object('source_invoice_item_id',pg_temp.src(key,line->>'description'))$$;
create function pg_temp.edit_sql(key text, ekey text, subtotal numeric, discount numeric, lines jsonb) returns text language sql as $$
 select format('select clinic_edit_invoice((select id from invoices where request_key=%L),%L,%L::jsonb,%L::jsonb)',key,ekey,
  jsonb_build_object('subtotal',subtotal,'discount',discount,'tax',0,'total',subtotal-discount,'dp_amount',0,'paid_status','Belum Lunas',
   'metode_bayar','Tunai','voucher_code',null,'reason','PF test')::text,lines::text)$$;
create temp table pf_src(label text primary key, anthel uuid, groom uuid);
grant all on pf_src to authenticated;
insert into pf_src select 'g0',pg_temp.src('pf-groom11','Anthel Cat'),pg_temp.src('pf-groom11','Grooming VET Lengkap');
select pg_temp.ok(clinic_edit_invoice((select id from invoices where request_key='pf-groom11'),'pf-edit-1',
  (select jsonb_build_object('subtotal',108000,'discount',45000,'tax',0,'total',63000,'dp_amount',0,'paid_status','Belum Lunas','metode_bayar','Tunai','voucher_code',null,'reason','PF test')),
  jsonb_build_array((select pg_temp.obat(1,1,18000)||jsonb_build_object('source_invoice_item_id',anthel) from pf_src where label='g0'),
                    (select pg_temp.jasa(3,90000)||jsonb_build_object('source_invoice_item_id',groom) from pf_src where label='g0')))
 =(select id from invoices where request_key='pf-groom11'),'G1 koreksi tanpa perubahan baris lolos (promo diwarisi dari baris asal)');
select pg_temp.ok(pg_temp.promo_of('pf-groom11','Grooming VET Lengkap')=45000 and pg_temp.promo_of('pf-groom11','Anthel Cat')=0,'G2 promo Grooming tetap 45.000 setelah koreksi');
select pg_temp.ok(clinic_edit_invoice((select id from invoices where request_key='pf-groom11'),'pf-edit-2',
  jsonb_build_object('subtotal',110000,'discount',45000,'tax',0,'total',65000,'dp_amount',0,'paid_status','Belum Lunas','metode_bayar','Tunai','voucher_code',null,'reason','PF test'),
  jsonb_build_array(pg_temp.with_src('pf-groom11',pg_temp.obat(1,1,20000)),pg_temp.with_src('pf-groom11',pg_temp.jasa(3,90000))))
 =(select id from invoices where request_key='pf-groom11'),'G3 koreksi menaikkan harga Anthel ke 20.000: Grooming tak berubah mewarisi promo, lolos');
select pg_temp.ok(pg_temp.promo_of('pf-groom11','Grooming VET Lengkap')=45000,'G4 promo tetap setelah koreksi kedua');
-- baris Grooming TANPA rujukan baris asal (klien tidak menyebut sumbernya): promo tidak diwarisi walau barang/qty/harga sama persis
select pg_temp.reject(pg_temp.edit_sql('pf-groom11','pf-edit-2b',108000,45000,
  jsonb_build_array(pg_temp.with_src('pf-groom11',pg_temp.obat(1,1,18000)),pg_temp.jasa(3,90000))),
  'PRICE_BELOW_HPP: Harga neto Anthel Cat Rp10.500','G4b baris Grooming tanpa sumber: promo tidak diwarisi, Anthel Rp10.500 ditolak');
-- harga Grooming berubah: promo TIDAK diwarisi (klien tidak boleh mengklaim); aturan lama memukul Anthel
select pg_temp.reject(pg_temp.edit_sql('pf-groom11','pf-edit-3',100000,45000,
  jsonb_build_array(pg_temp.with_src('pf-groom11',pg_temp.obat(1,1,20000)),pg_temp.with_src('pf-groom11',pg_temp.jasa(3,80000,45000)))),
  'PRICE_BELOW_HPP: Harga neto Anthel Cat Rp11.000','G5 harga Grooming berubah + klaim promo dari klien: promo tak diwarisi/tak dibaca, Anthel Rp11.000 ditolak');
-- diskon diturunkan di bawah promo warisan: kembali ke aturan lama (promo diabaikan)
select pg_temp.reject(pg_temp.edit_sql('pf-groom11','pf-edit-4',104000,30000,
  jsonb_build_array(pg_temp.with_src('pf-groom11',pg_temp.obat(1,1,14000)),pg_temp.with_src('pf-groom11',pg_temp.jasa(3,90000)))),
  'PRICE_BELOW_HPP: Harga neto Anthel Cat Rp9.962','G6 diskon 30.000 < promo warisan 45.000: aturan lama (Anthel Rp9.962 ditolak)');
select pg_temp.ok(clinic_edit_invoice((select id from invoices where request_key='pf-groom11'),'pf-edit-5',
  jsonb_build_object('subtotal',104000,'discount',20000,'tax',0,'total',84000,'dp_amount',0,'paid_status','Belum Lunas','metode_bayar','Tunai','voucher_code',null,'reason','PF test'),
  jsonb_build_array(pg_temp.with_src('pf-groom11',pg_temp.obat(1,1,14000)),pg_temp.with_src('pf-groom11',pg_temp.jasa(3,90000))))
 =(select id from invoices where request_key='pf-groom11'),'G7 diskon 20.000: aturan lama, Anthel Rp11.308 lolos');

-- ===== G2. Tagihan lunas: batal + terbit ulang menyalin promo baris; koreksi sesudahnya tetap lolos
select pg_temp.ok(clinic_post_invoice(pg_temp.visit(31),'pf-lunas',jsonb_set(pg_temp.inv(108000,45000),'{paid_status}','"Lunas"'),
  jsonb_build_array(pg_temp.obat(1,1,18000,0),pg_temp.jasa(3,90000,45000))) is not null,'G8 GROOM11 dibayar lunas lolos');
select pg_temp.ok(clinic_void_reissue_invoice((select id from invoices where request_key='pf-lunas'),'pf-reissue','Koreksi uji promo baris') is not null,'G9 batal + terbit ulang berhasil');
select pg_temp.ok(pg_temp.promo_of('pf-reissue','Grooming VET Lengkap')=45000 and pg_temp.promo_of('pf-reissue','Anthel Cat')=0,'G10 nota terbit ulang membawa promo baris yang sama');
select pg_temp.ok(clinic_edit_invoice((select id from invoices where request_key='pf-reissue'),'pf-reissue-edit',
  jsonb_build_object('subtotal',108000,'discount',45000,'tax',0,'total',63000,'dp_amount',0,'paid_status','Lunas','metode_bayar','Tunai','voucher_code',null,'reason','PF test'),
  jsonb_build_array(pg_temp.with_src('pf-reissue',pg_temp.obat(1,1,18000)),pg_temp.with_src('pf-reissue',pg_temp.jasa(3,90000))))
 =(select id from invoices where request_key='pf-reissue'),'G11 koreksi sesudah terbit ulang lolos lantai (promo baris diwarisi)');

-- ===== H. Uang, stok, jurnal sama persis dengan/ tanpa promo_discount (kasus yang lolos di kedua cara)
select pg_temp.ok(pg_temp.post(20,'pf-eq-a',115000,45000,jsonb_build_array(pg_temp.obat(1,1,25000,0),pg_temp.jasa(3,90000,45000))) is not null,'H1 nota dengan promo_discount');
select pg_temp.ok(pg_temp.post(21,'pf-eq-b',115000,45000,jsonb_build_array(pg_temp.obat(1,1,25000),pg_temp.jasa(3,90000))) is not null,'H2 nota yang sama tanpa promo_discount (aplikasi lama)');

-- ===== I. Idempotensi
select pg_temp.ok(pg_temp.post(1,'pf-groom11',108000,45000,jsonb_build_array(pg_temp.obat(1,1,18000,0),pg_temp.jasa(3,90000,45000)))=(select id from invoices where request_key='pf-groom11'),
 'I1 kirim ulang kunci sama + isi sama mengembalikan invoice yang sama');
select pg_temp.reject(pg_temp.post_sql(1,'pf-groom11',108000,45000,jsonb_build_array(pg_temp.obat(1,1,18000,0),pg_temp.jasa(3,90000,44000))),
 'IDEMPOTENCY_CONFLICT','I2 kunci sama + promo berbeda = konflik');

-- ===== J. Jalur nyata kasir: pembungkus *_with_record dengan baris resep dokter
select pg_temp.ok(public.clinic_post_invoice_with_record(pg_temp.visit(30),'pf-wrapper',pg_temp.inv(108000,45000),
  jsonb_build_array(pg_temp.obat(1,1,18000,0)||jsonb_build_object('prescription_item_id','f05c0000-0000-4000-8000-000000000001'),
                    pg_temp.jasa(3,90000,45000)||jsonb_build_object('prescription_item_id','f05c0000-0000-4000-8000-000000000002','unit','jasa')),
  p_cart_version=>public.clinic_outpatient_cart_version(pg_temp.visit(30))) is not null,'J1 pembungkus posting kasir + resep dokter: GROOM11 lolos');
select pg_temp.ok(pg_temp.promo_of('pf-wrapper','Grooming VET Lengkap')=45000,'J2 promo tercatat lewat pembungkus');

-- ===== K. Hak akses, constraint, baris langsung (superuser)
reset role;
select pg_temp.ok(not has_function_privilege('authenticated','clinic_private.assert_invoice_price_floor(uuid,numeric,numeric)','EXECUTE')
 and not has_function_privilege('anon','clinic_private.assert_invoice_price_floor(uuid,numeric,numeric)','EXECUTE'),'K1 penjaga lantai tetap tidak bisa dipanggil langsung');
select pg_temp.ok(has_function_privilege('authenticated','public.clinic_post_invoice(uuid,text,jsonb,jsonb)','EXECUTE')
 and not has_function_privilege('anon','public.clinic_post_invoice(uuid,text,jsonb,jsonb)','EXECUTE')
 and not has_function_privilege('authenticated','public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)','EXECUTE'),'K2 hak EXECUTE fungsi posting/koreksi tidak berubah');
select pg_temp.ok(not has_column_privilege('authenticated','public.invoice_items','promo_discount','UPDATE')
 and not has_column_privilege('authenticated','public.invoice_items','promo_discount','INSERT'),'K3 klien tidak bisa menulis promo_discount langsung');
select pg_temp.ok((select count(*)=1 from pg_constraint where conrelid='public.invoice_items'::regclass and conname='invoice_items_promo_discount_check'),'K4 constraint ada');
select pg_temp.ok((select data_type='numeric' and numeric_precision=15 and numeric_scale=2 and column_default='0' and is_nullable='YES'
  from information_schema.columns where table_schema='public' and table_name='invoice_items' and column_name='promo_discount'),'K5 kolom numeric(15,2) default 0 nullable');
select pg_temp.ok((select every(promo_discount=0) from invoice_items where invoice_id in (select id from invoices where request_key in ('pf-eq-b','pf-manual-ok','pf-manual-only-ok'))
  and jenis='obat'),'K6 baris obat tanpa promo = 0');
select pg_temp.ok((select count(*)=0 from invoice_items where promo_discount is null),'K7 baris baru tidak pernah NULL');
select pg_temp.reject($q$insert into invoice_items(invoice_id,deskripsi,qty,harga,jenis,promo_discount) values((select id from invoices limit 1),'neg',1,1,'jasa',-1)$q$,
 'invoice_items_promo_discount_check','K8 promo negatif ditolak tabel');
-- H (lanjutan): bandingkan uang/stok/jurnal
select pg_temp.ok((select md5(string_agg(x,'|' order by x)) from (
   select concat_ws(',',i.subtotal,i.discount,i.tax,i.total,i.paid_status,i.dp_amount) x from invoices i where i.request_key='pf-eq-a'
   union all select concat_ws(',','item',ii.deskripsi,ii.qty,ii.harga,ii.jenis,ii.diskon_persen,coalesce(ii.hpp::text,'-'),ii.satuan,ii.faktor)
     from invoice_items ii join invoices i on i.id=ii.invoice_id where i.request_key='pf-eq-a'
   union all select concat_ws(',','jrn',je.source,a.code,l.debit,l.credit) from journal_entries je join journal_lines l on l.entry_id=je.id join coa_accounts a on a.id=l.account_id
     where je.source_ref=(select invoice_no from invoices where request_key='pf-eq-a')
   union all select concat_ws(',','mv',sm.qty,sm.unit_cost,sm.source) from stock_moves sm where sm.source_ref=(select invoice_no from invoices where request_key='pf-eq-a')) s)
  =(select md5(string_agg(x,'|' order by x)) from (
   select concat_ws(',',i.subtotal,i.discount,i.tax,i.total,i.paid_status,i.dp_amount) x from invoices i where i.request_key='pf-eq-b'
   union all select concat_ws(',','item',ii.deskripsi,ii.qty,ii.harga,ii.jenis,ii.diskon_persen,coalesce(ii.hpp::text,'-'),ii.satuan,ii.faktor)
     from invoice_items ii join invoices i on i.id=ii.invoice_id where i.request_key='pf-eq-b'
   union all select concat_ws(',','jrn',je.source,a.code,l.debit,l.credit) from journal_entries je join journal_lines l on l.entry_id=je.id join coa_accounts a on a.id=l.account_id
     where je.source_ref=(select invoice_no from invoices where request_key='pf-eq-b')
   union all select concat_ws(',','mv',sm.qty,sm.unit_cost,sm.source) from stock_moves sm where sm.source_ref=(select invoice_no from invoices where request_key='pf-eq-b')) s),
 'H3 invoice, baris, jurnal pendapatan/diskon/HPP dan gerak stok identik dengan/tanpa promo_discount');
select pg_temp.ok((select count(*)=2 from journal_entries je join invoices i on i.invoice_no=je.source_ref where i.request_key='pf-eq-a' and je.source in('klinik','klinik-hpp')),'H4 dua jurnal (pendapatan + HPP) ada');
select pg_temp.ok((select sum(l.debit) from journal_entries je join journal_lines l on l.entry_id=je.id join coa_accounts a on a.id=l.account_id
   where je.source='klinik' and a.code='520002' and je.source_ref=(select invoice_no from invoices where request_key='pf-eq-a'))=45000,'H5 diskon penuh 45.000 (promo ikut) tercatat di akun diskon 520002');

-- planted: baris langsung memanggil penjaga (superuser, pemicu pengguna dimatikan) --------------------------------
insert into invoices(id,visit_id) values('f05b0000-0000-4000-8000-000000000001',pg_temp.visit(59));
create function pg_temp.plant(rows_ jsonb) returns void language plpgsql as $$
declare r jsonb;begin
 delete from invoice_items where invoice_id='f05b0000-0000-4000-8000-000000000001';
 for r in select * from jsonb_array_elements(rows_) loop
  insert into invoice_items(invoice_id,deskripsi,qty,harga,jenis,item_id,hpp,diskon_persen,satuan,promo_discount)
  values('f05b0000-0000-4000-8000-000000000001',r->>'d',(r->>'q')::int,(r->>'p')::numeric,r->>'k',
   case when r->>'k'='jasa' then 'f0540000-0000-4000-8000-000000000003'::uuid else 'f0540000-0000-4000-8000-000000000001'::uuid end,
   nullif(r->>'h','')::numeric,0,'pcs',case when r ? 'promo' then nullif(r->>'promo','')::numeric end);
 end loop;end$$;
create function pg_temp.floor_msg(subtotal numeric, discount numeric) returns text language plpgsql as $$
begin perform clinic_private.assert_invoice_price_floor('f05b0000-0000-4000-8000-000000000001',subtotal,discount);return 'ACCEPT';
exception when others then return sqlerrm;end$$;
-- K9 promo NULL = tidak ada promo: aturan lama
select pg_temp.plant('[{"d":"Anthel Cat","q":1,"p":18000,"k":"obat","h":11287.29,"promo":null},{"d":"Grooming","q":1,"p":90000,"k":"jasa","promo":null}]');
select pg_temp.ok(pg_temp.floor_msg(108000,45000) like 'PRICE_BELOW_HPP: Harga neto Anthel Cat Rp10.500%','K9 promo NULL diperlakukan 0 (aturan lama)');
-- K10 promo baris melebihi nilai baris (data tidak sah ditanam) dijepit ke nilai barisnya
select pg_temp.plant('[{"d":"X","q":1,"p":100,"k":"obat","h":50,"promo":500},{"d":"Y","q":1,"p":1000,"k":"obat","h":900,"promo":0}]');
select pg_temp.ok(pg_temp.floor_msg(1100,600) like '%Harga neto X Rp0%- Y: harga neto Rp500 per pcs%','K10 promo di atas nilai baris dijepit (X Rp0, Y Rp500)');
-- K11 jumlah promo melebihi diskon (mis. diskon koreksi diturunkan): aturan lama
select pg_temp.plant('[{"d":"Anthel Cat","q":1,"p":14000,"k":"obat","h":11287.29,"promo":0},{"d":"Grooming","q":1,"p":90000,"k":"jasa","promo":45000}]');
select pg_temp.ok(pg_temp.floor_msg(104000,30000) like 'PRICE_BELOW_HPP: Harga neto Anthel Cat Rp9.962%','K11 jumlah promo > diskon: kembali ke aturan lama');
select pg_temp.ok(pg_temp.floor_msg(104000,45000)='ACCEPT','K12 jumlah promo = diskon: promo berlaku, Anthel Rp14.000 lolos');
-- K13 nol-jumlah: nilai baris dikurangi neto, dijumlah seluruh baris, sama dengan diskon (diperiksa lewat batas lolos tiap baris)
select pg_temp.plant('[{"d":"A","q":1,"p":1000,"k":"obat","h":800,"promo":0},{"d":"B","q":1,"p":1000,"k":"obat","h":800,"promo":300},{"d":"C","q":1,"p":1000,"k":"jasa","promo":0}]');
select pg_temp.ok(pg_temp.floor_msg(3000,600) like 'PRICE_BELOW_HPP: Harga neto B Rp622 di bawah HPP Rp800.%','K13a B (nilai 1.000, promo 300): neto 622,22 < HPP 800 ditolak; A 888,89 dan C ikut porsi sisa diskon');
select pg_temp.plant('[{"d":"A","q":1,"p":1000,"k":"obat","h":800,"promo":0},{"d":"B","q":1,"p":1000,"k":"obat","h":622.22,"promo":300},{"d":"C","q":1,"p":1000,"k":"jasa","promo":0}]');
select pg_temp.ok(pg_temp.floor_msg(3000,600)='ACCEPT','K13b batas: HPP B 622,22 = neto 622,22 lolos');
select pg_temp.plant('[{"d":"A","q":1,"p":1000,"k":"obat","h":800,"promo":0},{"d":"B","q":1,"p":1000,"k":"obat","h":622.23,"promo":300},{"d":"C","q":1,"p":1000,"k":"jasa","promo":0}]');
select pg_temp.ok(pg_temp.floor_msg(3000,600) like 'PRICE_BELOW_HPP: Harga neto B Rp622 di bawah HPP Rp622.%','K13c batas: HPP 622,23 > neto 622,22 ditolak');
rollback;
