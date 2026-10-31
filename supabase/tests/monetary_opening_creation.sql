begin;
insert into auth.users(id,raw_user_meta_data) values('fa910000-0000-4000-8000-000000000001','{}'),('fa910000-0000-4000-8000-000000000002','{}');
alter table profiles disable trigger guard_profile_privileges;
update profiles set role='OWNER',is_active=true where id='fa910000-0000-4000-8000-000000000001';
update profiles set role='ADMIN',is_active=true where id='fa910000-0000-4000-8000-000000000002';
alter table profiles enable trigger guard_profile_privileges;
insert into coa_accounts(code,name,type,normal_balance) values('410001','Owner equity','EKUITAS','K'),('119901','Cash creation','ASET','D'),('119902','General creation','ASET','D') on conflict(code) do nothing;
insert into cash_accounts(id,nama,jenis,coa_code) values('fa920000-0000-4000-8000-000000000001','New cash','Kas','119901'),('fa920000-0000-4000-8000-000000000002','General cash','Kas','119902');
update accounting_locks set closed_until=null where id;
create function pg_temp.ok(v boolean,label text) returns void language plpgsql as $$begin if v is distinct from true then raise exception 'ASSERT: %',label;end if;end$$;
create function pg_temp.fails(statement text,fragment text) returns void language plpgsql as $$begin begin execute statement;raise exception 'Expected failure';exception when others then if position(fragment in sqlerrm)=0 then raise;end if;end;end$$;
create temp table monetary_creation(name text primary key,value jsonb);
grant all on monetary_creation to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','fa910000-0000-4000-8000-000000000002',true);
insert into monetary_creation select 'cash',post_cash_account_opening_atomic('fa920000-0000-4000-8000-000000000001',123.45);
select pg_temp.ok(post_cash_account_opening_atomic('fa920000-0000-4000-8000-000000000001',123.45)=(select value from monetary_creation where name='cash'),'cash initial posting retry');
select pg_temp.fails($q$select post_cash_account_opening_atomic('fa920000-0000-4000-8000-000000000001',200)$q$,'rincian berbeda');
select pg_temp.fails($q$select preview_monetary_opening('fa920000-0000-4000-8000-000000000001',200,'Admin correction')$q$,'Owner aktif');
select set_config('request.jwt.claim.sub','fa910000-0000-4000-8000-000000000001',true);
select correct_monetary_opening('fa920000-0000-4000-8000-000000000001',100.25,'Correct cents',preview_monetary_opening('fa920000-0000-4000-8000-000000000001',100.25,'Correct cents'),'correct-cash-created');
select pg_temp.ok((select sum(debit-credit)=100.25 from journal_lines l join coa_accounts a on a.id=l.account_id where a.code='119901'),'cash creation and correction preserve cents');
reset role;
insert into journal_entries(id,no_jurnal,tanggal,source) values('fa930000-0000-4000-8000-000000000002','FUTURE.LATER',current_date+2,'fixture');
insert into journal_lines(entry_id,account_id,debit,credit)
 select 'fa930000-0000-4000-8000-000000000002'::uuid,id,5,0 from coa_accounts where code='119901'
 union all select 'fa930000-0000-4000-8000-000000000002',id,0,5 from coa_accounts where code='410001';
set local role authenticated;
select pg_temp.ok((preview_monetary_opening('fa920000-0000-4000-8000-000000000001',100.20,'Include posted future ledger')->>'balance_before')::numeric=105.25,'preview matches unfiltered ledger including future posted entries');
select pg_temp.fails($q$select create_opening_balance_atomic('duplicate-cash-row',current_date,'[{"code":"119902","nilai":100,"sisi":"D"},{"code":"119902","nilai":200,"sisi":"D"}]')$q$,'Akun saldo awal tidak boleh berulang');
insert into monetary_creation select 'general',create_opening_balance_atomic('create-general',(now() at time zone 'Asia/Jakarta')::date,'[{"code":"119902","nilai":1000,"sisi":"D"}]');
select pg_temp.ok(create_opening_balance_atomic('create-general',(now() at time zone 'Asia/Jakarta')::date,'[{"code":"119902","nilai":1000,"sisi":"D"}]')=(select value from monetary_creation where name='general'),'general initial retry');
select pg_temp.fails($q$select create_opening_balance_atomic('overwrite-general',current_date,'[{"code":"119902","nilai":2000,"sisi":"D"}]')$q$,'sudah tersimpan');
select correct_monetary_opening('fa920000-0000-4000-8000-000000000002',750,'Correct general cash',preview_monetary_opening('fa920000-0000-4000-8000-000000000002',750,'Correct general cash'),'correct-general-created');
select pg_temp.ok((select sum(debit-credit)=750 from journal_lines l join coa_accounts a on a.id=l.account_id where a.code='119902'),'general creation and correction');
reset role;
-- Duplicate root provenance is rejected, even when both journals individually balance.
insert into journal_entries(id,no_jurnal,tanggal,source,source_ref) values('fa930000-0000-4000-8000-000000000001','DUPLICATE.OPEN',current_date,'saldo-awal','ambiguous');
insert into journal_lines(entry_id,account_id,debit,credit)
 select 'fa930000-0000-4000-8000-000000000001'::uuid,id,100,0 from coa_accounts where code='119901'
 union all select 'fa930000-0000-4000-8000-000000000001',id,0,100 from coa_accounts where code='410001';
set local role authenticated;
select pg_temp.fails($q$select preview_monetary_opening('fa920000-0000-4000-8000-000000000001',200,'Ambiguous source')$q$,'ganda atau ambigu');
reset role;
delete from journal_entries where id='fa930000-0000-4000-8000-000000000001';
-- Legacy incomplete sources must not be guessed as zero.
delete from journal_lines where entry_id=(select (value->>'entry_id')::uuid from monetary_creation where name='cash');
set local role authenticated;
select pg_temp.fails($q$select preview_monetary_opening('fa920000-0000-4000-8000-000000000001',200,'Incomplete source')$q$,'tidak lengkap');
reset role;
-- A zero without a source line has no proven date when global/creation dates differ.
insert into coa_accounts(code,name,type,normal_balance) values('119903','Ambiguous zero','ASET','D');
insert into cash_accounts(id,nama,jenis,coa_code,created_at) values('fa920000-0000-4000-8000-000000000003','Ambiguous zero','Kas','119903',now());
update journal_entries set tanggal=current_date-5 where id=(select (value->>'entry_id')::uuid from monetary_creation where name='general');
update accounting_locks set closed_until=current_date-4 where id;
set local role authenticated;
select pg_temp.fails($q$select preview_monetary_opening('fa920000-0000-4000-8000-000000000003',200,'Ambiguous zero date')$q$,'Tanggal saldo awal nol belum memiliki bukti');
reset role;
-- Raw anon/service callers have no execution grant; role capability delegation is insufficient.
-- Fixture-only policy models service visibility even when the localhost bootstrap
-- creates service_role without provider BYPASSRLS. Rolled back with this fixture.
create policy monetary_fixture_service_visibility on journal_entries for all to service_role using(true) with check(true);
set local role service_role;
select pg_temp.fails($q$update journal_entries set deskripsi='Forged by service' where source='cash-open-replacement'$q$,'jalur resmi');
select pg_temp.fails($q$insert into journal_entries(no_jurnal,source) values('SERVICE.FORGED','saldo-awal')$q$,'jalur resmi');
reset role;
select pg_temp.ok(not has_function_privilege('anon','public.correct_monetary_opening(uuid,numeric,text,jsonb,text)','EXECUTE'),'anon has no correction execute');
select pg_temp.ok(not has_function_privilege('service_role','public.correct_monetary_opening(uuid,numeric,text,jsonb,text)','EXECUTE'),'service role has no correction execute');
select pg_temp.ok(not has_function_privilege('authenticated','public.monetary_opening_context(uuid)','EXECUTE'),'context private');
rollback;
