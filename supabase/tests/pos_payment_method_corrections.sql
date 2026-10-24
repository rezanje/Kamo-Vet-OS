-- Fictional J02 fixtures only. The disposable PostgreSQL runner rolls back all rows.
begin;
create function pg_temp.assert_ok(ok boolean, message text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'Assertion failed: %', message;end if;
end$$;
create function pg_temp.reject(statement text, message text, expected text default null) returns void language plpgsql as $$declare blocked boolean:=false;begin
 begin execute statement;exception when others then
  blocked:=true;
  if expected is not null and position(expected in sqlerrm)=0 then
   raise exception 'Wrong rejection for %: %',message,sqlerrm;end if;
 end;
 if not blocked then raise exception 'Expected rejection: %',message;end if;
end$$;
create function pg_temp.balance_for_sale(doc uuid,code text) returns numeric language sql as $$
 select coalesce(sum(l.debit-l.credit),0) from public.journal_lines l
 join public.journal_entries e on e.id=l.entry_id join public.coa_accounts a on a.id=l.account_id
 where a.code=$2 and ((e.source='sale' and e.source_ref=(select no_struk from public.sales where id=$1))
  or (e.source in('sale-payment-reversal','sale-payment-repost')
   and e.source_ref in(select id::text from public.sale_payment_corrections where sale_id=$1)))
$$;

insert into auth.users(id,raw_user_meta_data) values
 ('e8100000-0000-4000-8000-000000000001','{"full_name":"Owner test"}');
update profiles set role='OWNER',is_active=true where id='e8100000-0000-4000-8000-000000000001';
insert into branches(id,code,name,type) values('e8200000-0000-4000-8000-000000000001','J02TEST','J02 Test','PETSHOP');
insert into user_branches(user_id,branch_id) values('e8100000-0000-4000-8000-000000000001','e8200000-0000-4000-8000-000000000001');
insert into cashier_shifts(id,branch_id,opened_by,shift_type) values('e8400000-0000-4000-8000-000000000001','e8200000-0000-4000-8000-000000000001','e8100000-0000-4000-8000-000000000001','petshop');
insert into items(id,code,name,unit,item_type) values('e8500000-0000-4000-8000-000000000001','J02SERVICE','J02 service','pcs','Jasa');
insert into coa_accounts(code,name,type,normal_balance,is_header) values
 ('1141','J02 cash','ASET','D',false),('1142','J02 bank','ASET','D',false),
 ('4101','Sales','PENDAPATAN','K',false),('4102','Discount','PENDAPATAN','D',false),
 ('2201','VAT','LIABILITAS','K',false),('5101','COGS','BEBAN','D',false),('1301','Inventory','ASET','D',false)
 on conflict(code) do update set is_active=true,is_header=false;
insert into cash_accounts(id,nama,jenis,coa_code) values
 ('e8600000-0000-4000-8000-000000000001','J02 cash','Kas','1141'),
 ('e8600000-0000-4000-8000-000000000002','J02 bank','Bank','1142');
insert into payment_account_map(metode,branch_id,cash_account_id) values
 ('Tunai','e8200000-0000-4000-8000-000000000001','e8600000-0000-4000-8000-000000000001'),
 ('Transfer','e8200000-0000-4000-8000-000000000001','e8600000-0000-4000-8000-000000000002');
update accounting_locks set closed_until=null;
update company_settings set mode_pkp=false,ppn_rate=11;

set local role authenticated;
select set_config('request.jwt.claim.sub','e8100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
insert into sales(id,branch_id,no_struk,subtotal,total,metode_bayar,bayar,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint)
 values('e8700000-0000-4000-8000-000000000001','e8200000-0000-4000-8000-000000000001','J02.CASH',100000,100000,'Tunai',100000,
 'e8100000-0000-4000-8000-000000000001','e8400000-0000-4000-8000-000000000001','[{"method":"Tunai","amount":100000}]','j02-cash',repeat('a',64));
insert into sale_items(id,sale_id,item_id,nama,qty,harga,satuan,faktor,hpp) values
 ('e8800000-0000-4000-8000-000000000001','e8700000-0000-4000-8000-000000000001','e8500000-0000-4000-8000-000000000001','J02 service',1,100000,'pcs',1,0);
select finalize_pos_sale('e8700000-0000-4000-8000-000000000001');
select correct_pos_sale_payment('e8700000-0000-4000-8000-000000000001',0,'j02-correct-one','Kasir salah pilih metode',0,100000);
select pg_temp.assert_ok((select id='e8700000-0000-4000-8000-000000000001' and total=100000 and revision=1 and metode_bayar='Transfer'
 from sales where no_struk='J02.CASH'),'same sale identity and total with corrected method');
select pg_temp.assert_ok((select count(*)=1 and min(method)='Transfer' and sum(amount)=100000 from sale_payments
 where sale_id='e8700000-0000-4000-8000-000000000001'),'effective allocation changed once');
select pg_temp.assert_ok(pg_temp.balance_for_sale('e8700000-0000-4000-8000-000000000001','1141')=0
 and pg_temp.balance_for_sale('e8700000-0000-4000-8000-000000000001','1142')=100000
 and pg_temp.balance_for_sale('e8700000-0000-4000-8000-000000000001','4101')=-100000,
 'same sale has corrected cash/bank ledger with unchanged revenue');
select pg_temp.assert_ok((select count(*)=1 and bool_and(reason='Kasir salah pilih metode') from sale_payment_corrections
 where sale_id='e8700000-0000-4000-8000-000000000001'),'one required audit row');
select pg_temp.assert_ok((select count(*)=2 and bool_and(net=0) from(
 select e.id,sum(l.debit-l.credit) net from journal_entries e join journal_lines l on l.entry_id=e.id
 where e.source_ref=(select id::text from sale_payment_corrections where sale_id='e8700000-0000-4000-8000-000000000001')
 group by e.id) z),'one balanced reversal and one balanced repost');
select pg_temp.assert_ok((select count(*)=1 from sale_items where sale_id='e8700000-0000-4000-8000-000000000001')
 and (select count(*)=0 from stock_moves where source_ref='J02.CASH'),
 'items and stock untouched');
select correct_pos_sale_payment('e8700000-0000-4000-8000-000000000001',0,'j02-correct-one','Kasir salah pilih metode',0,100000);
select pg_temp.assert_ok((select count(*)=1 from sale_payment_corrections where sale_id='e8700000-0000-4000-8000-000000000001'),
 'same retry key does not create a second correction');
select pg_temp.reject($q$select correct_pos_sale_payment('e8700000-0000-4000-8000-000000000001',0,'j02-correct-one','Alasan berbeda',0,100000)$q$,
 'changed retry payload');
select pg_temp.reject($q$select correct_pos_sale_payment('e8700000-0000-4000-8000-000000000001',0,'j02-stale','Kasir salah pilih metode',50000,50000)$q$,
 'stale expected revision');
select pg_temp.reject($q$update sale_payments set amount=1 where sale_id='e8700000-0000-4000-8000-000000000001'$q$,
 'direct payment write remains forbidden');
select pg_temp.reject($q$update sales set payment_plan='[{"method":"Tunai","amount":100000}]' where id='e8700000-0000-4000-8000-000000000001'$q$,
 'direct plan write remains forbidden');
select pg_temp.reject($q$insert into sale_payment_correction_gate(transaction_id,backend_pid,sale_id) values(txid_current(),pg_backend_pid(),'e8700000-0000-4000-8000-000000000001')$q$,
 'caller cannot open private gate');
select pg_temp.assert_ok((select count(*)=1 from sale_payment_corrections where sale_id='e8700000-0000-4000-8000-000000000001')
 and (select count(*)=2 from journal_entries where source_ref=(select id::text from sale_payment_corrections where sale_id='e8700000-0000-4000-8000-000000000001')),
 'rejected retry and direct writes leave one pair of journals');

-- Discount has an additional noncash debit line, not an additional payment.
insert into sales(id,branch_id,no_struk,subtotal,discount,total,metode_bayar,bayar,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint)
 values('e8700000-0000-4000-8000-000000000002','e8200000-0000-4000-8000-000000000001','J02.DISCOUNT',120000,20000,100000,'Tunai',100000,
 'e8100000-0000-4000-8000-000000000001','e8400000-0000-4000-8000-000000000001','[{"method":"Tunai","amount":100000}]','j02-discount',repeat('b',64));
insert into sale_items(id,sale_id,item_id,nama,qty,harga,satuan,faktor,hpp) values
 ('e8800000-0000-4000-8000-000000000002','e8700000-0000-4000-8000-000000000002','e8500000-0000-4000-8000-000000000001','J02 service',1,120000,'pcs',1,0);
select finalize_pos_sale('e8700000-0000-4000-8000-000000000002');
select correct_pos_sale_payment('e8700000-0000-4000-8000-000000000002',0,'j02-discount-correct','Kasir salah pilih metode',0,100000);
select pg_temp.assert_ok(pg_temp.balance_for_sale('e8700000-0000-4000-8000-000000000002','4101')=-120000
 and pg_temp.balance_for_sale('e8700000-0000-4000-8000-000000000002','4102')=20000,
 'discount and revenue remain unchanged');

-- A split with a third method must retain that allocation and its journal line.
insert into coa_accounts(code,name,type,normal_balance,is_header) values('1143','J02 wallet','ASET','D',false);
insert into cash_accounts(id,nama,jenis,coa_code) values('e8600000-0000-4000-8000-000000000003','J02 wallet','Bank','1143');
insert into payment_account_map(metode,branch_id,cash_account_id) values
 ('QRIS','e8200000-0000-4000-8000-000000000001','e8600000-0000-4000-8000-000000000003');
insert into sales(id,branch_id,no_struk,subtotal,total,merchant_fee_total,metode_bayar,bayar,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint)
 values('e8700000-0000-4000-8000-000000000003','e8200000-0000-4000-8000-000000000001','J02.SPLIT',95000,100000,5000,'Split',100000,
 'e8100000-0000-4000-8000-000000000001','e8400000-0000-4000-8000-000000000001',
 '[{"method":"Tunai","amount":20000},{"method":"Transfer","amount":25000},{"method":"QRIS","amount":55000,"fee_percent":10,"fee_amount":5000}]',
 'j02-split',repeat('c',64));
insert into sale_items(id,sale_id,item_id,nama,qty,harga,satuan,faktor,hpp) values
 ('e8800000-0000-4000-8000-000000000003','e8700000-0000-4000-8000-000000000003','e8500000-0000-4000-8000-000000000001','J02 service',1,95000,'pcs',1,0);
select finalize_pos_sale('e8700000-0000-4000-8000-000000000003');
select correct_pos_sale_payment('e8700000-0000-4000-8000-000000000003',0,'j02-split-correct','Kasir salah membagi metode',10000,35000);
select pg_temp.assert_ok((select count(*)=3 and sum(amount)=100000
 and sum(amount) filter(where method='QRIS')=55000
 and sum(fee_amount) filter(where method='QRIS')=5000 from sale_payments
 where sale_id='e8700000-0000-4000-8000-000000000003')
 and pg_temp.balance_for_sale('e8700000-0000-4000-8000-000000000003','1141')=10000
 and pg_temp.balance_for_sale('e8700000-0000-4000-8000-000000000003','1142')=35000
 and pg_temp.balance_for_sale('e8700000-0000-4000-8000-000000000003','1143')=55000
 and pg_temp.balance_for_sale('e8700000-0000-4000-8000-000000000003','4303')=-5000,
 'split correction preserves unrelated QRIS fee and its ledger');
select pg_temp.reject($q$select correct_pos_sale_payment('e8700000-0000-4000-8000-000000000003',1,'j02-invalid-sum','Jumlah salah',1,1)$q$,
 'cash plus transfer must remain constant');
select pg_temp.assert_ok((select count(*)=1 from sale_payment_corrections where sale_id='e8700000-0000-4000-8000-000000000003'),
 'rejected sum leaves no extra audit');
update accounting_locks set closed_until=(now() at time zone 'Asia/Jakarta')::date where id;
select pg_temp.reject($q$select correct_pos_sale_payment('e8700000-0000-4000-8000-000000000003',1,'j02-closed','Kasir salah membagi metode',15000,30000)$q$,
 'closed source and correction period','Periode sumber');
update accounting_locks set closed_until=null where id;
set local role postgres;
update profiles set is_active=false where id='e8100000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.reject($q$select correct_pos_sale_payment('e8700000-0000-4000-8000-000000000003',1,'j02-inactive','Kasir salah membagi metode',15000,30000)$q$,
 'inactive owner cannot correct','Hanya Owner');
set local role postgres;
update profiles set is_active=true where id='e8100000-0000-4000-8000-000000000001';
update payment_account_map set cash_account_id='e8600000-0000-4000-8000-000000000003'
 where branch_id='e8200000-0000-4000-8000-000000000001' and metode='Transfer';
set local role authenticated;
select pg_temp.reject($q$select correct_pos_sale_payment('e8700000-0000-4000-8000-000000000003',1,'j02-map-drift','Kasir salah membagi metode',15000,30000)$q$,
 'account mapping drift','Akun sumber berubah');
set local role postgres;
update payment_account_map set cash_account_id='e8600000-0000-4000-8000-000000000002'
 where branch_id='e8200000-0000-4000-8000-000000000001' and metode='Transfer';
insert into bank_reconciliations(tanggal,cash_account_id,bank_coa_code)
 values((now() at time zone 'Asia/Jakarta')::date,'e8600000-0000-4000-8000-000000000002','1142');
set local role authenticated;
select pg_temp.reject($q$select correct_pos_sale_payment('e8700000-0000-4000-8000-000000000003',1,'j02-reconciled','Kasir salah membagi metode',15000,30000)$q$,
 'reconciled bank account','Rekonsiliasi bank');
set local role postgres;
delete from bank_reconciliations where cash_account_id='e8600000-0000-4000-8000-000000000002';
create function pg_temp.force_j02_rollback() returns trigger language plpgsql as $$begin
 raise exception 'Injected audit storage failure';end$$;
create trigger j02_force_rollback before insert on sale_payment_corrections for each row
 execute function pg_temp.force_j02_rollback();
set local role authenticated;
select pg_temp.reject($q$select correct_pos_sale_payment('e8700000-0000-4000-8000-000000000003',1,'j02-rollback','Kasir salah membagi metode',15000,30000)$q$,
 'audit insert failure rolls back reversal, repost and payment rows','Injected audit storage failure');
select pg_temp.assert_ok((select revision=1 from sales where id='e8700000-0000-4000-8000-000000000003')
 and (select count(*)=1 from sale_payment_corrections where sale_id='e8700000-0000-4000-8000-000000000003')
 and (select count(*)=2 from journal_entries where source_ref in
  (select id::text from sale_payment_corrections where sale_id='e8700000-0000-4000-8000-000000000003'))
 and (select sum(amount) filter(where method='Tunai')=10000 from sale_payments
  where sale_id='e8700000-0000-4000-8000-000000000003'),
 'all rejected changes leave sale, allocation, audit and journals untouched');
rollback;
