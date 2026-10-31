-- J03 clinic refund posting. Appended to the clinic_invoice_post.sql prelude; everything rolls back.
-- Invoice: 2 strip medicine @100 (stock 20 pcs, FIFO cost 50) + 1 service @100, discount 10, tax 20, total 310.
insert into public.coa_accounts(code,name,type,normal_balance,is_active,is_header)
values('120002','Bank','ASET','D',true,false),('720010','Beban kerusakan','BEBAN','D',true,false)
on conflict(code) do update set is_active=true,is_header=false;
insert into public.cash_accounts(id,nama,jenis,coa_code)values('dc000000-0000-4000-8000-000000000002','Bank Uji Klinik','Bank','120002')
on conflict(coa_code) do update set is_active=true,jenis='Bank',branch_id=null;
insert into public.payment_account_map(metode,branch_id,cash_account_id)
select 'Tunai','d2000000-0000-4000-8000-000000000001',id from public.cash_accounts where coa_code='110003';
insert into auth.users(id,raw_user_meta_data)values('d1000000-0000-4000-8000-000000000004','{"full_name":"Finance Test"}'),('d1000000-0000-4000-8000-000000000005','{"full_name":"Staf tanpa shift"}');
update public.profiles set role='FINANCE' where id='d1000000-0000-4000-8000-000000000004';
update public.profiles set role='STAFF' where id='d1000000-0000-4000-8000-000000000005';
insert into public.user_branches(user_id,branch_id)values('d1000000-0000-4000-8000-000000000004','d2000000-0000-4000-8000-000000000001'),('d1000000-0000-4000-8000-000000000005','d2000000-0000-4000-8000-000000000001');
create function pg_temp.ok(c boolean,msg text) returns void language plpgsql as $$begin if c is not true then raise exception 'FAILED: %',msg;end if;end$$;
create function pg_temp.reject(q text,msg text) returns void language plpgsql as $$begin
 begin execute q;exception when others then return;end;raise exception 'FAILED (expected rejection): %',msg;end$$;
create function pg_temp.bal(p_src text,p_code text) returns numeric language sql as $$
 select coalesce(sum(l.debit-l.credit),0) from journal_entries j join journal_lines l on l.entry_id=j.id join coa_accounts a on a.id=l.account_id where j.source=p_src and a.code=p_code$$;
create temp table r(name text,result jsonb);
grant all on r to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
create temp table inv as
 select public.clinic_post_invoice('d6000000-0000-4000-8000-000000000001','j03-refund-post',
 jsonb_build_object('tanggal',(now()at time zone'Asia/Jakarta')::date,'subtotal',300,'discount',10,'tax',20,'total',310,'dp_amount',0,'paid_status','Belum Lunas','metode_bayar','Tunai','shift_id','da000000-0000-4000-8000-000000000001'),
 '[{"description":"Obat Unit","qty":2,"price":100,"kind":"obat","item_id":"d8000000-0000-4000-8000-000000000001","unit":"strip","prescription_item_id":"d9000000-0000-4000-8000-000000000001","discount_percent":0},{"description":"Konsultasi fiktif","qty":1,"price":100,"kind":"jasa","discount_percent":0}]')id;
select clinic_receive_invoice_payment((select id from inv),(now()at time zone'Asia/Jakarta')::date,310,'Tunai','110003','Fictional full receipt','j03-refund-payment');
reset role;
-- Points written by the payment screen with ref = invoice number: 9 redeemed, 31 earned.
update customers set points=22 where id='d4000000-0000-4000-8000-000000000001';
insert into point_ledger(customer_id,delta,saldo,ref,description)select 'd4000000-0000-4000-8000-000000000001',-9,0,invoice_no,'Poin digunakan' from invoices where id=(select id from inv);
insert into point_ledger(customer_id,delta,saldo,ref,description)select 'd4000000-0000-4000-8000-000000000001',31,22,invoice_no,'Kunjungan klinik' from invoices where id=(select id from inv);
create temp table lines as select id,jenis from invoice_items where invoice_id=(select id from inv);
grant all on inv,lines to authenticated;
create function pg_temp.items(med integer,cond text,svc integer) returns jsonb language sql as $$
 select coalesce(jsonb_agg(x),'[]') from (
  select jsonb_build_object('invoice_item_id',id,'qty',med,'kondisi',cond) x from lines where jenis='obat' and med>0
  union all select jsonb_build_object('invoice_item_id',id,'qty',svc) from lines where jenis='jasa' and svc>0)q$$;
create function pg_temp.hdr(method text) returns jsonb language sql as $$select jsonb_build_object('tanggal',(now() at time zone 'Asia/Jakarta')::date,'refund_method',method,
 'destination',jsonb_build_object('bank','Bank fiktif','account','000123456','name','Penerima fiktif'))$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);

-- 0) A sellable medicine cannot come back with an expired (or absurd) batch date.
select pg_temp.reject($q$select post_clinic_refund((select id from inv),'j03-expired',pg_temp.hdr('Tunai'),jsonb_build_array(jsonb_build_object('invoice_item_id',(select id from lines where jenis='obat'),'qty',1,'kondisi','baik','exp_date','2000-01-01')))$q$,'expired batch rejected');
select pg_temp.reject($q$select post_clinic_refund((select id from inv),'j03-far',pg_temp.hdr('Tunai'),jsonb_build_array(jsonb_build_object('invoice_item_id',(select id from lines where jenis='obat'),'qty',1,'kondisi','baik','exp_date','2199-01-01')))$q$,'absurd batch date rejected');

-- 1) Cash refund of one whole strip marked layak jual: stock, HPP, revenue, cash, points.
insert into r select 'cash',post_clinic_refund((select id from inv),'j03-c1',pg_temp.hdr('Tunai'),pg_temp.items(1,'baik',0));
select pg_temp.ok((select result->>'status'='selesai' and (result->>'total')::numeric=103.33 and (result->>'point_delta')::int=-10 and (result->>'point_restored')::int=2 from r where name='cash'),'cash refund posts 1/3: 10 earned points deducted, 2 redeemed points restored');
insert into r select 'cash-replay',post_clinic_refund((select id from inv),'j03-c1',pg_temp.hdr('Tunai'),pg_temp.items(1,'baik',0));
select pg_temp.ok((select (select result from r where name='cash')=(select result from r where name='cash-replay')),'double submit returns the same receipt');
select pg_temp.reject($q$select post_clinic_refund((select id from inv),'j03-c1',pg_temp.hdr('Tunai'),pg_temp.items(1,'rusak',0))$q$,'same key with other details rejected');
select pg_temp.reject($q$select post_clinic_refund((select id from inv),'j03-over',pg_temp.hdr('Tunai'),pg_temp.items(2,'baik',0))$q$,'qty above remaining rejected');
select pg_temp.reject($q$select post_clinic_refund((select id from inv),'j03-frac',pg_temp.hdr('Tunai'),jsonb_build_array(jsonb_build_object('invoice_item_id',(select id from lines where jenis='obat'),'qty',0.5)))$q$,'fractional qty rejected');
reset role;
select pg_temp.ok((select count(*)=1 from clinic_refunds),'one refund document');
select pg_temp.ok((select qty=20 from stock where warehouse_id='d3000000-0000-4000-8000-000000000001' and item_id='d8000000-0000-4000-8000-000000000001'),'one strip (10 pcs) back in stock');
select pg_temp.ok((select count(*)=1 and sum(qty)=10 from stock_moves where source='retur-klinik'),'stock move recorded');
select pg_temp.ok(pg_temp.bal('klinik-refund','510002')=99.99 and pg_temp.bal('klinik-refund','520002')=-3.33 and pg_temp.bal('klinik-refund','312005')=6.67 and pg_temp.bal('klinik-refund','110003')=-103.33,'revenue/discount/tax/cash reversed pro rata');
select pg_temp.ok(pg_temp.bal('klinik-refund-hpp','170001')=25 and pg_temp.bal('klinik-refund-hpp','600001')=-25,'returned stock reverses HPP at original cost');
select pg_temp.ok((select jumlah=103.33 and metode_bayar='Tunai' and shift_id='da000000-0000-4000-8000-000000000001' from expenses where id=(select expense_id from clinic_refunds)),'cash payout reduces the clinic shift');
select pg_temp.ok((select points=14 from customers where id='d4000000-0000-4000-8000-000000000001'),'points: 22 + 2 restored - 10 deducted');
select pg_temp.ok((select total_spending=206.67 from customers where id='d4000000-0000-4000-8000-000000000001'),'customer spending is net of refund');

-- 2) Guards: a refunded invoice cannot be corrected away, nor its payout edited.
select pg_temp.reject($q$update invoices set correction_pending=true where id=(select id from inv)$q$,'refunded invoice locked');
select pg_temp.reject($q$delete from invoice_items where invoice_id=(select id from inv)$q$,'refunded invoice lines locked');
select pg_temp.reject($q$update expenses set jumlah=1 where id=(select expense_id from clinic_refunds)$q$,'refund payout expense locked');
select pg_temp.reject($q$update clinic_refunds set total=1$q$,'refund document immutable');

-- 3) Role checks follow the Akses Grup matrix; cash needs the actor's own open shift.
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000005',true);
select pg_temp.reject($q$select post_clinic_refund((select id from inv),'j03-staff',pg_temp.hdr('Tunai'),pg_temp.items(0,null,1))$q$,'clinic staff without own shift cannot pay cash');
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000004',true);
select pg_temp.reject($q$select post_clinic_refund((select id from inv),'j03-fin',pg_temp.hdr('Transfer'),pg_temp.items(0,null,1))$q$,'role without the clinic module rejected');
reset role;
insert into role_modules(role,module_id)values('STAFF','pos');
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000005',true);
select pg_temp.reject($q$select post_clinic_refund((select id from inv),'j03-staff-matrix',pg_temp.hdr('Transfer'),pg_temp.items(0,null,1))$q$,'saved matrix without clinic module rejected');
reset role;
delete from role_modules where role='STAFF';
set local role authenticated;

-- 4) Transfer for the service, claimed by finance; a cash refund of the other line posts
--    meanwhile; completing the (already paid) transfer must still succeed with its quote.
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
insert into r select 'pending',post_clinic_refund((select id from inv),'j03-t1',pg_temp.hdr('Transfer'),pg_temp.items(0,null,1));
select pg_temp.ok((select result->>'status'='pending' and (result->>'quoted_total')::numeric=103.34 from r where name='pending'),'transfer request pending with cumulative cent rounding');
select pg_temp.ok((select count(*)=1 from clinic_refunds),'pending request posts nothing');
select pg_temp.reject($q$select claim_clinic_refund_request((select (result->>'refund_request_id')::uuid from r where name='pending'))$q$,'requester cannot claim finance queue');
select pg_temp.ok((select jsonb_array_length(get_clinic_refund_requests((select id from inv)))=2),'invoice panel lists its requests');
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000004',true);
select claim_clinic_refund_request((select (result->>'refund_request_id')::uuid from r where name='pending'));
select pg_temp.ok((select count(*)=1 from jsonb_array_elements(get_clinic_refund_requests(null,true,'diproses'))),'finance queue shows the claimed request');
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
select pg_temp.reject($q$select post_clinic_refund((select id from inv),'j03-race',pg_temp.hdr('Tunai'),pg_temp.items(0,null,1))$q$,'reserved line cannot be refunded twice');
insert into r select 'cash2',post_clinic_refund((select id from inv),'j03-c2',pg_temp.hdr('Tunai'),pg_temp.items(1,'rusak',0));
select pg_temp.ok((select (result->>'total')::numeric=103.33 from r where name='cash2'),'other refund leaves the reserved amount untouched');
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000004',true);
select pg_temp.reject($q$select complete_clinic_refund_request((select (result->>'refund_request_id')::uuid from r where name='pending'),(now() at time zone 'Asia/Jakarta')::date,(select id from cash_accounts where coa_code='110003'),'FICT')$q$,'transfer cannot use a cash account');
reset role;
update customers set points=5 where id='d4000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000004',true);
insert into r select 'done',complete_clinic_refund_request((select (result->>'refund_request_id')::uuid from r where name='pending'),(now() at time zone 'Asia/Jakarta')::date,(select id from cash_accounts where coa_code='120002'),'FICT-TRF-1');
insert into r select 'done-retry',complete_clinic_refund_request((select (result->>'refund_request_id')::uuid from r where name='pending'),(now() at time zone 'Asia/Jakarta')::date,(select id from cash_accounts where coa_code='120002'),'FICT-TRF-1');
select pg_temp.ok((select (select result->>'document_id' from r where name='done')=(select result->>'document_id' from r where name='done-retry')),'completion retry is idempotent');
reset role;
select pg_temp.ok((select (result->>'total')::numeric=103.34 from r where name='done'),'completion posts the quoted (transferred) amount');
select pg_temp.ok((select count(*)=3 and sum(total)=310 from clinic_refunds),'invoice fully refunded exactly once');
select pg_temp.ok(pg_temp.bal('klinik-refund','510002')=300 and pg_temp.bal('klinik-refund','520002')=-10 and pg_temp.bal('klinik-refund','312005')=20 and pg_temp.bal('klinik-refund','120002')=-103.34 and pg_temp.bal('klinik-refund','110003')=-206.66,'cumulative reversal equals the source invoice');
select pg_temp.ok(pg_temp.bal('klinik-refund-hpp','720010')=25 and pg_temp.bal('klinik-refund-hpp','600001')=-50,'unsellable medicine cost to loss, not stock');
select pg_temp.ok((select qty=20 from stock where warehouse_id='d3000000-0000-4000-8000-000000000001' and item_id='d8000000-0000-4000-8000-000000000001'),'unsellable strip and service do not return stock');
select pg_temp.ok((select points=0 from customers where id='d4000000-0000-4000-8000-000000000001') and (select sum(point_delta)=-29 and sum(point_restored)=9 from clinic_refunds),'all 9 redeemed points restored; earned points deducted to zero, never below');
select pg_temp.ok((select total_spending=0 from customers where id='d4000000-0000-4000-8000-000000000001'),'fully refunded invoice adds no spending');
select pg_temp.ok(not exists(select 1 from journal_entries j join journal_lines l on l.entry_id=j.id where j.source in('klinik-refund','klinik-refund-hpp') group by j.id having sum(l.debit-l.credit)<>0),'every refund journal balanced');
select pg_temp.ok((select status='selesai' and refund_id is not null from clinic_refund_requests where request_key='j03-t1'),'request linked to its refund document');
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
select pg_temp.reject($q$select post_clinic_refund((select id from inv),'j03-after',pg_temp.hdr('Tunai'),pg_temp.items(0,null,1))$q$,'nothing left to refund');
select pg_temp.ok((select count(*)=3 from clinic_refunds where invoice_id=(select id from inv)),'branch user reads refunds of the invoice');
reset role;
rollback;
