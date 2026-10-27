-- HRIS pilot access (20261027030000). Fictional fixtures only.
-- Run against a disposable database that has every repository migration applied EXCEPT
-- 20261027030000_hris_pilot_access.sql (scripts/test-hris-pilot-access-postgres.py does this).
\set ON_ERROR_STOP on

-- ------------------------------------------------------------ fixtures (pre-migration)
insert into auth.users(id) values
  ('a0000000-0000-4000-8000-000000000001'), ('a0000000-0000-4000-8000-000000000002'),
  ('a0000000-0000-4000-8000-000000000003'), ('a0000000-0000-4000-8000-000000000004'),
  ('a0000000-0000-4000-8000-000000000005'), ('a0000000-0000-4000-8000-000000000006');
insert into public.profiles(id, full_name, role, is_active) values
  ('a0000000-0000-4000-8000-000000000001', 'Fiksi Owner',   'OWNER',   true),
  ('a0000000-0000-4000-8000-000000000002', 'Fiksi Admin',   'ADMIN',   true),
  ('a0000000-0000-4000-8000-000000000003', 'Fiksi Finance', 'FINANCE', true),
  ('a0000000-0000-4000-8000-000000000004', 'Fiksi Staf',    'STAFF',   true),
  ('a0000000-0000-4000-8000-000000000005', 'Fiksi Dokter',  'DOCTOR',  true),
  ('a0000000-0000-4000-8000-000000000006', 'Fiksi Staf B2', 'STAFF',   true)
on conflict (id) do update set role = excluded.role, full_name = excluded.full_name, is_active = true;
insert into public.branches(id, code, name, type) values
  ('b0000000-0000-4000-8000-000000000001', 'TST_B1', 'Cabang Fiksi 1', 'KLINIK'),
  ('b0000000-0000-4000-8000-000000000002', 'TST_B2', 'Cabang Fiksi 2', 'KLINIK');
insert into public.user_branches(user_id, branch_id) values
  ('a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000002'),
  ('a0000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000002');
insert into public.employees(id, nama, branch_id, profile_id, gaji_pokok, status) values
  ('e0000000-0000-4000-8000-000000000001', 'Staf Fiksi',   'b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000004', 3000000, 'Aktif'),
  ('e0000000-0000-4000-8000-000000000002', 'Dokter Fiksi', 'b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000005', 7000000, 'Aktif'),
  ('e0000000-0000-4000-8000-000000000003', 'Tanpa Cabang', null, null, 0, 'Aktif'),
  ('e0000000-0000-4000-8000-000000000004', 'Staf B2',      'b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000006', 2500000, 'Aktif');
insert into public.payrolls(periode, employee_id, gaji_pokok, total) values
  ('2026-09', 'e0000000-0000-4000-8000-000000000001', 3000000, 3000000),
  ('2026-09', 'e0000000-0000-4000-8000-000000000002', 7000000, 7000000);
insert into public.cash_advances(id, employee_id, jumlah, status) values
  ('c0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 100000, 'Menunggu'),
  ('c0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000002', 200000, 'Menunggu');
insert into public.reimbursements(employee_id, tanggal, kategori, jumlah, status)
select 'e0000000-0000-4000-8000-000000000002', current_date, 'Lainnya', 50000, 'Menunggu'
where exists (select 1 from information_schema.columns where table_name = 'reimbursements' and column_name = 'kategori');
insert into public.attendance(employee_id, tanggal, status) values
  ('e0000000-0000-4000-8000-000000000001', '2026-10-01', 'Hadir'),
  ('e0000000-0000-4000-8000-000000000002', '2026-10-01', 'Hadir');
insert into public.work_shifts(id, nama, branch_id, jam_masuk, jam_pulang) values
  ('f0000000-0000-4000-8000-000000000001', 'Pagi B1', 'b0000000-0000-4000-8000-000000000001', '08:00', '16:00'),
  ('f0000000-0000-4000-8000-000000000002', 'Pagi B2', 'b0000000-0000-4000-8000-000000000002', '08:00', '16:00');
insert into public.employee_schedules(employee_id, tanggal, shift_id) values
  ('e0000000-0000-4000-8000-000000000002', '2026-10-02', 'f0000000-0000-4000-8000-000000000002');
insert into public.cashier_shifts(id, branch_id, opened_by, status, closed_at, selisih) values
  ('d0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000004', 'closed', now(), -5000),
  ('d0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000004', 'closed', now(), 0),
  ('d0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000004', 'closed', now() - interval '2 hours', -7000);

-- Proof of the old exposure: a STAFF account can read every salary before the migration.
set role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000004', false);
do $$ begin
  assert (select count(*) from public.employees where gaji_pokok > 0 and id::text like 'e0000000%') = 3,
    'pre: staff reads three salaries (old exposure)';
end $$;
reset role;

-- ------------------------------------------------------------ migration
\ir ../migrations/20261027030000_hris_pilot_access.sql

do $$ begin
  assert (select count(*) from public.employees where gaji_pokok <> 0) = 0, 'salary column emptied';
  assert (select gaji_pokok from public.employee_base_salaries where employee_id = 'e0000000-0000-4000-8000-000000000002') = 7000000, 'salary moved';
  assert (select count(*) from public.employee_base_salaries where employee_id::text like 'e0000000%') = 3, 'three salaries moved';
end $$;
do $$ begin
  begin
    update public.employees set gaji_pokok = 1 where id = 'e0000000-0000-4000-8000-000000000001';
    raise exception 'salary column must stay 0';
  exception when check_violation then null;
  end;
end $$;

create or replace function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, false);
$$;

-- ------------------------------------------------------------ STAFF
set role authenticated;
select pg_temp.as_user('a0000000-0000-4000-8000-000000000004');
do $$ declare n int; begin
  assert (select count(*) from public.employees where id::text like 'e0000000%') = 4, 'staff: directory visible';
  assert (select count(*) from public.employee_base_salaries) = 0, 'staff: no salaries';
  assert (select count(*) from public.payrolls) = 0, 'staff: no payroll';
  assert (select count(*) from public.cash_advances) = 1, 'staff: own kasbon only';
  assert (select count(*) from public.reimbursements) = 0, 'staff: no other reimburse';
  assert (select count(*) from public.attendance) = 1, 'staff: own attendance only';
  assert (select count(*) from public.work_shifts where id::text like 'f0000000%') = 2, 'staff: shifts visible';
  assert (select count(*) from public.employee_schedules) = 1, 'staff: schedules visible (clinic doctor roster)';

  update public.employees set nama = 'X' where id = 'e0000000-0000-4000-8000-000000000002';
  get diagnostics n = row_count; assert n = 0, 'staff: cannot edit employees';
  update public.cash_advances set status = 'Disetujui' where id = 'c0000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count; assert n = 0, 'staff: cannot approve own kasbon';

  insert into public.cash_advances(employee_id, jumlah, status) values ('e0000000-0000-4000-8000-000000000001', 1000, 'Menunggu');
  insert into public.attendance(employee_id, tanggal, status) values ('e0000000-0000-4000-8000-000000000001', '2026-10-02', 'Hadir');
  insert into public.leave_requests(employee_id, jenis, tanggal_mulai, status) values ('e0000000-0000-4000-8000-000000000001', 'Cuti', '2026-11-01', 'Menunggu');

  begin insert into public.cash_advances(employee_id, jumlah, status) values ('e0000000-0000-4000-8000-000000000002', 1000, 'Menunggu');
    raise exception 'staff: kasbon for someone else must fail'; exception when insufficient_privilege then null; end;
  begin insert into public.cash_advances(employee_id, jumlah, status) values ('e0000000-0000-4000-8000-000000000001', 1000, 'Disetujui');
    raise exception 'staff: pre-approved kasbon must fail'; exception when insufficient_privilege then null; end;
  begin insert into public.attendance(employee_id, tanggal, status) values ('e0000000-0000-4000-8000-000000000002', '2026-10-03', 'Hadir');
    raise exception 'staff: attendance for someone else must fail'; exception when insufficient_privilege then null; end;
  begin insert into public.payrolls(periode, employee_id) values ('2026-10', 'e0000000-0000-4000-8000-000000000001');
    raise exception 'staff: payroll insert must fail'; exception when insufficient_privilege then null; end;
  begin insert into public.employee_base_salaries(employee_id, gaji_pokok) values ('e0000000-0000-4000-8000-000000000003', 1);
    raise exception 'staff: salary insert must fail'; exception when insufficient_privilege then null; end;
  begin insert into public.commission_rules(nama) values ('x');
    raise exception 'staff: commission rule insert must fail'; exception when insufficient_privilege or not_null_violation then null; end;
end $$;

-- Shift shortage kasbon through the guarded function.
do $$ declare r record; begin
  select * into r from public.record_shift_cash_shortage('d0000000-0000-4000-8000-000000000001');
  assert r.employee_id = 'e0000000-0000-4000-8000-000000000001', 'shortage: charged to shift opener';
  assert (select jumlah from public.cash_advances where id = r.advance_id) = 5000, 'shortage: amount from shift';
  begin perform public.record_shift_cash_shortage('d0000000-0000-4000-8000-000000000001');
    raise exception 'shortage: duplicate must fail'; exception when raise_exception then
      if sqlerrm not like 'HRIS_SHORTAGE_DUPLICATE%' then raise; end if; end;
  begin perform public.record_shift_cash_shortage('d0000000-0000-4000-8000-000000000002');
    raise exception 'shortage: zero variance must fail'; exception when raise_exception then
      if sqlerrm not like 'HRIS_SHORTAGE_NOT_ELIGIBLE%' then raise; end if; end;
  begin perform public.record_shift_cash_shortage('d0000000-0000-4000-8000-000000000003');
    raise exception 'shortage: stale shift must fail'; exception when raise_exception then
      if sqlerrm not like 'HRIS_SHORTAGE_NOT_ELIGIBLE%' then raise; end if; end;
  perform public.cancel_shift_cash_shortage('d0000000-0000-4000-8000-000000000001');
  assert not exists (select 1 from public.cash_advances where id = r.advance_id), 'shortage: cancel removes kasbon';
end $$;

-- A STAFF from another branch cannot touch this shift.
select pg_temp.as_user('a0000000-0000-4000-8000-000000000006');
do $$ begin
  begin perform public.record_shift_cash_shortage('d0000000-0000-4000-8000-000000000001');
    raise exception 'shortage: other branch must fail'; exception when raise_exception then
      if sqlerrm not like 'HRIS_SHORTAGE_BRANCH_DENIED%' then raise; end if; end;
end $$;

-- ------------------------------------------------------------ DOCTOR
select pg_temp.as_user('a0000000-0000-4000-8000-000000000005');
do $$ begin
  assert (select count(*) from public.employee_base_salaries) = 0, 'doctor: no salaries';
  assert (select count(*) from public.payrolls) = 0, 'doctor: no payroll (laporan gaji empty)';
  assert (select count(*) from public.cash_advances) = 1, 'doctor: own kasbon only';
  assert (select count(*) from public.attendance) = 1, 'doctor: own attendance only';
  assert (select count(*) from public.employees where id::text like 'e0000000%') = 4, 'doctor: directory visible';
end $$;

-- ------------------------------------------------------------ FINANCE
select pg_temp.as_user('a0000000-0000-4000-8000-000000000003');
do $$ declare n int; begin
  assert (select count(*) from public.employee_base_salaries where employee_id::text like 'e0000000%') = 3, 'finance: reads salaries';
  assert (select count(*) from public.payrolls) = 2, 'finance: reads payroll';
  assert (select count(*) from public.cash_advances where employee_id::text like 'e0000000%') >= 2, 'finance: reads kasbon';
  assert (select count(*) from public.attendance) >= 3, 'finance: reads attendance';
  update public.payrolls set total = 1; get diagnostics n = row_count; assert n = 0, 'finance: cannot edit payroll';
  update public.employee_base_salaries set gaji_pokok = 1; get diagnostics n = row_count; assert n = 0, 'finance: cannot edit salary';
  update public.employees set nama = 'X' where id = 'e0000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count; assert n = 0, 'finance: cannot edit employees';
end $$;

-- ------------------------------------------------------------ ADMIN (default: all branches)
select pg_temp.as_user('a0000000-0000-4000-8000-000000000002');
do $$ declare n int; begin
  assert (select count(*) from public.employee_base_salaries) = 0, 'admin: no salaries';
  assert (select count(*) from public.payrolls) = 0, 'admin: no payroll';
  assert (select count(*) from public.cash_advances) = 0, 'admin: no kasbon';
  assert (select count(*) from public.reimbursements) = 0, 'admin: no reimburse';
  assert (select count(*) from public.attendance) >= 3, 'admin: manages attendance';
  assert (select count(*) from public.payroll_settings) = (select count(*) from public.payroll_settings), 'admin: payroll settings readable';
  insert into public.attendance(employee_id, tanggal, status) values ('e0000000-0000-4000-8000-000000000002', '2026-10-05', 'Izin');
  update public.employees set jabatan = 'Dokter Hewan' where id = 'e0000000-0000-4000-8000-000000000002';
  get diagnostics n = row_count; assert n = 1, 'admin: edits employee';
  insert into public.employee_schedules(employee_id, tanggal, shift_id)
  values ('e0000000-0000-4000-8000-000000000002', '2026-10-06', 'f0000000-0000-4000-8000-000000000002');
  begin insert into public.employee_base_salaries(employee_id, gaji_pokok) values ('e0000000-0000-4000-8000-000000000003', 1);
    raise exception 'admin: salary insert must fail'; exception when insufficient_privilege then null; end;
  update public.payroll_settings set id = id; get diagnostics n = row_count; assert n = 0, 'admin: cannot change payroll settings';
end $$;
reset role;

-- ADMIN limited to own branch when the all-branches capability is switched off.
insert into public.role_capabilities(role, all_branches, create_accounts) values ('ADMIN', false, true)
on conflict (role) do update set all_branches = false;
set role authenticated;
select pg_temp.as_user('a0000000-0000-4000-8000-000000000002');
do $$ declare n int; begin
  assert not exists (select 1 from public.attendance where employee_id = 'e0000000-0000-4000-8000-000000000002'),
    'scoped admin: other-branch attendance hidden';
  assert exists (select 1 from public.attendance where employee_id = 'e0000000-0000-4000-8000-000000000001'),
    'scoped admin: own-branch attendance visible';
  begin insert into public.attendance(employee_id, tanggal, status) values ('e0000000-0000-4000-8000-000000000004', '2026-10-07', 'Izin');
    raise exception 'scoped admin: other-branch write must fail'; exception when insufficient_privilege then null; end;
  insert into public.attendance(employee_id, tanggal, status) values ('e0000000-0000-4000-8000-000000000003', '2026-10-07', 'Izin');
  update public.employees set jabatan = 'X' where id = 'e0000000-0000-4000-8000-000000000004';
  get diagnostics n = row_count; assert n = 0, 'scoped admin: cannot edit other-branch employee';
end $$;
reset role;
delete from public.role_capabilities where role = 'ADMIN';

-- ------------------------------------------------------------ OWNER
set role authenticated;
select pg_temp.as_user('a0000000-0000-4000-8000-000000000001');
do $$ declare n int; begin
  assert (select count(*) from public.employee_base_salaries where employee_id::text like 'e0000000%') = 3, 'owner: reads salaries';
  insert into public.employee_base_salaries(employee_id, gaji_pokok) values ('e0000000-0000-4000-8000-000000000003', 4000000);
  update public.payrolls set status = 'final' where periode = '2026-09'; get diagnostics n = row_count; assert n = 2, 'owner: edits payroll';
  update public.cash_advances set status = 'Ditolak' where id = 'c0000000-0000-4000-8000-000000000002';
  get diagnostics n = row_count; assert n = 1, 'owner: decides kasbon';
end $$;
reset role;

-- ------------------------------------------------------------ anon
set role anon;
do $$ begin
  begin perform 1 from public.employee_base_salaries limit 1;
    if exists (select 1 from public.employee_base_salaries) then raise exception 'anon: salaries readable'; end if;
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select 'HRIS pilot access: all assertions passed' as result;
