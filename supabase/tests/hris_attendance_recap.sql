\set ON_ERROR_STOP on
\ir hris_attendance_review_setup.sql
set local role authenticated;
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000001',true);
do $$begin begin perform hris_attendance_recap('2026-09-01','2026-09-30',null);exception when others then if sqlerrm like 'HRIS:%' then return;end if;raise;end;raise exception 'FAIL: STAFF read report';end$$;
reset role;
insert into work_shifts(id,nama,jam_masuk,jam_pulang,branch_id)values('94000000-0000-0000-0000-000000000001','Fiction recap night','20:00','08:00','91000000-0000-0000-0000-000000000001');
insert into employee_schedules(employee_id,tanggal,shift_id)select id,'2026-09-30','94000000-0000-0000-0000-000000000001' from employees;
insert into attendance(employee_id,tanggal,jam_masuk,jam_pulang,status,checked_in_at,checked_out_at,branch_id)values('92000000-0000-0000-0000-000000000001','2026-09-30','20:00','08:00','Hadir','2026-09-30T13:00Z','2026-10-01T01:00Z','91000000-0000-0000-0000-000000000001');
insert into leave_requests(employee_id,jenis,tanggal_mulai,status)values('92000000-0000-0000-0000-000000000002','Cuti','2026-09-30','Disetujui');
insert into overtime_requests(employee_id,tanggal,jam,status)values('92000000-0000-0000-0000-000000000001','2026-09-30',1.5,'Disetujui');
set local role authenticated;
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000002',true);
select pg_temp.check_it(jsonb_array_length(hris_attendance_recap('2026-09-01','2026-09-30',null)->'attendance')=1,'explicit entry-date session included');
select pg_temp.check_it(jsonb_array_length(hris_attendance_recap('2026-09-01','2026-09-30',null)->'leave')=1,'approved leave included');
select pg_temp.check_it(not(hris_attendance_recap('2026-09-01','2026-09-30',null)->'employees'->0 ? 'gaji_pokok'),'recap never returns salary');
reset role;
insert into user_branches(user_id,branch_id,effective_date)values('90000000-0000-0000-0000-000000000003','91000000-0000-0000-0000-000000000001','2026-01-01');
set local role authenticated;
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000003',true);
select pg_temp.check_it(jsonb_array_length(hris_attendance_recap('2026-09-01','2026-09-30','91000000-0000-0000-0000-000000000001')->'schedules')=2,'own branch admin recap');
do $$begin begin perform hris_attendance_recap('2026-09-01','2026-09-30','91000000-0000-0000-0000-000000000002');exception when others then if sqlerrm like 'HRIS:%' then return;end if;raise;end;raise exception 'FAIL: foreign branch recap';end$$;
reset role;
insert into branches(id,code,name,type)values('91000000-0000-0000-0000-000000000002','RECAP-FIC-B','Fiction recap B','KLINIK');
update work_shifts set branch_id='91000000-0000-0000-0000-000000000002' where id='94000000-0000-0000-0000-000000000001';
set local role authenticated;
do $$begin begin perform hris_attendance_recap('2026-09-01','2026-09-30','91000000-0000-0000-0000-000000000001');exception when others then if sqlerrm like 'HRIS:%' then return;end if;raise;end;raise exception 'FAIL: hidden history becomes absent';end$$;
reset role;
-- Single JSON result avoids PostgREST's usual 1,000-row relation limit.
insert into employees(id,nama,branch_id)select gen_random_uuid(),'Fiction large recap '||i,'91000000-0000-0000-0000-000000000001' from generate_series(1,1100)i;
set local role authenticated;
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000002',true);
select pg_temp.check_it(jsonb_array_length(hris_attendance_recap('2026-09-01','2026-09-30',null)->'employees')=1102,'all employees retained beyond 1000');
reset role;
set local role anon;
do $$begin begin perform hris_attendance_recap('2026-09-01','2026-09-30',null);exception when insufficient_privilege then return;end;raise exception 'FAIL: anon recap';end$$;
rollback;
