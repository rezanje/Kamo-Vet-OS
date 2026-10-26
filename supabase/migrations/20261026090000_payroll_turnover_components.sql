-- Configurable turnover components; existing fixed components retain their behavior.
-- This migration changes calculation metadata only and does not alter access policies.
alter table public.salary_components
  add column calculation_basis text not null default 'fixed'
    check (calculation_basis in ('fixed', 'net_turnover')),
  add column sales_source text not null default 'semua'
    check (sales_source in ('semua', 'kasir', 'klinik', 'reseller')),
  add column sales_scope text not null default 'employee'
    check (sales_scope in ('employee', 'own_branch', 'all_branches')),
  add column rate_percent numeric(8,4) not null default 0
    check (rate_percent >= 0 and rate_percent <= 100),
  add constraint salary_components_turnover_rate_check
    check (calculation_basis = 'fixed' or rate_percent > 0);

alter table public.employee_salary_components
  add column rate_percent_override numeric(8,4)
    check (rate_percent_override > 0 and rate_percent_override <= 100);

comment on column public.salary_components.calculation_basis is
  'fixed uses nominal; net_turnover applies configured rate to posted net sales after discount and returns.';
comment on column public.salary_components.sales_scope is
  'employee = attributable employee rows; own_branch = every row in employee branch; all_branches = every row in source.';

alter table public.payrolls
  add column component_breakdown jsonb not null default '[]'::jsonb
    check (jsonb_typeof(component_breakdown) = 'array');
comment on column public.payrolls.component_breakdown is
  'Snapshot of configured component, net turnover basis, rate, and applied amount at payroll calculation.';
