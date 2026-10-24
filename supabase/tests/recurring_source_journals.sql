-- Fictional local source-journal lifecycle only; all fixture/data changes roll back.
begin;
insert into auth.users(id)values(md5('j04-owner')::uuid),(md5('j04-staff')::uuid),(md5('j04-finance')::uuid),(md5('j04-anonymous-owner-claim')::uuid);
insert into profiles(id,role,is_active)values(md5('j04-owner')::uuid,'OWNER',true),(md5('j04-staff')::uuid,'STAFF',true),(md5('j04-finance')::uuid,'FINANCE',true),(md5('j04-anonymous-owner-claim')::uuid,'OWNER',true)on conflict(id)do update set role=excluded.role,is_active=true;
insert into branches(id,code,name,type)values(md5('j04-a')::uuid,'J04A','Fiction source branch','OFFICE'),(md5('j04-b')::uuid,'J04B','Fiction other branch','OFFICE');
insert into coa_accounts(id,code,name,type,normal_balance,is_active,is_header)values(md5('j04-debit')::uuid,'J04D','Fiction rental expense','BEBAN','D',true,false),(md5('j04-credit')::uuid,'J04K','Fiction prepaid rent','ASET','K',true,false);
create table public.qa_j04_state(id boolean primary key default true,source_id uuid,other_source_id uuid,schedule_id uuid,snapshot jsonb,first_period text);
grant select,update on public.qa_j04_state to authenticated;
insert into qa_j04_state(id)values(true);
set local role authenticated;
set local request.jwt.claim.role='authenticated';
select set_config('request.jwt.claim.sub',md5('j04-owner')::uuid::text,true);
do $$declare s jsonb;other jsonb;d date;begin
 d:=(date_trunc('month',statement_timestamp()at time zone'Asia/Jakarta')-interval'12 months')::date;
 s:=create_manual_journal_atomic('j04-source',d,'Fiction inherited rental allocation',md5('j04-a')::uuid,jsonb_build_array(jsonb_build_object('account_id',md5('j04-debit')::uuid,'debit',125.50,'credit',0),jsonb_build_object('account_id',md5('j04-credit')::uuid,'debit',0,'credit',125.50)));
 other:=create_manual_journal_atomic('j04-other-source',d,'Fiction other allocation',md5('j04-a')::uuid,jsonb_build_array(jsonb_build_object('account_id',md5('j04-debit')::uuid,'debit',100,'credit',0),jsonb_build_object('account_id',md5('j04-credit')::uuid,'debit',0,'credit',100)));
 update qa_j04_state set source_id=(s->>'entry_id')::uuid,other_source_id=(other->>'entry_id')::uuid,first_period=to_char(d+interval'1 month','YYYY-MM');
end$$;
do $$declare state qa_j04_state%rowtype;result jsonb;retry jsonb;v_snapshot jsonb;before_count bigint;begin
 select *into state from qa_j04_state;
 select count(*)into before_count from journal_entries;
 v_snapshot:=preview_recurring_journal_source(state.source_id);
 if v_snapshot->>'deskripsi'<>'Fiction inherited rental allocation'or jsonb_array_length(v_snapshot->'lines')<>2 then raise exception 'J04 canonical source preview incomplete';end if;
 result:=create_recurring_journal_from_source('j04-create',state.source_id,v_snapshot,'Fiction monthly rental',state.first_period,1,12,null,true,true);
 retry:=create_recurring_journal_from_source('j04-create',state.source_id,v_snapshot,'Fiction monthly rental',state.first_period,1,12,null,true,true);
 if result is distinct from retry or result is distinct from get_recurring_journal_source_result('j04-create')then raise exception 'J04 creation/recovery receipt changed';end if;
 if result->>'mode'<>'manual'or(result->>'count')::integer<>12 then raise exception 'J04 explicit finite manual config lost';end if;
 if(select count(*)from journal_entries)<>before_count then raise exception 'J04 setup posted ledger entries';end if;
 if not exists(select 1 from recurring_journals where id=(result->>'schedule_id')::uuid and is_source_schedule and lines='[]'::jsonb and deskripsi is null and last_posted is null)then raise exception 'J04 source data leaked into global template or progress forged';end if;
 update qa_j04_state set schedule_id=(result->>'schedule_id')::uuid,snapshot=v_snapshot;
end$$;
-- fixture-end: runner uses the actual source/setup above for deterministic sessions.
do $$declare state qa_j04_state%rowtype;failed boolean;begin
 select *into state from qa_j04_state;
 failed:=false;begin perform create_recurring_journal_from_source('j04-create',state.source_id,state.snapshot,'Different name',state.first_period,1,12,null,true,true);exception when sqlstate'22023'then failed:=true;end;
 if not failed then raise exception 'J04 changed retry accepted';end if;
 failed:=false;begin perform create_recurring_journal_from_source('j04-another-key',state.source_id,state.snapshot,'Second plan',state.first_period,1,12,null,true,true);exception when others then if sqlerrm not like'RECURRING_SOURCE_DUPLICATE:%'then raise;end if;failed:=true;end;
 if not failed then raise exception 'J04 different-key duplicate source plan accepted';end if;
 failed:=false;begin perform post_recurring_journal_period(state.schedule_id,state.first_period);exception when others then if sqlerrm not like'RECURRING_SOURCE_MODE:%'then raise;end if;failed:=true;end;
 if not failed then raise exception 'J04 legacy auto path posted source schedule';end if;
 failed:=false;begin update recurring_journals set last_posted=state.first_period where id=state.schedule_id;exception when insufficient_privilege then failed:=true;end;
 if not failed then raise exception 'J04 direct progress forged';end if;
 failed:=false;begin update recurring_journals set is_source_schedule=false where id=state.schedule_id;exception when insufficient_privilege then failed:=true;end;
 if not failed then raise exception 'J04 source marker unlinked';end if;
end$$;
do $$declare state qa_j04_state%rowtype;period text;first_result jsonb;again jsonb;i integer;begin
 select *into state from qa_j04_state;
 for i in 0..11 loop
  period:=to_char((state.first_period||'-01')::date+make_interval(months=>i),'YYYY-MM');
  first_result:=post_recurring_journal_source_period(state.schedule_id,period);
  again:=post_recurring_journal_source_period(state.schedule_id,period);
  if not(first_result->>'posted')::boolean or(again->>'posted')::boolean or first_result->>'entry_id'<>again->>'entry_id'then raise exception 'J04 occurrence replay duplicated receipt';end if;
  if not exists(select 1 from journal_entries where id=(first_result->>'entry_id')::uuid and tanggal=(period||'-01')::date and branch_id=md5('j04-a')::uuid and source='recurring'and source_ref=state.schedule_id::text||':'||period)then raise exception 'J04 period/date/branch identity wrong';end if;
  if(select sum(debit)from journal_lines where entry_id=(first_result->>'entry_id')::uuid)<>125.50 or(select sum(credit)from journal_lines where entry_id=(first_result->>'entry_id')::uuid)<>125.50 then raise exception 'J04 source value did not reconcile';end if;
 end loop;
 if(select count(*)from recurring_source_occurrences where schedule_id=state.schedule_id)<>12 then raise exception 'J04 receipt count differs from12';end if;
end$$;
do $$declare state qa_j04_state%rowtype;failed boolean;period text;entry uuid;begin
 select *into state from qa_j04_state;period:=to_char((state.first_period||'-01')::date+interval'12 months','YYYY-MM');
 failed:=false;begin perform post_recurring_journal_source_period(state.schedule_id,period);exception when others then if sqlerrm not like'RECURRING_SOURCE_LIMIT:%'then raise;end if;failed:=true;end;
 if not failed then raise exception 'J04 finite limit exceeded';end if;
 select o.journal_id into entry from recurring_source_occurrences o where o.schedule_id=state.schedule_id order by o.period limit 1;
 failed:=false;begin update journal_lines set debit=126 where entry_id=entry and debit>0;exception when insufficient_privilege then failed:=true;end;
 if not failed then raise exception 'J04 direct posted lines altered';end if;
 failed:=false;begin delete from journal_entries where id=entry;exception when insufficient_privilege then failed:=true;end;
 if not failed then raise exception 'J04 posted journal deleted';end if;
end$$;
select set_config('request.jwt.claims','{"role":"authenticated","is_anonymous":true}',true);
select set_config('request.jwt.claim.sub',md5('j04-anonymous-owner-claim')::uuid::text,true);
do $$declare state qa_j04_state%rowtype;failed boolean:=false;begin
 select *into state from qa_j04_state;
 begin perform preview_recurring_journal_source(state.source_id);exception when insufficient_privilege then failed:=true;end;
 if not failed then raise exception 'J04 anonymous Auth user with an OWNER profile bypassed the finance boundary';end if;
 if exists(select schedule_id from recurring_journal_sources)then raise exception 'J04 anonymous Auth user read source proofs';end if;
end$$;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select set_config('request.jwt.claim.sub',md5('j04-owner')::uuid::text,true);
select set_config('request.jwt.claim.sub',md5('j04-staff')::uuid::text,true);
do $$declare failed boolean:=false;begin
 begin perform preview_recurring_journal_source((select source_id from qa_j04_state));exception when insufficient_privilege then failed:=true;end;
 if not failed or exists(select schedule_id from recurring_journal_sources)then raise exception 'J04 staff read source/private proof';end if;
end$$;
select set_config('request.jwt.claim.sub',md5('j04-finance')::uuid::text,true);
do $$begin if get_recurring_journal_source_result('j04-create')is not null then raise exception 'J04 another account recovered private creation key';end if;end$$;
select set_config('request.jwt.claim.sub',md5('j04-owner')::uuid::text,true);
select set_config('request.headers',jsonb_build_object('x-kamo-operational-branch',md5('j04-b')::uuid)::text,true);
do $$declare failed boolean:=false;begin
 begin perform preview_recurring_journal_source((select source_id from qa_j04_state));exception when insufficient_privilege then failed:=true;end;
 if not failed then raise exception 'J04 selected-branch scope bypassed';end if;
end$$;
select set_config('request.headers','{}',true);
reset role;
do $$declare failed boolean:=false;begin
 begin delete from recurring_journal_sources;exception when insufficient_privilege then failed:=true;end;
 if not failed then raise exception 'J04 immutable proof removed';end if;
end$$;
rollback;
