-- Prepend recurring_source_journals.sql fixture through -- fixture-end:.
do $$declare state qa_j04_state%rowtype;snap jsonb;failed boolean;current_period text;begin
 select *into state from qa_j04_state;snap:=preview_recurring_journal_source(state.other_source_id);
 current_period:=to_char(statement_timestamp()at time zone'Asia/Jakarta','YYYY-MM');
 failed:=false;begin perform create_recurring_journal_from_source('j04-unconfirmed',state.other_source_id,snap,'Fiction guards',current_period,1,2,null,false,false);exception when sqlstate'22023'then failed:=true;end;
 if not failed then raise exception 'J04 missing confirmation accepted';end if;
 failed:=false;begin perform create_recurring_journal_from_source('j04-backdated',state.other_source_id,snap,'Fiction guards',state.first_period,1,2,null,false,true);exception when sqlstate'22023'then failed:=true;end;
 if not failed then raise exception 'J04 backdate silently accepted';end if;
 failed:=false;begin perform create_recurring_journal_from_source('j04-zero-count',state.other_source_id,snap,'Fiction guards',current_period,1,0,null,false,true);exception when sqlstate'22023'then failed:=true;end;
 if not failed then raise exception 'J04 zero count accepted';end if;
 failed:=false;begin perform create_recurring_journal_from_source('j04-mismatch-end',state.other_source_id,snap,'Fiction guards',current_period,1,2,current_period,false,true);exception when sqlstate'22023'then failed:=true;end;
 if not failed then raise exception 'J04 count/end mismatch accepted';end if;
 failed:=false;begin perform create_recurring_journal_from_source('j04-source-month',state.other_source_id,snap,'Fiction guards',left(snap->>'tanggal',7),1,2,null,true,true);exception when sqlstate'22023'then failed:=true;end;
 if not failed then raise exception 'J04 already-booked source month duplicated';end if;
 failed:=false;begin perform create_recurring_journal_from_source('j04-stale',state.other_source_id,jsonb_set(snap,'{revision}','999'),'Fiction guards',current_period,1,2,null,false,true);exception when sqlstate'40001'then failed:=true;end;
 if not failed then raise exception 'J04 stale source preview accepted';end if;
end$$;
reset role;
create function public.qa_j04_audit_fail()returns trigger language plpgsql as $$begin if new.row_entity='recurring_journals'then raise exception 'fictional J04 audit failure';end if;return new;end$$;
create trigger qa_j04_audit_fail before insert on activity_log for each row execute function qa_j04_audit_fail();
set local role authenticated;
do $$declare state qa_j04_state%rowtype;snap jsonb;failed boolean:=false;begin
 select *into state from qa_j04_state;snap:=preview_recurring_journal_source(state.other_source_id);
 begin perform create_recurring_journal_from_source('j04-create-audit-fail',state.other_source_id,snap,'Fiction rollback',to_char(statement_timestamp()at time zone'Asia/Jakarta','YYYY-MM'),1,2,null,false,true);exception when others then if sqlerrm<>'fictional J04 audit failure'then raise;end if;failed:=true;end;
 if not failed then raise exception 'J04 creation audit failure ignored';end if;
end$$;
reset role;
drop trigger qa_j04_audit_fail on activity_log;
do $$begin if(select count(*)from recurring_journal_sources)<>1 or(select count(*)from recurring_journals where is_source_schedule)<>1 then raise exception 'J04 create failure left partial schedule';end if;end$$;
set local role authenticated;
do $$declare state qa_j04_state%rowtype;snap jsonb;result jsonb;period text;begin
 select *into state from qa_j04_state;snap:=preview_recurring_journal_source(state.other_source_id);period:=to_char(statement_timestamp()at time zone'Asia/Jakarta','YYYY-MM');
 result:=create_recurring_journal_from_source('j04-guard-plan',state.other_source_id,snap,'Fiction due guards',period,1,null,to_char((period||'-01')::date+interval'1 month','YYYY-MM'),false,true);
 if(result->>'count')::integer<>2 then raise exception 'J04 end month did not derive inclusive count';end if;
 update qa_j04_state set schedule_id=(result->>'schedule_id')::uuid,first_period=period,snapshot=snap;
end$$;
reset role;
create function public.qa_j04_line_fail()returns trigger language plpgsql as $$begin if exists(select 1 from public.journal_entries where id=new.entry_id and source='recurring')then raise exception 'fictional J04 line failure';end if;return new;end$$;
create trigger qa_j04_line_fail before insert on journal_lines for each row execute function qa_j04_line_fail();
set local role authenticated;
do $$declare state qa_j04_state%rowtype;failed boolean:=false;begin
 select *into state from qa_j04_state;
 begin perform post_recurring_journal_source_period(state.schedule_id,state.first_period);exception when others then if sqlerrm<>'fictional J04 line failure'then raise;end if;failed:=true;end;
 if not failed then raise exception 'J04 journal failure ignored';end if;
end$$;
reset role;
drop trigger qa_j04_line_fail on journal_lines;drop function qa_j04_line_fail();
create trigger qa_j04_audit_fail before insert on activity_log for each row execute function qa_j04_audit_fail();
set local role authenticated;
do $$declare state qa_j04_state%rowtype;failed boolean:=false;begin
 select *into state from qa_j04_state;
 begin perform post_recurring_journal_source_period(state.schedule_id,state.first_period);exception when others then if sqlerrm<>'fictional J04 audit failure'then raise;end if;failed:=true;end;
 if not failed then raise exception 'J04 posting audit failure ignored';end if;
end$$;
reset role;
drop trigger qa_j04_audit_fail on activity_log;drop function qa_j04_audit_fail();
do $$begin if exists(select 1 from journal_entries where source='recurring')or exists(select 1 from recurring_source_occurrences)or exists(select 1 from recurring_journals where is_source_schedule and last_posted is not null)then raise exception 'J04 failed execution left partial ledger/proof/progress';end if;end$$;
update accounting_locks set closed_until=(now()at time zone'Asia/Jakarta')::date where id;
set local role authenticated;
do $$declare state qa_j04_state%rowtype;failed boolean:=false;begin
 select *into state from qa_j04_state;
 begin perform post_recurring_journal_source_period(state.schedule_id,state.first_period);exception when others then if sqlerrm not like'RECURRING_SOURCE_CLOSED:%'then raise;end if;failed:=true;end;
 if not failed then raise exception 'J04 closed period posted';end if;
end$$;
reset role;update accounting_locks set closed_until=null where id;
savepoint source_change;
update journal_entries set revision=revision+1 where id=(select other_source_id from qa_j04_state);
set local role authenticated;
do $$declare state qa_j04_state%rowtype;failed boolean:=false;begin
 select *into state from qa_j04_state;
 begin perform post_recurring_journal_source_period(state.schedule_id,state.first_period);exception when others then if sqlerrm not like'RECURRING_SOURCE_CHANGED:%'then raise;end if;failed:=true;end;
 if not failed then raise exception 'J04 changed source posted';end if;
end$$;
reset role;rollback to savepoint source_change;
savepoint source_void;
update journal_entries set voided_at=now()where id=(select other_source_id from qa_j04_state);
set local role authenticated;
do $$declare state qa_j04_state%rowtype;failed boolean:=false;begin
 select *into state from qa_j04_state;
 begin perform post_recurring_journal_source_period(state.schedule_id,state.first_period);exception when others then if sqlerrm not like'RECURRING_SOURCE_CHANGED:%'then raise;end if;failed:=true;end;
 if not failed then raise exception 'J04 voided source posted';end if;
end$$;
reset role;rollback to savepoint source_void;
set local role authenticated;
do $$declare state qa_j04_state%rowtype;failed boolean;receipt jsonb;begin
 select *into state from qa_j04_state;
 failed:=false;begin perform post_recurring_journal_source_period(state.schedule_id,to_char((state.first_period||'-01')::date+interval'1 month','YYYY-MM'));exception when others then if sqlerrm not like'RECURRING_SOURCE_PERIOD:%'then raise;end if;failed:=true;end;
 if not failed then raise exception 'J04 future/skipped period posted';end if;
 update recurring_journals set is_active=false where id=state.schedule_id;
 failed:=false;begin perform post_recurring_journal_source_period(state.schedule_id,state.first_period);exception when others then if sqlerrm not like'RECURRING_SOURCE_INACTIVE:%'then raise;end if;failed:=true;end;
 if not failed then raise exception 'J04 paused schedule posted';end if;
 update recurring_journals set is_active=true where id=state.schedule_id;
 receipt:=post_recurring_journal_source_period(state.schedule_id,state.first_period);
 update recurring_journals set is_active=false where id=state.schedule_id;
 if(post_recurring_journal_source_period(state.schedule_id,state.first_period)->>'entry_id')<>receipt->>'entry_id'then raise exception 'J04 inactive historical replay failed';end if;
end$$;
rollback;
