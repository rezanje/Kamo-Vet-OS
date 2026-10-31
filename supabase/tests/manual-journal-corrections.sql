-- Disposable local acceptance test. Run after migrations; every change rolls back.
begin;
insert into auth.users(id,raw_user_meta_data) values
 ('ee410000-0000-4000-8000-000000000001','{}'),
 ('ee410000-0000-4000-8000-000000000002','{}'),
 ('ee410000-0000-4000-8000-000000000003','{}')
on conflict (id) do nothing;
alter table public.profiles disable trigger guard_profile_privileges;
update public.profiles set role='OWNER',is_active=true where id='ee410000-0000-4000-8000-000000000001';
update public.profiles set role='FINANCE',is_active=true where id='ee410000-0000-4000-8000-000000000002';
update public.profiles set role='OWNER',is_active=false where id='ee410000-0000-4000-8000-000000000003';
alter table public.profiles enable trigger guard_profile_privileges;
insert into public.branches(id,code,name,type) values ('ee420000-0000-4000-8000-000000000001','JRN-T','Journal test','PETSHOP') on conflict (id) do nothing;
insert into public.user_branches(user_id,branch_id) values
 ('ee410000-0000-4000-8000-000000000001','ee420000-0000-4000-8000-000000000001'),
 ('ee410000-0000-4000-8000-000000000002','ee420000-0000-4000-8000-000000000001') on conflict do nothing;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'ASSERTION FAILED: %',label; end if; end $$;
select pg_temp.assert_true(true,'manual journal correction fixture loaded');
create or replace function pg_temp.expect_error(statement text,fragment text) returns void language plpgsql as $$
begin begin execute statement; raise exception 'Expected failure'; exception when others then if position(fragment in sqlerrm)=0 then raise; end if; end; end $$;
update public.accounting_locks set closed_until=null where id;
set local role authenticated;
select set_config('request.jwt.claim.sub','ee410000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"sub":"ee410000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('request.headers','{}',true);
create temp table journal_results(name text primary key,result jsonb);
insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,branch_id) values
 ('ee430000-0000-4000-8000-000000000001','JRN-TEST-001',current_date-1,'Manual acceptance','manual','ee420000-0000-4000-8000-000000000001');
insert into public.journal_lines(entry_id,account_id,debit,credit)
select 'ee430000-0000-4000-8000-000000000001',a.id,case when a.code='110003' then 100 else 0 end,case when a.code='510001' then 100 else 0 end
from public.coa_accounts a where a.code in ('110003','510001');
select pg_temp.expect_error($q$update public.journal_entries set revision=9 where id='ee430000-0000-4000-8000-000000000001'$q$,'Metadata koreksi');
select pg_temp.expect_error($q$select public.revise_manual_journal('null-action','ee430000-0000-4000-8000-000000000001',0,null,'{}','[]','reason')$q$,'tidak valid');
select set_config('request.jwt.claim.sub','ee410000-0000-4000-8000-000000000002',true);
select pg_temp.expect_error(format('select public.revise_manual_journal(%L,%L,0,%L,%L,%L,%L)', 'non-owner','ee430000-0000-4000-8000-000000000001','void','{}','[]','reason'),'Super Admin');
select set_config('request.jwt.claim.sub','ee410000-0000-4000-8000-000000000003',true);
select pg_temp.expect_error(format('select public.revise_manual_journal(%L,%L,0,%L,%L,%L,%L)', 'inactive-owner','ee430000-0000-4000-8000-000000000001','void','{}','[]','reason'),'Cabang jurnal tidak dapat diakses');
select set_config('request.jwt.claim.sub','ee410000-0000-4000-8000-000000000001',true);
insert into journal_results
select 'edit',public.revise_manual_journal('edit-ok','ee430000-0000-4000-8000-000000000001',0,'edit',jsonb_build_object('deskripsi','Corrected'),jsonb_build_array(
  jsonb_build_object('account_id',(select id from public.coa_accounts where code='110003'),'debit',125,'credit',0),
  jsonb_build_object('account_id',(select id from public.coa_accounts where code='510001'),'debit',0,'credit',125)),'Correction');
select pg_temp.assert_true((select count(*)=1 from public.journal_entries where source='manual-correction' and voided_at is null),'successful edit creates active replacement');
select pg_temp.assert_true((select count(*)=1 from public.journal_entries where id='ee430000-0000-4000-8000-000000000001' and voided_at is not null),'original is retained and superseded');
select pg_temp.assert_true(public.revise_manual_journal('edit-ok','ee430000-0000-4000-8000-000000000001',0,'edit',jsonb_build_object('deskripsi','Corrected'),jsonb_build_array(
  jsonb_build_object('account_id',(select id from public.coa_accounts where code='110003'),'debit',125,'credit',0),
  jsonb_build_object('account_id',(select id from public.coa_accounts where code='510001'),'debit',0,'credit',125)),'Correction')=(select result from journal_results where name='edit'),'retry returns exact correction');
reset role;
update public.profiles set is_active=false where id='ee410000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.expect_error($q$select public.revise_manual_journal('edit-ok','ee430000-0000-4000-8000-000000000001',0,'edit','{"deskripsi":"Corrected"}','[]','Correction')$q$,'Cabang jurnal tidak dapat diakses');
reset role;
alter table public.profiles disable trigger guard_profile_privileges;
update public.profiles set is_active=true where id='ee410000-0000-4000-8000-000000000001';
alter table public.profiles enable trigger guard_profile_privileges;
set local role authenticated;
select pg_temp.expect_error(format('select public.revise_manual_journal(%L,%L,0,%L,%L,%L,%L)', 'stale','ee430000-0000-4000-8000-000000000001','void','{}','[]','reason'),'berubah');
select pg_temp.expect_error(format('select public.revise_manual_journal(%L,%L,0,%L,%L,%L,%L)', 'unbalanced',(select result->>'replacement_journal_id' from journal_results where name='edit'),'edit','{"deskripsi":"bad"}','[{"account_id":"00000000-0000-0000-0000-000000000001","debit":10,"credit":0},{"account_id":"00000000-0000-0000-0000-000000000002","debit":0,"credit":5}]','reason'),'tidak valid');
select public.revise_manual_journal('void-ok',(select result->>'replacement_journal_id' from journal_results where name='edit')::uuid,0,'void','{}','[]','Wrong manual entry');
select pg_temp.assert_true((select voided_at is not null from public.journal_entries where id=(select result->>'replacement_journal_id' from journal_results where name='edit')::uuid),'successful void marks replacement');
select pg_temp.assert_true((select sum(debit)=sum(credit) from public.journal_lines where entry_id=(select result->>'reversal_journal_id' from journal_results where name='edit')::uuid),'void reversal remains balanced');
insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,branch_id) values
 ('ee430000-0000-4000-8000-000000000002','JRN-TEST-002',current_date-1,'Automatic acceptance','sale','ee420000-0000-4000-8000-000000000001');
select pg_temp.expect_error(format('select public.revise_manual_journal(%L,%L,0,%L,%L,%L,%L)', 'automatic','ee430000-0000-4000-8000-000000000002','void','{}','[]','reason'),'transaksi sumbernya');
insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,branch_id) values
 ('ee430000-0000-4000-8000-000000000003','JRN-TEST-003',current_date-1,'Closed acceptance','manual','ee420000-0000-4000-8000-000000000001');
insert into public.journal_lines(entry_id,account_id,debit,credit)
select 'ee430000-0000-4000-8000-000000000003',a.id,case when a.code='110003' then 100 else 0 end,case when a.code='510001' then 100 else 0 end
from public.coa_accounts a where a.code in ('110003','510001');
update public.accounting_locks set closed_until=current_date where id;
select pg_temp.expect_error(format('select public.revise_manual_journal(%L,%L,0,%L,%L,%L,%L)', 'closed','ee430000-0000-4000-8000-000000000003','void','{}','[]','reason'),'ditutup');
rollback;
