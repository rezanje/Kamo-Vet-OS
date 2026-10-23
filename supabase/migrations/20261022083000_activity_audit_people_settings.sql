-- A01: minimum action metadata for HRIS, company and access/configuration writes.
-- No personal/payroll values, import JSON, names, bank details, settings values,
-- or changed-column names are retained. Existing source policies are unchanged.
-- Employee history requires every primary/secondary assigned branch. The direct
-- assignment branch is also required, including while a cascaded row disappears.
insert into public.activity_log_sources
 (entity,module_id,scope_kind,identity_keys,branch_columns,scope_parents,parent_entity,parent_key,metadata_only)
values
 ('employees','hris','employee',array['id'],array['branch_id'],'[]',null,null,true),
 ('employee_branch_assignments','hris','refs',array['employee_id','branch_id'],array['branch_id'],
  '[{"entity":"employees","key":"employee_id"}]','employees','employee_id',true),
 ('employee_import_details','hris','refs',array['employee_id'],'{}',
  '[{"entity":"employees","key":"employee_id"}]','employees','employee_id',true),
 ('attendance','hris','refs',array['id'],'{}',
  '[{"entity":"employees","key":"employee_id"}]','employees','employee_id',true),
 ('employee_schedules','hris','refs',array['id'],'{}',
  '[{"entity":"employees","key":"employee_id"},{"entity":"work_shifts","key":"shift_id"}]','employees','employee_id',true),
 ('leave_requests','hris','refs',array['id'],'{}',
  '[{"entity":"employees","key":"employee_id"}]','employees','employee_id',true),
 ('overtime_requests','hris','refs',array['id'],'{}',
  '[{"entity":"employees","key":"employee_id"}]','employees','employee_id',true),
 ('payrolls','hris','refs',array['id'],'{}',
  '[{"entity":"employees","key":"employee_id"}]','employees','employee_id',true),
 ('employee_salary_components','hris','refs',array['id'],'{}',
  '[{"entity":"employees","key":"employee_id"}]','employees','employee_id',true),
 ('reimbursements','hris','refs',array['id'],'{}',
  '[{"entity":"employees","key":"employee_id"}]','employees','employee_id',true),
 ('cash_advances','hris','refs',array['id'],'{}',
  '[{"entity":"employees","key":"employee_id"},{"entity":"cash_accounts","key":"cash_account_id"}]','employees','employee_id',true),
 ('cash_advance_installments','hris','refs',array['id'],'{}',
  '[{"entity":"cash_advances","key":"advance_id"}]','cash_advances','advance_id',true),
 ('kpi_records','hris','refs',array['id'],'{}',
  '[{"entity":"employees","key":"employee_id"}]','employees','employee_id',true),
 ('work_shifts','hris','refs',array['id'],array['branch_id'],'[]',null,null,true),
 ('salary_components','hris','all',array['id'],'{}','[]',null,null,true),
 ('payroll_settings','pengaturan','all',array['id'],'{}','[]',null,null,true),
 ('branches','perusahaan','refs',array['id'],array['id'],'[]',null,null,true),
 ('warehouses','perusahaan','refs',array['id'],array['branch_id'],'[]',null,null,true),
 ('profiles','pengaturan','all',array['id'],'{}','[]',null,null,true),
 ('user_branches','pengaturan','all',array['user_id','branch_id'],'{}','[]',null,null,true),
 ('role_modules','pengaturan','all',array['role','module_id'],'{}','[]',null,null,true),
 ('role_capabilities','pengaturan','all',array['role'],'{}','[]',null,null,true),
 ('company_settings','pengaturan','all',array['id'],'{}','[]',null,null,true),
 ('approval_rules','pengaturan','all',array['id'],'{}','[]',null,null,true),
 ('approval_requests','pengaturan','all',array['id'],'{}','[]',null,null,true),
 ('document_numbering','pengaturan','all',array['jenis'],'{}','[]',null,null,true),
 ('wa_engine_settings','pengaturan','all',array['id'],'{}','[]',null,null,true),
 ('tier_settings','pengaturan','all',array['id'],'{}','[]',null,null,true),
 ('operational_alert_settings','pengaturan','refs',array['id'],array['branch_id'],'[]',null,null,true),
 ('commission_rules','penjualan','refs',array['id'],array['branch_id'],
  '[{"entity":"employees","key":"employee_id"}]',null,null,true),
 ('sales_targets','penjualan','refs',array['id'],array['branch_id'],
  '[{"entity":"employees","key":"employee_id"}]',null,null,true),
 ('notifications','pengaturan','all',array['id'],'{}','[]',null,null,true);

-- Register only the tables named above. Technical request/epoch/domain-audit
-- stores are deliberately excluded: their business-source mutations are captured.
do $$declare t text;begin
 foreach t in array array[
  'employees','employee_branch_assignments','employee_import_details','attendance',
  'employee_schedules','leave_requests','overtime_requests','payrolls',
  'employee_salary_components','reimbursements','cash_advances','cash_advance_installments',
  'kpi_records','work_shifts','salary_components','payroll_settings','branches','warehouses',
  'profiles','user_branches','role_modules','role_capabilities','company_settings',
  'approval_rules','approval_requests','document_numbering','wa_engine_settings',
  'tier_settings','operational_alert_settings','commission_rules','sales_targets','notifications'
 ] loop
  execute format('create trigger a01_activity_change after insert or update on public.%I for each row execute function public.capture_activity_log()',t);
  execute format('create trigger a01_activity_delete before delete on public.%I for each row execute function public.capture_activity_log()',t);
 end loop;
end$$;
