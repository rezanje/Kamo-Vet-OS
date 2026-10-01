-- LOCAL fictional database only. Test clocks and data all roll back.
\ir hris_attendance_review_setup.sql
create or replace function public.hris_schedule_now() returns timestamptz language sql volatile as $$ select '2026-10-01T08:10:00+07'::timestamptz $$;
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select public.hris_my_schedule('2026-10-01','2026-10-08');
reset role;
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000002',true);
insert into work_shifts(id,nama,jam_masuk,jam_pulang,branch_id) values('94000000-0000-0000-0000-000000000001','Fiction 07','07:00','15:00','91000000-0000-0000-0000-000000000001'),('94000000-0000-0000-0000-000000000002','Fiction 08','08:00','16:00','91000000-0000-0000-0000-000000000001');
insert into employee_schedules(employee_id,tanggal,shift_id) select '92000000-0000-0000-0000-000000000001',date '2026-10-01'+i,'94000000-0000-0000-0000-000000000001' from generate_series(0,8) i;
create function pg_temp.reject(cmd text,pattern text default 'JADWAL:%') returns void language plpgsql as $$ begin execute cmd;raise exception 'FAIL: accepted %',cmd;exception when sqlstate 'P0001' then if sqlerrm not like pattern then raise;end if;end $$;
create function pg_temp.forbid(cmd text) returns void language plpgsql as $$ begin execute cmd;raise exception 'FAIL: direct write accepted';exception when insufficient_privilege then null;end $$;
-- Modern JSON-only PostgREST identity.
select set_config('request.jwt.claim.role','',true);
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"authenticated","sub":"90000000-0000-0000-0000-000000000001"}',true);
set local role authenticated;
select pg_temp.check_it(jsonb_array_length(public.hris_my_schedule('2026-10-01','2026-10-08')->'schedules')=8,'own published schedules');
select public.hris_request_schedule_change(id,updated_at,'94000000-0000-0000-0000-000000000002','91000000-0000-0000-0000-000000000001','Fiction start later') from employee_schedules where tanggal='2026-10-02';
select pg_temp.check_it((select shift_id='94000000-0000-0000-0000-000000000001' from employee_schedules where tanggal='2026-10-02'),'submission does not change effective schedule');
select pg_temp.reject(format('select public.hris_request_schedule_change(%L,%L,%L,%L,%L)',id,updated_at,'94000000-0000-0000-0000-000000000002','91000000-0000-0000-0000-000000000001','Duplicate pending')) from employee_schedules where tanggal='2026-10-02';
update employee_schedules set shift_id='94000000-0000-0000-0000-000000000002' where tanggal='2026-10-03';
select pg_temp.check_it((select shift_id='94000000-0000-0000-0000-000000000001' from employee_schedules where tanggal='2026-10-03'),'staff cannot bypass via board write');
update work_shifts set jam_masuk='00:00' where id='94000000-0000-0000-0000-000000000001';
select pg_temp.check_it((select jam_masuk='07:00' from work_shifts where id='94000000-0000-0000-0000-000000000001'),'staff cannot bypass via shift master');
select pg_temp.forbid('insert into schedule_change_requests(employee_id) values (''92000000-0000-0000-0000-000000000001'')');
select pg_temp.reject(format('select public.hris_decide_schedule_change(%L,true,%L)',id,'Staff self approval')) from schedule_change_requests;
-- Owner approval commits row and decision together; repeat cannot duplicate audit.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"90000000-0000-0000-0000-000000000002"}',true);
select public.hris_decide_schedule_change(id,true,'Fiction HR approval') from schedule_change_requests;
select pg_temp.check_it((select r.status='Disetujui' and r.decided_by=auth.uid() and s.shift_id=r.proposed_shift_id from schedule_change_requests r join employee_schedules s on s.id=r.schedule_id where r.tanggal='2026-10-02'),'decision and schedule atomic');
select pg_temp.check_it((select w.jam_masuk='08:00' from employee_schedules s join work_shifts w on w.id=s.shift_id where s.tanggal='2026-10-02'),'existing payroll join reads approved 08 start');
select pg_temp.check_it((select count(*)=2 from schedule_request_events),'submission and decision events');
select pg_temp.reject(format('select public.hris_decide_schedule_change(%L,true,%L)',id,'Repeat approval')) from schedule_change_requests;
select pg_temp.forbid('delete from schedule_request_events');
-- Snapshot version protects against board ABA, not just different shift IDs.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"90000000-0000-0000-0000-000000000001"}',true);
select public.hris_request_schedule_change(id,updated_at,'94000000-0000-0000-0000-000000000002','91000000-0000-0000-0000-000000000001','Fiction ABA') from employee_schedules where tanggal='2026-10-03';
select set_config('request.jwt.claims','{"role":"authenticated","sub":"90000000-0000-0000-0000-000000000002"}',true);
update employee_schedules set shift_id='94000000-0000-0000-0000-000000000002' where tanggal='2026-10-03';
update employee_schedules set shift_id='94000000-0000-0000-0000-000000000001' where tanggal='2026-10-03';
select pg_temp.reject(format('select public.hris_decide_schedule_change(%L,true,%L)',id,'Stale approval')) from schedule_change_requests where tanggal='2026-10-03';
select pg_temp.check_it((select status='Menunggu' from schedule_change_requests where tanggal='2026-10-03'),'failed approval remains pending');
select public.hris_decide_schedule_change(id,false,'Jadwal berubah; ajukan ulang') from schedule_change_requests where tanggal='2026-10-03';
-- Definition mutation is also rejected.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"90000000-0000-0000-0000-000000000001"}',true);
select public.hris_request_schedule_change(id,updated_at,'94000000-0000-0000-0000-000000000002','91000000-0000-0000-0000-000000000001','Fiction changed shift') from employee_schedules where tanggal='2026-10-04';
select set_config('request.jwt.claims','{"role":"authenticated","sub":"90000000-0000-0000-0000-000000000002"}',true);
update work_shifts set jam_masuk='09:00' where id='94000000-0000-0000-0000-000000000002';
select pg_temp.reject(format('select public.hris_decide_schedule_change(%L,true,%L)',id,'Changed definition')) from schedule_change_requests where tanggal='2026-10-04';
update work_shifts set jam_masuk='08:00' where id='94000000-0000-0000-0000-000000000002';
-- Approval rechecks final payroll protection; direct board writes protected too.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"90000000-0000-0000-0000-000000000001"}',true);
select public.hris_request_schedule_change(id,updated_at,'94000000-0000-0000-0000-000000000002','91000000-0000-0000-0000-000000000001','Fiction final lock') from employee_schedules where tanggal='2026-10-05';
reset role;
insert into payrolls(employee_id,periode,status) values('92000000-0000-0000-0000-000000000001','2026-10','final');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"90000000-0000-0000-0000-000000000002"}',true);
set local role authenticated;
select pg_temp.reject(format('select public.hris_decide_schedule_change(%L,true,%L)',id,'Final period')) from schedule_change_requests where tanggal='2026-10-05';
select pg_temp.reject('update employee_schedules set shift_id=''94000000-0000-0000-0000-000000000002'' where tanggal=''2026-10-06''');
reset role;
delete from payrolls;
-- Attendance recorded while approval pending prevents retiming worked history.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"90000000-0000-0000-0000-000000000001"}',true);
set local role authenticated;
select public.hris_request_schedule_change(id,updated_at,'94000000-0000-0000-0000-000000000002','91000000-0000-0000-0000-000000000001','Fiction attendance started') from employee_schedules where tanggal='2026-10-01';
reset role;
insert into attendance(employee_id,tanggal,jam_masuk,checked_in_at,branch_id) values('92000000-0000-0000-0000-000000000001','2026-10-01','08:00','2026-10-01T08:00+07','91000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"90000000-0000-0000-0000-000000000002"}',true);
set local role authenticated;
select pg_temp.reject(format('select public.hris_decide_schedule_change(%L,true,%L)',id,'Attendance started')) from schedule_change_requests where tanggal='2026-10-01';
select public.hris_decide_schedule_change(id,false,'Sudah absen; koreksi lewat HR') from schedule_change_requests where tanggal='2026-10-01';
reset role;
-- If the audit write fails, neither decision nor effective schedule may commit.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"90000000-0000-0000-0000-000000000001"}',true);
set local role authenticated;
select public.hris_request_schedule_change(id,updated_at,'94000000-0000-0000-0000-000000000002','91000000-0000-0000-0000-000000000001','Fiction audit rollback') from employee_schedules where tanggal='2026-10-08';
reset role;
create function pg_temp.fail_schedule_audit() returns trigger language plpgsql as $$ begin if new.new_values->'request'->>'tanggal'='2026-10-08' then raise exception 'JADWAL: Fiction audit unavailable';end if;return new;end $$;
create trigger fiction_audit_failure before insert on schedule_request_events for each row execute function pg_temp.fail_schedule_audit();
select set_config('request.jwt.claims','{"role":"authenticated","sub":"90000000-0000-0000-0000-000000000002"}',true);
set local role authenticated;
select pg_temp.reject(format('select public.hris_decide_schedule_change(%L,true,%L)',id,'Fiction failed audit')) from schedule_change_requests where tanggal='2026-10-08';
select pg_temp.check_it((select r.status='Menunggu' and s.shift_id='94000000-0000-0000-0000-000000000001' from schedule_change_requests r join employee_schedules s on s.id=r.schedule_id where r.tanggal='2026-10-08'),'audit failure rolls back decision and schedule');
reset role;
drop trigger fiction_audit_failure on schedule_request_events;
-- Branch-B staff/shift/request: hidden from branch-A admin, owner can inspect.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"90000000-0000-0000-0000-000000000002"}',true);
insert into auth.users(id) values('90000000-0000-0000-0000-000000000004');
insert into branches(id,code,name,type) values('91000000-0000-0000-0000-000000000002','REQ-B-FIC','Fiction B','KLINIK');
update employees set profile_id='90000000-0000-0000-0000-000000000004',branch_id='91000000-0000-0000-0000-000000000002' where id='92000000-0000-0000-0000-000000000002';
update employee_branch_assignments set branch_id='91000000-0000-0000-0000-000000000002' where employee_id='92000000-0000-0000-0000-000000000002';
insert into user_branches(user_id,branch_id,effective_date) values('90000000-0000-0000-0000-000000000003','91000000-0000-0000-0000-000000000001','2026-01-01');
insert into work_shifts(id,nama,jam_masuk,jam_pulang,branch_id) values('94000000-0000-0000-0000-000000000003','Fiction B early','07:00','15:00','91000000-0000-0000-0000-000000000002'),('94000000-0000-0000-0000-000000000004','Fiction B late','08:00','16:00','91000000-0000-0000-0000-000000000002');
insert into employee_schedules(employee_id,tanggal,shift_id) values('92000000-0000-0000-0000-000000000002','2026-10-02','94000000-0000-0000-0000-000000000003');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"90000000-0000-0000-0000-000000000004"}',true);
set local role authenticated;
select pg_temp.check_it((select count(*)=1 from employee_schedules),'other staff sees only own schedule');
select public.hris_request_schedule_change(id,updated_at,'94000000-0000-0000-0000-000000000004','91000000-0000-0000-0000-000000000002','Fiction B change') from employee_schedules;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"90000000-0000-0000-0000-000000000003"}',true);
select pg_temp.check_it((select count(*)=0 from schedule_change_requests where employee_id='92000000-0000-0000-0000-000000000002'),'foreign branch request hidden');
select public.hris_decide_schedule_change(id,true,'Fiction own-branch ADMIN approval') from schedule_change_requests where tanggal='2026-10-04';
select pg_temp.check_it((select status='Disetujui' and decided_by=auth.uid() from schedule_change_requests where tanggal='2026-10-04'),'positive own-branch ADMIN approval');
reset role;
select pg_temp.reject(format('select public.hris_decide_schedule_change(%L,true,%L)',id,'Foreign admin')) from schedule_change_requests where employee_id='92000000-0000-0000-0000-000000000002';
select pg_temp.reject(format('select public.hris_request_schedule_change(%L,%L,%L,%L,%L)',id,updated_at,'94000000-0000-0000-0000-000000000002','91000000-0000-0000-0000-000000000001','Forged identity')) from employee_schedules where employee_id='92000000-0000-0000-0000-000000000001' and tanggal='2026-10-06';
select set_config('request.jwt.claims','{"role":"authenticated","sub":"90000000-0000-0000-0000-000000000001"}',true);
select pg_temp.reject(format('select public.hris_request_schedule_change(%L,%L,%L,%L,%L)',id,updated_at,'94000000-0000-0000-0000-000000000004','91000000-0000-0000-0000-000000000001','Foreign proposed shift')) from employee_schedules where employee_id='92000000-0000-0000-0000-000000000001' and tanggal='2026-10-06';
-- Deleted/recreated cell cannot satisfy the original schedule identity.
set local role authenticated;
select public.hris_request_schedule_change(id,updated_at,'94000000-0000-0000-0000-000000000002','91000000-0000-0000-0000-000000000001','Fiction replaced cell') from employee_schedules where tanggal='2026-10-07';
select set_config('request.jwt.claims','{"role":"authenticated","sub":"90000000-0000-0000-0000-000000000002"}',true);
delete from employee_schedules where employee_id='92000000-0000-0000-0000-000000000001' and tanggal='2026-10-07';
insert into employee_schedules(employee_id,tanggal,shift_id) values('92000000-0000-0000-0000-000000000001','2026-10-07','94000000-0000-0000-0000-000000000001');
select pg_temp.reject(format('select public.hris_decide_schedule_change(%L,true,%L)',id,'Recreated schedule')) from schedule_change_requests where tanggal='2026-10-07';
reset role;
-- Legacy payroll calculates the whole company: fail closed if scoped RLS would
-- hide some employees' schedules/attendance rather than calculate incomplete pay.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"90000000-0000-0000-0000-000000000003"}',true);
set local role authenticated;
select pg_temp.reject('select public.hris_assert_payroll_scope()','HRIS:%');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"90000000-0000-0000-0000-000000000002"}',true);
select pg_temp.check_it(public.hris_assert_payroll_scope(),'owner can collect complete company payroll');
reset role;
set local role anon;
select pg_temp.forbid('select public.hris_my_schedule(''2026-10-01'',''2026-10-08'')');
rollback;
