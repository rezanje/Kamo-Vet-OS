-- H03 (carried over from draft #229): salary components that pay a configured percentage
-- of posted net turnover (after discount and returns). Existing fixed components keep
-- their behaviour. No rate is seeded. Access stays as 20261027030000: salary_components
-- and employee_salary_components are OWNER-write, FINANCE-read.
alter table public.salary_components
  add column if not exists calculation_basis text not null default 'fixed',
  add column if not exists sales_source text not null default 'semua',
  add column if not exists sales_scope text not null default 'employee',
  add column if not exists rate_percent numeric(8,4) not null default 0;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'salary_components_calculation_basis_check') then
    alter table public.salary_components add constraint salary_components_calculation_basis_check
      check (calculation_basis in ('fixed', 'net_turnover'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'salary_components_sales_source_check') then
    alter table public.salary_components add constraint salary_components_sales_source_check
      check (sales_source in ('semua', 'kasir', 'klinik', 'reseller'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'salary_components_sales_scope_check') then
    alter table public.salary_components add constraint salary_components_sales_scope_check
      check (sales_scope in ('employee', 'own_branch', 'all_branches'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'salary_components_turnover_rate_check') then
    alter table public.salary_components add constraint salary_components_turnover_rate_check
      check (rate_percent >= 0 and rate_percent <= 100 and (calculation_basis = 'fixed' or rate_percent > 0));
  end if;
end $$;

alter table public.employee_salary_components
  add column if not exists rate_percent_override numeric(8,4);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'employee_salary_components_rate_override_check') then
    alter table public.employee_salary_components add constraint employee_salary_components_rate_override_check
      check (rate_percent_override is null or (rate_percent_override > 0 and rate_percent_override <= 100));
  end if;
end $$;

comment on column public.salary_components.calculation_basis is
  'fixed = nominal; net_turnover = rate_percent x omzet neto terposting (setelah diskon dan retur).';
comment on column public.salary_components.sales_scope is
  'employee = baris milik karyawan; own_branch = semua baris cabang karyawan; all_branches = semua baris sumber itu.';

alter table public.payrolls
  add column if not exists component_breakdown jsonb not null default '[]'::jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'payrolls_component_breakdown_array') then
    alter table public.payrolls add constraint payrolls_component_breakdown_array
      check (jsonb_typeof(component_breakdown) = 'array');
  end if;
end $$;
comment on column public.payrolls.component_breakdown is
  'Snapshot komponen saat gaji dihitung: nama, asal (template/individu), dasar omzet, tarif, nominal.';
