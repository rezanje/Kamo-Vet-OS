-- Fictional local PostgreSQL fixtures only; every mutation rolls back.
begin;
do $$ begin
 assert exists(select 1 from information_schema.columns where table_schema='public'
  and table_name='recurring_journals' and column_name='max_occurrences'), 'Repeat-count field is missing';
end $$;
create function public.test_limit_period(offset_months int default 0) returns text language sql stable as $$
 select to_char(date_trunc('month',statement_timestamp() at time zone 'Asia/Jakarta')+make_interval(months=>offset_months),'YYYY-MM')
$$;
create function public.test_limit_seed(schedule_id uuid,period text,complete boolean default true) returns void language plpgsql as $$
declare entry uuid; begin
 insert into journal_entries(no_jurnal,tanggal,source,source_ref)
 values('JRN-LIMIT-'||left(gen_random_uuid()::text,10),(period||'-01')::date,'recurring',schedule_id::text||':'||period) returning id into entry;
 if complete then
 insert into journal_lines(entry_id,account_id,debit,credit)
 select entry,id,case code when 'LIMIT-D' then 100 else 0 end,case code when 'LIMIT-K' then 100 else 0 end
 from coa_accounts where code in('LIMIT-D','LIMIT-K');
 end if;
end $$;
insert into auth.users(id)values('a1100000-0000-4000-8000-000000000001');
update profiles set role='OWNER' where id='a1100000-0000-4000-8000-000000000001';
insert into coa_accounts(code,name,type,normal_balance)values('LIMIT-D','Fiction limit debit','BEBAN','D'),('LIMIT-K','Fiction limit credit','ASET','K');
insert into recurring_journals(id,nama,day_of_month,max_occurrences,last_posted,lines)select
 ('a120000'||i||'-0000-4000-8000-000000000001')::uuid,'Fiction limit '||i,1,
 case when i=4 then null else 2 end,test_limit_period(-2),
 '[{"code":"LIMIT-D","debit":100,"credit":0},{"code":"LIMIT-K","debit":0,"credit":100}]'::jsonb
from generate_series(1,6)i;
select test_limit_seed(id,test_limit_period(-2))from recurring_journals where nama like 'Fiction limit%';
set local role authenticated;
select set_config('request.jwt.claim.sub','a1100000-0000-4000-8000-000000000001',true);
do $$ declare a record; b record; begin
 select *into a from post_recurring_journal_period('a1200001-0000-4000-8000-000000000001',test_limit_period(-1));
 select *into b from post_recurring_journal_period('a1200001-0000-4000-8000-000000000001',test_limit_period(-1));
 assert a.posted and not b.posted and a.entry_id=b.entry_id,'Retry must not consume another occurrence';
 assert recurring_completed_occurrences('a1200001-0000-4000-8000-000000000001')=2,'Successful count';
 begin
  perform post_recurring_journal_period('a1200001-0000-4000-8000-000000000001',test_limit_period());
  raise exception 'Expected exhausted repeat limit';
 exception when sqlstate 'RCL01' then null; end;
 assert (select last_posted=test_limit_period(-1) from recurring_journals where id='a1200001-0000-4000-8000-000000000001'),'Limit must not advance marker';
 assert (select count(*)=2 from journal_entries where source_ref like 'a1200001-0000-4000-8000-000000000001:%'),'Limit must not write extra header';
 -- Unlimited remains the default and may continue beyond two occurrences.
 perform post_recurring_journal_period('a1200004-0000-4000-8000-000000000001',test_limit_period(-1));
 perform post_recurring_journal_period('a1200004-0000-4000-8000-000000000001',test_limit_period());
 assert recurring_completed_occurrences('a1200004-0000-4000-8000-000000000001')=3,'Legacy unlimited schedule';
 -- Database validation independently rejects zero and negative repeats.
 begin update recurring_journals set max_occurrences=0 where id='a1200004-0000-4000-8000-000000000001';
  raise exception 'Expected positive count constraint'; exception when check_violation then null; end;
 begin update recurring_journals set max_occurrences=-1 where id='a1200004-0000-4000-8000-000000000001';
  raise exception 'Expected positive count constraint'; exception when check_violation then null; end;
end $$;
reset role;
-- An incomplete abandoned header is not a successful occurrence.
select test_limit_seed('a1200002-0000-4000-8000-000000000001',test_limit_period(-3),false);
do $$ begin
 assert recurring_completed_occurrences('a1200002-0000-4000-8000-000000000001')=1,'Empty failed header is not a successful occurrence';
end $$;
-- Void/reversal journals are not successful recurring occurrences.
insert into journal_entries(no_jurnal,tanggal,source,source_ref)
values('JRN-LIMIT-VOID',(test_limit_period(-3)||'-01')::date,'recurring-void','a1200002-0000-4000-8000-000000000001:'||test_limit_period(-3));
insert into journal_lines(entry_id,account_id,debit,credit)
select e.id,a.id,case a.code when 'LIMIT-D' then 100 else 0 end,case a.code when 'LIMIT-K' then 100 else 0 end
from journal_entries e cross join coa_accounts a where e.no_jurnal='JRN-LIMIT-VOID' and a.code in('LIMIT-D','LIMIT-K');
do $$begin
 assert recurring_completed_occurrences('a1200002-0000-4000-8000-000000000001')=1,'Void source must not consume occurrence';
end $$;
-- Failure after header insertion rolls back the occurrence and may retry.
create function public.test_limit_fail_line()returns trigger language plpgsql as $$begin
 if current_setting('test.limit_fail',true)='yes' then raise exception 'Fiction limit line failure';end if;return new;end $$;
create trigger test_limit_failure before insert on journal_lines for each row execute function test_limit_fail_line();
set local role authenticated;
select set_config('request.jwt.claim.sub','a1100000-0000-4000-8000-000000000001',true);
do $$begin
 perform set_config('test.limit_fail','yes',true);
 begin perform post_recurring_journal_period('a1200003-0000-4000-8000-000000000001',test_limit_period(-1));
  raise exception 'Expected line failure';exception when others then
  if sqlerrm<>'Fiction limit line failure' then raise;end if;end;
 assert recurring_completed_occurrences('a1200003-0000-4000-8000-000000000001')=1,'Failed attempt does not consume occurrence';
 perform set_config('test.limit_fail','no',true);
 perform post_recurring_journal_period('a1200003-0000-4000-8000-000000000001',test_limit_period(-1));
 assert recurring_completed_occurrences('a1200003-0000-4000-8000-000000000001')=2,'Retry after failure consumes exactly one';
end $$;
reset role;
-- Lost progress response repairs its marker even if history already fills the limit.
select test_limit_seed('a1200005-0000-4000-8000-000000000001',test_limit_period(-1));
set local role authenticated;
select set_config('request.jwt.claim.sub','a1100000-0000-4000-8000-000000000001',true);
do $$ declare recovered record;begin
 select *into recovered from post_recurring_journal_period('a1200005-0000-4000-8000-000000000001',test_limit_period(-1));
 assert not recovered.posted,'Recover complete existing occurrence without duplicate';
 assert recurring_completed_occurrences('a1200005-0000-4000-8000-000000000001')=2,'Recovery does not double count';
end $$;
reset role;
-- Legacy complete refs count; colliding prefixes fail closed rather than extending quota.
update journal_entries set source_ref='a1200006-'||test_limit_period(-2)where source_ref='a1200006-0000-4000-8000-000000000001:'||test_limit_period(-2);
do $$begin
 assert recurring_completed_occurrences('a1200006-0000-4000-8000-000000000001')=1,'Unambiguous legacy history counts';
end $$;
insert into recurring_journals(id,nama,lines)values('a1200006-0000-4000-8000-000000000002','Fiction prefix collision','[]');
do $$begin
 begin perform recurring_completed_occurrences('a1200006-0000-4000-8000-000000000001');
  raise exception 'Expected ambiguous history rejection'; exception when others then
  if sqlerrm not like 'RECURRING_HISTORY:%' then raise;end if;end;
end $$;
rollback;
