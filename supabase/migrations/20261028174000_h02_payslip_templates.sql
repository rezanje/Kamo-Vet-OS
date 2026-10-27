-- H02: payslip templates per employee group (e.g. groomer, senior doctor).
-- A template lists salary components with optional template amounts/rates. Each employee
-- is linked to at most one template. Per-employee exceptions stay in
-- employee_salary_components (explicit row on the same component), and every link or
-- exception change is written to an append-only history with who/when/why.
-- No template, component or amount is seeded. Access mirrors 20261027030000:
-- OWNER manages pay configuration, FINANCE reads it, nobody else sees it.

create table if not exists public.payslip_templates (
  id uuid primary key default gen_random_uuid(),
  kode varchar(40) not null unique check (kode ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
  nama varchar(80) not null check (length(btrim(nama)) > 0),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table if not exists public.payslip_template_components (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.payslip_templates(id) on delete cascade,
  component_id uuid not null references public.salary_components(id) on delete restrict,
  -- Null = follow the component master. Fixed components use nominal, turnover components rate.
  nominal numeric(15,2) check (nominal is null or nominal >= 0),
  rate_percent numeric(8,4) check (rate_percent is null or (rate_percent > 0 and rate_percent <= 100)),
  created_at timestamptz not null default now(),
  unique (template_id, component_id)
);
create index if not exists payslip_template_components_component_idx on public.payslip_template_components(component_id);

create table if not exists public.employee_payslip_templates (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null unique references public.employees(id) on delete cascade,
  template_id uuid not null references public.payslip_templates(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create index if not exists employee_payslip_templates_template_idx on public.employee_payslip_templates(template_id);

alter table public.employee_salary_components
  add column if not exists override_reason text;
comment on column public.employee_salary_components.override_reason is
  'H02: alasan pengecualian bila komponen ini menimpa nilai dari template karyawan.';

create table if not exists public.payslip_override_history (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  action text not null check (action in ('template_set', 'template_removed', 'component_set', 'component_removed')),
  template_id uuid,
  component_id uuid,
  old_value jsonb,
  new_value jsonb,
  reason text,
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default now()
);
create index if not exists payslip_override_history_employee_idx on public.payslip_override_history(employee_id, changed_at desc);

create or replace function public.record_payslip_override_history() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'employee_payslip_templates' then
    if tg_op = 'DELETE' then
      insert into public.payslip_override_history(employee_id, action, template_id, old_value)
      values (old.employee_id, 'template_removed', old.template_id, jsonb_build_object('template_id', old.template_id));
      return old;
    end if;
    if tg_op = 'UPDATE' and new.template_id is not distinct from old.template_id then return new; end if;
    insert into public.payslip_override_history(employee_id, action, template_id, old_value, new_value)
    values (new.employee_id, 'template_set', new.template_id,
      case when tg_op = 'UPDATE' then jsonb_build_object('template_id', old.template_id) end,
      jsonb_build_object('template_id', new.template_id));
    return new;
  end if;
  -- employee_salary_components
  if tg_op = 'DELETE' then
    insert into public.payslip_override_history(employee_id, action, component_id, old_value, reason)
    values (old.employee_id, 'component_removed', old.component_id,
      jsonb_build_object('nominal', old.nominal, 'rate_percent_override', to_jsonb(old) -> 'rate_percent_override'), old.override_reason);
    return old;
  end if;
  if tg_op = 'UPDATE' and new.nominal is not distinct from old.nominal
    and (to_jsonb(new) -> 'rate_percent_override') is not distinct from (to_jsonb(old) -> 'rate_percent_override')
    and new.override_reason is not distinct from old.override_reason then
    return new;
  end if;
  insert into public.payslip_override_history(employee_id, action, component_id, old_value, new_value, reason)
  values (new.employee_id, 'component_set', new.component_id,
    case when tg_op = 'UPDATE' then jsonb_build_object('nominal', old.nominal, 'rate_percent_override', to_jsonb(old) -> 'rate_percent_override') end,
    jsonb_build_object('nominal', new.nominal, 'rate_percent_override', to_jsonb(new) -> 'rate_percent_override'),
    new.override_reason);
  return new;
end $$;
revoke all on function public.record_payslip_override_history() from public, anon, authenticated, service_role;
drop trigger if exists h02_payslip_history on public.employee_payslip_templates;
create trigger h02_payslip_history after insert or update or delete on public.employee_payslip_templates
  for each row execute function public.record_payslip_override_history();
drop trigger if exists h02_payslip_history on public.employee_salary_components;
create trigger h02_payslip_history after insert or update or delete on public.employee_salary_components
  for each row execute function public.record_payslip_override_history();

alter table public.payslip_templates enable row level security;
alter table public.payslip_template_components enable row level security;
alter table public.employee_payslip_templates enable row level security;
alter table public.payslip_override_history enable row level security;
revoke all on public.payslip_templates, public.payslip_template_components,
  public.employee_payslip_templates, public.payslip_override_history from anon;
grant select, insert, update, delete on public.payslip_templates, public.payslip_template_components,
  public.employee_payslip_templates to authenticated;
revoke all on public.payslip_override_history from authenticated;
grant select on public.payslip_override_history to authenticated;

do $$
declare t text;
begin
  foreach t in array array['payslip_templates', 'payslip_template_components', 'employee_payslip_templates'] loop
    execute format('drop policy if exists %I on public.%I', t || '_owner_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_finance', t);
    execute format('create policy %I on public.%I for all to authenticated using ((select private.is_hris_owner())) with check ((select private.is_hris_owner()))', t || '_owner_all', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select private.can_read_hris_money()))', t || '_select_finance', t);
  end loop;
end $$;
-- History is written only by the trigger above; OWNER/FINANCE read it.
drop policy if exists payslip_override_history_select on public.payslip_override_history;
create policy payslip_override_history_select on public.payslip_override_history
  for select to authenticated using ((select private.can_read_hris_money()));
