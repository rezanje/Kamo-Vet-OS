-- Disposable local acceptance only. Every fixture and mutation rolls back.
-- Koreksi pengeluaran sesudah shift ditutup: OWNER/FINANCE boleh, ADMIN/STAFF ditolak,
-- angka tutup shift tidak berubah, periode tutup buku tetap mengunci.
begin;
select set_config('request.jwt.claim.role','service_role',true);
alter table auth.users disable trigger all;
insert into auth.users(id,raw_user_meta_data) values
 ('ea100000-0000-4000-8000-000000000001','{"full_name":"After-shift cashier"}'),
 ('ea100000-0000-4000-8000-000000000002','{"full_name":"After-shift finance"}'),
 ('ea100000-0000-4000-8000-000000000003','{"full_name":"After-shift owner"}'),
 ('ea100000-0000-4000-8000-000000000004','{"full_name":"After-shift admin"}');
alter table auth.users enable trigger all;
insert into public.profiles(id,full_name) values
 ('ea100000-0000-4000-8000-000000000001','After-shift cashier'),
 ('ea100000-0000-4000-8000-000000000002','After-shift finance'),
 ('ea100000-0000-4000-8000-000000000003','After-shift owner'),
 ('ea100000-0000-4000-8000-000000000004','After-shift admin');
alter table public.profiles disable trigger all;
update public.profiles set is_active=true,role=case id
  when 'ea100000-0000-4000-8000-000000000002' then 'FINANCE'::public.user_role
  when 'ea100000-0000-4000-8000-000000000003' then 'OWNER'::public.user_role
  when 'ea100000-0000-4000-8000-000000000004' then 'ADMIN'::public.user_role
  else 'STAFF'::public.user_role end
 where id::text like 'ea100000-%';
alter table public.profiles enable trigger all;
insert into public.branches(id,code,name,type) values('ea200000-0000-4000-8000-000000000001','EXP-AFTER','After-shift branch','PETSHOP');
insert into public.user_branches(user_id,branch_id) values
 ('ea100000-0000-4000-8000-000000000001','ea200000-0000-4000-8000-000000000001'),
 ('ea100000-0000-4000-8000-000000000004','ea200000-0000-4000-8000-000000000001');
insert into public.cashier_shifts(id,branch_id,opened_by,shift_type) values
 ('ea300000-0000-4000-8000-000000000001','ea200000-0000-4000-8000-000000000001','ea100000-0000-4000-8000-000000000001','petshop');
insert into public.coa_accounts(code,name,type,normal_balance,is_header,is_active) values
 ('1105','After-shift cash','ASET','D',false,true),('5401','Operations','BEBAN','D',false,true)
 on conflict(code) do update set is_active=true,is_header=false;
insert into public.cash_accounts(id,nama,jenis,coa_code,branch_id,is_active) values
 ('ea400000-0000-4000-8000-000000000001','After-shift cash','Kas','1105','ea200000-0000-4000-8000-000000000001',true);
delete from public.payment_account_map where metode='Tunai';
update public.accounting_locks set closed_until=null where id;

create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'ASSERTION FAILED: %',label; end if; end $$;
create function pg_temp.expect_error(statement text,fragment text) returns void language plpgsql as $$
begin
 begin execute statement; raise exception 'Expected a failure, statement succeeded';
 exception when others then if position(fragment in sqlerrm)=0 then raise; end if; end;
end $$;
create function pg_temp.act_as(actor text) returns void language sql as $$
 select set_config('request.jwt.claim.sub',actor,true),set_config('request.jwt.claim.role','authenticated',true),
  set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true),set_config('request.headers','{}',true);
$$;
create function pg_temp.save_expense(key text,amount numeric) returns jsonb language sql as $$
 select public.post_expense_atomic(key,'cashier',null,
   jsonb_build_object('tanggal',(now() at time zone 'Asia/Jakarta')::date,'kategori','Operasional','jumlah',amount,'metode_bayar','Tunai','deskripsi','After-shift proof'),
   '[{"path":"pengeluaran/after-shift.jpg","nama":"after-shift.jpg","mime":"image/jpeg","ukuran":100}]'::jsonb)
$$;
create function pg_temp.edit_payload(amount numeric) returns jsonb language sql as $$
 select jsonb_build_object('tanggal',(now() at time zone 'Asia/Jakarta')::date,'kategori','Operasional','deskripsi','Corrected after shift','jumlah',amount,'metode_bayar','Transfer')
$$;
create temp table after_shift_results(name text primary key,result jsonb);
grant all on after_shift_results to authenticated;
create temp table after_shift_snapshot as select * from public.cashier_shifts where false;
grant all on after_shift_snapshot to authenticated;

-- Kasir mencatat tiga pengeluaran tunai selama shift buka.
set local role authenticated;
select pg_temp.act_as('ea100000-0000-4000-8000-000000000001');
insert into after_shift_results values('a',pg_temp.save_expense('after-shift-a',25000));
insert into after_shift_results values('b',pg_temp.save_expense('after-shift-b',40000));
insert into after_shift_results values('c',pg_temp.save_expense('after-shift-c',15000));

-- Shift ditutup dengan angka penutupan yang tidak boleh berubah oleh koreksi.
reset role;
update public.cashier_shifts set status='closed',closed_at=now(),closing_balance=920000,expected_cash=920000,selisih=0
 where id='ea300000-0000-4000-8000-000000000001';
insert into after_shift_snapshot select * from public.cashier_shifts where id='ea300000-0000-4000-8000-000000000001';

set local role authenticated;
-- STAFF dan ADMIN tetap ditolak sesudah shift ditutup.
select pg_temp.expect_error(format('select public.revise_expense_atomic(%L,%L::uuid,0,%L,%L::jsonb,%L)','staff-after',(select result->>'expense_id' from after_shift_results where name='a'),'void','{}','Correction'),'Akses');
select pg_temp.act_as('ea100000-0000-4000-8000-000000000004');
select pg_temp.expect_error(format('select public.revise_expense_atomic(%L,%L::uuid,0,%L,%L::jsonb,%L)','admin-after',(select result->>'expense_id' from after_shift_results where name='a'),'void','{}','Correction'),'Hanya Owner atau Finance');

-- FINANCE mengedit nominal & metode sesudah shift ditutup.
select pg_temp.act_as('ea100000-0000-4000-8000-000000000002');
insert into after_shift_results values('finance-edit',public.revise_expense_atomic('finance-after-edit',(select (result->>'expense_id')::uuid from after_shift_results where name='a'),0,'edit',pg_temp.edit_payload(30000),'Salah input nominal'));
select pg_temp.assert_true((select result->>'source_shift_status'='closed' from after_shift_results where name='finance-edit'),'result names closed source shift');
select pg_temp.assert_true(public.revise_expense_atomic('finance-after-edit',(select (result->>'expense_id')::uuid from after_shift_results where name='a'),0,'edit',pg_temp.edit_payload(30000),'Salah input nominal')=(select result from after_shift_results where name='finance-edit'),'finance retry returns the original result');
select pg_temp.assert_true((select jumlah=30000 and metode_bayar='Transfer' and revision=1 and shift_id='ea300000-0000-4000-8000-000000000001' from public.expenses where id=(select (result->>'expense_id')::uuid from after_shift_results where name='a')),'finance edit applied and expense stays on its shift');
select pg_temp.assert_true((select count(*)=1 and bool_and(source_shift_status='closed' and reversal_journal_id is not null and replacement_journal_id is not null) from public.expense_revisions where expense_id=(select (result->>'expense_id')::uuid from after_shift_results where name='a')),'audit records closed shift with reversal and replacement journals');

-- OWNER membatalkan pengeluaran ganda sesudah shift ditutup.
select pg_temp.act_as('ea100000-0000-4000-8000-000000000003');
insert into after_shift_results values('owner-void',public.revise_expense_atomic('owner-after-void',(select (result->>'expense_id')::uuid from after_shift_results where name='b'),0,'void','{}','Tercatat dobel'));
select pg_temp.assert_true((select jumlah=0 and voided_at is not null and revision=1 from public.expenses where id=(select (result->>'expense_id')::uuid from after_shift_results where name='b')),'owner void applied after shift closed');

reset role;
select pg_temp.assert_true((select count(*)=1 from public.cashier_shifts s join after_shift_snapshot o using(id)
 where s.status='closed' and s.closed_at=o.closed_at and s.closing_balance=o.closing_balance and s.expected_cash=o.expected_cash
   and s.selisih is not distinct from o.selisih and s.closing_breakdown is not distinct from o.closing_breakdown),'closed shift figures unchanged and shift not reopened');
select pg_temp.assert_true((select sum(l.debit)=sum(l.credit) from public.journal_lines l join public.journal_entries j on j.id=l.entry_id where j.branch_id='ea200000-0000-4000-8000-000000000001'),'branch journals stay balanced');
select pg_temp.assert_true((select sum(l.debit-l.credit)=45000 from public.journal_lines l join public.coa_accounts a on a.id=l.account_id join public.journal_entries j on j.id=l.entry_id where j.branch_id='ea200000-0000-4000-8000-000000000001' and a.code='5401'),'net expense = corrected 30000 + untouched 15000');

-- Periode tutup buku tetap mengunci walau pelakunya FINANCE.
update public.accounting_locks set closed_until=(now() at time zone 'Asia/Jakarta')::date where id;
set local role authenticated;
select pg_temp.act_as('ea100000-0000-4000-8000-000000000002');
select pg_temp.expect_error(format('select public.revise_expense_atomic(%L,%L::uuid,0,%L,%L::jsonb,%L)','finance-locked',(select result->>'expense_id' from after_shift_results where name='c'),'void','{}','Correction'),'Periode akuntansi sudah ditutup');
reset role;
rollback;
