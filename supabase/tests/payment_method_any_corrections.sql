-- Koreksi metode ke SEMUA metode (petshop correct_pos_sale_method + klinik correct_clinic_invoice_payment).
-- Fixture fiktif saja; runner PostgreSQL sekali pakai me-rollback semuanya.
begin;
create function pg_temp.ok(c boolean,msg text) returns void language plpgsql as $$begin
 if c is distinct from true then raise exception 'Assertion failed: %',msg;end if;end$$;
create function pg_temp.reject(statement text,message text,expected text default null) returns void language plpgsql as $$declare blocked boolean:=false;begin
 begin execute statement;exception when others then
  blocked:=true;
  if expected is not null and position(expected in sqlerrm)=0 then raise exception 'Wrong rejection for %: %',message,sqlerrm;end if;
 end;
 if not blocked then raise exception 'Expected rejection: %',message;end if;
end$$;
-- Neraca saldo per akun (semua jurnal, termasuk pembalik/pengganti/koreksi), dibaca tanpa RLS.
create function pg_temp.tb() returns jsonb language sql security definer as $$
 select coalesce(jsonb_object_agg(code,bal),'{}'::jsonb) from(
  select a.code,sum(l.debit-l.credit) bal from public.journal_lines l join public.coa_accounts a on a.id=l.account_id
  group by a.code having sum(l.debit-l.credit)<>0) z$$;
create function pg_temp.tb_diff(a jsonb,b jsonb) returns jsonb language sql as $$
 select coalesce(jsonb_object_agg(k,d),'{}'::jsonb) from(
  select k,coalesce((b->>k)::numeric,0)-coalesce((a->>k)::numeric,0) d
  from(select jsonb_object_keys(a) k union select jsonb_object_keys(b)) ks) z where d<>0$$;
create function pg_temp.codes() returns jsonb language sql as $$
 select '{"Tunai":"1141","Transfer":"1142","Debit":"1143","Kredit":"1144","QRIS":"1145","E-Wallet":"1146"}'::jsonb$$;
create function pg_temp.expected_diff(f text,t text,amount numeric) returns jsonb language sql as $$
 select case when pg_temp.codes()->>f=pg_temp.codes()->>t then '{}'::jsonb
  else jsonb_build_object(pg_temp.codes()->>f,-amount,pg_temp.codes()->>t,amount) end$$;
create function pg_temp.jcount() returns bigint language sql security definer as $$select count(*) from public.journal_entries$$;
create function pg_temp.ccount() returns bigint language sql security definer as $$
 select (select count(*) from public.sale_payment_corrections)+(select count(*) from public.clinic_payment_corrections)$$;
create function pg_temp.today() returns date language sql as $$select (now() at time zone 'Asia/Jakarta')::date$$;
create function pg_temp.jbal(entry uuid) returns numeric language sql security definer as $$
 select coalesce(sum(debit-credit),0) from public.journal_lines where entry_id=entry$$;
-- Hitungan tutup shift (persis query penutupan di suite J02): metode -> jumlah.
create function pg_temp.breakdown(shift uuid) returns jsonb language sql security definer as $$
 select coalesce(jsonb_object_agg(method,amount),'{}'::jsonb) from(select p.method,sum(p.amount) amount
  from public.sale_payments p join public.sales s on s.id=p.sale_id
  where s.voided_at is null and s.shift_id=$1 and s.payments_finalized_at is not null group by p.method) z$$;

-- ===== Fixture umum =====
insert into auth.users(id,raw_user_meta_data) values
 ('e9100000-0000-4000-8000-000000000001','{"full_name":"Owner KM"}'),
 ('e9100000-0000-4000-8000-000000000002','{"full_name":"Finance KM"}'),
 ('e9100000-0000-4000-8000-000000000003','{"full_name":"Staff KM"}'),
 ('e9100000-0000-4000-8000-000000000004','{"full_name":"Admin KM"}'),
 ('e9100000-0000-4000-8000-000000000005','{"full_name":"Finance KM lain"}'),
 ('e9100000-0000-4000-8000-000000000006','{"full_name":"Kasir tutup shift"}'),
 ('e9100000-0000-4000-8000-000000000007','{"full_name":"Kasir petshop 2"}'),
 ('e9100000-0000-4000-8000-000000000008','{"full_name":"Kasir klinik tutup"}'),
 ('e9100000-0000-4000-8000-000000000009','{"full_name":"Kasir klinik 2"}');
update profiles set role='OWNER',is_active=true where id='e9100000-0000-4000-8000-000000000001';
update profiles set role='FINANCE',is_active=true where id in('e9100000-0000-4000-8000-000000000002','e9100000-0000-4000-8000-000000000005');
update profiles set role='STAFF',is_active=true where id in('e9100000-0000-4000-8000-000000000003','e9100000-0000-4000-8000-000000000006','e9100000-0000-4000-8000-000000000007','e9100000-0000-4000-8000-000000000008','e9100000-0000-4000-8000-000000000009');
update profiles set role='ADMIN',is_active=true where id='e9100000-0000-4000-8000-000000000004';
insert into branches(id,code,name,type) values
 ('e9200000-0000-4000-8000-000000000001','KMPET1','KM Petshop 1','PETSHOP'),
 ('e9200000-0000-4000-8000-000000000002','KMPET2','KM Petshop 2 (rekening bersama)','PETSHOP'),
 ('e9200000-0000-4000-8000-000000000003','KMKLN1','KM Klinik 1','KLINIK'),
 ('e9200000-0000-4000-8000-000000000004','KMKLN2','KM Klinik 2 (rekening bersama)','KLINIK');
insert into user_branches(user_id,branch_id)
 select u.id,b.id from(values('e9100000-0000-4000-8000-000000000001'::uuid),('e9100000-0000-4000-8000-000000000002'),
  ('e9100000-0000-4000-8000-000000000003'),('e9100000-0000-4000-8000-000000000004'),('e9100000-0000-4000-8000-000000000006'),
  ('e9100000-0000-4000-8000-000000000007'),('e9100000-0000-4000-8000-000000000008'),('e9100000-0000-4000-8000-000000000009')) u(id),
  (select id from branches where code like 'KM%') b;
insert into cashier_shifts(id,branch_id,opened_by,shift_type) values
 ('e9400000-0000-4000-8000-000000000001','e9200000-0000-4000-8000-000000000001','e9100000-0000-4000-8000-000000000001','petshop'),
 ('e9400000-0000-4000-8000-000000000002','e9200000-0000-4000-8000-000000000001','e9100000-0000-4000-8000-000000000006','petshop'),
 ('e9400000-0000-4000-8000-000000000004','e9200000-0000-4000-8000-000000000002','e9100000-0000-4000-8000-000000000007','petshop');
insert into items(id,code,name,unit,item_type) values('e9500000-0000-4000-8000-000000000001','KMSERVICE','KM service','pcs','Jasa');
insert into coa_accounts(code,name,type,normal_balance,is_header) values
 ('1141','KM kas','ASET','D',false),('1142','KM bank','ASET','D',false),('1143','KM debit','ASET','D',false),
 ('1144','KM kredit','ASET','D',false),('1145','KM qris','ASET','D',false),('1146','KM ewallet','ASET','D',false),
 ('110003','Kas','ASET','D',false),('120002','Bank','ASET','D',false),('150001','Piutang','ASET','D',false),
 ('510001','Sales','PENDAPATAN','K',false),('520002','Discount','PENDAPATAN','D',false),
 ('312005','VAT','LIABILITAS','K',false),('600001','COGS','BEBAN','D',false),('170001','Inventory','ASET','D',false),
 ('510002','Pendapatan Klinik','PENDAPATAN','K',false)
 on conflict(code) do update set is_active=true,is_header=false;
insert into cash_accounts(id,nama,jenis,coa_code) values
 ('e9600000-0000-4000-8000-000000000001','KM kas','Kas','1141'),('e9600000-0000-4000-8000-000000000002','KM bank','Bank','1142'),
 ('e9600000-0000-4000-8000-000000000003','KM debit','Bank','1143'),('e9600000-0000-4000-8000-000000000004','KM kredit','Bank','1144'),
 ('e9600000-0000-4000-8000-000000000005','KM qris','Bank','1145'),('e9600000-0000-4000-8000-000000000006','KM ewallet','Bank','1146'),
 ('e9600000-0000-4000-8000-000000000007','Kas klinik','Kas','110003'),('e9600000-0000-4000-8000-000000000008','Bank klinik','Bank','120002')
 on conflict(coa_code) do update set is_active=true,branch_id=null;
-- Petshop 1 dan Klinik 1: enam rekening berbeda. Petshop 2 dan Klinik 2: Transfer dan Debit berbagi satu rekening.
insert into payment_account_map(metode,branch_id,cash_account_id)
 select m.metode,b.id,(select id from cash_accounts where coa_code=pg_temp.codes()->>m.metode)
 from(values('Tunai'),('Transfer'),('Debit'),('Kredit'),('QRIS'),('E-Wallet')) m(metode),
  (select id from branches where code in('KMPET1','KMKLN1')) b;
insert into payment_account_map(metode,branch_id,cash_account_id)
 select m.metode,(select id from branches where code='KMPET2'),(select id from cash_accounts where coa_code=m.code)
 from(values('Tunai','1141'),('Transfer','1142'),('Debit','1142'),('QRIS','1145')) m(metode,code);
insert into payment_account_map(metode,branch_id,cash_account_id)
 select m.metode,(select id from branches where code='KMKLN2'),(select id from cash_accounts where coa_code=m.code)
 from(values('Tunai','110003'),('Transfer','120002'),('Debit','120002')) m(metode,code);
update accounting_locks set closed_until=null where id;
update company_settings set mode_pkp=false,ppn_rate=11;
update clinic_billing_settings set min_dp_percent=0 where id;

-- Penjualan petshop terposting (dipanggil sebagai kasir/OWNER).
create function pg_temp.mk_sale(tag text,method text,total numeric,branch uuid,shift uuid,tendered numeric default null,
 plan jsonb default null,fee numeric default 0) returns uuid language plpgsql as $$
declare sid uuid:=gen_random_uuid();begin
 insert into sales(id,branch_id,no_struk,subtotal,total,merchant_fee_total,metode_bayar,bayar,kembali,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint)
 values(sid,branch,'KM.'||tag,total-fee,total,fee,method,coalesce(tendered,total),coalesce(tendered,total)-total,
  auth.uid(),shift,
  coalesce(plan,jsonb_build_array(jsonb_build_object('method',method,'amount',total))),'km-'||tag,repeat('a',64));
 insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp)
 values(sid,'e9500000-0000-4000-8000-000000000001','KM service',1,total-fee,'pcs',1,0);
 perform finalize_pos_sale(sid);
 return sid;end$$;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','e9100000-0000-4000-8000-000000000001',true);

create function pg_temp.force_rollback() returns trigger language plpgsql as $$begin raise exception 'Injected audit storage failure';end$$;

-- ===== K. Klinik rawat jalan =====
reset role;
insert into customers(id,name,phone) values('e9800000-0000-4000-8000-000000000001','Pelanggan KM','080000000301');
insert into pets(id,customer_id,name) values('e9800000-0000-4000-8000-000000000002','e9800000-0000-4000-8000-000000000001','Pasien KM');
insert into visits(id,branch_id,customer_id,pet_id)
 select ('e9a00000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,
  case when n<=50 then 'e9200000-0000-4000-8000-000000000003'::uuid else 'e9200000-0000-4000-8000-000000000004'::uuid end,
  'e9800000-0000-4000-8000-000000000001','e9800000-0000-4000-8000-000000000002' from generate_series(1,60) n;
insert into cashier_shifts(id,branch_id,opened_by,shift_type,status) values
 ('e9b00000-0000-4000-8000-000000000001','e9200000-0000-4000-8000-000000000003','e9100000-0000-4000-8000-000000000001','klinik','open'),
 ('e9b00000-0000-4000-8000-000000000002','e9200000-0000-4000-8000-000000000003','e9100000-0000-4000-8000-000000000008','klinik','open'),
 ('e9b00000-0000-4000-8000-000000000003','e9200000-0000-4000-8000-000000000004','e9100000-0000-4000-8000-000000000009','klinik','open');
create function pg_temp.mk_inv(visit_n integer,method text,total numeric,shift text default 'e9b00000-0000-4000-8000-000000000001',
 paid text default 'Lunas',dp numeric default 0) returns uuid language sql as $$
 select public.clinic_post_invoice(('e9a00000-0000-4000-8000-0000000000'||lpad($1::text,2,'0'))::uuid,'km-inv-'||$1,
  jsonb_build_object('tanggal',pg_temp.today(),'subtotal',$3,'discount',0,'tax',0,'total',$3,'dp_amount',$6,'dp_date',pg_temp.today(),
   'paid_status',$5,'metode_bayar',$2,'shift_id',$4::uuid),
  jsonb_build_array(jsonb_build_object('description','Layanan KM','qty',1,'price',$3,'kind','jasa','discount_percent',0)))$$;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','e9100000-0000-4000-8000-000000000001',true);

-- K1. 30 pasangan pembayaran langsung (lunas sekali bayar)
do $$
declare m text[]:=array['Tunai','Transfer','Debit','Kredit','QRIS','E-Wallet'];f text;t text;iid uuid;tb0 jsonb;tb1 jsonb;
 res jsonb;n integer:=0;amt numeric;actor uuid;aud public.clinic_payment_corrections%rowtype;
begin
 foreach f in array m loop foreach t in array m loop
  continue when f=t;
  n:=n+1;amt:=20000+n*1000;
  actor:=case when n%2=0 then 'e9100000-0000-4000-8000-000000000001' else 'e9100000-0000-4000-8000-000000000002' end;
  perform set_config('request.jwt.claim.sub','e9100000-0000-4000-8000-000000000001',true);
  iid:=pg_temp.mk_inv(n,f,amt);
  perform set_config('request.jwt.claim.sub',actor::text,true);
  tb0:=pg_temp.tb();
  res:=correct_clinic_invoice_payment(iid,null,0,'km-kc-'||n,'Kasir salah pilih metode '||n,t);
  tb1:=pg_temp.tb();
  perform pg_temp.ok((res->>'revision')::int=1 and res->>'method'=t,'clinic result '||f||'->'||t);
  perform pg_temp.ok((select metode_bayar=t and total=amt and voided_at is null and paid_status='Lunas' from invoices where id=iid),'clinic invoice '||f||'->'||t);
  select * into aud from clinic_payment_corrections where invoice_id=iid;
  perform pg_temp.ok(aud.from_method=f and aud.to_method=t and aud.from_code=pg_temp.codes()->>f and aud.to_code=pg_temp.codes()->>t
   and aud.amount=amt and aud.created_by=actor and aud.source_shift_status='open' and aud.journal_id is not null
   and pg_temp.jbal(aud.journal_id)=0 and (select count(*)=2 from journal_lines where entry_id=aud.journal_id),'clinic audit+journal '||f||'->'||t);
  perform pg_temp.ok(pg_temp.tb_diff(tb0,tb1)=pg_temp.expected_diff(f,t,amt),'clinic trial balance '||f||'->'||t||' '||pg_temp.tb_diff(tb0,tb1)::text);
 end loop;end loop;
 perform pg_temp.ok(n=30,'thirty clinic pairs exercised');
end $$;
select set_config('request.jwt.claim.sub','e9100000-0000-4000-8000-000000000001',true);

-- K2. Split per bagian: Debit 30.000 + QRIS 70.000
create temp table kmk(name text primary key,id uuid);
grant all on kmk to authenticated;
insert into kmk select 'split',public.clinic_post_split_invoice('e9a00000-0000-4000-8000-000000000041','km-inv-split',
 jsonb_build_object('tanggal',pg_temp.today(),'subtotal',100000,'discount',0,'tax',0,'total',100000,'dp_amount',0,
  'paid_status','Lunas','metode_bayar','Debit','shift_id','e9b00000-0000-4000-8000-000000000001'),
 '[{"description":"Tindakan KM","qty":1,"price":100000,"kind":"jasa","discount_percent":0}]',
 '[{"method":"Debit","amount":30000,"kas_code":"1143"},{"method":"QRIS","amount":70000,"kas_code":"1145"}]');
create temp table km_sp as select pg_temp.tb() tb0;
grant select on km_sp to authenticated;
select set_config('request.jwt.claim.sub','e9100000-0000-4000-8000-000000000002',true);
select correct_clinic_invoice_payment((select id from kmk where name='split'),
 (select id from invoice_payments where invoice_id=(select id from kmk where name='split') and metode='Debit'),0,'km-sp-1','Bagian pertama kredit','Kredit');
select correct_clinic_invoice_payment((select id from kmk where name='split'),
 (select id from invoice_payments where invoice_id=(select id from kmk where name='split') and metode='QRIS'),1,'km-sp-2','Bagian kedua e-wallet','E-Wallet');
select pg_temp.ok((select count(*)=2 and sum(amount)=100000 and bool_or(metode='Kredit' and kas_code='1144' and amount=30000)
  and bool_or(metode='E-Wallet' and kas_code='1146' and amount=70000) and bool_and(checkout_payment) from invoice_payments where invoice_id=(select id from kmk where name='split'))
 and pg_temp.tb_diff((select tb0 from km_sp),pg_temp.tb())=jsonb_build_object('1143',-30000,'1144',30000,'1145',-70000,'1146',70000),
 'split parts corrected independently to different methods; ledger moves exactly per part');
select pg_temp.reject($q$select correct_clinic_invoice_payment((select id from kmk where name='split'),null,2,'km-sp-direct','Langsung','Tunai')$q$,'split invoice has no direct payment','tidak memiliki pembayaran langsung');

-- K3. DP lalu pelunasan
select set_config('request.jwt.claim.sub','e9100000-0000-4000-8000-000000000001',true);
insert into kmk select 'dp',pg_temp.mk_inv(42,'QRIS',100000,'e9b00000-0000-4000-8000-000000000001','DP',50000);
select clinic_receive_invoice_payment((select id from kmk where name='dp'),pg_temp.today(),50000,'E-Wallet','1146',null,'km-dp-settle');
create temp table km_dp as select pg_temp.tb() tb0;
grant select on km_dp to authenticated;
select set_config('request.jwt.claim.sub','e9100000-0000-4000-8000-000000000002',true);
select correct_clinic_invoice_payment((select id from kmk where name='dp'),null,0,'km-dp-1','DP sebenarnya debit','Debit');
select correct_clinic_invoice_payment((select id from kmk where name='dp'),(select id from invoice_payments where invoice_id=(select id from kmk where name='dp')),1,'km-dp-2','Pelunasan tunai','Tunai');
select pg_temp.ok(pg_temp.tb_diff((select tb0 from km_dp),pg_temp.tb())=jsonb_build_object('1145',-50000,'1143',50000,'1146',-50000,'1141',50000)
 and (select paid_status='Lunas' and metode_bayar='Debit' from invoices where id=(select id from kmk where name='dp')),
 'DP and settlement corrected to different methods, receivable untouched');

-- K4. Invoice DEMO ditolak (juga Tunai<->Transfer)
select set_config('request.jwt.claim.sub','e9100000-0000-4000-8000-000000000001',true);
insert into kmk select 'demo',pg_temp.mk_inv(43,'Tunai',50000);
reset role;
insert into clinic_demo_policies(id,name,incentive_percent,fee_bearer,fee_rates,admin_revenue_code,admin_expense_code,is_active)
 values('e9c00000-0000-4000-8000-000000000001','Policy KM',10,'company','{"Debit":100}','510002','600001',false);
insert into clinic_demo_invoice_snapshots(invoice_id,policy_id,branch_id,request_key,request_hash,base_total,fee_amount,fee_bearer,payments,service_basis,incentive_pool)
 select id,'e9c00000-0000-4000-8000-000000000001','e9200000-0000-4000-8000-000000000003','km-inv-43','h',50000,0,'company','[]',0,0 from kmk where name='demo';
set local role authenticated;
select set_config('request.jwt.claim.sub','e9100000-0000-4000-8000-000000000002',true);
select pg_temp.reject($q$select correct_clinic_invoice_payment((select id from kmk where name='demo'),null,0,'km-demo-1','Salah metode','Debit')$q$,'DEMO invoice to Debit','Invoice DEMO');
select pg_temp.reject($q$select correct_clinic_invoice_payment((select id from kmk where name='demo'),null,0,'km-demo-2','Salah metode','Transfer')$q$,'DEMO invoice Tunai to Transfer is refused too','Invoice DEMO');

-- K5. Bagian milik kwitansi rawat inap ditolak
select set_config('request.jwt.claim.sub','e9100000-0000-4000-8000-000000000001',true);
insert into kmk select 'receipt',public.clinic_post_split_invoice('e9a00000-0000-4000-8000-000000000044','km-inv-receipt',
 jsonb_build_object('tanggal',pg_temp.today(),'subtotal',100000,'discount',0,'tax',0,'total',100000,'dp_amount',0,
  'paid_status','Lunas','metode_bayar','Debit','shift_id','e9b00000-0000-4000-8000-000000000001'),
 '[{"description":"Tindakan KM","qty":1,"price":100000,"kind":"jasa","discount_percent":0}]',
 '[{"method":"Debit","amount":30000,"kas_code":"1143"},{"method":"QRIS","amount":70000,"kas_code":"1145"}]');
reset role;
alter table invoice_payments disable trigger user;
insert into clinic_payment_receipts(id,no_kwitansi,visit_id,branch_id,tanggal,total,request_key,request_hash)
 values('e9d00000-0000-4000-8000-000000000001','KW.KM.1','e9a00000-0000-4000-8000-000000000044','e9200000-0000-4000-8000-000000000003',pg_temp.today(),30000,'km-kw-1','h');
update invoice_payments set receipt_id='e9d00000-0000-4000-8000-000000000001'
 where invoice_id=(select id from kmk where name='receipt') and metode='Debit';
alter table invoice_payments enable trigger user;
set local role authenticated;
select set_config('request.jwt.claim.sub','e9100000-0000-4000-8000-000000000002',true);
select pg_temp.reject($q$select correct_clinic_invoice_payment((select id from kmk where name='receipt'),
 (select id from invoice_payments where invoice_id=(select id from kmk where name='receipt') and metode='Debit'),0,'km-kw-fix','Salah metode','Tunai')$q$,
 'receipt-bound part refused','kwitansi rawat inap');
select correct_clinic_invoice_payment((select id from kmk where name='receipt'),
 (select id from invoice_payments where invoice_id=(select id from kmk where name='receipt') and metode='QRIS'),0,'km-kw-ok','Bagian tanpa kwitansi boleh','Tunai');
select pg_temp.ok((select bool_or(metode='Tunai' and amount=70000) from invoice_payments where invoice_id=(select id from kmk where name='receipt')),'a part without a receipt is still correctable');

-- K6. Rekening bersama (Transfer dan Debit sama-sama 120002): label saja, tanpa jurnal
select set_config('request.jwt.claim.sub','e9100000-0000-4000-8000-000000000009',true);
insert into kmk select 'shared',public.clinic_post_invoice('e9a00000-0000-4000-8000-000000000051','km-inv-shared',
 jsonb_build_object('tanggal',pg_temp.today(),'subtotal',60000,'discount',0,'tax',0,'total',60000,'dp_amount',0,
  'paid_status','Lunas','metode_bayar','Transfer','shift_id','e9b00000-0000-4000-8000-000000000003'),
 '[{"description":"Layanan KM","qty":1,"price":60000,"kind":"jasa","discount_percent":0}]');
create temp table km_ksh as select pg_temp.tb() tb0,pg_temp.jcount() entries;
grant select on km_ksh to authenticated;
select set_config('request.jwt.claim.sub','e9100000-0000-4000-8000-000000000002',true);
select correct_clinic_invoice_payment((select id from kmk where name='shared'),null,0,'km-ksh-1','Debit bukan transfer','Debit');
select pg_temp.ok(pg_temp.tb_diff((select tb0 from km_ksh),pg_temp.tb())='{}'::jsonb
 and pg_temp.jcount()=(select entries from km_ksh)
 and (select metode_bayar='Debit' from invoices where id=(select id from kmk where name='shared'))
 and (select count(*)=1 and bool_and(journal_id is null and from_code='120002' and to_code='120002' and from_method='Transfer' and to_method='Debit')
  from clinic_payment_corrections where invoice_id=(select id from kmk where name='shared')),
 'shared account: label-only correction, no journal, audit row kept');
select correct_clinic_invoice_payment((select id from kmk where name='shared'),null,1,'km-ksh-2','Ternyata tunai','Tunai');
select pg_temp.ok(pg_temp.tb_diff((select tb0 from km_ksh),pg_temp.tb())=jsonb_build_object('120002',-60000,'110003',60000)
 and (select count(*)=2 from clinic_payment_corrections where invoice_id=(select id from kmk where name='shared')),
 'label-only correction then a real move to cash uses the latest account');

-- K7. Replay, peran, periode, rekonsiliasi, rollback, shift tertutup
select set_config('request.jwt.claim.sub','e9100000-0000-4000-8000-000000000001',true);
insert into kmk select 'guards',pg_temp.mk_inv(45,'Debit',44000);
select pg_temp.ok((select count(*)>=1 from clinic_payment_corrections),'owner reads the trail');
create temp table km_kb as select pg_temp.tb() tb0,pg_temp.jcount() entries,pg_temp.ccount() corrections;
grant select on km_kb to authenticated;
select set_config('request.jwt.claim.sub','e9100000-0000-4000-8000-000000000003',true);
select pg_temp.reject($q$select correct_clinic_invoice_payment((select id from kmk where name='guards'),null,0,'km-k-staff','Salah metode','Tunai')$q$,'staff refused','Hanya Owner atau Finance');
select set_config('request.jwt.claim.sub','e9100000-0000-4000-8000-000000000004',true);
select pg_temp.reject($q$select correct_clinic_invoice_payment((select id from kmk where name='guards'),null,0,'km-k-admin','Salah metode','Tunai')$q$,'admin refused (J02: OWNER/FINANCE only)','Hanya Owner atau Finance');
select set_config('request.jwt.claim.sub','e9100000-0000-4000-8000-000000000002',true);
select pg_temp.reject($q$select correct_clinic_invoice_payment((select id from kmk where name='guards'),null,0,'km-k-kartu','Salah metode','Kartu')$q$,'unknown method','tidak valid');
select pg_temp.reject($q$select correct_clinic_invoice_payment((select id from kmk where name='guards'),null,0,'km-k-same','Salah metode','Debit')$q$,'same method','tidak mengubah');
select pg_temp.reject($q$select correct_clinic_invoice_payment((select id from kmk where name='guards'),null,5,'km-k-stale','Salah metode','Tunai')$q$,'stale revision','sudah berubah');
reset role;
update accounting_locks set closed_until=pg_temp.today() where id;
set local role authenticated;
select pg_temp.reject($q$select correct_clinic_invoice_payment((select id from kmk where name='guards'),null,0,'km-k-period','Salah metode','Tunai')$q$,'closed period','Periode sumber atau koreksi telah ditutup');
reset role;
update accounting_locks set closed_until=null where id;
insert into bank_reconciliations(tanggal,cash_account_id,bank_coa_code) values(pg_temp.today(),'e9600000-0000-4000-8000-000000000001','1141');
set local role authenticated;
select pg_temp.reject($q$select correct_clinic_invoice_payment((select id from kmk where name='guards'),null,0,'km-k-recon','Salah metode','Tunai')$q$,'reconciled destination account','Rekonsiliasi bank');
reset role;
delete from bank_reconciliations;
update cash_accounts set is_active=false where coa_code='1141';
set local role authenticated;
select pg_temp.reject($q$select correct_clinic_invoice_payment((select id from kmk where name='guards'),null,0,'km-k-inactive','Salah metode','Tunai')$q$,'inactive destination','belum dipetakan');
reset role;
update cash_accounts set is_active=true where coa_code='1141';
create trigger km_k_force_rollback before insert on clinic_payment_corrections for each row execute function pg_temp.force_rollback();
set local role authenticated;
select pg_temp.reject($q$select correct_clinic_invoice_payment((select id from kmk where name='guards'),null,0,'km-k-rollback','Salah metode','Tunai')$q$,'audit failure rolls back journal and invoice','Injected audit storage failure');
reset role;
drop trigger km_k_force_rollback on clinic_payment_corrections;
select pg_temp.ok(pg_temp.tb()=(select tb0 from km_kb) and pg_temp.jcount()=(select entries from km_kb)
 and pg_temp.ccount()=(select corrections from km_kb)
 and (select metode_bayar='Debit' from invoices where id=(select id from kmk where name='guards')),
 'rejected clinic corrections left ledger, invoice and audit untouched');
-- replay
set local role authenticated;
select set_config('request.jwt.claim.sub','e9100000-0000-4000-8000-000000000002',true);
create temp table km_kr as select 'a'::text name,correct_clinic_invoice_payment((select id from kmk where name='guards'),null,0,'km-k-replay','Salah metode','QRIS') result;
grant all on km_kr to authenticated;
insert into km_kr select 'b',correct_clinic_invoice_payment((select id from kmk where name='guards'),null,0,'km-k-replay','Salah metode','QRIS');
select pg_temp.ok((select (select result from km_kr where name='a')=(select result from km_kr where name='b'))
 and (select count(*)=1 from clinic_payment_corrections where invoice_id=(select id from kmk where name='guards')),'clinic replay is idempotent');
select pg_temp.reject($q$select correct_clinic_invoice_payment((select id from kmk where name='guards'),null,0,'km-k-replay','Salah metode','Kredit')$q$,'changed method on same key','rincian berbeda');
-- shift klinik tertutup
select set_config('request.jwt.claim.sub','e9100000-0000-4000-8000-000000000008',true);
insert into kmk select 'closed',pg_temp.mk_inv(46,'Tunai',90000,'e9b00000-0000-4000-8000-000000000002');
reset role;
update cashier_shifts set status='closed',closed_at=now(),expected_cash=90000,closing_balance=90000,selisih=0,
 closing_breakdown='{"Tunai":90000}' where id='e9b00000-0000-4000-8000-000000000002';
create temp table km_kclosed as select to_jsonb(s) snap from cashier_shifts s where id='e9b00000-0000-4000-8000-000000000002';
grant select on km_kclosed to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','e9100000-0000-4000-8000-000000000002',true);
select correct_clinic_invoice_payment((select id from kmk where name='closed'),null,0,'km-k-closed','Pelanggan bayar kredit','Kredit');
reset role;
select pg_temp.ok((select to_jsonb(s)=(select snap from km_kclosed) from cashier_shifts s where id='e9b00000-0000-4000-8000-000000000002')
 and (select source_shift_status='closed' from clinic_payment_corrections where invoice_id=(select id from kmk where name='closed')),
 'closed clinic shift untouched, status recorded');
select pg_temp.ok((select coalesce(sum(debit-credit),0)=0 from journal_lines),'whole ledger balanced at the end');
select pg_temp.ok((select count(*)=0 from journal_entries e where (select coalesce(sum(debit-credit),0) from journal_lines where entry_id=e.id)<>0),'every journal entry balanced');
rollback;
