-- Fictional fixtures only. This suite commits for the runner's independent-session races.
create function public.transfer_assert(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Assertion: %',message;end if;end$$;
create function public.transfer_snapshot() returns jsonb language sql security definer set search_path='public' as $$select jsonb_build_array(
 (select jsonb_agg(t order by id) from cash_transfers t),(select jsonb_agg(t order by id) from journal_entries t),
 (select jsonb_agg(t order by id) from journal_lines t),(select jsonb_agg(t order by id) from cash_transfer_revisions t),
 (select jsonb_agg(t order by actor_id,request_key) from cash_transfer_requests t))$$;
create function public.transfer_reject(statement text, message text) returns void language plpgsql as $$
declare before_value jsonb:=transfer_snapshot();rejected boolean:=false;begin
 begin execute statement;exception when others then if position(message in sqlerrm)>0 then rejected:=true;else raise;end if;end;
 perform transfer_assert(rejected,'Expected rejection: '||message);
 perform transfer_assert(before_value is not distinct from transfer_snapshot(),'Rejected operation changed accounting state');
end$$;
insert into auth.users(id,email) values('f7100000-0000-4000-8000-000000000001','owner@transfer.example'),('f7100000-0000-4000-8000-000000000002','admin@transfer.example'),('f7100000-0000-4000-8000-000000000003','finance@transfer.example');
alter table profiles disable trigger guard_profile_privileges;
update profiles set role=case id when 'f7100000-0000-4000-8000-000000000001' then 'OWNER'::user_role when 'f7100000-0000-4000-8000-000000000002' then 'ADMIN'::user_role else 'FINANCE'::user_role end,is_active=true where id::text like 'f710%';
alter table profiles enable trigger guard_profile_privileges;
insert into branches(id,name,code,type) values('f7200000-0000-4000-8000-000000000001','Transfer test','TFTEST','OFFICE');
insert into coa_accounts(code,name,type,normal_balance) values('1171','Test source','ASET','D'),('1172','Test destination','ASET','D'),('1173','Test alternate','ASET','D'),('740010','Bank fee','BEBAN','D') on conflict(code) do update set is_active=true,is_header=false;
insert into cash_accounts(id,nama,jenis,coa_code) values('f7300000-0000-4000-8000-000000000001','Test source','Bank','1171'),('f7300000-0000-4000-8000-000000000002','Test destination','Bank','1172'),('f7300000-0000-4000-8000-000000000003','Test alternate','Bank','1173');
create table transfer_input as select jsonb_build_object('tanggal',current_date,'from_account_id','f7300000-0000-4000-8000-000000000001','to_account_id','f7300000-0000-4000-8000-000000000002','jumlah',1000,'biaya_admin',2.50,'branch_id','f7200000-0000-4000-8000-000000000001','keterangan','Fictional transfer') header;
create table transfer_results(name text primary key,value jsonb);
grant select on transfer_input to authenticated;grant all on transfer_results to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub','f7100000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claim.role','authenticated',false);
insert into transfer_results values('original',mutate_cash_transfer('create-original','create',null,null,(select header from transfer_input),null));
select transfer_assert(mutate_cash_transfer('create-original','create',null,null,(select header from transfer_input),null)=(select value from transfer_results where name='original'),'create retry result');
select transfer_assert(get_cash_transfer_result('create-original')=(select value from transfer_results where name='original'),'read-only recovery');
select transfer_reject($q$select mutate_cash_transfer('create-original','create',null,null,jsonb_set((select header from transfer_input),'{jumlah}','2000'),null)$q$,'rincian berbeda');
insert into transfer_results values('corrected',mutate_cash_transfer('edit-original','edit',(select(value->>'transfer_id')::uuid from transfer_results where name='original'),0,jsonb_set((select header from transfer_input),'{jumlah}','100'),'Wrong amount'));
select transfer_assert((select jumlah=1000 and voided_at is not null from cash_transfers where id=(select(value->>'transfer_id')::uuid from transfer_results where name='original')),'original amount preserved');
select transfer_assert((select jumlah=100 and replacement_of=(select(value->>'transfer_id')::uuid from transfer_results where name='original') and voided_at is null from cash_transfers where id=(select(value->>'replacement_transfer_id')::uuid from transfer_results where name='corrected')),'replacement link');
select transfer_assert((select sum(l.debit-l.credit)=-102.50 from journal_lines l join coa_accounts a on a.id=l.account_id where a.code='1171'),'source balance');
select transfer_assert((select sum(l.debit-l.credit)=100 from journal_lines l join coa_accounts a on a.id=l.account_id where a.code='1172'),'destination balance');
select transfer_assert(not exists(select 1 from journal_lines l join coa_accounts a on a.id=l.account_id where a.type='PENDAPATAN'),'no revenue');
select transfer_assert(not exists(select entry_id from journal_lines group by entry_id having sum(debit)<>sum(credit)),'every journal balances');
insert into transfer_results values('account-correction',mutate_cash_transfer('edit-account','edit',(select(value->>'replacement_transfer_id')::uuid from transfer_results where name='corrected'),0,jsonb_set(jsonb_set((select header from transfer_input),'{jumlah}','100'),'{to_account_id}','"f7300000-0000-4000-8000-000000000003"'),'Wrong destination'));
select transfer_assert((select sum(l.debit-l.credit)=0 from journal_lines l join coa_accounts a on a.id=l.account_id where a.code='1172'),'old destination restored');
select transfer_assert((select sum(l.debit-l.credit)=100 from journal_lines l join coa_accounts a on a.id=l.account_id where a.code='1173'),'new destination credited');
insert into transfer_results values('cancelled',mutate_cash_transfer('void-account','void',(select(value->>'replacement_transfer_id')::uuid from transfer_results where name='account-correction'),0,'{}','Cancel entry'));
select transfer_assert(not exists(select account_id from journal_lines group by account_id having sum(debit-credit)<>0),'cancel returns all accounts including fees to baseline');
select transfer_assert((select count(*)=3 from cash_transfer_revisions),'immutable audit chain');
select transfer_reject($q$select mutate_cash_transfer('stale','edit',(select(value->>'transfer_id')::uuid from transfer_results where name='original'),0,(select header from transfer_input),'Stale edit')$q$,'sudah berubah');
select set_config('request.jwt.claim.sub','f7100000-0000-4000-8000-000000000002',false);
select transfer_reject($q$select mutate_cash_transfer('denied','void',(select(value->>'transfer_id')::uuid from transfer_results where name='original'),0,'{}','Denied admin')$q$,'Akses');
select set_config('request.jwt.claim.sub','f7100000-0000-4000-8000-000000000003',false);
select transfer_reject($q$select mutate_cash_transfer('denied-finance','edit',(select(value->>'transfer_id')::uuid from transfer_results where name='original'),0,(select header from transfer_input),'Denied finance')$q$,'Akses');
select set_config('request.jwt.claim.sub','f7100000-0000-4000-8000-000000000001',false);
select transfer_reject($q$update cash_transfers set jumlah=2$q$,'permission denied');
select transfer_reject($q$delete from journal_lines where entry_id=(select(value->>'journal_entry_id')::uuid from transfer_results where name='original')$q$,'jalur resmi');
select transfer_reject($q$select mutate_cash_transfer('same-account','create',null,null,jsonb_set((select header from transfer_input),'{to_account_id}','"f7300000-0000-4000-8000-000000000001"'),null)$q$,'Rekening');
select transfer_reject($q$select mutate_cash_transfer('nan','create',null,null,jsonb_set((select header from transfer_input),'{jumlah}','"NaN"'),null)$q$,'Nilai');
insert into transfer_results values('rollback',mutate_cash_transfer('create-rollback','create',null,null,(select header from transfer_input),null));
reset role;
create function transfer_fail() returns trigger language plpgsql as $$begin raise exception 'forced partial failure';end$$;
create trigger transfer_test_failure before insert on cash_transfer_revisions for each row execute function transfer_fail();
set role authenticated;
select transfer_reject($q$select mutate_cash_transfer('failed-edit','edit',(select(value->>'transfer_id')::uuid from transfer_results where name='rollback'),0,(select header from transfer_input),'Test rollback')$q$,'forced partial failure');
reset role;
drop trigger transfer_test_failure on cash_transfer_revisions;
update accounting_locks set closed_until=current_date where id;
set role authenticated;
select transfer_reject($q$select mutate_cash_transfer('closed','void',(select(value->>'transfer_id')::uuid from transfer_results where name='rollback'),0,'{}','Closed test')$q$,'ditutup');
reset role;
update accounting_locks set closed_until=null where id;
-- A changed mapping must never reverse an unrelated balanced ledger entry.
insert into coa_accounts(code,name,type,normal_balance) values('1174','Drift test','ASET','D');
update cash_accounts set coa_code='1174' where id='f7300000-0000-4000-8000-000000000001';
set role authenticated;
select transfer_reject($q$select mutate_cash_transfer('mapping-drift','void',(select(value->>'transfer_id')::uuid from transfer_results where name='rollback'),0,'{}','Mapping drift')$q$,'Jurnal');
reset role;
update cash_accounts set coa_code='1171' where id='f7300000-0000-4000-8000-000000000001';
set role authenticated;
select mutate_bank_reconciliation('test-downstream','create',null,null,jsonb_build_object('account_id','f7300000-0000-4000-8000-000000000002','tanggal',current_date,'saldo_bank',0,'biaya_adm',0,'bunga',0),null);
select transfer_reject($q$select mutate_cash_transfer('downstream','void',(select(value->>'transfer_id')::uuid from transfer_results where name='rollback'),0,'{}','Downstream test')$q$,'Rekonsiliasi');
select mutate_bank_reconciliation('void-downstream','void',(select id from bank_reconciliations where voided_at is null),0,'{}','Fictional cleanup');
reset role;
-- Valid legacy documents are adopted without changing financial fields or journals.
insert into cash_transfers(no_transfer,tanggal,from_account_id,to_account_id,jumlah,biaya_admin,branch_id)
values('LEGACY.TRANSFER',current_date,'f7300000-0000-4000-8000-000000000001','f7300000-0000-4000-8000-000000000002',25,0,'f7200000-0000-4000-8000-000000000001');
insert into journal_entries(no_jurnal,tanggal,deskripsi,source,source_ref,branch_id)
values('LEGACY.TRANSFER.J',current_date,'Legacy test','transfer','LEGACY.TRANSFER','f7200000-0000-4000-8000-000000000001');
insert into journal_lines(entry_id,account_id,debit,credit)
select e.id,a.id,case when a.code='1172' then 25 else 0 end,case when a.code='1171' then 25 else 0 end from journal_entries e cross join coa_accounts a where e.no_jurnal='LEGACY.TRANSFER.J' and a.code in('1171','1172');
set role authenticated;
select mutate_cash_transfer('legacy-void','void',(select id from cash_transfers where no_transfer='LEGACY.TRANSFER'),0,'{}','Legacy correction');
select transfer_assert((select jumlah=25 and journal_entry_id is null and voided_at is not null from cash_transfers where no_transfer='LEGACY.TRANSFER'),'legacy source preserved');
-- Wrong source is corrected symmetrically, and fee changes remain an expense.
insert into transfer_results values('wrong-source',mutate_cash_transfer('create-wrong-source','create',null,null,(select header from transfer_input),null));
insert into transfer_results values('fixed-source',mutate_cash_transfer('fix-source','edit',(select(value->>'transfer_id')::uuid from transfer_results where name='wrong-source'),0,jsonb_set(jsonb_set((select header from transfer_input),'{from_account_id}','"f7300000-0000-4000-8000-000000000003"'),'{biaya_admin}','5'),'Wrong source and fee'));
select transfer_assert((select from_account_id='f7300000-0000-4000-8000-000000000003' and biaya_admin=5 from cash_transfers where id=(select(value->>'replacement_transfer_id')::uuid from transfer_results where name='fixed-source')),'source and fee replacement');
select transfer_assert((select count(*)=0 from journal_lines l join journal_entries e on e.id=l.entry_id join coa_accounts a on a.id=l.account_id where e.id=(select(value->>'replacement_journal_id')::uuid from transfer_results where name='fixed-source') and a.type='PENDAPATAN'),'replacement never earns revenue');
select transfer_reject($q$select mutate_cash_transfer('no-reason','void',(select(value->>'transfer_id')::uuid from transfer_results where name='rollback'),0,'{}','')$q$,'alasan');
select transfer_reject($q$select mutate_cash_transfer('change-date','edit',(select(value->>'transfer_id')::uuid from transfer_results where name='rollback'),0,jsonb_set((select header from transfer_input),'{tanggal}',to_jsonb(current_date-1)),'Wrong date')$q$,'tanggal dan cabang');
-- Protect both original and destination accounts, including reconciliation of a new destination.
select mutate_bank_reconciliation('new-destination-rec','create',null,null,jsonb_build_object('account_id','f7300000-0000-4000-8000-000000000003','tanggal',current_date,'saldo_bank',0,'biaya_adm',0,'bunga',0),null);
select transfer_reject($q$select mutate_cash_transfer('new-destination-blocked','edit',(select(value->>'transfer_id')::uuid from transfer_results where name='rollback'),0,jsonb_set((select header from transfer_input),'{to_account_id}','"f7300000-0000-4000-8000-000000000003"'),'New reconciled destination')$q$,'Rekonsiliasi');
select mutate_bank_reconciliation('void-new-destination-rec','void',(select id from bank_reconciliations where voided_at is null),0,'{}','Fictional cleanup');
reset role;
-- Legacy nonfinite values and a matching invalid journal must still fail closed.
update cash_transfers set jumlah='NaN' where id=(select(value->>'transfer_id')::uuid from transfer_results where name='rollback');
update journal_lines set debit=case when debit>0 then 'NaN'::numeric else debit end,credit=case when credit>0 then 'NaN'::numeric else credit end
where entry_id=(select(value->>'journal_entry_id')::uuid from transfer_results where name='rollback') and account_id in(select id from coa_accounts where code in('1171','1172'));
set role authenticated;
select transfer_reject($q$select mutate_cash_transfer('invalid-legacy','void',(select(value->>'transfer_id')::uuid from transfer_results where name='rollback'),0,'{}','Nonfinite legacy')$q$,'Jurnal');
reset role;
update cash_transfers set jumlah=1000 where id=(select(value->>'transfer_id')::uuid from transfer_results where name='rollback');
update journal_lines l set debit=case when a.code='1172' then 1000 when a.code='740010' then 2.5 else 0 end,credit=case when a.code='1171' then 1002.5 else 0 end from coa_accounts a
where a.id=l.account_id and l.entry_id=(select(value->>'journal_entry_id')::uuid from transfer_results where name='rollback');
-- Active-account, module and branch visibility still apply to read-only recovery.
update profiles set is_active=false where id='f7100000-0000-4000-8000-000000000001';
set role authenticated;
select transfer_reject($q$select get_cash_transfer_result('create-original')$q$,'Akses');
reset role;
update profiles set is_active=true where id='f7100000-0000-4000-8000-000000000001';
set role authenticated;
select set_config('request.headers','{"x-kamo-operational-branch":"f7200000-0000-4000-8000-000000000099"}',false);
select transfer_reject($q$select get_cash_transfer_result('create-original')$q$,'diakses');
select transfer_assert((select count(*)=0 from cash_transfers),'RLS branch invisibility');
select set_config('request.headers','{}',false);
reset role;
-- Unmapped historical reconciliation must fail closed, rather than disappear in a join.
insert into bank_reconciliations(tanggal,saldo_buku,saldo_bank,catatan) values(current_date,0,0,'Unmapped legacy statement');
set role authenticated;
select transfer_reject($q$select mutate_cash_transfer('unmapped-statement','void',(select(value->>'transfer_id')::uuid from transfer_results where name='rollback'),0,'{}','Unmapped statement test')$q$,'Rekonsiliasi');
reset role;
delete from bank_reconciliations where catatan='Unmapped legacy statement';
-- Fail after the debit line was attempted: the header and all lines roll back.
create function transfer_fail_line() returns trigger language plpgsql as $$begin if new.credit>0 then raise exception 'forced ledger failure';end if;return new;end$$;
create trigger transfer_test_line_failure before insert on journal_lines for each row execute function transfer_fail_line();
set role authenticated;
select transfer_reject($q$select mutate_cash_transfer('failed-create','create',null,null,(select header from transfer_input),null)$q$,'forced ledger failure');
select transfer_reject($q$select mutate_cash_transfer('failed-void','void',(select(value->>'transfer_id')::uuid from transfer_results where name='rollback'),0,'{}','Test failed reversal')$q$,'forced ledger failure');
reset role;
drop trigger transfer_test_line_failure on journal_lines;
-- Inactive and income-mapped destination accounts cannot receive a replacement.
update cash_accounts set is_active=false where id='f7300000-0000-4000-8000-000000000003';
set role authenticated;
select transfer_reject($q$select mutate_cash_transfer('inactive-destination','edit',(select(value->>'transfer_id')::uuid from transfer_results where name='rollback'),0,jsonb_set((select header from transfer_input),'{to_account_id}','"f7300000-0000-4000-8000-000000000003"'),'Inactive destination')$q$,'tidak aktif');
reset role;
update cash_accounts set is_active=true,coa_code='810001' where id='f7300000-0000-4000-8000-000000000003';
set role authenticated;
select transfer_reject($q$select mutate_cash_transfer('income-destination','edit',(select(value->>'transfer_id')::uuid from transfer_results where name='rollback'),0,jsonb_set((select header from transfer_input),'{to_account_id}','"f7300000-0000-4000-8000-000000000003"'),'Income destination')$q$,'akun aset');
reset role;
update cash_accounts set coa_code='1173' where id='f7300000-0000-4000-8000-000000000003';
