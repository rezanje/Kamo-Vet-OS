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
 ('510001','Sales','PENDAPATAN','K',false),('520002','Discount','PENDAPATAN','D',false),
 ('312005','VAT','LIABILITAS','K',false),('600001','COGS','BEBAN','D',false),('170001','Inventory','ASET','D',false)
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
 and pg_temp.balance_for_sale('e8700000-0000-4000-8000-000000000001','510001')=-100000,
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
-- Reversal/replacement journals are as fixed as the original sale journal.
select pg_temp.reject($q$delete from journal_lines where entry_id=(select reversal_journal_id from sale_payment_corrections where sale_id='e8700000-0000-4000-8000-000000000001')$q$,
 'reversal lines cannot be deleted through the API','Jurnal pembayaran POS sudah tetap');
select pg_temp.reject($q$update journal_lines set debit=debit+1 where debit>0 and entry_id=(select replacement_journal_id from sale_payment_corrections where sale_id='e8700000-0000-4000-8000-000000000001')$q$,
 'replacement lines cannot be edited through the API','Jurnal pembayaran POS sudah tetap');
select pg_temp.reject($q$update journal_entries set voided_at=now() where id=(select reversal_journal_id from sale_payment_corrections where sale_id='e8700000-0000-4000-8000-000000000001')$q$,
 'reversal header cannot be voided through the API');
select pg_temp.reject($q$insert into journal_lines(entry_id,account_id,debit,credit) select c.replacement_journal_id,a.id,1,0 from sale_payment_corrections c,coa_accounts a where c.sale_id='e8700000-0000-4000-8000-000000000001' and a.code='1141'$q$,
 'no extra line on the replacement journal','Jurnal pembayaran POS sudah tetap');
select pg_temp.assert_ok(pg_temp.balance_for_sale('e8700000-0000-4000-8000-000000000001','1142')=100000
 and pg_temp.balance_for_sale('e8700000-0000-4000-8000-000000000001','510001')=-100000,'ledger unchanged after tamper attempts');
select correct_pos_sale_payment('e8700000-0000-4000-8000-000000000001',0,'j02-correct-one','Kasir salah pilih metode',0,100000);
select pg_temp.assert_ok((select count(*)=1 from sale_payment_corrections where sale_id='e8700000-0000-4000-8000-000000000001'),
 'same retry key does not create a second correction');
select pg_temp.reject($q$select cancel_posted_sale('e8700000-0000-4000-8000-000000000001',1,'j02-cancel-after','Struk perlu dibatalkan')$q$,
 'old cancellation cannot reverse only the original cash ledger','Koreksi metode pembayaran perlu rekonsiliasi sebelum pembatalan');
select pg_temp.assert_ok((select voided_at is null from sales where id='e8700000-0000-4000-8000-000000000001')
 and (select count(*)=2 from journal_entries where source_ref=(select id::text from sale_payment_corrections
  where sale_id='e8700000-0000-4000-8000-000000000001')),
 'rejected cancellation rolls back all its attempted writes');
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
select pg_temp.assert_ok(pg_temp.balance_for_sale('e8700000-0000-4000-8000-000000000002','510001')=-120000
 and pg_temp.balance_for_sale('e8700000-0000-4000-8000-000000000002','520002')=20000,
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
 and pg_temp.balance_for_sale('e8700000-0000-4000-8000-000000000003','810004')=-5000,
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
-- Peta rekening yang berubah sesudah struk dibuat kini diterima (J02_AKUN_LAMA, lihat bagian akhir).
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

-- J02 lanjutan: koreksi sesudah shift ditutup, oleh OWNER dan FINANCE; STAFF ditolak.
set local role postgres;
drop trigger j02_force_rollback on sale_payment_corrections;
insert into auth.users(id,raw_user_meta_data) values
 ('e8100000-0000-4000-8000-000000000002','{"full_name":"Finance test"}'),
 ('e8100000-0000-4000-8000-000000000003','{"full_name":"Staff test"}'),
 ('e8100000-0000-4000-8000-000000000004','{"full_name":"Finance other branch"}');
update profiles set role='FINANCE',is_active=true where id in('e8100000-0000-4000-8000-000000000002','e8100000-0000-4000-8000-000000000004');
update profiles set role='STAFF',is_active=true where id='e8100000-0000-4000-8000-000000000003';
insert into user_branches(user_id,branch_id) values
 ('e8100000-0000-4000-8000-000000000002','e8200000-0000-4000-8000-000000000001'),
 ('e8100000-0000-4000-8000-000000000003','e8200000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','e8100000-0000-4000-8000-000000000001',true);
insert into sales(id,branch_id,no_struk,subtotal,total,metode_bayar,bayar,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint)
 values('e8700000-0000-4000-8000-000000000004','e8200000-0000-4000-8000-000000000001','J02.CLOSED',80000,80000,'Tunai',80000,
 'e8100000-0000-4000-8000-000000000001','e8400000-0000-4000-8000-000000000001','[{"method":"Tunai","amount":80000}]','j02-closed-shift',repeat('d',64));
insert into sale_items(id,sale_id,item_id,nama,qty,harga,satuan,faktor,hpp) values
 ('e8800000-0000-4000-8000-000000000004','e8700000-0000-4000-8000-000000000004','e8500000-0000-4000-8000-000000000001','J02 service',1,80000,'pcs',1,0);
select finalize_pos_sale('e8700000-0000-4000-8000-000000000004');
set local role postgres;
-- Tutup shift dengan angka yang sama persis dengan hitungan guard tutup shift.
with t as(select p.method,sum(p.amount) amount from sale_payments p join sales s on s.id=p.sale_id
  where s.voided_at is null and s.shift_id='e8400000-0000-4000-8000-000000000001' and s.payments_finalized_at is not null group by p.method),
 b as(select jsonb_build_object('Tunai',0,'Transfer',0,'Debit',0,'Kredit',0,'QRIS',0,'E-Wallet',0)
  ||coalesce((select jsonb_object_agg(method,round(amount,2)) from t),'{}'::jsonb) breakdown)
update cashier_shifts set status='closed',closed_at=now(),closing_breakdown=b.breakdown,
 expected_cash=round(opening_balance+(b.breakdown->>'Tunai')::numeric,2),
 closing_balance=round(opening_balance+(b.breakdown->>'Tunai')::numeric,2),selisih=0
 from b where id='e8400000-0000-4000-8000-000000000001';
select pg_temp.assert_ok((select status='closed' and (closing_breakdown->>'Tunai')::numeric=90000 from cashier_shifts
 where id='e8400000-0000-4000-8000-000000000001'),'fixture shift closed with 90000 cash (10000 + 80000)');
create temp table j02_shift_before as select to_jsonb(s) snap from cashier_shifts s where id='e8400000-0000-4000-8000-000000000001';
grant select on j02_shift_before to authenticated;
-- STAFF dengan akses cabang tetap ditolak.
set local role authenticated;
select set_config('request.jwt.claim.sub','e8100000-0000-4000-8000-000000000003',true);
select pg_temp.reject($q$select correct_pos_sale_payment('e8700000-0000-4000-8000-000000000004',0,'j02-staff','Kasir salah pilih metode',0,80000)$q$,
 'staff cannot correct','Hanya Owner atau Finance');
-- FINANCE yang sedang bekerja di cabang operasional lain ditolak (FINANCE default semua cabang).
select set_config('request.jwt.claim.sub','e8100000-0000-4000-8000-000000000004',true);
select set_config('request.headers','{"x-kamo-operational-branch":"e8200000-0000-4000-8000-0000000000ff"}',true);
select pg_temp.reject($q$select correct_pos_sale_payment('e8700000-0000-4000-8000-000000000004',0,'j02-fin-other','Kasir salah pilih metode',0,80000)$q$,
 'finance outside the operational branch cannot correct','tidak dapat diakses');
select set_config('request.headers','',true);
-- FINANCE cabang: shift sudah ditutup tetap boleh, lewat jurnal koreksi.
select set_config('request.jwt.claim.sub','e8100000-0000-4000-8000-000000000002',true);
select correct_pos_sale_payment('e8700000-0000-4000-8000-000000000004',0,'j02-fin-closed','Kasir salah pilih metode',0,80000);
select pg_temp.assert_ok((select revision=1 and metode_bayar='Transfer' from sales where id='e8700000-0000-4000-8000-000000000004')
 and pg_temp.balance_for_sale('e8700000-0000-4000-8000-000000000004','1141')=0
 and pg_temp.balance_for_sale('e8700000-0000-4000-8000-000000000004','1142')=80000
 and pg_temp.balance_for_sale('e8700000-0000-4000-8000-000000000004','510001')=-80000,
 'finance corrects a sale whose shift is closed');
select pg_temp.assert_ok((select count(*)=1 and bool_and(source_shift_status='closed' and created_by='e8100000-0000-4000-8000-000000000002')
 from sale_payment_corrections where sale_id='e8700000-0000-4000-8000-000000000004'),'audit records closed source shift and finance actor');
select pg_temp.assert_ok((select count(*)=2 and bool_and(e.tanggal=(now() at time zone 'Asia/Jakarta')::date)
 from journal_entries e where e.source_ref=(select id::text from sale_payment_corrections where sale_id='e8700000-0000-4000-8000-000000000004')),
 'reversal and replacement are dated on the correction day');
select correct_pos_sale_payment('e8700000-0000-4000-8000-000000000004',0,'j02-fin-closed','Kasir salah pilih metode',0,80000);
select pg_temp.assert_ok((select count(*)=1 from sale_payment_corrections where sale_id='e8700000-0000-4000-8000-000000000004')
 and (select count(*)=2 from journal_entries where source_ref in(select id::text from sale_payment_corrections where sale_id='e8700000-0000-4000-8000-000000000004')),
 'finance retry with the same key is idempotent');
select pg_temp.reject($q$select correct_pos_sale_payment('e8700000-0000-4000-8000-000000000004',0,'j02-fin-stale','Kasir salah pilih metode',80000,0)$q$,
 'stale revision after closed-shift correction','sudah berubah');
select pg_temp.assert_ok((select count(*)>=1 from sale_payment_corrections where sale_id='e8700000-0000-4000-8000-000000000004'),
 'finance can read the correction trail');
set local role postgres;
select pg_temp.assert_ok((select to_jsonb(s)=(select snap from j02_shift_before) from cashier_shifts s where id='e8400000-0000-4000-8000-000000000001'),
 'closed shift is not reopened and its closing totals are untouched');
-- Kembalian tunai (laporan 2 Nov): koreksi kini diterima; jurnal/laci memakai angka bersih.
update cashier_shifts set status='open' where id='e8400000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','e8100000-0000-4000-8000-000000000001',true);
insert into sales(id,branch_id,no_struk,subtotal,total,metode_bayar,bayar,kembali,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint)
 values('e8700000-0000-4000-8000-000000000005','e8200000-0000-4000-8000-000000000001','J02.CHANGE',50000,50000,'Tunai',60000,10000,
 'e8100000-0000-4000-8000-000000000001','e8400000-0000-4000-8000-000000000001','[{"method":"Tunai","amount":50000}]','j02-change',repeat('e',64));
insert into sale_items(id,sale_id,item_id,nama,qty,harga,satuan,faktor,hpp) values
 ('e8800000-0000-4000-8000-000000000005','e8700000-0000-4000-8000-000000000005','e8500000-0000-4000-8000-000000000001','J02 service',1,50000,'pcs',1,0);
select finalize_pos_sale('e8700000-0000-4000-8000-000000000005');
select set_config('request.jwt.claim.sub','e8100000-0000-4000-8000-000000000002',true);
select correct_pos_sale_payment('e8700000-0000-4000-8000-000000000005',0,'j02-change','Kasir salah pilih metode',0,50000);
select pg_temp.assert_ok((select revision=1 and metode_bayar='Transfer' and bayar=50000 and kembali=0 and total=50000
  from sales where id='e8700000-0000-4000-8000-000000000005')
 and pg_temp.balance_for_sale('e8700000-0000-4000-8000-000000000005','1141')=0
 and pg_temp.balance_for_sale('e8700000-0000-4000-8000-000000000005','1142')=50000
 and pg_temp.balance_for_sale('e8700000-0000-4000-8000-000000000005','510001')=-50000,
 'cash sale with change moves fully to Transfer; change cleared and paid equals total');
select pg_temp.assert_ok((select before_sale->>'bayar'='60000' and (before_sale->>'kembali')::numeric=10000
  from sale_payment_corrections where sale_id='e8700000-0000-4000-8000-000000000005'),
 'original tendered cash and change stay in the correction trail');
-- Bagian Tunai tetap ada: bayar/kembali tidak berubah.
select set_config('request.jwt.claim.sub','e8100000-0000-4000-8000-000000000001',true);
insert into sales(id,branch_id,no_struk,subtotal,total,metode_bayar,bayar,kembali,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint)
 values('e8700000-0000-4000-8000-000000000006','e8200000-0000-4000-8000-000000000001','J02.CHANGE.SPLIT',50000,50000,'Tunai',60000,10000,
 'e8100000-0000-4000-8000-000000000001','e8400000-0000-4000-8000-000000000001','[{"method":"Tunai","amount":50000}]','j02-change-split',repeat('f',64));
insert into sale_items(id,sale_id,item_id,nama,qty,harga,satuan,faktor,hpp) values
 ('e8800000-0000-4000-8000-000000000006','e8700000-0000-4000-8000-000000000006','e8500000-0000-4000-8000-000000000001','J02 service',1,50000,'pcs',1,0);
select finalize_pos_sale('e8700000-0000-4000-8000-000000000006');
select pg_temp.reject($q$update sales set bayar=50000,kembali=0 where id='e8700000-0000-4000-8000-000000000006'$q$,
 'tendered cash and change stay immutable outside the official correction');
select correct_pos_sale_payment('e8700000-0000-4000-8000-000000000006',0,'j02-change-split','Sebagian dibayar transfer',30000,20000);
select pg_temp.assert_ok((select revision=1 and metode_bayar='Split' and bayar=60000 and kembali=10000
  from sales where id='e8700000-0000-4000-8000-000000000006')
 and pg_temp.balance_for_sale('e8700000-0000-4000-8000-000000000006','1141')=30000
 and pg_temp.balance_for_sale('e8700000-0000-4000-8000-000000000006','1142')=20000,
 'split correction keeps tendered cash and change when a cash part remains');

-- J02_AKUN_LAMA (laporan 12 Nov): struk dibuat saat Tunai masih ke kas lama (mis. 110003 Kas Kecil),
-- lalu peta Tunai cabang dipindah ke kas toko cabang. Koreksi tetap bisa; metode yang sudah ada
-- tetap di akun tercatatnya, metode baru memakai peta sekarang.
insert into sales(id,branch_id,no_struk,subtotal,total,metode_bayar,bayar,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint) values
 ('e8700000-0000-4000-8000-000000000007','e8200000-0000-4000-8000-000000000001','J02.OLD.FULL',30000,30000,'Tunai',30000,
  'e8100000-0000-4000-8000-000000000001','e8400000-0000-4000-8000-000000000001','[{"method":"Tunai","amount":30000}]','j02-old-full',repeat('1',64)),
 ('e8700000-0000-4000-8000-000000000008','e8200000-0000-4000-8000-000000000001','J02.OLD.SPLIT',40000,40000,'Tunai',40000,
  'e8100000-0000-4000-8000-000000000001','e8400000-0000-4000-8000-000000000001','[{"method":"Tunai","amount":40000}]','j02-old-split',repeat('2',64)),
 ('e8700000-0000-4000-8000-000000000009','e8200000-0000-4000-8000-000000000001','J02.OLD.TRANSFER',20000,20000,'Transfer',20000,
  'e8100000-0000-4000-8000-000000000001','e8400000-0000-4000-8000-000000000001','[{"method":"Transfer","amount":20000}]','j02-old-transfer',repeat('3',64)),
 ('e8700000-0000-4000-8000-00000000000a','e8200000-0000-4000-8000-000000000001','J02.OLD.BROKEN',10000,10000,'Tunai',10000,
  'e8100000-0000-4000-8000-000000000001','e8400000-0000-4000-8000-000000000001','[{"method":"Tunai","amount":10000}]','j02-old-broken',repeat('4',64));
insert into sale_items(id,sale_id,item_id,nama,qty,harga,satuan,faktor,hpp) values
 ('e8800000-0000-4000-8000-000000000007','e8700000-0000-4000-8000-000000000007','e8500000-0000-4000-8000-000000000001','J02 service',1,30000,'pcs',1,0),
 ('e8800000-0000-4000-8000-000000000008','e8700000-0000-4000-8000-000000000008','e8500000-0000-4000-8000-000000000001','J02 service',1,40000,'pcs',1,0),
 ('e8800000-0000-4000-8000-000000000009','e8700000-0000-4000-8000-000000000009','e8500000-0000-4000-8000-000000000001','J02 service',1,20000,'pcs',1,0),
 ('e8800000-0000-4000-8000-00000000000a','e8700000-0000-4000-8000-00000000000a','e8500000-0000-4000-8000-000000000001','J02 service',1,10000,'pcs',1,0);
select finalize_pos_sale('e8700000-0000-4000-8000-000000000007');
select finalize_pos_sale('e8700000-0000-4000-8000-000000000008');
select finalize_pos_sale('e8700000-0000-4000-8000-000000000009');
select finalize_pos_sale('e8700000-0000-4000-8000-00000000000a');
select pg_temp.assert_ok((select count(*)=3 and bool_and(coa_code='1141') from sale_payments where method='Tunai'
 and sale_id in('e8700000-0000-4000-8000-000000000007','e8700000-0000-4000-8000-000000000008','e8700000-0000-4000-8000-00000000000a')),
 'fixture: old cash sales recorded on the old cash account');
set local role postgres;
insert into coa_accounts(code,name,type,normal_balance,is_header) values('1144','J02 kas toko','ASET','D',false)
 on conflict(code) do update set is_active=true,is_header=false;
insert into cash_accounts(id,nama,jenis,coa_code,branch_id)
 values('e8600000-0000-4000-8000-000000000004','J02 kas toko','Kas','1144','e8200000-0000-4000-8000-000000000001');
update payment_account_map set cash_account_id='e8600000-0000-4000-8000-000000000004'
 where branch_id='e8200000-0000-4000-8000-000000000001' and metode='Tunai';
-- Snapshot rusak (rekening di snapshot bukan milik kode akunnya) tetap ditolak.
set local session_replication_role=replica;
update sale_payments set account_snapshot=jsonb_set(account_snapshot,'{cash_account_id}','"e8600000-0000-4000-8000-000000000002"')
 where sale_id='e8700000-0000-4000-8000-00000000000a';
set local session_replication_role=origin;
set local role authenticated;
select correct_pos_sale_payment('e8700000-0000-4000-8000-000000000007',0,'j02-old-full','Kasir salah pilih metode',0,30000);
select pg_temp.assert_ok((select revision=1 and metode_bayar='Transfer' from sales where id='e8700000-0000-4000-8000-000000000007')
 and pg_temp.balance_for_sale('e8700000-0000-4000-8000-000000000007','1141')=0
 and pg_temp.balance_for_sale('e8700000-0000-4000-8000-000000000007','1144')=0
 and pg_temp.balance_for_sale('e8700000-0000-4000-8000-000000000007','1142')=30000
 and pg_temp.balance_for_sale('e8700000-0000-4000-8000-000000000007','510001')=-30000,
 'old-account cash sale moves fully to Transfer after the cash map changed; old cash account reversed');
select correct_pos_sale_payment('e8700000-0000-4000-8000-000000000008',0,'j02-old-split','Sebagian dibayar transfer',15000,25000);
select pg_temp.assert_ok(pg_temp.balance_for_sale('e8700000-0000-4000-8000-000000000008','1141')=15000
 and pg_temp.balance_for_sale('e8700000-0000-4000-8000-000000000008','1144')=0
 and pg_temp.balance_for_sale('e8700000-0000-4000-8000-000000000008','1142')=25000
 and (select coa_code='1141' and account_snapshot->>'code'='1141'
   and account_snapshot->>'cash_account_id'='e8600000-0000-4000-8000-000000000001'
  from sale_payments where sale_id='e8700000-0000-4000-8000-000000000008' and method='Tunai'),
 'remaining cash part stays on its recorded account; only the moved amount changes account');
select correct_pos_sale_payment('e8700000-0000-4000-8000-000000000009',0,'j02-old-transfer','Ternyata dibayar tunai',20000,0);
select pg_temp.assert_ok(pg_temp.balance_for_sale('e8700000-0000-4000-8000-000000000009','1142')=0
 and pg_temp.balance_for_sale('e8700000-0000-4000-8000-000000000009','1144')=20000
 and pg_temp.balance_for_sale('e8700000-0000-4000-8000-000000000009','1141')=0
 and (select coa_code='1144' and account_snapshot->>'cash_account_id'='e8600000-0000-4000-8000-000000000004'
  from sale_payments where sale_id='e8700000-0000-4000-8000-000000000009' and method='Tunai'),
 'a newly introduced method uses the current branch map');
select pg_temp.reject($q$select correct_pos_sale_payment('e8700000-0000-4000-8000-00000000000a',0,'j02-old-broken','Kasir salah pilih metode',0,10000)$q$,
 'inconsistent account snapshot','Akun sumber pembayaran tidak lengkap atau tidak konsisten');
select pg_temp.assert_ok((select revision=0 and metode_bayar='Tunai' from sales where id='e8700000-0000-4000-8000-00000000000a'),
 'rejected inconsistent source leaves the sale untouched');
set local role postgres;
insert into bank_reconciliations(tanggal,cash_account_id,bank_coa_code)
 values((now() at time zone 'Asia/Jakarta')::date,'e8600000-0000-4000-8000-000000000001','1141');
set local role authenticated;
select pg_temp.reject($q$select correct_pos_sale_payment('e8700000-0000-4000-8000-000000000008',1,'j02-old-reconciled','Koreksi lagi',0,40000)$q$,
 'reconciliation on the recorded (old) cash account still blocks','Rekonsiliasi bank');

-- J02_TANGGAL_ASLI (12 Nov): koreksi struk lama dibukukan di TANGGAL STRUK, bukan hari koreksi.
set local role postgres;
delete from bank_reconciliations where cash_account_id='e8600000-0000-4000-8000-000000000001';
set local role authenticated;
insert into sales(id,branch_id,no_struk,subtotal,total,metode_bayar,bayar,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint,created_at)
 values('e8700000-0000-4000-8000-00000000000b','e8200000-0000-4000-8000-000000000001','J02.BACKDATE',25000,25000,'Tunai',25000,
 'e8100000-0000-4000-8000-000000000001','e8400000-0000-4000-8000-000000000001','[{"method":"Tunai","amount":25000}]','j02-backdate',repeat('5',64),
 now()-interval '4 days');
insert into sale_items(id,sale_id,item_id,nama,qty,harga,satuan,faktor,hpp) values
 ('e8800000-0000-4000-8000-00000000000b','e8700000-0000-4000-8000-00000000000b','e8500000-0000-4000-8000-000000000001','J02 service',1,25000,'pcs',1,0);
select finalize_pos_sale('e8700000-0000-4000-8000-00000000000b');
select pg_temp.assert_ok((select tanggal=((now()-interval '4 days') at time zone 'Asia/Jakarta')::date from journal_entries
 where source='sale' and source_ref='J02.BACKDATE'),'fixture: sale journal sits four days back');
-- Rekonsiliasi bank sesudah tanggal struk tetap memblokir (jurnal koreksi akan jatuh di periode yang sudah dicocokkan).
set local role postgres;
insert into bank_reconciliations(tanggal,cash_account_id,bank_coa_code)
 values(((now()-interval '2 days') at time zone 'Asia/Jakarta')::date,'e8600000-0000-4000-8000-000000000002','1142');
set local role authenticated;
select pg_temp.reject($q$select correct_pos_sale_payment('e8700000-0000-4000-8000-00000000000b',0,'j02-backdate-rec','Kasir salah pilih metode',0,25000)$q$,
 'reconciliation between sale date and today blocks a backdated correction','Rekonsiliasi bank');
set local role postgres;
delete from bank_reconciliations where cash_account_id='e8600000-0000-4000-8000-000000000002';
set local role authenticated;
select correct_pos_sale_payment('e8700000-0000-4000-8000-00000000000b',0,'j02-backdate','Kasir salah pilih metode',0,25000);
select pg_temp.assert_ok((select count(*)=2 and bool_and(e.tanggal=((now()-interval '4 days') at time zone 'Asia/Jakarta')::date)
 from journal_entries e where e.source_ref=(select id::text from sale_payment_corrections where sale_id='e8700000-0000-4000-8000-00000000000b')),
 'reversal and replacement are booked on the original sale date, not the correction day');
select pg_temp.assert_ok((select (created_at at time zone 'Asia/Jakarta')::date=(now() at time zone 'Asia/Jakarta')::date
 from sale_payment_corrections where sale_id='e8700000-0000-4000-8000-00000000000b'),
 'the real correction time stays in the audit trail');
select pg_temp.assert_ok(pg_temp.balance_for_sale('e8700000-0000-4000-8000-00000000000b','1144')=0
 and pg_temp.balance_for_sale('e8700000-0000-4000-8000-00000000000b','1142')=25000
 and pg_temp.balance_for_sale('e8700000-0000-4000-8000-00000000000b','510001')=-25000,
 'backdated correction ledger');
-- Tutup buku sampai tanggal struk: koreksi ditolak (tidak ada jurnal di periode tertutup).
set local role postgres;
update accounting_locks set closed_until=((now()-interval '4 days') at time zone 'Asia/Jakarta')::date where id;
set local role authenticated;
select pg_temp.reject($q$select correct_pos_sale_payment('e8700000-0000-4000-8000-00000000000b',1,'j02-backdate-closed','Koreksi lagi',25000,0)$q$,
 'closed period on the sale date','Periode sumber');
rollback;
