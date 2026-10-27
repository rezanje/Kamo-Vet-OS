-- H02–H06 ROLLBACK — ONLY IF THE OWNER DECIDES TO UNDO. Revert the app deploy FIRST
-- (the app reads these columns/tables). This DROPS configuration entered after apply:
-- commission groups/exceptions, visit rates, package tags on clinic lines, turnover
-- components, payslip templates and their history. Export them first if they matter.
-- It REFUSES to run while such data exists, unless the owner explicitly confirms in the same
-- session first:   set kamo.h_rollback_discard_data = 'yes';
begin;

do $guard$
declare v_found text[] := array[]::text[];
begin
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='invoice_items' and column_name='package_item_id') then
    if exists(select 1 from public.invoice_items where package_item_id is not null) then v_found := v_found || 'tanda paket di invoice'::text; end if;
  end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='employees' and column_name='commission_group') then
    if exists(select 1 from public.employees where commission_group is not null) then v_found := v_found || 'kelompok komisi karyawan'::text; end if;
    if exists(select 1 from public.commission_rules where commission_group is not null or override_group_rule_id is not null or sumber = 'visit_ranap') then
      v_found := v_found || 'aturan kelompok/pengecualian/visit'::text; end if;
  end if;
  if to_regclass('public.payslip_templates') is not null then
    if exists(select 1 from public.payslip_templates) or exists(select 1 from public.employee_payslip_templates)
       or exists(select 1 from public.payslip_override_history) then v_found := v_found || 'template slip/riwayat'::text; end if;
  end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='payrolls' and column_name='component_breakdown') then
    if exists(select 1 from public.payrolls where component_breakdown <> '[]'::jsonb) then v_found := v_found || 'rincian komponen di slip'::text; end if;
    if exists(select 1 from public.salary_components where calculation_basis <> 'fixed')
       or exists(select 1 from public.employee_salary_components where rate_percent_override is not null) then
      v_found := v_found || 'komponen gaji omzet'::text; end if;
  end if;
  if cardinality(v_found) > 0 and coalesce(current_setting('kamo.h_rollback_discard_data', true), '') <> 'yes' then
    raise exception 'H_ROLLBACK_REFUSED: data akan hilang (%). Ekspor dulu; jalankan lagi dengan set kamo.h_rollback_discard_data = ''yes'' bila owner memutuskan.',
      array_to_string(v_found, ', ');
  end if;
end $guard$;

-- H05: restore clinic_post_invoice to the reviewed pre-H05 text (fails closed on drift).
do $patch$
declare p record; definition text;
begin
  definition := pg_get_functiondef('public.clinic_post_invoice(uuid,text,jsonb,jsonb)'::regprocedure);
  if position('package_item_id' in definition) = 0 then return; end if;
  for p in select * from (values
    (E'service_performers, bmhp_components, salesperson_id, package_item_id, package_qty\n    ) values',
     E'service_performers, bmhp_components, salesperson_id\n    ) values'),
    (E'v_bmhp, nullif(v_line.value->>''salesperson_id'','''')::uuid,\n      nullif(v_line.value->>''package_item_id'','''')::uuid, nullif(v_line.value->>''package_qty'','''')::numeric\n    ) returning',
     E'v_bmhp, nullif(v_line.value->>''salesperson_id'','''')::uuid\n    ) returning')
  ) as patches(new_text, old_text) loop
    if (length(definition) - length(replace(definition, p.new_text, ''))) / length(p.new_text) <> 1 then
      raise exception 'H05 rollback expected exactly one patched anchor: %', left(p.new_text, 60);
    end if;
    definition := replace(definition, p.new_text, p.old_text);
  end loop;
  execute definition;
end $patch$;
drop trigger if exists clinic_line_package on public.invoice_items;
drop function if exists public.guard_clinic_line_package();
drop index if exists public.invoice_items_package_item_idx;
alter table public.invoice_items drop constraint if exists invoice_items_package_origin_pair;
alter table public.invoice_items drop column if exists package_item_id, drop column if exists package_qty;

-- H02
drop trigger if exists h02_payslip_history on public.employee_salary_components;
drop trigger if exists h02_payslip_history on public.employee_payslip_templates;
drop function if exists public.record_payslip_override_history();
drop table if exists public.payslip_override_history;
drop table if exists public.employee_payslip_templates;
drop table if exists public.payslip_template_components;
drop table if exists public.payslip_templates;
alter table public.employee_salary_components drop column if exists override_reason;

-- H03
alter table public.payrolls drop constraint if exists payrolls_component_breakdown_array;
alter table public.payrolls drop column if exists component_breakdown;
alter table public.employee_salary_components drop constraint if exists employee_salary_components_rate_override_check;
alter table public.employee_salary_components drop column if exists rate_percent_override;
alter table public.salary_components
  drop constraint if exists salary_components_turnover_rate_check,
  drop constraint if exists salary_components_sales_scope_check,
  drop constraint if exists salary_components_sales_source_check,
  drop constraint if exists salary_components_calculation_basis_check;
alter table public.salary_components
  drop column if exists rate_percent, drop column if exists sales_scope,
  drop column if exists sales_source, drop column if exists calculation_basis;

-- H06 + H04
drop trigger if exists h06_doctor_visit_guard on public.inpatient_daily_logs;
drop function if exists public.guard_inpatient_doctor_visit();
drop index if exists public.inpatient_daily_logs_doctor_visit_idx;
drop trigger if exists h04_commission_group_owner on public.employees;
drop function if exists public.guard_employee_commission_group();
drop policy if exists commission_rules_select_general on public.commission_rules;
drop policy if exists commission_rules_write_owner on public.commission_rules;
drop policy if exists commission_rules_write_admin_general on public.commission_rules;
drop policy if exists commission_rules_select_all on public.commission_rules;
drop policy if exists commission_rules_write_admin on public.commission_rules;
-- restore the 20261027030000 policies
create policy commission_rules_select_all on public.commission_rules
  for select to authenticated using (true);
create policy commission_rules_write_admin on public.commission_rules
  for all to authenticated
  using ((select private.hris_role()) in ('OWNER', 'ADMIN'))
  with check ((select private.hris_role()) in ('OWNER', 'ADMIN'));
delete from public.commission_rules where sumber = 'visit_ranap' or override_group_rule_id is not null or commission_group is not null;
alter table public.commission_rules drop constraint if exists commission_rules_visit_nominal_check;
alter table public.commission_rules drop constraint if exists commission_rules_sumber_check;
alter table public.commission_rules add constraint commission_rules_sumber_check
  check (sumber in ('semua', 'kasir', 'klinik', 'reseller'));
alter table public.commission_rules drop constraint if exists commission_rule_override_scope_check;
alter table public.commission_rules drop constraint if exists commission_rules_group_format;
alter table public.commission_rules drop column if exists override_group_rule_id, drop column if exists commission_group;
alter table public.employees drop constraint if exists employees_commission_group_format;
alter table public.employees drop column if exists commission_group;

commit;
