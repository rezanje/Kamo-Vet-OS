-- PRD §11.1: satu karyawan, terutama dokter floating, bisa ditugaskan ke
-- beberapa cabang.

create table if not exists employee_branch_assignments (
  employee_id uuid not null references employees(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete cascade,
  role branch_assignment_role not null default 'SECONDARY',
  effective_date date not null default current_date,
  created_at timestamptz not null default now(),
  primary key (employee_id, branch_id)
);

create unique index if not exists employee_one_primary_branch
  on employee_branch_assignments(employee_id) where role = 'PRIMARY';

insert into employee_branch_assignments (employee_id, branch_id, role)
select id, branch_id, 'PRIMARY'::branch_assignment_role
from employees
where branch_id is not null
on conflict (employee_id, branch_id) do nothing;

create index if not exists employee_branch_assignments_branch_idx
  on employee_branch_assignments(branch_id);

alter table employee_branch_assignments enable row level security;
drop policy if exists employee_branch_assignments_select on employee_branch_assignments;
drop policy if exists employee_branch_assignments_write on employee_branch_assignments;
create policy employee_branch_assignments_select on employee_branch_assignments
  for select to authenticated using (public.user_can_access_branch(branch_id));
create policy employee_branch_assignments_write on employee_branch_assignments
  for all to authenticated
  using (public.user_can_access_branch(branch_id) and exists (select 1 from profiles where id = auth.uid() and role in ('OWNER', 'ADMIN')))
  with check (public.user_can_access_branch(branch_id) and exists (select 1 from profiles where id = auth.uid() and role in ('OWNER', 'ADMIN')));
