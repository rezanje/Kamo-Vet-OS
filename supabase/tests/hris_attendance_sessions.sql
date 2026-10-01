\set ON_ERROR_STOP on
begin;
-- All fixtures fictional. Test clock override is rolled back at the end.
create or replace function public.hris_attendance_now() returns timestamptz language sql volatile as $$ select current_setting('hris.test_time')::timestamptz $$;
insert into auth.users(id) select ('10000000-0000-0000-0000-00000000000'||i)::uuid from generate_series(1,5) i;
update profiles set role=case id::text when '10000000-0000-0000-0000-000000000003' then 'ADMIN'::user_role when '10000000-0000-0000-0000-000000000004' then 'OWNER'::user_role else 'STAFF'::user_role end;
insert into branches(id,code,name,type,is_active) values ('20000000-0000-0000-0000-000000000001','FIC-A','Fiction A','KLINIK',true),('20000000-0000-0000-0000-000000000002','FIC-B','Fiction B','KLINIK',true);
insert into user_branches(user_id,branch_id,effective_date) values ('10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','2026-01-01');
insert into employees(id,nama,profile_id,branch_id) values ('30000000-0000-0000-0000-000000000001','Fiction Staff A','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001'),('30000000-0000-0000-0000-000000000002','Fiction Staff B','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002');
insert into employee_branch_assignments(employee_id,branch_id,effective_date) select id,branch_id,'2026-01-01' from employees;
create function pg_temp.check_it(ok boolean, msg text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAIL: %',msg;end if;end $$;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select set_config('hris.test_time','2026-09-30T20:00:00+07',true);
set local role authenticated;
select public.hris_clock_attendance('in','20000000-0000-0000-0000-000000000001',null,null);
select pg_temp.check_it((select count(*)=1 from attendance),'own initial row');
select pg_temp.check_it(public.hris_my_attendance()->'open_sessions'->0->>'tanggal'='2026-09-30','own RPC finds open session');
do $$ begin perform public.hris_clock_attendance('in','20000000-0000-0000-0000-000000000001',null,null);raise exception 'duplicate in accepted';exception when sqlstate 'P0001' then if sqlerrm not like 'ATTENDANCE:%' then raise;end if;end $$;
select set_config('hris.test_time','2026-10-01T08:00:00+07',true);
select public.hris_clock_attendance('out','20000000-0000-0000-0000-000000000001',null,null);
select pg_temp.check_it((select tanggal='2026-09-30' and jam_pulang='08:00' and extract(epoch from checked_out_at-checked_in_at)=43200 from attendance),'overnight one correct 12h session/month boundary');
do $$ begin perform public.hris_clock_attendance('out','20000000-0000-0000-0000-000000000001',null,null);raise exception 'duplicate out accepted';exception when sqlstate 'P0001' then if sqlerrm not like 'ATTENDANCE:%' then raise;end if;end $$;
-- Own/other access and direct writes.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
select pg_temp.check_it((select count(*)=0 from attendance),'staff cannot read another attendance');
do $$ begin perform public.hris_clock_attendance('in','20000000-0000-0000-0000-000000000001',null,null);raise exception 'wrong branch accepted';exception when sqlstate 'P0001' then if sqlerrm not like 'ATTENDANCE:%' then raise;end if;end $$;
do $$ begin insert into attendance(employee_id,tanggal) values ('30000000-0000-0000-0000-000000000001','2026-10-01');raise exception 'direct forged insert accepted';exception when insufficient_privilege then null;end $$;
reset role;
-- Audit correction with optimistic version and reason.
select set_config('hris.test_time','2026-10-01T08:10:00+07',true);
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
set local role authenticated;
select pg_temp.check_it((select count(*)=1 from attendance),'own branch admin sees attendance');
do $$ declare r public.attendance; begin
 select * into r from attendance limit 1;
 begin perform public.hris_correct_attendance(r.id,r.updated_at,r.checked_in_at,r.checked_out_at,'',false);raise exception 'blank reason accepted';exception when sqlstate 'P0001' then if sqlerrm not like 'ATTENDANCE:%' then raise;end if;end;
 perform public.hris_correct_attendance(r.id,r.updated_at,r.checked_in_at,r.checked_out_at+interval '5 minutes','Fiction correction',false);
 begin perform public.hris_correct_attendance(r.id,r.updated_at,r.checked_in_at,r.checked_out_at,'Stale edit',false);raise exception 'stale correction accepted';exception when sqlstate 'P0001' then if sqlerrm not like 'ATTENDANCE:%' then raise;end if;end;
end $$;
select pg_temp.check_it((select count(*)=1 and bool_and(reason='Fiction correction' and actor_id=auth.uid() and old_values<>new_values) from attendance_corrections),'audit old/new actor/reason');
reset role;
insert into attendance(employee_id,tanggal,jam_masuk,status) values ('30000000-0000-0000-0000-000000000002','2026-09-29','20:00','Hadir');
set local role authenticated;
select pg_temp.check_it((select count(*)=1 from attendance),'other branch legacy row hidden from admin');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
do $$ begin perform public.hris_clock_attendance('out','20000000-0000-0000-0000-000000000002',null,null);raise exception 'legacy hours guessed';exception when sqlstate 'P0001' then if sqlerrm not like 'ATTENDANCE:%' then raise;end if;end $$;
do $$ begin perform public.hris_clock_attendance('in','20000000-0000-0000-0000-000000000002',null,null);raise exception 'open legacy overwritten';exception when sqlstate 'P0001' then if sqlerrm not like 'ATTENDANCE:%' then raise;end if;end $$;
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
set local role authenticated;
select pg_temp.check_it((select count(*)=2 from attendance),'owner sees both branches');
-- Owner can resolve legacy by explicit void without inventing worked hours.
do $$ declare r public.attendance;begin
 select * into r from attendance where employee_id='30000000-0000-0000-0000-000000000002';
 perform public.hris_correct_attendance(r.id,r.updated_at,null,null,'Fiction mistaken legacy session',true);
end $$;
select public.hris_record_attendance('30000000-0000-0000-0000-000000000001','2026-09-28','2026-09-28T20:00+07','2026-09-29T08:00+07','Hadir','Fiction missing prior record');
do $$ begin perform public.hris_record_attendance('30000000-0000-0000-0000-000000000001','2026-09-28','2026-09-28T20:00+07','2026-09-29T08:00+07','Hadir','Must not overwrite');raise exception 'manual overwrite accepted';exception when sqlstate 'P0001' then if sqlerrm not like 'ATTENDANCE:%' then raise;end if;end $$;
reset role;
insert into payrolls(employee_id,periode,status) values('30000000-0000-0000-0000-000000000001','2026-09','final');
set local role authenticated;
do $$ declare r public.attendance;begin
 select * into r from attendance where employee_id='30000000-0000-0000-0000-000000000001' and tanggal='2026-09-28';
 begin perform public.hris_correct_attendance(r.id,r.updated_at,r.checked_in_at,r.checked_out_at,'Settled period edit',true);raise exception 'settled history modified';exception when sqlstate 'P0001' then if sqlerrm not like 'ATTENDANCE:%' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
select pg_temp.check_it(jsonb_array_length(public.hris_my_attendance()->'open_sessions')=0,'void releases legacy session');
reset role;
update branches set lat=-6,lng=106,radius_m=100 where id='20000000-0000-0000-0000-000000000002';
set local role authenticated;
do $$ begin perform public.hris_clock_attendance('in','20000000-0000-0000-0000-000000000002',null,null);raise exception 'missing GPS accepted';exception when sqlstate 'P0001' then if sqlerrm not like 'ATTENDANCE:%' then raise;end if;end $$;
do $$ begin perform public.hris_clock_attendance('in','20000000-0000-0000-0000-000000000002',0,0);raise exception 'outside GPS accepted';exception when sqlstate 'P0001' then if sqlerrm not like 'ATTENDANCE:%' then raise;end if;end $$;
select public.hris_clock_attendance('in','20000000-0000-0000-0000-000000000002',-6,106);
select pg_temp.check_it((select count(*)=1 from attendance where not is_void),'staff resumes after authorized void');
do $$ begin perform public.hris_clock_attendance('out','20000000-0000-0000-0000-000000000001',-6,106);raise exception 'checkout moved branches';exception when sqlstate 'P0001' then if sqlerrm not like 'ATTENDANCE:%' then raise;end if;end $$;
select public.hris_clock_attendance('out','20000000-0000-0000-0000-000000000002',-6,106);
-- Known-timestamp stale sessions remain untouched; staff cannot self-correct or
-- hijack identity via the old employee master policy.
reset role;
insert into employees(id,nama,profile_id,branch_id) values('30000000-0000-0000-0000-000000000003','Fiction stale','10000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000001');
insert into employee_branch_assignments(employee_id,branch_id,effective_date) values('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','2026-01-01');
insert into attendance(employee_id,tanggal,jam_masuk,checked_in_at,branch_id) values('30000000-0000-0000-0000-000000000003','2026-09-28','20:00','2026-09-28T20:00+07','20000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000005',true);
set local role authenticated;
do $$ begin perform public.hris_clock_attendance('out','20000000-0000-0000-0000-000000000001',null,null);raise exception 'stale known session guessed';exception when sqlstate 'P0001' then if sqlerrm not like 'ATTENDANCE:%' then raise;end if;end $$;
do $$ declare r public.attendance;begin
 select * into r from attendance where employee_id='30000000-0000-0000-0000-000000000003';
 begin perform public.hris_correct_attendance(r.id,r.updated_at,r.checked_in_at,null,'Staff attempted own correction',false);raise exception 'staff correction accepted';exception when sqlstate 'P0001' then if sqlerrm not like 'ATTENDANCE:%' then raise;end if;end;
end $$;
update employees set profile_id='10000000-0000-0000-0000-000000000005' where id='30000000-0000-0000-0000-000000000001';
select pg_temp.check_it((select profile_id='10000000-0000-0000-0000-000000000001' from employees where id='30000000-0000-0000-0000-000000000001'),'staff identity overwrite blocked');
reset role;
set local role anon;
do $$ begin perform public.hris_my_attendance();raise exception 'anonymous RPC accepted';exception when insufficient_privilege then null;end $$;
rollback;
