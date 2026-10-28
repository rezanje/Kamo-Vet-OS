-- H02–H06 READBACK — READ ONLY. Run after apply.sql. Every row must show ok = true.
with checks(check_name, ok) as (
  select 'H04 employees.commission_group',
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='employees' and column_name='commission_group')
  union all select 'H04 commission_rules group + override columns',
    (select count(*) = 2 from information_schema.columns where table_schema='public' and table_name='commission_rules' and column_name in ('commission_group','override_group_rule_id'))
  union all select 'H06 sumber accepts visit_ranap',
    pg_get_constraintdef((select oid from pg_constraint where conname='commission_rules_sumber_check')) like '%visit_ranap%'
  union all select 'H06 visit rule is nominal-only', exists(select 1 from pg_constraint where conname='commission_rules_visit_nominal_check')
  union all select 'H06 visit log index', to_regclass('public.inpatient_daily_logs_doctor_visit_idx') is not null
  union all select 'H06 visit tamper guard', exists(select 1 from pg_trigger where tgname='h06_doctor_visit_guard' and tgrelid='public.inpatient_daily_logs'::regclass)
  union all select 'H04 group change OWNER-only', exists(select 1 from pg_trigger where tgname='h04_commission_group_owner' and tgrelid='public.employees'::regclass)
  union all select 'H04 personal rules OWNER-only', (select count(*) = 3 from pg_policies where tablename='commission_rules'
    and policyname in ('commission_rules_select_general','commission_rules_write_owner','commission_rules_write_admin_general'))
    and not exists(select 1 from pg_policies where tablename='commission_rules' and policyname in ('commission_rules_select_all','commission_rules_write_admin'))
  union all select 'H04 exception follows its group rule on delete',
    (select confdeltype = 'c' from pg_constraint where conrelid='public.commission_rules'::regclass and contype='f'
      and conkey = array[(select attnum from pg_attribute where attrelid='public.commission_rules'::regclass and attname='override_group_rule_id')])
  union all select 'H05 invoice_items package columns',
    (select count(*) = 2 from information_schema.columns where table_schema='public' and table_name='invoice_items' and column_name in ('package_item_id','package_qty'))
  union all select 'H05 package guard trigger', exists(select 1 from pg_trigger where tgname='clinic_line_package' and tgrelid='public.invoice_items'::regclass)
  union all select 'H05 clinic_post_invoice carries package fields',
    position('package_item_id' in pg_get_functiondef('public.clinic_post_invoice(uuid,text,jsonb,jsonb)'::regprocedure)) > 0
  union all select 'H05 clinic_post_invoice ACL unchanged',
    has_function_privilege('authenticated','public.clinic_post_invoice(uuid,text,jsonb,jsonb)','EXECUTE')
    and not has_function_privilege('anon','public.clinic_post_invoice(uuid,text,jsonb,jsonb)','EXECUTE')
    and not has_function_privilege('service_role','public.clinic_post_invoice(uuid,text,jsonb,jsonb)','EXECUTE')
  union all select 'H03 salary_components turnover columns',
    (select count(*) = 4 from information_schema.columns where table_schema='public' and table_name='salary_components' and column_name in ('calculation_basis','sales_source','sales_scope','rate_percent'))
  union all select 'H03 payrolls.component_breakdown',
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='payrolls' and column_name='component_breakdown')
  union all select 'H02 tables',
    (select count(*) = 4 from unnest(array['payslip_templates','payslip_template_components','employee_payslip_templates','payslip_override_history']) t where to_regclass('public.' || t) is not null)
  union all select 'H02 RLS on',
    (select bool_and(relrowsecurity) from pg_class where oid in ('public.payslip_templates'::regclass,'public.payslip_template_components'::regclass,
      'public.employee_payslip_templates'::regclass,'public.payslip_override_history'::regclass))
  union all select 'H02 history triggers', (select count(*) = 2 from pg_trigger where tgname='h02_payslip_history')
  union all select 'H02 history not writable by app', not has_table_privilege('authenticated','public.payslip_override_history','INSERT')
  union all select 'H02 history never blocks deleting an employee',
    not exists(select 1 from pg_constraint where conrelid='public.payslip_override_history'::regclass and contype='f')
  union all select 'no template seeded', not exists(select 1 from public.payslip_templates)
  union all select 'no visit rate seeded', not exists(select 1 from public.commission_rules where sumber='visit_ranap')
)
select check_name, ok from checks
union all select 'SUMMARY', bool_and(ok) from checks;
