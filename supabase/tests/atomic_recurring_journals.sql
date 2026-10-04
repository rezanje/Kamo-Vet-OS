-- Fictional local PostgreSQL/Supabase only. All fixtures and helpers roll back.
begin;
do $$ begin
 if to_regprocedure('public.post_recurring_journal_period(uuid,text)') is null then
  raise exception 'Atomic recurring posting RPC is missing';
 end if;
end $$;

create function public.test_recurring_period(offset_months integer default 0)
returns text language sql stable as $$
 select to_char(date_trunc('month',statement_timestamp() at time zone 'Asia/Jakarta')
  +make_interval(months=>offset_months),'YYYY-MM')
$$;
create function public.test_recurring_state() returns jsonb language sql as $$
 select jsonb_build_object(
  'headers',(select coalesce(jsonb_agg(to_jsonb(e)order by e.id),'[]')from journal_entries e where source='recurring'),
  'lines',(select coalesce(jsonb_agg(to_jsonb(l)order by l.id),'[]')from journal_lines l),
  'progress',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'last_posted',last_posted)order by id),'[]')from recurring_journals));
$$;
create function public.test_seed_recurring_history(schedule_id uuid,period text)
returns void language plpgsql as $$ declare header_id uuid; begin
 insert into journal_entries(no_jurnal,tanggal,source,source_ref,branch_id)
 select 'JRN-FIC-'||left(gen_random_uuid()::text,12),(period||'-'||lpad(day_of_month::text,2,'0'))::date,
 'recurring',id::text||':'||period,branch_id from recurring_journals where id=schedule_id returning id into header_id;
 insert into journal_lines(entry_id,account_id,debit,credit)
 select header_id,a.id,l.debit,l.credit from recurring_journals r,
 jsonb_to_recordset(r.lines)as l(code text,debit numeric,credit numeric)
 join coa_accounts a on a.code=l.code where r.id=schedule_id;
end $$;
create function public.test_recurring_failure() returns trigger language plpgsql as $$
begin
 if tg_table_name='journal_lines' then
  if exists(select 1 from journal_entries e where e.id=new.entry_id and e.deskripsi like 'Fiction line failure%') then
   raise exception 'Fiction line failure';
  end if;
 elsif tg_table_name='recurring_journals' then
  if new.nama='Fiction progress failure' then raise exception 'Fiction progress failure'; end if;
 end if;
 return new;
end $$;
create trigger test_recurring_line_failure before insert on journal_lines for each row execute function test_recurring_failure();
create trigger test_recurring_progress_failure before update on recurring_journals for each row execute function test_recurring_failure();

insert into auth.users(id)values('f1000000-0000-4000-8000-000000000001'),('f1000000-0000-4000-8000-000000000002');
update profiles set role='OWNER' where id='f1000000-0000-4000-8000-000000000001';
insert into branches(id,code,name,type)values('f2000000-0000-4000-8000-000000000001','FIC-RJ','Fiction recurring','OFFICE');
insert into coa_accounts(code,name,type,normal_balance)values('FIC-D','Fiction debit','BEBAN','D'),('FIC-K','Fiction credit','ASET','K');
insert into recurring_journals(id,nama,branch_id,day_of_month,last_posted,lines)select
 ('f3000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 case i when 3 then 'Fiction line failure' when 4 then 'Fiction progress failure' else 'Fiction recurring '||i end,
 'f2000000-0000-4000-8000-000000000001',1,test_recurring_period(-1),
 '[{"code":"FIC-D","debit":125.5,"credit":0},{"code":"FIC-K","debit":0,"credit":125.5}]'::jsonb
from generate_series(1,8)i;
select test_seed_recurring_history(id,test_recurring_period(-1))from recurring_journals;

set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
do $$ declare a record; b record; begin
 select * into a from post_recurring_journal_period('f3000000-0000-4000-8000-000000000001',test_recurring_period());
 select * into b from post_recurring_journal_period('f3000000-0000-4000-8000-000000000001',test_recurring_period());
 assert a.posted and not b.posted and a.entry_id=b.entry_id,'duplicate request must reuse the journal';
 assert (select source='recurring' and source_ref='f3000000-0000-4000-8000-000000000001:'||test_recurring_period()
  and tanggal=(test_recurring_period()||'-01')::date and branch_id='f2000000-0000-4000-8000-000000000001'
  from journal_entries where id=a.entry_id),'full identity, WIB period and ledger source preserved';
 assert (select count(*)=2 and sum(debit)=125.5 and sum(credit)=125.5 from journal_lines where entry_id=a.entry_id),'complete balanced lines';
 assert (select last_posted=test_recurring_period() from recurring_journals where id='f3000000-0000-4000-8000-000000000001'),'progress saved';
 -- Same short prefix does not collide for new full identities.
 perform post_recurring_journal_period('f3000000-0000-4000-8000-000000000002',test_recurring_period());
 assert (select count(*)=2 from journal_entries where source='recurring'and tanggal=(test_recurring_period()||'-01')::date),'distinct full identities';
end $$;

do $$ declare before_state jsonb; index integer; expected text; begin
 for index in 3..4 loop
  before_state:=test_recurring_state();
  expected:=case index when 3 then 'Fiction line failure' else 'Fiction progress failure' end;
  begin
   perform post_recurring_journal_period(('f3000000-0000-4000-8000-'||lpad(index::text,12,'0'))::uuid,test_recurring_period());
   raise exception 'Expected rollback did not happen';
  exception when others then
   if sqlerrm<>expected then raise; end if;
  end;
  assert before_state=test_recurring_state(),'line/progress failure must roll back every mutation';
 end loop;
end $$;

-- Catch-up cannot skip a month; each successful month commits a balanced entry.
update recurring_journals set last_posted=test_recurring_period(-2)where id='f3000000-0000-4000-8000-000000000005';
select test_seed_recurring_history('f3000000-0000-4000-8000-000000000005',test_recurring_period(-2));
do $$ begin
 begin
  perform post_recurring_journal_period('f3000000-0000-4000-8000-000000000005',test_recurring_period());
  raise exception 'Expected skipped period rejection';
 exception when others then if sqlerrm not like 'RECURRING_PERIOD:%' then raise; end if; end;
 perform post_recurring_journal_period('f3000000-0000-4000-8000-000000000005',test_recurring_period(-1));
 perform post_recurring_journal_period('f3000000-0000-4000-8000-000000000005',test_recurring_period());
 begin
  perform post_recurring_journal_period('f3000000-0000-4000-8000-000000000006',test_recurring_period(1));
  raise exception 'Expected future period rejection';
 exception when others then if sqlerrm not like 'RECURRING_PERIOD:%' then raise; end if; end;
end $$;

-- Historical header-only entries are never acknowledged as complete, including
-- those whose old app already advanced last_posted.
insert into journal_entries(no_jurnal,tanggal,source,source_ref,branch_id)values
 ('JRN-FIC-INCOMPLETE',(test_recurring_period()||'-01')::date,'recurring','f3000000-0000-4000-8000-000000000006:'||test_recurring_period(),'f2000000-0000-4000-8000-000000000001');
update recurring_journals set last_posted=test_recurring_period()where id='f3000000-0000-4000-8000-000000000006';
do $$ declare before_state jsonb:=test_recurring_state(); begin
 begin
  perform post_recurring_journal_period('f3000000-0000-4000-8000-000000000006',test_recurring_period());
  raise exception 'Expected incomplete journal rejection';
 exception when others then if sqlerrm not like 'RECURRING_HISTORY:%' then raise; end if; end;
 assert before_state=test_recurring_state(),'incomplete history must be untouched';
end $$;

-- A complete legacy entry is reused without rewriting historical accounting.
reset role;
insert into recurring_journals(id,nama,day_of_month,last_posted,lines)values
 ('f4000000-0000-4000-8000-000000000001','Fiction legacy',1,test_recurring_period(-1),
 '[{"code":"FIC-D","debit":50,"credit":0},{"code":"FIC-K","debit":0,"credit":50}]');
select test_seed_recurring_history('f4000000-0000-4000-8000-000000000001',test_recurring_period(-1));
insert into journal_entries(no_jurnal,tanggal,source,source_ref)values
 ('JRN-FIC-LEGACY',(test_recurring_period()||'-01')::date,'recurring','f4000000-'||test_recurring_period());
insert into journal_lines(entry_id,account_id,debit,credit)select e.id,a.id,
 case a.code when 'FIC-D' then 50 else 0 end,case a.code when 'FIC-K' then 50 else 0 end
 from journal_entries e cross join coa_accounts a where e.no_jurnal='JRN-FIC-LEGACY'and a.code in('FIC-D','FIC-K');
set local role authenticated;
do $$ declare a record; begin
 select * into a from post_recurring_journal_period('f4000000-0000-4000-8000-000000000001',test_recurring_period());
 assert not a.posted and a.no_jurnal='JRN-FIC-LEGACY','reuse complete legacy journal';
 assert (select last_posted=test_recurring_period()from recurring_journals where id='f4000000-0000-4000-8000-000000000001'),'recover legacy marker';
end $$;

-- Ambiguous legacy refs cannot suppress either of two schedules.
insert into journal_entries(no_jurnal,tanggal,source,source_ref,branch_id)values
 ('JRN-FIC-AMBIGUOUS',(test_recurring_period()||'-01')::date,'recurring','f3000000-'||test_recurring_period(),'f2000000-0000-4000-8000-000000000001');
do $$ begin
 begin
  perform post_recurring_journal_period('f3000000-0000-4000-8000-000000000007',test_recurring_period());
  raise exception 'Expected ambiguous journal rejection';
 exception when others then if sqlerrm not like 'RECURRING_HISTORY:%' then raise; end if; end;
end $$;

-- An inaccessible branch must not mutate the globally readable schedule marker.
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000002',true);
do $$ declare before_state jsonb:=test_recurring_state(); begin
 begin
  perform post_recurring_journal_period('f3000000-0000-4000-8000-000000000008',test_recurring_period());
  raise exception 'Expected branch access rejection';
 exception when insufficient_privilege then null; end;
 assert before_state=test_recurring_state(),'cross-branch rejection must leave progress intact';
 assert not has_function_privilege('anon','public.post_recurring_journal_period(uuid,text)','EXECUTE'),'anon cannot invoke posting';
end $$;
reset role;
-- First activation never backfills before its first eligible current month.
insert into recurring_journals(id,nama,day_of_month,last_posted,lines)values
 ('f5400000-0000-4000-8000-000000000001','Fiction missing marker journal',1,test_recurring_period(),
 '[{"code":"FIC-D","debit":12,"credit":0},{"code":"FIC-K","debit":0,"credit":12}]');
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
do $$ declare before_state jsonb:=test_recurring_state(); begin
 begin
  perform post_recurring_journal_period('f5400000-0000-4000-8000-000000000001',test_recurring_period());
  raise exception 'Expected missing historical journal rejection';
 exception when others then if sqlerrm not like 'RECURRING_HISTORY:%' then raise; end if; end;
 assert before_state=test_recurring_state(),'missing historical journals require review';
end $$;
reset role;
insert into recurring_journals(id,nama,day_of_month,last_posted,lines)values
 ('f5300000-0000-4000-8000-000000000001','Fiction prior incomplete',1,test_recurring_period(-1),
 '[{"code":"FIC-D","debit":12,"credit":0},{"code":"FIC-K","debit":0,"credit":12}]');
insert into journal_entries(no_jurnal,tanggal,source,source_ref)values
 ('JRN-FIC-PRIOR-EMPTY',(test_recurring_period(-1)||'-01')::date,'recurring','f5300000-0000-4000-8000-000000000001:'||test_recurring_period(-1));
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
do $$ declare before_state jsonb:=test_recurring_state(); begin
 begin
  perform post_recurring_journal_period('f5300000-0000-4000-8000-000000000001',test_recurring_period());
  raise exception 'Expected prior incomplete header rejection';
 exception when others then if sqlerrm not like 'RECURRING_HISTORY:%' then raise; end if; end;
 assert before_state=test_recurring_state(),'catch-up cannot conceal an incomplete previous marker';
end $$;
reset role;
insert into recurring_journals(id,nama,day_of_month,lines)values
 ('f5000000-0000-4000-8000-000000000001','Fiction first run',1,
 '[{"code":"FIC-D","debit":12,"credit":0},{"code":"FIC-K","debit":0,"credit":12}]');
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
do $$ begin
 begin
  perform post_recurring_journal_period('f5000000-0000-4000-8000-000000000001',test_recurring_period(-1));
  raise exception 'Expected first-run backfill rejection';
 exception when others then if sqlerrm not like 'RECURRING_PERIOD:%' then raise; end if; end;
 perform post_recurring_journal_period('f5000000-0000-4000-8000-000000000001',test_recurring_period());
end $$;

-- Disabled schedules, inactive accounts and closed periods are fail-closed.
update recurring_journals set is_active=false where id='f5000000-0000-4000-8000-000000000001';
do $$ declare a record; begin
 select * into a from post_recurring_journal_period('f5000000-0000-4000-8000-000000000001',test_recurring_period());
 assert not a.posted,'completed journal retry remains readable after disabling';
end $$;
reset role;
insert into recurring_journals(id,nama,day_of_month,last_posted,lines,is_active)values
 ('f5100000-0000-4000-8000-000000000001','Fiction disabled',1,test_recurring_period(-1),
 '[{"code":"FIC-D","debit":12,"credit":0},{"code":"FIC-K","debit":0,"credit":12}]',false),
 ('f5200000-0000-4000-8000-000000000001','Fiction blocked',1,test_recurring_period(-2),
 '[{"code":"FIC-D","debit":12,"credit":0},{"code":"FIC-K","debit":0,"credit":12}]',true);
select test_seed_recurring_history('f5200000-0000-4000-8000-000000000001',test_recurring_period(-2));
set local role authenticated;
do $$ declare before_state jsonb:=test_recurring_state(); begin
 begin
  perform post_recurring_journal_period('f5100000-0000-4000-8000-000000000001',test_recurring_period());
  raise exception 'Expected disabled rejection';
 exception when others then if sqlerrm<>'Jurnal berulang sedang nonaktif.' then raise; end if; end;
 assert before_state=test_recurring_state(),'disabled request cannot mutate journals';
end $$;
update coa_accounts set is_active=false where code='FIC-K';
do $$ declare before_state jsonb:=test_recurring_state(); begin
 begin
  perform post_recurring_journal_period('f5200000-0000-4000-8000-000000000001',test_recurring_period(-1));
  raise exception 'Expected inactive account rejection';
 exception when others then if sqlerrm not like 'Akun FIC-K%' then raise; end if; end;
 assert before_state=test_recurring_state(),'inactive account cannot leave a header or marker';
end $$;
update coa_accounts set is_active=true where code='FIC-K';
update accounting_locks set closed_until=(test_recurring_period()||'-01')::date-1;
do $$ declare before_state jsonb:=test_recurring_state(); begin
 begin
  perform post_recurring_journal_period('f5200000-0000-4000-8000-000000000001',test_recurring_period(-1));
  raise exception 'Expected closed period rejection';
 exception when others then if sqlerrm not like 'Periode s/d %' then raise; end if; end;
 assert before_state=test_recurring_state(),'closed period cannot leave a header or marker';
end $$;
update accounting_locks set closed_until=null;
reset role;

-- Service-role cron uses the same transaction contract without a login session.
set local role service_role;
select set_config('request.jwt.claim.sub','',true);
select * from post_recurring_journal_period('f5200000-0000-4000-8000-000000000001',test_recurring_period(-1));
reset role;
rollback;
