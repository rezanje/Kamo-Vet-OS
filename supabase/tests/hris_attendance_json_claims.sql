-- All four RPCs must work with modern JSON-only PostgREST claims.
\ir hris_attendance_review_setup.sql
select set_config('request.jwt.claim.role','',true);
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"authenticated","sub":"90000000-0000-0000-0000-000000000001"}',true);
set local role authenticated;
select pg_temp.check_it(jsonb_array_length(public.hris_my_attendance()->'branches')=1,'JSON-only own identity');
select public.hris_clock_attendance('in','91000000-0000-0000-0000-000000000001',null,null);
select public.hris_clock_attendance('out','91000000-0000-0000-0000-000000000001',null,null);
select set_config('request.jwt.claims','{"role":"authenticated","sub":"90000000-0000-0000-0000-000000000002"}',true);
select public.hris_record_attendance('92000000-0000-0000-0000-000000000002','2026-09-30','2026-09-30T20:00+07','2026-10-01T08:00+07','Hadir','Fiction JSON record');
do $$ declare r public.attendance;begin
 select * into r from attendance where employee_id='92000000-0000-0000-0000-000000000002';
 perform public.hris_correct_attendance(r.id,r.updated_at,r.checked_in_at,r.checked_out_at,'Fiction JSON correction',false);
end $$;
select pg_temp.check_it((select count(*)=2 from attendance_corrections),'JSON-only corrections audited');
select set_config('request.jwt.claims','{"role":"anon","sub":"90000000-0000-0000-0000-000000000001"}',true);
do $$ begin perform public.hris_my_attendance();raise exception 'FAIL: anonymous JSON accepted';exception when sqlstate 'P0001' then if sqlerrm not like 'ATTENDANCE:%' then raise;end if;end $$;
rollback;
