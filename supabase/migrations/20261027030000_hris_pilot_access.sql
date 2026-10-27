-- HRIS pilot: batasi data karyawan, absensi, pengajuan, dan payroll per peran/cabang.
-- Fungsi internal sengaja ditempatkan di schema private agar tidak menjadi endpoint Data API.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.is_hris_owner()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'OWNER'
  );
$$;

create or replace function private.can_manage_hris_branch(target_branch uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select private.is_hris_owner()
    or exists (
      select 1
      from public.profiles p
      join public.user_branches ub on ub.user_id = p.id
      where p.id = (select auth.uid())
        and p.role = 'ADMIN'
        and ub.branch_id = target_branch
    );
$$;

create or replace function private.is_own_employee(target_employee uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.employees e
    join public.profiles p on p.id = e.profile_id
    where e.id = target_employee
      and e.profile_id = (select auth.uid())
      and p.role in ('STAFF', 'DOCTOR')
  );
$$;

create or replace function private.can_manage_hris_employee(target_employee uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select private.is_hris_owner()
    or exists (
      select 1
      from public.employees e
      where e.id = target_employee
        and e.branch_id is not null
        and private.can_manage_hris_branch(e.branch_id)
    );
$$;

create or replace function private.can_read_hris_employee(target_employee uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select private.is_own_employee(target_employee)
    or private.can_manage_hris_employee(target_employee);
$$;

create or replace function private.can_read_hris_shift(target_branch uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select private.can_manage_hris_branch(target_branch)
    or exists (
      select 1
      from public.employees e
      join public.profiles p on p.id = e.profile_id
      where e.profile_id = (select auth.uid())
        and p.role in ('STAFF', 'DOCTOR')
        and (target_branch is null or e.branch_id = target_branch)
    );
$$;

create or replace function private.can_manage_hris_schedule(target_employee uuid, target_shift uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select private.is_hris_owner()
    or exists (
      select 1
      from public.employees e
      join public.work_shifts ws on ws.id = target_shift
      where e.id = target_employee
        and private.can_manage_hris_employee(e.id)
        and (ws.branch_id is null or ws.branch_id = e.branch_id)
    );
$$;

revoke all on function private.is_hris_owner() from public, anon;
revoke all on function private.can_manage_hris_branch(uuid) from public, anon;
revoke all on function private.is_own_employee(uuid) from public, anon;
revoke all on function private.can_manage_hris_employee(uuid) from public, anon;
revoke all on function private.can_read_hris_employee(uuid) from public, anon;
revoke all on function private.can_read_hris_shift(uuid) from public, anon;
revoke all on function private.can_manage_hris_schedule(uuid, uuid) from public, anon;
grant execute on function private.is_hris_owner() to authenticated;
grant execute on function private.can_manage_hris_branch(uuid) to authenticated;
grant execute on function private.is_own_employee(uuid) to authenticated;
grant execute on function private.can_manage_hris_employee(uuid) to authenticated;
grant execute on function private.can_read_hris_employee(uuid) to authenticated;
grant execute on function private.can_read_hris_shift(uuid) to authenticated;
grant execute on function private.can_manage_hris_schedule(uuid, uuid) to authenticated;

drop policy if exists employees_all on public.employees;
drop policy if exists attendance_all on public.attendance;
drop policy if exists leave_all on public.leave_requests;
drop policy if exists payrolls_all on public.payrolls;
drop policy if exists work_shifts_all on public.work_shifts;
drop policy if exists employee_schedules_all on public.employee_schedules;
drop policy if exists salary_components_all on public.salary_components;
drop policy if exists emp_salary_components_all on public.employee_salary_components;
drop policy if exists payroll_settings_all on public.payroll_settings;
drop policy if exists overtime_requests_all on public.overtime_requests;
drop policy if exists cash_advances_all on public.cash_advances;
drop policy if exists cash_advance_inst_all on public.cash_advance_installments;
drop policy if exists reimbursements_all on public.reimbursements;
drop policy if exists kpi_all on public.kpi_records;
drop policy if exists commission_rules_all on public.commission_rules;
drop policy if exists sales_targets_all on public.sales_targets;

create policy employees_owner_all on public.employees
  for all to authenticated
  using ((select private.is_hris_owner()))
  with check ((select private.is_hris_owner()));
create policy employees_select_self on public.employees
  for select to authenticated
  using ((select private.is_own_employee(id)));
create policy employees_select_manager on public.employees
  for select to authenticated
  using ((select private.can_manage_hris_employee(id)));
create policy employees_insert_manager on public.employees
  for insert to authenticated
  with check ((select private.can_manage_hris_branch(branch_id)));
create policy employees_update_manager on public.employees
  for update to authenticated
  using ((select private.can_manage_hris_employee(id)))
  with check ((select private.can_manage_hris_branch(branch_id)));

create policy attendance_owner_all on public.attendance
  for all to authenticated
  using ((select private.is_hris_owner()))
  with check ((select private.is_hris_owner()));
create policy attendance_select_self on public.attendance
  for select to authenticated
  using ((select private.is_own_employee(employee_id)));
create policy attendance_select_manager on public.attendance
  for select to authenticated
  using ((select private.can_manage_hris_employee(employee_id)));
create policy attendance_insert_self on public.attendance
  for insert to authenticated
  with check ((select private.is_own_employee(employee_id)) and status = 'Hadir');
create policy attendance_insert_manager on public.attendance
  for insert to authenticated
  with check ((select private.can_manage_hris_employee(employee_id)));
create policy attendance_update_self on public.attendance
  for update to authenticated
  using ((select private.is_own_employee(employee_id)))
  with check ((select private.is_own_employee(employee_id)) and status = 'Hadir');
create policy attendance_update_manager on public.attendance
  for update to authenticated
  using ((select private.can_manage_hris_employee(employee_id)))
  with check ((select private.can_manage_hris_employee(employee_id)));
create policy attendance_delete_manager on public.attendance
  for delete to authenticated
  using ((select private.can_manage_hris_employee(employee_id)));

create policy leave_requests_owner_all on public.leave_requests
  for all to authenticated
  using ((select private.is_hris_owner()))
  with check ((select private.is_hris_owner()));
create policy leave_requests_select_self on public.leave_requests
  for select to authenticated
  using ((select private.is_own_employee(employee_id)));
create policy leave_requests_select_manager on public.leave_requests
  for select to authenticated
  using ((select private.can_manage_hris_employee(employee_id)));
create policy leave_requests_insert_self on public.leave_requests
  for insert to authenticated
  with check (
    (select private.is_own_employee(employee_id))
    and status = 'Menunggu'
  );
create policy leave_requests_insert_manager on public.leave_requests
  for insert to authenticated
  with check (
    (select private.can_manage_hris_employee(employee_id))
    and status = 'Menunggu'
  );
create policy leave_requests_update_manager on public.leave_requests
  for update to authenticated
  using ((select private.can_manage_hris_employee(employee_id)))
  with check ((select private.can_manage_hris_employee(employee_id)));

create policy overtime_requests_owner_all on public.overtime_requests
  for all to authenticated
  using ((select private.is_hris_owner()))
  with check ((select private.is_hris_owner()));
create policy overtime_requests_select_self on public.overtime_requests
  for select to authenticated
  using ((select private.is_own_employee(employee_id)));
create policy overtime_requests_select_manager on public.overtime_requests
  for select to authenticated
  using ((select private.can_manage_hris_employee(employee_id)));
create policy overtime_requests_insert_self on public.overtime_requests
  for insert to authenticated
  with check (
    (select private.is_own_employee(employee_id))
    and status = 'Menunggu'
    and approved_by is null
    and approved_at is null
  );
create policy overtime_requests_update_manager on public.overtime_requests
  for update to authenticated
  using ((select private.can_manage_hris_employee(employee_id)))
  with check ((select private.can_manage_hris_employee(employee_id)));

create policy cash_advances_owner_all on public.cash_advances
  for all to authenticated
  using ((select private.is_hris_owner()))
  with check ((select private.is_hris_owner()));
create policy cash_advances_select_self on public.cash_advances
  for select to authenticated
  using ((select private.is_own_employee(employee_id)));
create policy cash_advances_select_manager on public.cash_advances
  for select to authenticated
  using ((select private.can_manage_hris_employee(employee_id)));
create policy cash_advances_insert_self on public.cash_advances
  for insert to authenticated
  with check (
    (select private.is_own_employee(employee_id))
    and status = 'Menunggu'
    and approved_by is null
    and approved_at is null
    and disbursed_at is null
    and cash_account_id is null
  );
create policy cash_advances_update_manager on public.cash_advances
  for update to authenticated
  using ((select private.can_manage_hris_employee(employee_id)))
  with check ((select private.can_manage_hris_employee(employee_id)));

create policy reimbursements_owner_all on public.reimbursements
  for all to authenticated
  using ((select private.is_hris_owner()))
  with check ((select private.is_hris_owner()));
create policy reimbursements_select_self on public.reimbursements
  for select to authenticated
  using ((select private.is_own_employee(employee_id)));
create policy reimbursements_select_manager on public.reimbursements
  for select to authenticated
  using ((select private.can_manage_hris_employee(employee_id)));
create policy reimbursements_insert_self on public.reimbursements
  for insert to authenticated
  with check (
    (select private.is_own_employee(employee_id))
    and status = 'Menunggu'
    and approved_by is null
    and approved_at is null
    and paid_periode is null
  );
create policy reimbursements_update_manager on public.reimbursements
  for update to authenticated
  using ((select private.can_manage_hris_employee(employee_id)))
  with check ((select private.can_manage_hris_employee(employee_id)));

create policy employee_schedules_owner_all on public.employee_schedules
  for all to authenticated
  using ((select private.is_hris_owner()))
  with check ((select private.is_hris_owner()));
create policy employee_schedules_select_self on public.employee_schedules
  for select to authenticated
  using ((select private.is_own_employee(employee_id)));
create policy employee_schedules_select_manager on public.employee_schedules
  for select to authenticated
  using ((select private.can_manage_hris_employee(employee_id)));
create policy employee_schedules_insert_manager on public.employee_schedules
  for insert to authenticated
  with check ((select private.can_manage_hris_schedule(employee_id, shift_id)));
create policy employee_schedules_update_manager on public.employee_schedules
  for update to authenticated
  using ((select private.can_manage_hris_schedule(employee_id, shift_id)))
  with check ((select private.can_manage_hris_schedule(employee_id, shift_id)));
create policy employee_schedules_delete_manager on public.employee_schedules
  for delete to authenticated
  using ((select private.can_manage_hris_schedule(employee_id, shift_id)));

create policy kpi_records_owner_all on public.kpi_records
  for all to authenticated
  using ((select private.is_hris_owner()))
  with check ((select private.is_hris_owner()));
create policy kpi_records_select_self on public.kpi_records
  for select to authenticated
  using ((select private.is_own_employee(employee_id)));
create policy kpi_records_select_manager on public.kpi_records
  for select to authenticated
  using ((select private.can_manage_hris_employee(employee_id)));
create policy kpi_records_insert_manager on public.kpi_records
  for insert to authenticated
  with check ((select private.can_manage_hris_employee(employee_id)));
create policy kpi_records_update_manager on public.kpi_records
  for update to authenticated
  using ((select private.can_manage_hris_employee(employee_id)))
  with check ((select private.can_manage_hris_employee(employee_id)));
create policy kpi_records_delete_manager on public.kpi_records
  for delete to authenticated
  using ((select private.can_manage_hris_employee(employee_id)));

create policy work_shifts_owner_all on public.work_shifts
  for all to authenticated
  using ((select private.is_hris_owner()))
  with check ((select private.is_hris_owner()));
create policy work_shifts_select_pilot on public.work_shifts
  for select to authenticated
  using ((select private.can_read_hris_shift(branch_id)));
create policy work_shifts_insert_manager on public.work_shifts
  for insert to authenticated
  with check ((select private.can_manage_hris_branch(branch_id)));
create policy work_shifts_update_manager on public.work_shifts
  for update to authenticated
  using ((select private.can_manage_hris_branch(branch_id)))
  with check ((select private.can_manage_hris_branch(branch_id)));
create policy work_shifts_delete_manager on public.work_shifts
  for delete to authenticated
  using ((select private.can_manage_hris_branch(branch_id)));

create policy payrolls_owner_all on public.payrolls
  for all to authenticated
  using ((select private.is_hris_owner()))
  with check ((select private.is_hris_owner()));
create policy salary_components_owner_all on public.salary_components
  for all to authenticated
  using ((select private.is_hris_owner()))
  with check ((select private.is_hris_owner()));
create policy employee_salary_components_owner_all on public.employee_salary_components
  for all to authenticated
  using ((select private.is_hris_owner()))
  with check ((select private.is_hris_owner()));
create policy payroll_settings_owner_all on public.payroll_settings
  for all to authenticated
  using ((select private.is_hris_owner()))
  with check ((select private.is_hris_owner()));
create policy cash_advance_installments_owner_all on public.cash_advance_installments
  for all to authenticated
  using ((select private.is_hris_owner()))
  with check ((select private.is_hris_owner()));
create policy commission_rules_owner_all on public.commission_rules
  for all to authenticated
  using ((select private.is_hris_owner()))
  with check ((select private.is_hris_owner()));
create policy sales_targets_owner_all on public.sales_targets
  for all to authenticated
  using ((select private.is_hris_owner()))
  with check ((select private.is_hris_owner()));
