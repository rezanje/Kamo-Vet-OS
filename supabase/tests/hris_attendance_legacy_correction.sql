-- A branchless legacy session may only be completed or voided explicitly.
\ir hris_attendance_review_setup.sql
insert into attendance(employee_id,tanggal,jam_masuk) values('92000000-0000-0000-0000-000000000001','2026-09-30','20:00');
set local role authenticated;
do $$ declare r public.attendance;begin
 select * into r from attendance;
 begin perform public.hris_correct_attendance(r.id,r.updated_at,'2026-09-30T20:00+07',null,'Fiction branchless open',false);raise exception 'FAIL: branchless corrected session left open';exception when sqlstate 'P0001' then if sqlerrm not like 'ATTENDANCE: Sesi tanpa cabang%' then raise;end if;end;
 perform public.hris_correct_attendance(r.id,r.updated_at,'2026-09-30T20:00+07','2026-10-01T08:00+07','Fiction actual complete times',false);
end $$;
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000001',true);
select pg_temp.check_it(jsonb_array_length(public.hris_my_attendance()->'open_sessions')=0,'completed legacy releases staff');
select public.hris_clock_attendance('in','91000000-0000-0000-0000-000000000001',null,null);
rollback;
