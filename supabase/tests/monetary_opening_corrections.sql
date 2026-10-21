begin;
insert into auth.users(id,raw_user_meta_data) values
 ('fa810000-0000-4000-8000-000000000001','{}'),('fa810000-0000-4000-8000-000000000002','{}');
alter table profiles disable trigger guard_profile_privileges;
update profiles set role='OWNER',is_active=true where id='fa810000-0000-4000-8000-000000000001';
update profiles set role='ADMIN',is_active=true where id='fa810000-0000-4000-8000-000000000002';
alter table profiles enable trigger guard_profile_privileges;
insert into coa_accounts(code,name,type,normal_balance) values
 ('3101','Equity','EKUITAS','K'),('119801','Opening bank','ASET','D'),('119802','Zero cash','ASET','D'),('139801','Noncash asset','ASET','D') on conflict(code) do nothing;
insert into cash_accounts(id,nama,jenis,coa_code,created_at) values
 ('fa820000-0000-4000-8000-000000000001','Opening bank','Bank','119801',now()-interval '10 days'),
 ('fa820000-0000-4000-8000-000000000002','Zero cash','Kas','119802',now()-interval '10 days');
insert into journal_entries(id,no_jurnal,tanggal,source,source_ref) values
 ('fa830000-0000-4000-8000-000000000001','FIX.OPEN',current_date-10,'saldo-awal','mixed-fixture'),
 ('fa830000-0000-4000-8000-000000000002','FIX.LATER',current_date-2,'fixture','later');
insert into journal_lines(entry_id,account_id,debit,credit)
 select 'fa830000-0000-4000-8000-000000000001'::uuid,id,50000000,0 from coa_accounts where code='119801'
 union all select 'fa830000-0000-4000-8000-000000000001',id,125000,0 from coa_accounts where code='139801'
 union all select 'fa830000-0000-4000-8000-000000000001',id,0,50125000 from coa_accounts where code='3101'
 union all select 'fa830000-0000-4000-8000-000000000002',id,0,1000000 from coa_accounts where code='119801'
 union all select 'fa830000-0000-4000-8000-000000000002',id,1000000,0 from coa_accounts where code='139801';
update accounting_locks set closed_until=null where id;
create function pg_temp.ok(v boolean,label text) returns void language plpgsql as $$begin if v is distinct from true then raise exception 'ASSERT: %',label;end if;end$$;
create function pg_temp.fails(statement text,fragment text) returns void language plpgsql as $$begin begin execute statement;raise exception 'Expected failure';exception when others then if position(fragment in sqlerrm)=0 then raise;end if;end;end$$;
create temp table monetary_test(name text primary key,value jsonb);
grant all on monetary_test to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','fa810000-0000-4000-8000-000000000001',true);
insert into monetary_test select 'preview',preview_monetary_opening('fa820000-0000-4000-8000-000000000001',5000000,'Wrong opening amount');
select pg_temp.ok((select value->>'old_amount'='50000000' and (value->>'balance_before')::numeric=49000000 and (value->>'balance_after')::numeric=4000000 from monetary_test where name='preview'),'preview includes actual running impact');
select pg_temp.ok((select count(*)=2 from journal_entries),'preview does not post');
insert into monetary_test select 'saved',correct_monetary_opening('fa820000-0000-4000-8000-000000000001',5000000,'Wrong opening amount',(select value from monetary_test where name='preview'),'monetary-one');
select pg_temp.ok(correct_monetary_opening('fa820000-0000-4000-8000-000000000001',5000000,'Wrong opening amount',(select value from monetary_test where name='preview'),'monetary-one')=(select value from monetary_test where name='saved'),'same request exactly once');
select pg_temp.fails($q$select correct_monetary_opening('fa820000-0000-4000-8000-000000000001',6000000,'Different amount',(select value from monetary_test where name='preview'),'monetary-one')$q$,'rincian berbeda');
select pg_temp.fails($q$select correct_monetary_opening('fa820000-0000-4000-8000-000000000001',5000000,'Wrong opening amount',(select value from monetary_test where name='preview'),'stale-preview')$q$,'Preview');
select pg_temp.ok((select sum(debit-credit)=4000000 from journal_lines l join coa_accounts a on a.id=l.account_id where a.code='119801'),'running bank balance updated once');
select pg_temp.ok((select sum(debit-credit)=1125000 from journal_lines l join coa_accounts a on a.id=l.account_id where a.code='139801'),'noncash and later transaction unchanged');
select pg_temp.ok(not exists(select entry_id from journal_lines group by entry_id having sum(debit)<>sum(credit)),'every journal balances');
select pg_temp.ok(not exists(select 1 from journal_lines l join coa_accounts a on a.id=l.account_id join journal_entries e on e.id=l.entry_id where e.source like 'cash-open-%' and a.type in('PENDAPATAN','BEBAN')),'no false income');
select pg_temp.ok((select count(*)=3 and sum(debit)=50125000 from journal_lines where entry_id='fa830000-0000-4000-8000-000000000001'),'original retained intact');
select pg_temp.fails($q$delete from journal_entries where id='fa830000-0000-4000-8000-000000000001'$q$,'jalur resmi');
select pg_temp.fails($q$update journal_lines set debit=1 where entry_id='fa830000-0000-4000-8000-000000000001'$q$,'jalur resmi');
select pg_temp.fails($q$update monetary_opening_corrections set reason='forged'$q$,'permission denied');
-- Zero and repeated corrections remain linked to the original, without changing later debits/credits.
select correct_monetary_opening('fa820000-0000-4000-8000-000000000001',0,'Set correct zero',preview_monetary_opening('fa820000-0000-4000-8000-000000000001',0,'Set correct zero'),'monetary-zero');
select correct_monetary_opening('fa820000-0000-4000-8000-000000000001',3000000,'Correct zero again',preview_monetary_opening('fa820000-0000-4000-8000-000000000001',3000000,'Correct zero again'),'monetary-three');
select pg_temp.ok((select sum(debit-credit)=2000000 from journal_lines l join coa_accounts a on a.id=l.account_id where a.code='119801'),'repeated correction uses current opening');
select correct_monetary_opening('fa820000-0000-4000-8000-000000000002',250,'Previously zero opening',preview_monetary_opening('fa820000-0000-4000-8000-000000000002',250,'Previously zero opening'),'zero-first');
select pg_temp.fails($q$select preview_monetary_opening('fa820000-0000-4000-8000-000000000001','NaN','Bad amount')$q$,'Nilai');
select pg_temp.fails($q$select preview_monetary_opening('fa820000-0000-4000-8000-000000000001',-1,'Bad amount')$q$,'Nilai');
select pg_temp.fails($q$select preview_monetary_opening('fa820000-0000-4000-8000-000000000001',10,'')$q$,'Alasan');
select set_config('request.jwt.claim.sub','fa810000-0000-4000-8000-000000000002',true);
select pg_temp.fails($q$select preview_monetary_opening('fa820000-0000-4000-8000-000000000001',10,'No permission')$q$,'Owner aktif');
select pg_temp.fails($q$select get_monetary_opening_result('fa820000-0000-4000-8000-000000000001','monetary-one')$q$,'Owner aktif');
select pg_temp.ok(not exists(select 1 from monetary_opening_corrections),'nonowner audit read denied');
reset role;
-- No source forgery, relocation of lines, or correction by delegated nonowners.
set local role authenticated;
select pg_temp.fails($q$insert into journal_entries(no_jurnal,source) values('FORGED.OPEN','cash-account-opening')$q$,'jalur resmi');
select pg_temp.fails($q$insert into journal_lines(entry_id,account_id,debit,credit) select 'fa830000-0000-4000-8000-000000000001',id,1,0 from coa_accounts where code='119801'$q$,'jalur resmi');
select pg_temp.fails($q$select correct_monetary_opening('fa820000-0000-4000-8000-000000000001',1,'No permission','{}','forbidden')$q$,'Owner aktif');
reset role;
-- Fail after the reversal has already inserted: the complete transaction must roll back.
create function pg_temp.fail_replacement() returns trigger language plpgsql as $$begin if current_setting('test.monetary_failure',true)='on' and new.source='cash-open-replacement' then raise exception 'INJECTED_MONETARY_FAILURE';end if;return new;end$$;
create trigger monetary_failure before insert on journal_entries for each row execute function pg_temp.fail_replacement();
set local role authenticated;
select set_config('request.jwt.claim.sub','fa810000-0000-4000-8000-000000000001',true);
update monetary_test set value=preview_monetary_opening('fa820000-0000-4000-8000-000000000001',4000000,'Rollback correction') where name='preview';
select set_config('test.monetary_failure','on',true);
select pg_temp.fails($q$select correct_monetary_opening('fa820000-0000-4000-8000-000000000001',4000000,'Rollback correction',(select value from monetary_test where name='preview'),'rollback')$q$,'INJECTED_MONETARY_FAILURE');
select set_config('test.monetary_failure','off',true);
select pg_temp.ok((select sum(debit-credit)=2000000 from journal_lines l join coa_accounts a on a.id=l.account_id where a.code='119801'),'rollback restores ledger');
reset role;
select pg_temp.ok(not exists(select 1 from monetary_opening_requests where request_key='rollback'),'rollback leaves no result');
select pg_temp.ok((select count(*)=4 from monetary_opening_corrections),'rollback leaves no audit');
update accounting_locks set closed_until=current_date-9 where id;
set local role authenticated;
select pg_temp.fails($q$select preview_monetary_opening('fa820000-0000-4000-8000-000000000001',10,'Closed period')$q$,'ditutup');
reset role;
update accounting_locks set closed_until=null where id;
insert into bank_reconciliations(tanggal,cash_account_id,bank_coa_code) values(current_date-1,'fa820000-0000-4000-8000-000000000001','119801');
set local role authenticated;
select pg_temp.fails($q$select preview_monetary_opening('fa820000-0000-4000-8000-000000000001',10,'Reconciled bank')$q$,'Rekonsiliasi');
select pg_temp.ok(get_monetary_opening_result('fa820000-0000-4000-8000-000000000001','monetary-one')=(select value from monetary_test where name='saved'),'read-only recovery works after downstream changes');
reset role;
update bank_reconciliations set voided_at=now();
update cash_accounts set is_active=false where id='fa820000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.fails($q$select preview_monetary_opening('fa820000-0000-4000-8000-000000000001',10,'Inactive account')$q$,'Rekening');
reset role;
update cash_accounts set is_active=true where id='fa820000-0000-4000-8000-000000000001';
-- Delegated all-branch rights do not grant correction rights to any other role.
alter table profiles disable trigger guard_profile_privileges;
do $$declare r text;begin
 for r in select unnest(array['ADMIN','FINANCE','STAFF','DOCTOR']) loop
  perform set_config('request.jwt.claim.sub','fa810000-0000-4000-8000-000000000001',true);
  update profiles set role=r::public.user_role where id='fa810000-0000-4000-8000-000000000002';
  perform set_config('request.jwt.claim.sub','fa810000-0000-4000-8000-000000000002',true);
  perform pg_temp.fails($q$select preview_monetary_opening('fa820000-0000-4000-8000-000000000001',10,'Delegated permission')$q$,'Owner aktif');
 end loop;
end$$;
alter table profiles enable trigger guard_profile_privileges;
select set_config('request.jwt.claim.sub','fa810000-0000-4000-8000-000000000001',true);
insert into branches(id,code,name,type) values('fa840000-0000-4000-8000-000000000001','MON.A','Branch A','PETSHOP'),('fa840000-0000-4000-8000-000000000002','MON.B','Branch B','PETSHOP');
update cash_accounts set branch_id='fa840000-0000-4000-8000-000000000001' where id='fa820000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.headers','{"x-kamo-operational-branch":"fa840000-0000-4000-8000-000000000002"}',true);
select pg_temp.fails($q$select preview_monetary_opening('fa820000-0000-4000-8000-000000000001',10,'Wrong branch')$q$,'Cabang');
select pg_temp.fails($q$select get_monetary_opening_result('fa820000-0000-4000-8000-000000000001','monetary-one')$q$,'Cabang');
select pg_temp.ok(not exists(select 1 from monetary_opening_corrections where cash_account_id='fa820000-0000-4000-8000-000000000001'),'branch scoped audit read');
select set_config('request.headers','{}',true);
reset role;
update branches set is_active=false where id='fa840000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.fails($q$select preview_monetary_opening('fa820000-0000-4000-8000-000000000001',10,'Inactive branch')$q$,'Cabang');
reset role;
update branches set is_active=true where id='fa840000-0000-4000-8000-000000000001';
update coa_accounts set is_active=false where code='119801';
set local role authenticated;
select pg_temp.fails($q$select preview_monetary_opening('fa820000-0000-4000-8000-000000000001',10,'Inactive COA')$q$,'Akun kas/bank');
reset role;
update coa_accounts set is_active=true where code='119801';
update profiles set is_active=false where id='fa810000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.fails($q$select get_monetary_opening_result('fa820000-0000-4000-8000-000000000001','monetary-one')$q$,'Owner aktif');
rollback;
