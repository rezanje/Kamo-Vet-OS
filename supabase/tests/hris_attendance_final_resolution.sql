-- Explicit operational resolution must preserve settled attendance/payroll exactly.
\ir hris_attendance_review_setup.sql
insert into attendance(id,employee_id,tanggal,jam_masuk) values('93000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000001','2026-09-28','20:00');
insert into payrolls(employee_id,periode,status) values('92000000-0000-0000-0000-000000000001','2026-09','final');
create temporary table original_final as select to_jsonb(a) attendance,(select to_jsonb(p) from payrolls p) payroll from attendance a;
grant select on original_final to authenticated;
set local role authenticated;
-- Completed-row mutations remain forbidden, including void.
do $$ declare r public.attendance;begin
 select * into r from attendance;
 begin perform public.hris_correct_attendance(r.id,r.updated_at,null,null,'Cannot void settled row',true);raise exception 'FAIL: settled void accepted';exception when sqlstate 'P0001' then if sqlerrm not like 'ATTENDANCE:%' then raise;end if;end;
 begin perform public.hris_resolve_final_attendance(r.id,r.updated_at,'');raise exception 'FAIL: blank resolution reason accepted';exception when sqlstate 'P0001' then if sqlerrm not like 'ATTENDANCE:%' then raise;end if;end;
 begin perform public.hris_resolve_final_attendance(r.id,r.updated_at-interval '1 microsecond','Stale resolution');raise exception 'FAIL: stale resolution accepted';exception when sqlstate 'P0001' then if sqlerrm not like 'ATTENDANCE:%' then raise;end if;end;
 -- Modern JSON-only claims also work for the recovery RPC.
 perform set_config('request.jwt.claim.role','',true);
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims','{"role":"authenticated","sub":"90000000-0000-0000-0000-000000000002"}',true);
 perform public.hris_resolve_final_attendance(r.id,r.updated_at,'Fiction legacy operational resolution');
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000002',true);
 begin perform public.hris_resolve_final_attendance(r.id,r.updated_at,'Duplicate resolution');raise exception 'FAIL: duplicate resolution accepted';exception when sqlstate 'P0001' then if sqlerrm not like 'ATTENDANCE:%' then raise;end if;end;
end $$;
select pg_temp.check_it((select to_jsonb(a)=o.attendance from attendance a cross join original_final o),'final attendance byte-equivalent');
select pg_temp.check_it((select to_jsonb(p)=o.payroll from payrolls p cross join original_final o),'final payroll unchanged');
select pg_temp.check_it((select count(*)=1 and bool_and(actor_id=auth.uid() and reason='Fiction legacy operational resolution') from attendance_session_resolutions),'resolution reason/actor');
select pg_temp.check_it((select count(*)=1 and bool_and(old_values=(select attendance from original_final) and new_values->'attendance'=old_values and new_values->'operational_resolution'->>'actor_id'=auth.uid()::text) from attendance_corrections),'resolution old/new trace preserves original row');
do $$ begin delete from attendance_session_resolutions;raise exception 'FAIL: direct resolution deletion accepted';exception when insufficient_privilege then null;end $$;
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000001',true);
select pg_temp.check_it(jsonb_array_length(public.hris_my_attendance()->'open_sessions')=0,'settled resolved session no longer blocks');
select public.hris_clock_attendance('in','91000000-0000-0000-0000-000000000001',null,null);
select public.hris_clock_attendance('out','91000000-0000-0000-0000-000000000001',null,null);
do $$ begin perform public.hris_resolve_final_attendance('93000000-0000-0000-0000-000000000001',(select updated_at from attendance where id='93000000-0000-0000-0000-000000000001'),'Staff cannot resolve');raise exception 'FAIL: staff resolution accepted';exception when sqlstate 'P0001' then if sqlerrm not like 'ATTENDANCE:%' then raise;end if;end $$;
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000003',true);
select pg_temp.check_it((select count(*)=0 from attendance_session_resolutions),'foreign admin cannot read resolution');
do $$ begin perform public.hris_resolve_final_attendance('93000000-0000-0000-0000-000000000001',now(),'Foreign admin cannot resolve');raise exception 'FAIL: foreign resolution accepted';exception when sqlstate 'P0001' then if sqlerrm not like 'ATTENDANCE:%' then raise;end if;end $$;
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000002',true);
do $$ declare r public.attendance;begin
 select * into r from attendance where tanggal='2026-10-01';
 begin perform public.hris_resolve_final_attendance(r.id,r.updated_at,'Cannot resolve nonfinal');raise exception 'FAIL: nonfinal resolution accepted';exception when sqlstate 'P0001' then if sqlerrm not like 'ATTENDANCE:%' then raise;end if;end;
end $$;
select pg_temp.check_it((select count(*)=0 from hris_open_attendance),'HR pending view excludes resolved and completed sessions');
rollback;
