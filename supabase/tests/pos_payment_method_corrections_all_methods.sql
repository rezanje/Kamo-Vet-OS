-- Fictional J02 fixtures only (koreksi semua metode POS, 2 Nov 2026). Rolled back at the end.
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
create function pg_temp.bal(doc uuid,code text) returns numeric language sql as $$
 select coalesce(sum(l.debit-l.credit),0) from public.journal_lines l
 join public.journal_entries e on e.id=l.entry_id join public.coa_accounts a on a.id=l.account_id
 where a.code=$2 and ((e.source='sale' and e.source_ref=(select no_struk from public.sales where id=$1))
  or (e.source in('sale-payment-reversal','sale-payment-repost')
   and e.source_ref in(select id::text from public.sale_payment_corrections where sale_id=$1)))
$$;
create function pg_temp.methods(doc uuid) returns text language sql as $$
 select string_agg(method||':'||amount::numeric(15,0)||case when fee_amount<>0 then '+fee' else '' end,',' order by method)
 from public.sale_payments where sale_id=$1
$$;

insert into auth.users(id,raw_user_meta_data) values
 ('e9100000-0000-4000-8000-000000000001','{"full_name":"Owner semua metode"}'),
 ('e9100000-0000-4000-8000-000000000002','{"full_name":"Finance semua metode"}'),
 ('e9100000-0000-4000-8000-000000000003','{"full_name":"Staff semua metode"}');
update profiles set role='OWNER',is_active=true where id='e9100000-0000-4000-8000-000000000001';
update profiles set role='FINANCE',is_active=true where id='e9100000-0000-4000-8000-000000000002';
update profiles set role='STAFF',is_active=true where id='e9100000-0000-4000-8000-000000000003';
insert into branches(id,code,name,type) values('e9200000-0000-4000-8000-000000000001','J02ALL','J02 Semua','PETSHOP');
insert into user_branches(user_id,branch_id) values
 ('e9100000-0000-4000-8000-000000000001','e9200000-0000-4000-8000-000000000001'),
 ('e9100000-0000-4000-8000-000000000002','e9200000-0000-4000-8000-000000000001'),
 ('e9100000-0000-4000-8000-000000000003','e9200000-0000-4000-8000-000000000001');
insert into cashier_shifts(id,branch_id,opened_by,shift_type) values
 ('e9400000-0000-4000-8000-000000000001','e9200000-0000-4000-8000-000000000001','e9100000-0000-4000-8000-000000000001','petshop');
insert into items(id,code,name,unit,item_type) values('e9500000-0000-4000-8000-000000000001','J02ALLSVC','J02 all service','pcs','Jasa');
insert into coa_accounts(code,name,type,normal_balance,is_header) values
 ('1151','J02 all cash','ASET','D',false),('1152','J02 all bank','ASET','D',false),('1153','J02 all wallet','ASET','D',false),
 ('510001','Sales','PENDAPATAN','K',false),('520002','Discount','PENDAPATAN','D',false),
 ('312005','VAT','LIABILITAS','K',false),('600001','COGS','BEBAN','D',false),('170001','Inventory','ASET','D',false)
 on conflict(code) do update set is_active=true,is_header=false;
insert into cash_accounts(id,nama,jenis,coa_code) values
 ('e9600000-0000-4000-8000-000000000001','J02 all cash','Kas','1151'),
 ('e9600000-0000-4000-8000-000000000002','J02 all bank','Bank','1152'),
 ('e9600000-0000-4000-8000-000000000003','J02 all wallet','Bank','1153');
-- Seperti Production: QRIS, Debit, Transfer, Kredit masuk ke rekening bank yang SAMA.
insert into payment_account_map(metode,branch_id,cash_account_id) values
 ('Tunai','e9200000-0000-4000-8000-000000000001','e9600000-0000-4000-8000-000000000001'),
 ('Transfer','e9200000-0000-4000-8000-000000000001','e9600000-0000-4000-8000-000000000002'),
 ('QRIS','e9200000-0000-4000-8000-000000000001','e9600000-0000-4000-8000-000000000002'),
 ('Debit','e9200000-0000-4000-8000-000000000001','e9600000-0000-4000-8000-000000000002'),
 ('Kredit','e9200000-0000-4000-8000-000000000001','e9600000-0000-4000-8000-000000000002'),
 ('E-Wallet','e9200000-0000-4000-8000-000000000001','e9600000-0000-4000-8000-000000000003');
update accounting_locks set closed_until=null;
update company_settings set mode_pkp=false,ppn_rate=11;

set local role authenticated;
select set_config('request.jwt.claim.sub','e9100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);

-- 1. Tunai berkembalian -> QRIS: kembalian hilang, bayar = total, kas pindah ke bank.
insert into sales(id,branch_id,no_struk,subtotal,total,metode_bayar,bayar,kembali,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint)
 values('e9700000-0000-4000-8000-000000000001','e9200000-0000-4000-8000-000000000001','J02ALL.1',100000,100000,'Tunai',120000,20000,
 'e9100000-0000-4000-8000-000000000001','e9400000-0000-4000-8000-000000000001','[{"method":"Tunai","amount":100000}]','j02all-1',repeat('1',64));
insert into sale_items(id,sale_id,item_id,nama,qty,harga,satuan,faktor,hpp) values
 ('e9800000-0000-4000-8000-000000000001','e9700000-0000-4000-8000-000000000001','e9500000-0000-4000-8000-000000000001','J02 all service',1,100000,'pcs',1,0);
select finalize_pos_sale('e9700000-0000-4000-8000-000000000001');
select correct_pos_sale_payment_methods('e9700000-0000-4000-8000-000000000001',0,'all-1a','Pelanggan bayar QRIS, kasir pilih tunai',
 '[{"method":"QRIS","amount":100000}]');
select pg_temp.assert_ok((select revision=1 and metode_bayar='QRIS' and total=100000 and bayar=100000 and kembali=0
  and payment_plan='[{"method":"QRIS","amount":100000,"fee_amount":0,"fee_percent":0}]'::jsonb
  from sales where id='e9700000-0000-4000-8000-000000000001'),'Tunai -> QRIS updates header, clears change');
select pg_temp.assert_ok(pg_temp.methods('e9700000-0000-4000-8000-000000000001')='QRIS:100000','one QRIS allocation');
select pg_temp.assert_ok(pg_temp.bal('e9700000-0000-4000-8000-000000000001','1151')=0
 and pg_temp.bal('e9700000-0000-4000-8000-000000000001','1152')=100000
 and pg_temp.bal('e9700000-0000-4000-8000-000000000001','510001')=-100000,'cash moved to bank, revenue unchanged');
select pg_temp.assert_ok((select account_snapshot->>'cash_account_id'='e9600000-0000-4000-8000-000000000002' and coa_code='1152'
 from sale_payments where sale_id='e9700000-0000-4000-8000-000000000001'),'new part carries the mapped account snapshot');

-- 2. QRIS -> Debit (rekening sama): tetap tercatat, saldo bank tidak berubah.
select correct_pos_sale_payment_methods('e9700000-0000-4000-8000-000000000001',1,'all-1b','Ternyata kartu debit',
 '[{"method":"Debit","amount":100000}]');
select pg_temp.assert_ok((select revision=2 and metode_bayar='Debit' from sales where id='e9700000-0000-4000-8000-000000000001')
 and pg_temp.bal('e9700000-0000-4000-8000-000000000001','1152')=100000
 and (select count(*)=2 from sale_payment_corrections where sale_id='e9700000-0000-4000-8000-000000000001'),
 'same-account method change keeps the ledger and adds a second audit row');
select pg_temp.assert_ok((select count(*)=4 and bool_and(net=0) from(
 select e.id,sum(l.debit-l.credit) net from journal_entries e join journal_lines l on l.entry_id=e.id
 where e.source_ref in(select id::text from sale_payment_corrections where sale_id='e9700000-0000-4000-8000-000000000001')
 group by e.id) z),'two balanced reversal/repost pairs');

-- 3. Debit -> Tunai 60.000 + E-Wallet 40.000 (rekening berbeda).
select correct_pos_sale_payment_methods('e9700000-0000-4000-8000-000000000001',2,'all-1c','Sebagian tunai, sebagian e-wallet',
 '[{"method":"Tunai","amount":60000},{"method":"E-Wallet","amount":40000}]');
select pg_temp.assert_ok((select revision=3 and metode_bayar='Split' and bayar=100000 and kembali=0 from sales
  where id='e9700000-0000-4000-8000-000000000001')
 and pg_temp.methods('e9700000-0000-4000-8000-000000000001')='E-Wallet:40000,Tunai:60000'
 and pg_temp.bal('e9700000-0000-4000-8000-000000000001','1151')=60000
 and pg_temp.bal('e9700000-0000-4000-8000-000000000001','1152')=0
 and pg_temp.bal('e9700000-0000-4000-8000-000000000001','1153')=40000
 and pg_temp.bal('e9700000-0000-4000-8000-000000000001','510001')=-100000,'split across separate accounts');

-- 4. Fungsi lama Tunai<->Transfer tetap menyambung pada rantai koreksi yang sama.
select correct_pos_sale_payment('e9700000-0000-4000-8000-000000000001',3,'all-1d','Bagian tunai ternyata transfer',0,60000);
select pg_temp.assert_ok((select revision=4 from sales where id='e9700000-0000-4000-8000-000000000001')
 and pg_temp.methods('e9700000-0000-4000-8000-000000000001')='E-Wallet:40000,Transfer:60000'
 and pg_temp.bal('e9700000-0000-4000-8000-000000000001','1151')=0
 and pg_temp.bal('e9700000-0000-4000-8000-000000000001','1152')=60000
 and pg_temp.bal('e9700000-0000-4000-8000-000000000001','1153')=40000,'old cash/transfer correction continues the chain');
select correct_pos_sale_payment_methods('e9700000-0000-4000-8000-000000000001',4,'all-1e','Kembali ke QRIS penuh',
 '[{"method":"QRIS","amount":100000}]');
select pg_temp.assert_ok(pg_temp.bal('e9700000-0000-4000-8000-000000000001','1152')=100000
 and pg_temp.bal('e9700000-0000-4000-8000-000000000001','1153')=0
 and (select count(*)=5 from sale_payment_corrections where sale_id='e9700000-0000-4000-8000-000000000001'),
 'new function continues after the old one');

-- 5. Idempoten & penolakan input.
select pg_temp.assert_ok((select correct_pos_sale_payment_methods('e9700000-0000-4000-8000-000000000001',4,'all-1e','Kembali ke QRIS penuh',
 '[{"method":"QRIS","amount":100000}]')->>'revision')='5','same key + same payload returns the stored result');
select pg_temp.reject($q$select correct_pos_sale_payment_methods('e9700000-0000-4000-8000-000000000001',4,'all-1e','Kembali ke QRIS penuh','[{"method":"Debit","amount":100000}]')$q$,
 'same key with another payload','Identitas simpan');
select pg_temp.reject($q$select correct_pos_sale_payment_methods('e9700000-0000-4000-8000-000000000001',4,'all-stale','Revisi lama','[{"method":"Debit","amount":100000}]')$q$,
 'stale revision','sudah berubah');
select pg_temp.reject($q$select correct_pos_sale_payment_methods('e9700000-0000-4000-8000-000000000001',5,'all-same','Tidak berubah','[{"method":"QRIS","amount":100000}]')$q$,
 'no change','tidak mengubah');
select pg_temp.reject($q$select correct_pos_sale_payment_methods('e9700000-0000-4000-8000-000000000001',5,'all-unknown','Metode aneh','[{"method":"Cek","amount":100000}]')$q$,
 'unknown method','metode tidak dikenal');
select pg_temp.reject($q$select correct_pos_sale_payment_methods('e9700000-0000-4000-8000-000000000001',5,'all-dup','Ganda','[{"method":"Debit","amount":50000},{"method":"Debit","amount":50000}]')$q$,
 'duplicate method','metode ganda');
select pg_temp.reject($q$select correct_pos_sale_payment_methods('e9700000-0000-4000-8000-000000000001',5,'all-zero','Nol','[{"method":"Debit","amount":100000},{"method":"Tunai","amount":0}]')$q$,
 'zero amount','nominal harus positif');
select pg_temp.reject($q$select correct_pos_sale_payment_methods('e9700000-0000-4000-8000-000000000001',5,'all-sum','Kurang','[{"method":"Debit","amount":90000}]')$q$,
 'sum must equal the redistributed total','harus sama');
select pg_temp.reject($q$select correct_pos_sale_payment_methods('e9700000-0000-4000-8000-000000000001',5,'all-extra','Kunci lain','[{"method":"Debit","amount":100000,"fee_percent":2}]')$q$,
 'extra keys (fee) are not accepted','tidak dikenal');
select pg_temp.assert_ok((select revision=5 from sales where id='e9700000-0000-4000-8000-000000000001')
 and (select count(*)=5 from sale_payment_corrections where sale_id='e9700000-0000-4000-8000-000000000001'),
 'rejections leave no extra correction');

-- 6. STAFF ditolak; FINANCE boleh.
select set_config('request.jwt.claim.sub','e9100000-0000-4000-8000-000000000003',true);
select pg_temp.reject($q$select correct_pos_sale_payment_methods('e9700000-0000-4000-8000-000000000001',5,'all-staff','Staff mencoba','[{"method":"Debit","amount":100000}]')$q$,
 'staff cannot correct','Hanya Owner atau Finance');
select set_config('request.jwt.claim.sub','e9100000-0000-4000-8000-000000000002',true);
select correct_pos_sale_payment_methods('e9700000-0000-4000-8000-000000000001',5,'all-fin','Finance koreksi','[{"method":"Debit","amount":100000}]');
select pg_temp.assert_ok((select created_by='e9100000-0000-4000-8000-000000000002' from sale_payment_corrections
 where sale_id='e9700000-0000-4000-8000-000000000001' and revision=6),'finance correction recorded');

-- 7. Bagian ber-fee merchant tetap; metode ber-fee tidak boleh dipakai ulang.
select set_config('request.jwt.claim.sub','e9100000-0000-4000-8000-000000000001',true);
insert into sales(id,branch_id,no_struk,subtotal,total,merchant_fee_total,metode_bayar,bayar,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint)
 values('e9700000-0000-4000-8000-000000000002','e9200000-0000-4000-8000-000000000001','J02ALL.FEE',95000,100000,5000,'Split',100000,
 'e9100000-0000-4000-8000-000000000001','e9400000-0000-4000-8000-000000000001',
 '[{"method":"Tunai","amount":45000},{"method":"Kredit","amount":55000,"fee_percent":10,"fee_amount":5000}]','j02all-fee',repeat('2',64));
insert into sale_items(id,sale_id,item_id,nama,qty,harga,satuan,faktor,hpp) values
 ('e9800000-0000-4000-8000-000000000002','e9700000-0000-4000-8000-000000000002','e9500000-0000-4000-8000-000000000001','J02 all service',1,95000,'pcs',1,0);
select finalize_pos_sale('e9700000-0000-4000-8000-000000000002');
select pg_temp.reject($q$select correct_pos_sale_payment_methods('e9700000-0000-4000-8000-000000000002',0,'fee-reuse','Pakai kredit','[{"method":"Kredit","amount":45000}]')$q$,
 'fee-bearing method cannot be reused','fee merchant');
select pg_temp.reject($q$select correct_pos_sale_payment_methods('e9700000-0000-4000-8000-000000000002',0,'fee-all','Termasuk fee','[{"method":"QRIS","amount":100000}]')$q$,
 'only the fee-free part is redistributed','harus sama');
select correct_pos_sale_payment_methods('e9700000-0000-4000-8000-000000000002',0,'fee-ok','Bagian tunai ternyata QRIS','[{"method":"QRIS","amount":45000}]');
select pg_temp.assert_ok(pg_temp.methods('e9700000-0000-4000-8000-000000000002')='Kredit:55000+fee,QRIS:45000'
 and (select merchant_fee_total=5000 and total=100000 and metode_bayar='Split' from sales where id='e9700000-0000-4000-8000-000000000002')
 and pg_temp.bal('e9700000-0000-4000-8000-000000000002','1151')=0
 and pg_temp.bal('e9700000-0000-4000-8000-000000000002','1152')=100000
 and pg_temp.bal('e9700000-0000-4000-8000-000000000002','810004')=-5000,'fee part and fee income untouched');

-- 8. Penjualan yang seluruhnya ber-fee tidak bisa dibagi ulang.
insert into sales(id,branch_id,no_struk,subtotal,total,merchant_fee_total,metode_bayar,bayar,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint)
 values('e9700000-0000-4000-8000-000000000003','e9200000-0000-4000-8000-000000000001','J02ALL.FEEONLY',50000,51000,1000,'Kredit',51000,
 'e9100000-0000-4000-8000-000000000001','e9400000-0000-4000-8000-000000000001',
 '[{"method":"Kredit","amount":51000,"fee_percent":2,"fee_amount":1000}]','j02all-feeonly',repeat('3',64));
insert into sale_items(id,sale_id,item_id,nama,qty,harga,satuan,faktor,hpp) values
 ('e9800000-0000-4000-8000-000000000003','e9700000-0000-4000-8000-000000000003','e9500000-0000-4000-8000-000000000001','J02 all service',1,50000,'pcs',1,0);
select finalize_pos_sale('e9700000-0000-4000-8000-000000000003');
select pg_temp.reject($q$select correct_pos_sale_payment_methods('e9700000-0000-4000-8000-000000000003',0,'feeonly','Coba','[{"method":"Debit","amount":51000}]')$q$,
 'all-fee sale','fee merchant');

-- 9. Sesudah shift ditutup: koreksi tetap boleh, angka penutupan shift tidak disentuh.
set local role postgres;
with t as(select p.method,sum(p.amount) amount from sale_payments p join sales s on s.id=p.sale_id
  where s.voided_at is null and s.shift_id='e9400000-0000-4000-8000-000000000001' and s.payments_finalized_at is not null group by p.method),
 b as(select jsonb_build_object('Tunai',0,'Transfer',0,'Debit',0,'Kredit',0,'QRIS',0,'E-Wallet',0)
  ||coalesce((select jsonb_object_agg(method,round(amount,2)) from t),'{}'::jsonb) breakdown)
update cashier_shifts set status='closed',closed_at=now(),closing_breakdown=b.breakdown,
 expected_cash=round(opening_balance+(b.breakdown->>'Tunai')::numeric,2),
 closing_balance=round(opening_balance+(b.breakdown->>'Tunai')::numeric,2),selisih=0
 from b where id='e9400000-0000-4000-8000-000000000001';
create temp table j02all_shift_before as select to_jsonb(s) snap from cashier_shifts s where id='e9400000-0000-4000-8000-000000000001';
set local role authenticated;
select correct_pos_sale_payment_methods('e9700000-0000-4000-8000-000000000002',1,'closed-ok','Sesudah tutup shift','[{"method":"Tunai","amount":45000}]');
select pg_temp.assert_ok((select source_shift_status='closed' from sale_payment_corrections
 where sale_id='e9700000-0000-4000-8000-000000000002' and revision=2),'audit notes the closed shift');
set local role postgres;
select pg_temp.assert_ok((select to_jsonb(s)=(select snap from j02all_shift_before) from cashier_shifts s
 where id='e9400000-0000-4000-8000-000000000001'),'closed shift numbers untouched');

-- 10. Penulisan langsung tetap terlarang.
set local role authenticated;
select pg_temp.reject($q$update sale_payments set method='Tunai' where sale_id='e9700000-0000-4000-8000-000000000001'$q$,
 'direct payment edit stays forbidden');
select pg_temp.reject($q$update sales set metode_bayar='Tunai' where id='e9700000-0000-4000-8000-000000000001'$q$,
 'direct header edit stays forbidden');
rollback;
