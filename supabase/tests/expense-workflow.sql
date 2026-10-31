-- Disposable local acceptance only. Every fixture and mutation rolls back.
begin;
select set_config('request.jwt.claim.role','service_role',true);
alter table auth.users disable trigger all;
insert into auth.users(id,raw_user_meta_data) values
 ('ee100000-0000-4000-8000-000000000001','{"full_name":"Expense test cashier"}'),
 ('ee100000-0000-4000-8000-000000000002','{"full_name":"Expense test finance"}');
alter table auth.users enable trigger all;
insert into public.profiles(id,full_name) values
 ('ee100000-0000-4000-8000-000000000001','Expense test cashier'),
 ('ee100000-0000-4000-8000-000000000002','Expense test finance');
alter table public.profiles disable trigger all;
update public.profiles set role=case when id='ee100000-0000-4000-8000-000000000002' then 'FINANCE'::public.user_role else 'STAFF'::public.user_role end,is_active=true
 where id in ('ee100000-0000-4000-8000-000000000001','ee100000-0000-4000-8000-000000000002');
alter table public.profiles enable trigger all;
insert into public.branches(id,code,name,type) values
 ('ee200000-0000-4000-8000-000000000001','EXP-TEST-A','Expense test A','PETSHOP'),
 ('ee200000-0000-4000-8000-000000000002','EXP-TEST-B','Expense test B','PETSHOP');
insert into public.user_branches(user_id,branch_id) values('ee100000-0000-4000-8000-000000000001','ee200000-0000-4000-8000-000000000001');
insert into public.cashier_shifts(id,branch_id,opened_by,shift_type) values
 ('ee300000-0000-4000-8000-000000000001','ee200000-0000-4000-8000-000000000001','ee100000-0000-4000-8000-000000000001','petshop');
insert into public.coa_accounts(code,name,type,normal_balance,is_header,is_active) values
 ('760003','Expense acceptance','BEBAN','D',false,true),('110003','Cash acceptance','ASET','D',false,true),
 ('1103','Branch A cash acceptance','ASET','D',false,true),('1104','Branch B cash acceptance','ASET','D',false,true)
 on conflict(code) do update set is_active=true,is_header=false;
insert into public.cash_accounts(id,nama,jenis,coa_code,branch_id,is_active) values
 ('ee400000-0000-4000-8000-000000000001','Branch A cash','Kas','1103','ee200000-0000-4000-8000-000000000001',true),
 ('ee400000-0000-4000-8000-000000000002','Branch B cash','Kas','1104','ee200000-0000-4000-8000-000000000002',true);
delete from public.payment_account_map where metode='Tunai';
update public.accounting_locks set closed_until=null where id;

create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'ASSERTION FAILED: %',label; end if; end $$;
create function pg_temp.expect_error(statement text,fragment text) returns void language plpgsql as $$
begin
 begin execute statement; raise exception 'Expected a failure, statement succeeded';
 exception when others then if position(fragment in sqlerrm)=0 then raise; end if; end;
end $$;
create function pg_temp.save_expense(key text,amount numeric default 25000) returns jsonb language sql as $$
 select public.post_expense_atomic(key,'cashier','ee200000-0000-4000-8000-000000000002',
   jsonb_build_object('tanggal',(now() at time zone 'Asia/Jakarta')::date,'kategori','Operasional','jumlah',amount,'metode_bayar','Tunai','deskripsi','Acceptance proof'),
   '[{"path":"pengeluaran/acceptance.jpg","nama":"acceptance.jpg","mime":"image/jpeg","ukuran":100}]'::jsonb)
$$;
create function pg_temp.save_backoffice(key text,account uuid default null) returns jsonb language sql as $$
 select public.post_expense_atomic(key,'backoffice','ee200000-0000-4000-8000-000000000001',
   jsonb_build_object('tanggal',(now() at time zone 'Asia/Jakarta')::date,'kategori','Operasional','jumlah',25000,'metode_bayar','Tunai','deskripsi','Backoffice acceptance','account_id',account),
   '[{"path":"pengeluaran/backoffice.jpg","nama":"backoffice.jpg","mime":"image/jpeg","ukuran":100}]'::jsonb)
$$;
create temp table expense_test_results(name text primary key,result jsonb);
grant all on expense_test_results to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub','ee100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"sub":"ee100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('request.headers','{}',true);
insert into expense_test_results values('first',pg_temp.save_expense('expense-first'));
select pg_temp.assert_true(pg_temp.save_expense('expense-first')=(select result from expense_test_results where name='first'),'retry returns original expense and journal');
select pg_temp.assert_true((select count(*)=1 from public.expenses where created_by=auth.uid()),'retry inserts one expense');
select pg_temp.assert_true((select branch_id='ee200000-0000-4000-8000-000000000001' and shift_id='ee300000-0000-4000-8000-000000000001' from public.expenses where id=(select (result->>'expense_id')::uuid from expense_test_results where name='first')),'client branch ignored; open shift is authoritative');
select pg_temp.assert_true((select count(*)=1 from public.document_attachments where ref_id=(select (result->>'expense_id')::uuid from expense_test_results where name='first')),'retry has one proof');
select pg_temp.assert_true((select count(*)=1 from public.journal_entries where source='expense' and source_ref=(select result->>'expense_id' from expense_test_results where name='first')),'retry has one journal');
select pg_temp.expect_error(format('insert into public.expenses(branch_id,tanggal,kategori,jumlah,created_by,journal_entry_id) values(%L::uuid,current_date,%L,25000,auth.uid(),%L::uuid)','ee200000-0000-4000-8000-000000000001','Operasional',(select result->>'journal_id' from expense_test_results where name='first')),'row-level security');
select pg_temp.assert_true(public.get_expense_posting_result('expense-first')=(select result from expense_test_results where name='first'),'read-only recovery confirms exact committed identity');
select pg_temp.expect_error($q$select pg_temp.save_expense('expense-first',30000)$q$,'rincian berbeda');
select pg_temp.expect_error($q$select pg_temp.save_expense('expense-three-decimals',25000.123)$q$,'jumlah');
select set_config('request.jwt.claim.sub','ee100000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"ee100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
insert into expense_test_results values('backoffice-account',pg_temp.save_backoffice('backoffice-account','ee400000-0000-4000-8000-000000000001'));
select pg_temp.assert_true((select count(*)=1 from public.journal_entries j join public.journal_lines l on l.entry_id=j.id join public.coa_accounts a on a.id=l.account_id where j.id=(select (result->>'journal_id')::uuid from expense_test_results where name='backoffice-account') and a.code='1103'),'backoffice uses selected account');
select pg_temp.assert_true(pg_temp.save_backoffice('backoffice-account','ee400000-0000-4000-8000-000000000001')=(select result from expense_test_results where name='backoffice-account'),'backoffice selected-account retry is idempotent');
select pg_temp.expect_error($q$select pg_temp.save_backoffice('backoffice-wrong-branch','ee400000-0000-4000-8000-000000000002')$q$,'Rekening kas/bank tidak valid');
select set_config('request.jwt.claim.sub','ee100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"ee100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into expense_test_results values('second',pg_temp.save_expense('expense-second'));
select pg_temp.assert_true((select count(*)=2 from public.expenses where created_by=auth.uid()),'two independent identical expenses remain permitted');
select pg_temp.expect_error(format('select public.revise_expense_atomic(%L,%L::uuid,0,%L,%L::jsonb,%L)','staff-edit',(select result->>'expense_id' from expense_test_results where name='first'),'edit','{"jumlah":30000}','Correction'),'Akses');
select pg_temp.expect_error(format('delete from public.expenses where id=%L::uuid',(select result->>'expense_id' from expense_test_results where name='first')),'permission denied');

reset role;
update public.coa_accounts set is_active=false where code='760003';
set local role authenticated;
select pg_temp.expect_error($q$select pg_temp.save_expense('expense-account-failure')$q$,'Akun');
select pg_temp.assert_true((select count(*)=2 from public.expenses where created_by=auth.uid()),'journal failure rolls back expense');
reset role;
select pg_temp.assert_true(not exists(select 1 from public.expense_posting_requests where request_key='expense-account-failure'),'journal failure rolls back replay record');
update public.coa_accounts set is_active=true where code='760003';

set local role authenticated;
select set_config('request.jwt.claim.sub','ee100000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"ee100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
insert into expense_test_results values('edit',public.revise_expense_atomic('finance-edit',(select (result->>'expense_id')::uuid from expense_test_results where name='first'),0,'edit',jsonb_build_object('tanggal',(now() at time zone 'Asia/Jakarta')::date,'kategori','Operasional','deskripsi','Corrected expense','jumlah',30000,'metode_bayar','Tunai'),'Wrong amount'));
select pg_temp.assert_true((select jumlah=30000 and revision=1 and created_by='ee100000-0000-4000-8000-000000000001' from public.expenses where id=(select (result->>'expense_id')::uuid from expense_test_results where name='first')),'finance corrects cashier expense without changing creator');
select pg_temp.assert_true((select sum(jumlah)=55000 from public.expenses where shift_id='ee300000-0000-4000-8000-000000000001'),'open shift sums use corrected amount');
select pg_temp.assert_true((select count(*)=1 from public.expense_revisions where expense_id=(select (result->>'expense_id')::uuid from expense_test_results where name='first') and before_value->>'jumlah'='25000' and after_value->>'jumlah'='30000'),'correction retains before/after audit');
select pg_temp.expect_error(format('select public.revise_expense_atomic(%L,%L::uuid,0,%L,%L::jsonb,%L)','stale-edit',(select result->>'expense_id' from expense_test_results where name='first'),'edit','{"jumlah":40000}','Correction'),'berubah');
insert into expense_test_results values('void',public.revise_expense_atomic('finance-void',(select (result->>'expense_id')::uuid from expense_test_results where name='first'),1,'void','{}','Duplicate entry'));
select pg_temp.assert_true(public.revise_expense_atomic('finance-void',(select (result->>'expense_id')::uuid from expense_test_results where name='first'),1,'void','{}','Duplicate entry')=(select result from expense_test_results where name='void'),'void retry returns original result');
select pg_temp.assert_true((select jumlah=0 and voided_at is not null and revision=2 from public.expenses where id=(select (result->>'expense_id')::uuid from expense_test_results where name='first')),'void removes effective outflow and retains document');
select pg_temp.assert_true((select count(*)=2 from public.expense_revisions where expense_id=(select (result->>'expense_id')::uuid from expense_test_results where name='first')),'void retry does not duplicate audit or reversal');
select pg_temp.assert_true((select sum(jumlah)=25000 from public.expenses where shift_id='ee300000-0000-4000-8000-000000000001'),'shift excludes voided outflow');
select pg_temp.assert_true((select sum(l.debit-l.credit)=50000 from public.journal_lines l join public.coa_accounts a on a.id=l.account_id join public.journal_entries j on j.id=l.entry_id where j.branch_id='ee200000-0000-4000-8000-000000000001' and a.code='760003'),'journal net expense includes active backoffice and shift expenses');

reset role;
update public.cashier_shifts set status='closed' where id='ee300000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.expect_error(format('select public.revise_expense_atomic(%L,%L::uuid,0,%L,%L::jsonb,%L)','closed-void',(select result->>'expense_id' from expense_test_results where name='second'),'void','{}','Correction'),'Shift sudah ditutup');
reset role;
update public.cashier_shifts set status='open' where id='ee300000-0000-4000-8000-000000000001';
update public.accounting_locks set closed_until=(now() at time zone 'Asia/Jakarta')::date where id;
set local role authenticated;
select pg_temp.expect_error(format('select public.revise_expense_atomic(%L,%L::uuid,0,%L,%L::jsonb,%L)','locked-void',(select result->>'expense_id' from expense_test_results where name='second'),'void','{}','Correction'),'ditutup');
select set_config('request.jwt.claim.sub','ee100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"ee100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select pg_temp.assert_true(public.get_expense_posting_result('expense-second')=(select result from expense_test_results where name='second'),'committed response recovery survives closed books');
select pg_temp.assert_true(public.get_expense_posting_result('not-saved') is null,'uncommitted request has no success acknowledgement');
reset role;
rollback;
