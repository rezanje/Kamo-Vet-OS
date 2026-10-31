-- J02 lanjutan: koreksi Tunai<->Transfer pada pembayaran invoice klinik.
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
-- Saldo akun untuk satu invoice di seluruh jurnal klinik (pendapatan, pelunasan, koreksi).
create function pg_temp.bal(p_invoice uuid,p_code text) returns numeric language sql as $$
 select coalesce(sum(l.debit-l.credit),0) from public.journal_entries e join public.journal_lines l on l.entry_id=e.id
 join public.coa_accounts a on a.id=l.account_id
 where e.source_ref=(select invoice_no from public.invoices where id=p_invoice)
  and e.source in('klinik','klinik-ar','klinik-koreksi-bayar') and a.code=p_code$$;
create function pg_temp.today() returns date language sql as $$select (now() at time zone 'Asia/Jakarta')::date$$;

insert into auth.users(id,raw_user_meta_data) values
 ('f1000000-0000-4000-8000-000000000001','{"full_name":"Owner klinik fiktif"}'),
 ('f1000000-0000-4000-8000-000000000002','{"full_name":"Finance klinik fiktif"}'),
 ('f1000000-0000-4000-8000-000000000003','{"full_name":"Staff klinik fiktif"}');
update profiles set role='OWNER',is_active=true where id='f1000000-0000-4000-8000-000000000001';
update profiles set role='FINANCE',is_active=true where id='f1000000-0000-4000-8000-000000000002';
update profiles set role='STAFF',is_active=true where id='f1000000-0000-4000-8000-000000000003';
insert into branches(id,code,name,type) values('f2000000-0000-4000-8000-000000000001','J02KLN','J02 Klinik','KLINIK');
insert into user_branches(user_id,branch_id) values
 ('f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001'),
 ('f1000000-0000-4000-8000-000000000002','f2000000-0000-4000-8000-000000000001'),
 ('f1000000-0000-4000-8000-000000000003','f2000000-0000-4000-8000-000000000001');
insert into customers(id,name,phone) values('f4000000-0000-4000-8000-000000000001','Pelanggan J02','080000000201');
insert into pets(id,customer_id,name) values('f5000000-0000-4000-8000-000000000001','f4000000-0000-4000-8000-000000000001','Pasien J02');
insert into visits(id,branch_id,customer_id,pet_id)
 select ('f6000000-0000-4000-8000-00000000000'||n)::uuid,'f2000000-0000-4000-8000-000000000001',
  'f4000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000001' from generate_series(1,4) n;
insert into cashier_shifts(id,branch_id,opened_by,shift_type,status)
 values('fa000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','klinik','open');
insert into coa_accounts(code,name,type,normal_balance,is_active,is_header) values
 ('1101','Kas','ASET','D',true,false),('1102','Bank','ASET','D',true,false),('1201','Piutang','ASET','D',true,false),
 ('1301','Persediaan','ASET','D',true,false),('2201','PPN Keluaran','LIABILITAS','K',true,false),
 ('4102','Diskon','PENDAPATAN','D',true,false),('4201','Pendapatan Klinik','PENDAPATAN','K',true,false),
 ('5101','HPP','BEBAN','D',true,false)
 on conflict(code) do update set is_active=true,is_header=false;
insert into cash_accounts(id,nama,jenis,coa_code) values
 ('f8000000-0000-4000-8000-000000000001','Kas J02','Kas','1101'),('f8000000-0000-4000-8000-000000000002','Bank J02','Bank','1102')
 on conflict(coa_code) do update set is_active=true,branch_id=null;
insert into payment_account_map(metode,branch_id,cash_account_id)
 select 'Tunai','f2000000-0000-4000-8000-000000000001'::uuid,id from cash_accounts where coa_code='1101'
 union all select 'Transfer','f2000000-0000-4000-8000-000000000001'::uuid,id from cash_accounts where coa_code='1102';
update accounting_locks set closed_until=null where id;
create temp table inv(name text primary key,id uuid);
grant all on inv to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
-- A. Lunas sekali bayar Tunai (pembayaran langsung di jurnal 'klinik').
insert into inv select 'direct',public.clinic_post_invoice('f6000000-0000-4000-8000-000000000001','j02-kln-direct',
 jsonb_build_object('tanggal',pg_temp.today(),'subtotal',100000,'discount',0,'tax',0,'total',100000,'dp_amount',0,
  'paid_status','Lunas','metode_bayar','Tunai','shift_id','fa000000-0000-4000-8000-000000000001'),
 '[{"description":"Konsultasi fiktif","qty":1,"price":100000,"kind":"jasa","discount_percent":0}]');
-- B. Split Tunai 30.000 + Transfer 70.000 (dua baris invoice_payments + jurnal klinik-ar).
insert into inv select 'split',public.clinic_post_split_invoice('f6000000-0000-4000-8000-000000000002','j02-kln-split',
 jsonb_build_object('tanggal',pg_temp.today(),'subtotal',100000,'discount',0,'tax',0,'total',100000,'dp_amount',0,
  'paid_status','Lunas','metode_bayar','Tunai','shift_id','fa000000-0000-4000-8000-000000000001'),
 '[{"description":"Tindakan fiktif","qty":1,"price":100000,"kind":"jasa","discount_percent":0}]',
 '[{"method":"Tunai","amount":30000,"kas_code":"1101"},{"method":"Transfer","amount":70000,"kas_code":"1102"}]');
-- C. DP Tunai 40.000 dari 100.000.
insert into inv select 'dp',public.clinic_post_invoice('f6000000-0000-4000-8000-000000000003','j02-kln-dp',
 jsonb_build_object('tanggal',pg_temp.today(),'subtotal',100000,'discount',0,'tax',0,'total',100000,'dp_amount',40000,
  'dp_date',pg_temp.today(),'paid_status','DP','metode_bayar','Tunai','shift_id','fa000000-0000-4000-8000-000000000001'),
 '[{"description":"Rawat fiktif","qty":1,"price":100000,"kind":"jasa","discount_percent":0}]');
select pg_temp.ok(pg_temp.bal((select id from inv where name='direct'),'1101')=100000,'fixture: direct cash posted');

-- Tutup shift klinik: koreksi sesudahnya tetap boleh, angka penutupan tidak berubah.
reset role;
update cashier_shifts set status='closed',closed_at=now(),expected_cash=170000,closing_balance=170000,selisih=0,
 closing_breakdown='{"Tunai":170000,"Transfer":70000}' where id='fa000000-0000-4000-8000-000000000001';
create temp table shift_before as select to_jsonb(s) snap from cashier_shifts s where id='fa000000-0000-4000-8000-000000000001';
grant select on shift_before to authenticated;
set local role authenticated;

-- STAFF ditolak walau punya akses cabang.
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000003',true);
select pg_temp.reject($q$select correct_clinic_invoice_payment((select id from inv where name='direct'),null,0,'kln-staff','Kasir salah pilih metode','Transfer')$q$,
 'staff refused','Hanya Owner atau Finance');

-- FINANCE: pembayaran langsung Tunai -> Transfer sesudah shift ditutup.
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000002',true);
create temp table r as select 'direct-1'::text name,correct_clinic_invoice_payment((select id from inv where name='direct'),null,0,'kln-fin-1','Kasir salah pilih metode','Transfer') result;
select pg_temp.ok((select metode_bayar='Transfer' and total=100000 and voided_at is null from invoices where id=(select id from inv where name='direct')),
 'same invoice identity/total with corrected method');
select pg_temp.ok(pg_temp.bal((select id from inv where name='direct'),'1101')=0
 and pg_temp.bal((select id from inv where name='direct'),'1102')=100000
 and pg_temp.bal((select id from inv where name='direct'),'4201')=-100000,'cash moved to mapped bank, revenue unchanged');
select pg_temp.ok((select count(*)=1 and bool_and(e.tanggal=pg_temp.today() and e.source='klinik-koreksi-bayar')
 from journal_entries e where e.id=(select journal_id from clinic_payment_corrections where invoice_id=(select id from inv where name='direct'))),
 'one correction journal dated on the correction day');
select pg_temp.ok((select count(*)=1 and bool_and(revision=1 and invoice_payment_id is null and from_method='Tunai' and to_method='Transfer'
 and from_code='1101' and to_code='1102' and source_shift_status='closed' and reason='Kasir salah pilih metode'
 and created_by='f1000000-0000-4000-8000-000000000002') from clinic_payment_corrections where invoice_id=(select id from inv where name='direct')),
 'audit row with before/after, closed shift and finance actor');
select pg_temp.ok((select count(*)=0 from invoice_payments where invoice_id=(select id from inv where name='direct')),'no payment row/receipt created');
-- Retry idempoten, payload berbeda dan revisi basi ditolak.
insert into r select 'direct-1-retry',correct_clinic_invoice_payment((select id from inv where name='direct'),null,0,'kln-fin-1','Kasir salah pilih metode','Transfer');
select pg_temp.ok((select (select result from r where name='direct-1')=(select result from r where name='direct-1-retry'))
 and (select count(*)=1 from clinic_payment_corrections where invoice_id=(select id from inv where name='direct'))
 and (select count(*)=1 from journal_entries where source='klinik-koreksi-bayar'
  and source_ref=(select invoice_no from invoices where id=(select id from inv where name='direct'))),'same key retry is idempotent');
select pg_temp.reject($q$select correct_clinic_invoice_payment((select id from inv where name='direct'),null,0,'kln-fin-1','Alasan lain','Transfer')$q$,
 'changed payload on same key','rincian berbeda');
select pg_temp.reject($q$select correct_clinic_invoice_payment((select id from inv where name='direct'),null,0,'kln-fin-stale','Kasir salah pilih metode','Tunai')$q$,
 'stale revision','sudah berubah');
select pg_temp.reject($q$select correct_clinic_invoice_payment((select id from inv where name='direct'),null,1,'kln-fin-same','Kasir salah pilih metode','Transfer')$q$,
 'no-op method rejected','tidak mengubah');
-- Jurnal koreksi tidak bisa dirusak lewat API biasa; invoice terkoreksi tidak bisa di-void lewat jalur lama.
select pg_temp.reject($q$delete from journal_lines where entry_id=(select journal_id from clinic_payment_corrections where invoice_id=(select id from inv where name='direct'))$q$,
 'correction lines cannot be deleted','sudah tetap');
select pg_temp.reject($q$update journal_entries set voided_at=now() where id=(select journal_id from clinic_payment_corrections where invoice_id=(select id from inv where name='direct'))$q$,
 'correction header cannot be voided');
select pg_temp.reject($q$update invoice_payments set metode='Tunai' where invoice_id=(select id from inv where name='split')$q$,
 'direct payment write remains forbidden');
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
select pg_temp.reject($q$select clinic_void_reissue_invoice((select id from inv where name='direct'),'kln-void','Salah tagih')$q$,
 'void/reissue after correction fails closed','PAYMENT_CORRECTED');
-- OWNER mengembalikan (revisi 1): rekening asal dibaca dari koreksi terakhir.
insert into r select 'direct-2',correct_clinic_invoice_payment((select id from inv where name='direct'),null,1,'kln-owner-2','Ternyata memang tunai','Tunai');
select pg_temp.ok(pg_temp.bal((select id from inv where name='direct'),'1101')=100000
 and pg_temp.bal((select id from inv where name='direct'),'1102')=0
 and (select metode_bayar='Tunai' from invoices where id=(select id from inv where name='direct'))
 and (select count(*)=2 from clinic_payment_corrections where invoice_id=(select id from inv where name='direct')),
 'second correction reverses through the latest account');

-- B. Split: bagian Tunai -> Transfer; baris tetap sama, tidak ada struk/pembayaran baru.
create temp table split_before as select id,invoice_id,amount,checkout_payment,request_key,request_hash
 from invoice_payments where invoice_id=(select id from inv where name='split');
select pg_temp.reject($q$select correct_clinic_invoice_payment((select id from inv where name='split'),null,0,'kln-split-direct','Kasir salah pilih metode','Transfer')$q$,
 'split invoice has no direct payment','tidak memiliki pembayaran langsung');
select pg_temp.reject($q$select correct_clinic_invoice_payment((select id from inv where name='split'),
 (select id from invoice_payments where invoice_id=(select id from inv where name='split') and metode='Transfer'),0,'kln-split-same','Kasir salah pilih metode','Transfer')$q$,
 'same method part rejected','tidak mengubah');
select pg_temp.reject($q$select correct_clinic_invoice_payment((select id from inv where name='direct'),
 (select id from invoice_payments where invoice_id=(select id from inv where name='split') and metode='Tunai'),2,'kln-split-foreign','Kasir salah pilih metode','Transfer')$q$,
 'payment of another invoice rejected','tidak ditemukan pada invoice');
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000002',true);
insert into r select 'split-1',correct_clinic_invoice_payment((select id from inv where name='split'),
 (select id from invoice_payments where invoice_id=(select id from inv where name='split') and metode='Tunai'),0,'kln-split-1','Kasir salah pilih metode','Transfer');
select pg_temp.ok((select count(*)=2 and bool_and(p.metode='Transfer' and p.kas_code='1102') from invoice_payments p
 where p.invoice_id=(select id from inv where name='split')),'both parts now transfer to the mapped bank');
select pg_temp.ok((select count(*)=2 from invoice_payments p join split_before b on b.id=p.id and b.invoice_id=p.invoice_id and b.amount=p.amount
 and b.checkout_payment and p.checkout_payment and b.request_key=p.request_key and b.request_hash=p.request_hash),
 'split rows keep identity, invoice link, amount, checkout flag and receipt idempotency');
select pg_temp.ok(pg_temp.bal((select id from inv where name='split'),'1101')=0
 and pg_temp.bal((select id from inv where name='split'),'1102')=100000
 and pg_temp.bal((select id from inv where name='split'),'1201')=0
 and (select count(*)=2 from journal_entries where source='klinik-ar' and source_ref=(select invoice_no from invoices where id=(select id from inv where name='split'))),
 'ledger corrected without a duplicate receipt journal');
select pg_temp.ok((select paid_status='Lunas' and metode_bayar='Tunai' from invoices where id=(select id from inv where name='split')),
 'split header untouched');

-- C. DP Tunai -> Transfer, lalu pelunasan piutang tetap bisa diterima.
insert into r select 'dp-1',correct_clinic_invoice_payment((select id from inv where name='dp'),null,0,'kln-dp-1','DP sebenarnya transfer','Transfer');
select pg_temp.ok(pg_temp.bal((select id from inv where name='dp'),'1101')=0 and pg_temp.bal((select id from inv where name='dp'),'1102')=40000
 and pg_temp.bal((select id from inv where name='dp'),'1201')=60000,'DP moved to bank, receivable unchanged');
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
select clinic_receive_invoice_payment((select id from inv where name='dp'),pg_temp.today(),60000,'Tunai','1101',null,'kln-dp-settle');
select pg_temp.ok((select paid_status='Lunas' from invoices where id=(select id from inv where name='dp'))
 and pg_temp.bal((select id from inv where name='dp'),'1101')=60000 and pg_temp.bal((select id from inv where name='dp'),'1201')=0,
 'receivable settlement still works after a DP correction');
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000002',true);
-- Pelunasan yang baru juga dapat dikoreksi; total kas/bank invoice tetap 100.000.
insert into r select 'dp-2',correct_clinic_invoice_payment((select id from inv where name='dp'),
 (select id from invoice_payments where invoice_id=(select id from inv where name='dp')),1,'kln-dp-2','Pelunasan via transfer','Transfer');
select pg_temp.ok(pg_temp.bal((select id from inv where name='dp'),'1101')=0 and pg_temp.bal((select id from inv where name='dp'),'1102')=100000,
 'settlement part corrected');

-- D. Periode tertutup, rekening terekonsiliasi dan kegagalan tengah jalan ditolak tanpa sisa.
reset role;
update accounting_locks set closed_until=pg_temp.today() where id;
set local role authenticated;
select pg_temp.reject($q$select correct_clinic_invoice_payment((select id from inv where name='split'),
 (select min(id::text)::uuid from invoice_payments where invoice_id=(select id from inv where name='split')),1,'kln-closed','Kasir salah pilih metode','Tunai')$q$,
 'closed accounting period','Periode');
reset role;
update accounting_locks set closed_until=null where id;
insert into bank_reconciliations(tanggal,cash_account_id,bank_coa_code) select pg_temp.today(),id,'1102' from cash_accounts where coa_code='1102';
set local role authenticated;
select pg_temp.reject($q$select correct_clinic_invoice_payment((select id from inv where name='split'),
 (select min(id::text)::uuid from invoice_payments where invoice_id=(select id from inv where name='split')),1,'kln-recon','Kasir salah pilih metode','Tunai')$q$,
 'reconciled bank account','Rekonsiliasi bank');
reset role;
delete from bank_reconciliations where bank_coa_code='1102';
-- Rekening tujuan yang dipetakan tidak aktif ditolak.
update cash_accounts set is_active=false where coa_code='1101';
set local role authenticated;
select pg_temp.reject($q$select correct_clinic_invoice_payment((select id from inv where name='split'),
 (select min(id::text)::uuid from invoice_payments where invoice_id=(select id from inv where name='split')),1,'kln-unmapped','Kasir salah pilih metode','Tunai')$q$,
 'inactive mapped destination account','belum dipetakan atau tidak aktif');
reset role;
update cash_accounts set is_active=true where coa_code='1101';
create function pg_temp.force_rollback() returns trigger language plpgsql as $$begin raise exception 'Injected audit storage failure';end$$;
create trigger kln_force_rollback before insert on clinic_payment_corrections for each row execute function pg_temp.force_rollback();
set local role authenticated;
select pg_temp.reject($q$select correct_clinic_invoice_payment((select id from inv where name='split'),
 (select min(id::text)::uuid from invoice_payments where invoice_id=(select id from inv where name='split')),1,'kln-rollback','Kasir salah pilih metode','Tunai')$q$,
 'audit failure rolls back journal and payment','Injected audit storage failure');
select pg_temp.ok((select count(*)=2 and bool_and(metode='Transfer') from invoice_payments where invoice_id=(select id from inv where name='split'))
 and (select count(*)=1 from journal_entries where source='klinik-koreksi-bayar'
  and source_ref=(select invoice_no from invoices where id=(select id from inv where name='split'))),
 'rejected corrections leave payments and journals untouched');
reset role;
drop trigger kln_force_rollback on clinic_payment_corrections;
select pg_temp.ok((select to_jsonb(s)=(select snap from shift_before) from cashier_shifts s where id='fa000000-0000-4000-8000-000000000001'),
 'closed clinic shift is not reopened and its closing totals are untouched');
select pg_temp.ok((select count(*)=5 from clinic_payment_corrections) and (select count(*)=5 from clinic_payment_correction_requests),
 'five successful corrections, one request row each');
-- Jejak koreksi dapat dibaca FINANCE, tidak oleh STAFF.
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000002',true);
select pg_temp.ok((select count(*)=5 from clinic_payment_corrections),'finance reads the trail');
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000003',true);
select pg_temp.ok((select count(*)=0 from clinic_payment_corrections),'staff cannot read the trail');
rollback;
