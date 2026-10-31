-- Native disposable PostgreSQL only; fixtures and journal writes roll back.
begin;
insert into auth.users(id,raw_user_meta_data) values
 ('ee610000-0000-4000-8000-000000000001','{}'),
 ('ee610000-0000-4000-8000-000000000002','{}');
alter table public.profiles disable trigger guard_profile_privileges;
update public.profiles set role='OWNER',is_active=true where id='ee610000-0000-4000-8000-000000000001';
update public.profiles set role='STAFF',is_active=true where id='ee610000-0000-4000-8000-000000000002';
alter table public.profiles enable trigger guard_profile_privileges;
insert into public.branches(id,code,name,type) values
 ('ee620000-0000-4000-8000-000000000001','JCREATE','Journal create','PETSHOP');
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'ASSERTION FAILED: %',label; end if; end $$;
create function pg_temp.expect_error(statement text,fragment text) returns void language plpgsql as $$
begin begin execute statement; raise exception 'Expected failure'; exception when others then if position(fragment in sqlerrm)=0 then raise; end if; end; end $$;
create function pg_temp.reject_manual_line() returns trigger language plpgsql as $$
begin
 if new.credit>0 and exists(select 1 from public.journal_entries where id=new.entry_id and deskripsi='Injected failure') then
  raise exception 'INJECTED_LINE_FAILURE';
 end if;
 return new;
end $$;
create trigger manual_create_test_failure before insert on public.journal_lines for each row execute function pg_temp.reject_manual_line();
update public.accounting_locks set closed_until=null where id;
set local role authenticated;
select set_config('request.jwt.claim.sub','ee610000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.headers','{}',true);
create temp table create_input(lines jsonb);
insert into create_input select jsonb_build_array(
 jsonb_build_object('account_id',(select id from public.coa_accounts where code='110003'),'debit',100.25,'credit',0),
 jsonb_build_object('account_id',(select id from public.coa_accounts where code='510001'),'debit',0,'credit',100.25));
create temp table create_result(result jsonb);
insert into create_result select public.create_manual_journal_atomic('create-ok',current_date-1,'Atomic create','ee620000-0000-4000-8000-000000000001',(select lines from create_input));
select pg_temp.assert_true((select result->>'entry_id' is not null from create_result),'created journal result confirmed');
select pg_temp.assert_true(public.create_manual_journal_atomic('create-ok',current_date-1,'Atomic create','ee620000-0000-4000-8000-000000000001',(select lines from create_input))=(select result from create_result),'same key returns original result');
select pg_temp.assert_true((select count(*)=1 from public.journal_entries where deskripsi='Atomic create'),'retry creates no duplicate header');
select pg_temp.assert_true((select count(*)=2 and sum(debit)=100.25 and sum(credit)=100.25 from public.journal_lines where entry_id=(select (result->>'entry_id')::uuid from create_result)),'exact cents and complete lines');
select pg_temp.expect_error($q$select public.create_manual_journal_atomic('create-ok',current_date-1,'Changed payload','ee620000-0000-4000-8000-000000000001',(select lines from create_input))$q$,'rincian berbeda');
select pg_temp.expect_error($q$select public.create_manual_journal_atomic('not-balanced',current_date-1,'Unbalanced',null,jsonb_set((select lines from create_input),'{1,credit}','100.24'))$q$,'tidak seimbang');
select pg_temp.expect_error($q$select public.create_manual_journal_atomic('negative',current_date-1,'Negative',null,jsonb_set((select lines from create_input),'{0,credit}','-1'))$q$,'tidak valid');
select pg_temp.expect_error($q$select public.create_manual_journal_atomic('fraction',current_date-1,'Fraction',null,jsonb_set((select lines from create_input),'{0,debit}','100.251'))$q$,'tidak valid');
select pg_temp.expect_error($q$select public.create_manual_journal_atomic('unknown-account',current_date-1,'Bad account',null,jsonb_set((select lines from create_input),'{1,account_id}','"00000000-0000-4000-8000-000000000999"'))$q$,'tidak valid');
select pg_temp.expect_error($q$select public.create_manual_journal_atomic('future',current_date+1,'Future',null,(select lines from create_input))$q$,'Tanggal');
select pg_temp.expect_error($q$select public.create_manual_journal_atomic('rollback',current_date-1,'Injected failure',null,(select lines from create_input))$q$,'INJECTED_LINE_FAILURE');
select pg_temp.assert_true((select count(*)=1 from public.journal_entries where source='manual'),'rejections leave no partial headers');
select pg_temp.assert_true((select count(*)=2 from public.journal_lines),'mid-insert failure rolls back all newly inserted lines');
reset role;
select pg_temp.assert_true((select count(*)=1 from public.manual_journal_create_requests),'failed save leaves no orphan request');
update public.coa_accounts set is_active=false where code='510001';
set local role authenticated;
select pg_temp.expect_error($q$select public.create_manual_journal_atomic('inactive-account',current_date-1,'Inactive account',null,(select lines from create_input))$q$,'Akun baris');
reset role;
update public.coa_accounts set is_active=true,is_header=true where code='510001';
set local role authenticated;
select pg_temp.expect_error($q$select public.create_manual_journal_atomic('header-account',current_date-1,'Header account',null,(select lines from create_input))$q$,'Akun baris');
reset role;
update public.coa_accounts set is_header=false where code='510001';
update public.branches set is_active=false where id='ee620000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.expect_error($q$select public.create_manual_journal_atomic('inactive-branch',current_date-1,'Inactive branch','ee620000-0000-4000-8000-000000000001',(select lines from create_input))$q$,'Cabang jurnal');
reset role;
update public.branches set is_active=true where id='ee620000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.expect_error($q$select * from public.manual_journal_create_requests$q$,'permission denied');
select set_config('request.jwt.claim.sub','ee610000-0000-4000-8000-000000000002',true);
select pg_temp.expect_error($q$select public.create_manual_journal_atomic('staff',current_date-1,'Staff',null,(select lines from create_input))$q$,'keuangan');
select set_config('request.jwt.claim.sub','ee610000-0000-4000-8000-000000000001',true);
reset role;
update public.profiles set is_active=false where id='ee610000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.expect_error($q$select public.create_manual_journal_atomic('create-ok',current_date-1,'Atomic create','ee620000-0000-4000-8000-000000000001',(select lines from create_input))$q$,'keuangan');
reset role;
alter table public.profiles disable trigger guard_profile_privileges;
update public.profiles set is_active=true where id='ee610000-0000-4000-8000-000000000001';
alter table public.profiles enable trigger guard_profile_privileges;
update public.accounting_locks set closed_until=current_date where id;
set local role authenticated;
select pg_temp.expect_error($q$select public.create_manual_journal_atomic('closed',current_date-1,'Closed',null,(select lines from create_input))$q$,'ditutup');
select pg_temp.assert_true((select count(*)=1 from public.journal_entries where source='manual'),'failed closed-period save preserves prior journals');
reset role;
update public.accounting_locks set closed_until=null where id;
alter table public.profiles disable trigger guard_profile_privileges;
update public.profiles set role='ADMIN' where id='ee610000-0000-4000-8000-000000000002';
alter table public.profiles enable trigger guard_profile_privileges;
set local role authenticated;
select set_config('request.jwt.claim.sub','ee610000-0000-4000-8000-000000000002',true);
select pg_temp.assert_true(public.create_manual_journal_atomic('admin-ok',current_date-1,'Admin create',null,(select lines from create_input))->>'entry_id' is not null,'active ADMIN can post');
reset role;
insert into public.role_modules(role,module_id) values('ADMIN','pengaturan');
set local role authenticated;
select pg_temp.expect_error($q$select public.create_manual_journal_atomic('admin-ok',current_date-1,'Admin create',null,(select lines from create_input))$q$,'Buku Besar');
reset role;
delete from public.role_modules where role='ADMIN';
alter table public.profiles disable trigger guard_profile_privileges;
update public.profiles set role='FINANCE' where id='ee610000-0000-4000-8000-000000000002';
alter table public.profiles enable trigger guard_profile_privileges;
set local role authenticated;
select pg_temp.assert_true(public.create_manual_journal_atomic('finance-ok',current_date-1,'Finance create',null,(select lines from create_input))->>'entry_id' is not null,'active FINANCE can post');
reset role;
insert into public.role_capabilities(role,all_branches) values('FINANCE',false);
set local role authenticated;
select pg_temp.expect_error($q$select public.create_manual_journal_atomic('finance-branch',current_date-1,'Unauthorized branch','ee620000-0000-4000-8000-000000000001',(select lines from create_input))$q$,'Cabang jurnal');
rollback;
