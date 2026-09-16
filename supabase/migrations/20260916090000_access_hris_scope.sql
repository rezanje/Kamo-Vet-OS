-- P0: branch-scoped ADMIN, doctor queue scope, and HRIS isolation.

create or replace function public.user_can_access_branch(b uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role in ('OWNER', 'FINANCE')
  ) or exists (
    select 1 from public.user_branches
    where user_id = (select auth.uid()) and branch_id = b
  );
$$;

create or replace function public.current_employee_id()
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
  select e.id
  from public.employees e
  where e.profile_id = (select auth.uid())
  order by e.created_at, e.id
  limit 1;
$$;

revoke all on function public.current_employee_id() from public;
grant execute on function public.current_employee_id() to authenticated;

create or replace function public.user_can_access_visit(p_branch_id uuid, p_doctor_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select public.user_can_access_branch(p_branch_id)
    or exists (
      select 1
      from public.profiles p
      join public.employees e on e.profile_id = p.id
      where p.id = (select auth.uid())
        and p.role = 'DOCTOR'
        and e.id = p_doctor_id
    );
$$;

revoke all on function public.user_can_access_visit(uuid, uuid) from public;
grant execute on function public.user_can_access_visit(uuid, uuid) to authenticated;

drop policy if exists visits_all on public.visits;
drop policy if exists visits_select on public.visits;
drop policy if exists visits_write on public.visits;
create policy visits_select on public.visits for select to authenticated
  using (public.user_can_access_visit(branch_id, doctor_id));
create policy visits_write on public.visits for all to authenticated
  using (public.user_can_access_visit(branch_id, doctor_id))
  with check (public.user_can_access_visit(branch_id, doctor_id));

-- Medical detail follows the same visit gate and cannot re-open another branch.
drop policy if exists mr_all on public.medical_records;
drop policy if exists mr_select on public.medical_records;
drop policy if exists mr_write on public.medical_records;
create policy mr_select on public.medical_records for select to authenticated
  using (exists (
    select 1 from public.visits v
    where v.id = medical_records.visit_id
      and public.user_can_access_visit(v.branch_id, v.doctor_id)
  ));
create policy mr_write on public.medical_records for all to authenticated
  using (exists (
    select 1 from public.visits v
    where v.id = medical_records.visit_id
      and public.user_can_access_visit(v.branch_id, v.doctor_id)
  ))
  with check (exists (
    select 1 from public.visits v
    where v.id = medical_records.visit_id
      and public.user_can_access_visit(v.branch_id, v.doctor_id)
  ));

create or replace function public.user_can_access_employee(p_employee_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role in ('OWNER', 'FINANCE')
  ) or exists (
    select 1 from public.employees e
    where e.id = p_employee_id and e.profile_id = (select auth.uid())
  ) or exists (
    select 1
    from public.employees e
    where e.id = p_employee_id
      and e.branch_id is not null
      and public.user_can_access_branch(e.branch_id)
  ) or exists (
    select 1
    from public.employee_branch_assignments a
    where a.employee_id = p_employee_id
      and public.user_can_access_branch(a.branch_id)
  );
$$;

revoke all on function public.user_can_access_employee(uuid) from public;
grant execute on function public.user_can_access_employee(uuid) to authenticated;

drop policy if exists employees_all on public.employees;
drop policy if exists employees_select on public.employees;
drop policy if exists employees_insert on public.employees;
drop policy if exists employees_update on public.employees;
drop policy if exists employees_delete on public.employees;
create policy employees_select on public.employees for select to authenticated
  using (public.user_can_access_employee(id));
create policy employees_insert on public.employees for insert to authenticated
  with check (
    public.is_admin()
    and (
      public.user_can_access_branch(branch_id)
      or (branch_id is null and exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid()) and p.role = 'OWNER'
      ))
    )
  );
create policy employees_update on public.employees for update to authenticated
  using (public.is_admin() and public.user_can_access_employee(id))
  with check (
    public.is_admin()
    and (
      public.user_can_access_branch(branch_id)
      or (branch_id is null and exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid()) and p.role = 'OWNER'
      ))
    )
  );
create policy employees_delete on public.employees for delete to authenticated
  using (public.is_admin() and public.user_can_access_employee(id));

drop policy if exists attendance_all on public.attendance;
drop policy if exists attendance_select on public.attendance;
drop policy if exists attendance_insert on public.attendance;
drop policy if exists attendance_update on public.attendance;
drop policy if exists attendance_delete on public.attendance;
create policy attendance_select on public.attendance for select to authenticated
  using (public.user_can_access_employee(employee_id));
create policy attendance_insert on public.attendance for insert to authenticated
  with check (public.is_admin() and public.user_can_access_employee(employee_id));
create policy attendance_update on public.attendance for update to authenticated
  using (public.is_admin() and public.user_can_access_employee(employee_id))
  with check (public.is_admin() and public.user_can_access_employee(employee_id));
create policy attendance_delete on public.attendance for delete to authenticated
  using (public.is_admin() and public.user_can_access_employee(employee_id));
