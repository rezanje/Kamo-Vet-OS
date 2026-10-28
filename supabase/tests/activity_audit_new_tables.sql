begin;
-- A01 (29 Oct): business tables added after 24 Oct land in the general activity log.
-- Fictional data only; never run against a shared database.

-- 1. Coverage boundary: every public table is either a registered source with capture
--    triggers or an explicitly classified exclusion. A new table without a decision fails here.
create temporary table a01_excluded(entity text primary key, classification text not null) on commit drop;
insert into a01_excluded values
 ('activity_log','audit_infrastructure'),('activity_log_sources','audit_infrastructure'),
 ('bank_reconciliation_requests','request_receipt'),('cash_entry_revision_requests','request_receipt'),
 ('cash_transfer_requests','request_receipt'),('clinic_invoice_operations','request_receipt'),
 ('expense_posting_requests','request_receipt'),('fixed_asset_value_requests','request_receipt'),
 ('journal_revision_requests','request_receipt'),('manual_journal_create_requests','request_receipt'),
 ('monetary_opening_requests','request_receipt'),('opening_balance_create_requests','request_receipt'),
 ('purchase_invoice_cancellation_requests','request_receipt'),('purchase_operations','request_receipt'),
 ('purchase_order_requests','request_receipt'),('purchase_payment_cancellation_requests','request_receipt'),
 ('purchase_payment_order_requests','request_receipt'),('purchase_payment_requests','request_receipt'),
 ('return_record_requests','request_receipt'),('sale_cancellation_requests','request_receipt'),
 ('sales_posting_requests','request_receipt'),('staff_reward_requests','request_receipt'),
 ('stock_document_correction_requests','request_receipt'),('unit_posting_requests','request_receipt'),
 ('wholesale_operation_requests','request_receipt'),
 ('bank_reconciliation_revisions','domain_history'),('cash_entry_revisions','domain_history'),
 ('cash_transfer_revisions','domain_history'),('expense_revisions','domain_history'),
 ('fixed_asset_corrections','domain_history'),('inpatient_daily_log_edits','domain_history'),
 ('inpatient_status_log','domain_history'),('invoice_edit_log','domain_history'),
 ('journal_revisions','domain_history'),('master_data_lifecycle_audit','domain_history'),
 ('monetary_opening_corrections','domain_history'),('purchase_order_revisions','domain_history'),
 ('purchase_payment_cancellations','domain_history'),('return_record_corrections','domain_history'),
 ('sale_cancellations','domain_history'),('simulation_reset_audits','domain_history'),
 ('stock_document_corrections','domain_history'),('wholesale_invoice_corrections','domain_history'),
 ('pos_sale_postings','posting_proof'),('purchase_invoice_postings','posting_proof'),('return_record_postings','posting_proof'),
 ('wholesale_payroll_epochs','technical_concurrency'),
 -- Added after 24 Oct (20261029150000_a01_audit_new_tables.sql header lists the reasons).
 ('purchase_advance_requests','request_receipt'),('opname_posting_receipts','request_receipt'),
 ('production_atomic_postings','request_receipt'),('sale_payment_correction_requests','request_receipt'),
 ('purchase_advance_cascade_cancellations','request_receipt'),('promo_import_batches','request_receipt'),
 ('purchase_advance_cancellations','domain_history'),('purchase_order_receipt_closures','domain_history'),
 ('user_account_edits','domain_history'),('clinic_record_corrections','domain_history'),
 ('sale_payment_corrections','domain_history'),('purchase_invoice_corrections','domain_history'),
 ('payslip_override_history','domain_history'),('purchase_receipt_cancellations','domain_history'),
 ('purchase_invoice_correction_layers','posting_proof'),('promo_import_targets','posting_proof'),
 ('purchase_advance_capacity_locks','technical_concurrency'),('sale_payment_correction_gate','technical_concurrency');

do $$
declare missing text; stale text; overlap text; untriggered text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into missing
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
     and not exists(select 1 from public.activity_log_sources s where s.entity = c.relname)
     and not exists(select 1 from a01_excluded e where e.entity = c.relname);
  if missing is not null then raise exception 'Unclassified table outside the activity log: %', missing; end if;
  select string_agg(entity, ', ') into stale from a01_excluded e where to_regclass('public.' || e.entity) is null;
  if stale is not null then raise exception 'Stale exclusion: %', stale; end if;
  select string_agg(entity, ', ') into overlap from a01_excluded e join public.activity_log_sources using (entity);
  if overlap is not null then raise exception 'Excluded table is also registered: %', overlap; end if;
  -- clinic_history_reads is append-only (immutability trigger) and deliberately insert-only capture.
  select string_agg(s.entity, ', ') into untriggered from public.activity_log_sources s
   where not exists(select 1 from pg_trigger t where t.tgrelid = to_regclass('public.' || s.entity) and t.tgname = 'a01_activity_change'
           and t.tgfoid = 'public.capture_activity_log()'::regprocedure and t.tgenabled = 'O'
           and t.tgtype = case when s.entity = 'clinic_history_reads' then 5 else 21 end)
      or (s.entity <> 'clinic_history_reads' and not exists(select 1 from pg_trigger t where t.tgrelid = to_regclass('public.' || s.entity)
           and t.tgname = 'a01_activity_delete' and t.tgfoid = 'public.capture_activity_log()'::regprocedure and t.tgenabled = 'O' and t.tgtype = 11));
  if untriggered is not null then raise exception 'Registered source without capture triggers: %', untriggered; end if;
end $$;

-- 2. Privacy decisions of the new registrations.
do $$
begin
  if exists(select 1 from public.activity_log_sources where entity in ('payslip_templates','payslip_template_components',
      'employee_payslip_templates','employee_base_salaries') and (not metadata_only or reader_roles <> array['OWNER'])) then
    raise exception 'Pay configuration must be metadata-only and OWNER-only in the activity log';
  end if;
  if exists(select 1 from public.activity_log_sources where entity in ('service_commission_policies','clinic_record_addenda',
      'inpatient_rx_evidence','inpatient_rx_evidence_settings','recurring_journal_sources','recurring_source_occurrences',
      'quest_new_customer_claims','private_report_presets') and not metadata_only) then
    raise exception 'Sensitive new source copies values';
  end if;
  if (select reader_roles from public.activity_log_sources where entity = 'quest_new_customer_claims') <> '{}'
    or (select owner_column from public.activity_log_sources where entity = 'private_report_presets') is distinct from 'user_id' then
    raise exception 'Private source visibility widened';
  end if;
end $$;

-- 3. Real insert/update/delete on newly covered tables lands in the log.
insert into auth.users(id, raw_user_meta_data) values
 (md5('a01n-owner')::uuid, '{"full_name":"Fictional new-table owner"}'),
 (md5('a01n-admin')::uuid, '{"full_name":"Fictional new-table admin"}');
update profiles set role = 'OWNER', is_active = true where id = md5('a01n-owner')::uuid;
update profiles set role = 'ADMIN', is_active = true where id = md5('a01n-admin')::uuid;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', md5('a01n-owner')::uuid::text, true);
insert into branches(id, code, name, type) values (md5('a01n-branch')::uuid, 'A01N', 'PRIVATE branch', 'PETSHOP');
insert into employees(id, nik, nama, branch_id) values (md5('a01n-employee')::uuid, 'A01N-1', 'PRIVATE employee', md5('a01n-branch')::uuid);
insert into salary_components(id, nama, tipe) values (md5('a01n-component')::uuid, 'PRIVATE component', 'tunjangan');
insert into vouchers(id, code, tipe, nilai) values (md5('a01n-voucher')::uuid, 'A01NVOUCHER', 'nominal', 1000);

create function pg_temp.a01n_actions(p_entity text) returns text[] language sql as $$
  select coalesce(array_agg(action order by id), '{}') from public.activity_log where row_entity = p_entity
$$;

-- Campaign code: values limited to code/max_uses/is_active; free-text note never copied.
insert into campaign_codes(id, code, voucher_id, max_uses, note) values (md5('a01n-code')::uuid, 'A01N-CODE', md5('a01n-voucher')::uuid, 5, 'PRIVATE note');
update campaign_codes set max_uses = 9, note = 'PRIVATE edited note' where id = md5('a01n-code')::uuid;
delete from campaign_codes where id = md5('a01n-code')::uuid;
do $$
begin
  if pg_temp.a01n_actions('campaign_codes') <> array['create','update','delete'] then raise exception 'campaign_codes lifecycle missing'; end if;
  if not exists(select 1 from activity_log where row_entity = 'campaign_codes' and action = 'update'
      and module_id = 'crm' and object_label = 'A01N-CODE' and before_state = '{"max_uses":5}' and after_state = '{"max_uses":9}'
      and changed_fields = array['max_uses','note'] and actor_id = md5('a01n-owner')::uuid) then
    raise exception 'campaign_codes update snapshot wrong: %', (select jsonb_agg(to_jsonb(l)) from activity_log l where row_entity = 'campaign_codes');
  end if;
  if exists(select 1 from activity_log where row_entity = 'campaign_codes' and (before_state::text like '%PRIVATE%' or after_state::text like '%PRIVATE%')) then
    raise exception 'campaign_codes note leaked';
  end if;
  if not exists(select 1 from activity_log where row_entity = 'campaign_codes' and action = 'delete'
      and object_refs @> jsonb_build_array(jsonb_build_object('entity','vouchers','id',md5('a01n-voucher')::uuid::text))) then
    raise exception 'campaign_codes not linked to its voucher history';
  end if;
end $$;

-- Branch grooming rule: branch-scoped, boolean value only.
insert into branch_grooming_rules(branch_id, doctor_required, updated_by) values (md5('a01n-branch')::uuid, false, md5('a01n-owner')::uuid);
update branch_grooming_rules set doctor_required = true where branch_id = md5('a01n-branch')::uuid;
delete from branch_grooming_rules where branch_id = md5('a01n-branch')::uuid;
do $$
begin
  if pg_temp.a01n_actions('branch_grooming_rules') <> array['create','update','delete'] then raise exception 'branch_grooming_rules lifecycle missing'; end if;
  if exists(select 1 from activity_log where row_entity = 'branch_grooming_rules'
      and (scope <> 'branches' or branch_ids <> array[md5('a01n-branch')::uuid] or row_id <> md5('a01n-branch')::uuid::text)) then
    raise exception 'branch_grooming_rules scope/identity wrong';
  end if;
  if not exists(select 1 from activity_log where row_entity = 'branch_grooming_rules' and action = 'update'
      and before_state = '{"doctor_required":false}' and after_state = '{"doctor_required":true}') then
    raise exception 'branch_grooming_rules value missing';
  end if;
end $$;

-- Payslip template + component + employee link + base salary: metadata only, grouped, OWNER-only.
insert into payslip_templates(id, kode, nama) values (md5('a01n-template')::uuid, 'a01n-groomer', 'PRIVATE template');
update payslip_templates set nama = 'PRIVATE edited template' where id = md5('a01n-template')::uuid;
insert into payslip_template_components(id, template_id, component_id, nominal) values (md5('a01n-tc')::uuid, md5('a01n-template')::uuid, md5('a01n-component')::uuid, 12345);
update payslip_template_components set nominal = 98765 where id = md5('a01n-tc')::uuid;
insert into employee_payslip_templates(id, employee_id, template_id) values (md5('a01n-ept')::uuid, md5('a01n-employee')::uuid, md5('a01n-template')::uuid);
insert into employee_base_salaries(employee_id, gaji_pokok) values (md5('a01n-employee')::uuid, 4500000);
update employee_base_salaries set gaji_pokok = 5000000 where employee_id = md5('a01n-employee')::uuid;
delete from employee_base_salaries where employee_id = md5('a01n-employee')::uuid;
delete from employee_payslip_templates where id = md5('a01n-ept')::uuid;
delete from payslip_template_components where id = md5('a01n-tc')::uuid;
delete from payslip_templates where id = md5('a01n-template')::uuid;
do $$
begin
  if pg_temp.a01n_actions('payslip_templates') <> array['create','update','delete']
    or pg_temp.a01n_actions('payslip_template_components') <> array['create','update','delete']
    or pg_temp.a01n_actions('employee_payslip_templates') <> array['create','delete']
    or pg_temp.a01n_actions('employee_base_salaries') <> array['create','update','delete'] then
    raise exception 'Pay configuration lifecycle missing';
  end if;
  if exists(select 1 from activity_log where row_entity in ('payslip_templates','payslip_template_components','employee_payslip_templates','employee_base_salaries')
      and (before_state <> '{}' or after_state <> '{}' or changed_fields <> array['metadata'] or reader_roles <> array['OWNER'] or object_label like '%PRIVATE%')) then
    raise exception 'Pay configuration leaked a value or widened readers';
  end if;
  if exists(select 1 from activity_log where row_entity = 'payslip_template_components' and (entity <> 'payslip_templates' or entity_id <> md5('a01n-template')::uuid::text)) then
    raise exception 'Template component not grouped under its template';
  end if;
  if exists(select 1 from activity_log where row_entity in ('employee_payslip_templates','employee_base_salaries') and (entity <> 'employees' or entity_id <> md5('a01n-employee')::uuid::text)) then
    raise exception 'Employee pay link not grouped under the employee';
  end if;
end $$;

-- Inpatient medicine evidence settings: clinical config, metadata only, branch-scoped.
insert into inpatient_rx_evidence_settings(branch_id, administration_requires_handover, max_backdate_minutes) values (md5('a01n-branch')::uuid, false, 0);
update inpatient_rx_evidence_settings set max_backdate_minutes = 30 where branch_id = md5('a01n-branch')::uuid;
delete from inpatient_rx_evidence_settings where branch_id = md5('a01n-branch')::uuid;
do $$
begin
  if pg_temp.a01n_actions('inpatient_rx_evidence_settings') <> array['create','update','delete'] then raise exception 'inpatient_rx_evidence_settings lifecycle missing'; end if;
  if exists(select 1 from activity_log where row_entity = 'inpatient_rx_evidence_settings'
      and (module_id <> 'klinik' or before_state <> '{}' or after_state <> '{}' or branch_ids <> array[md5('a01n-branch')::uuid])) then
    raise exception 'inpatient_rx_evidence_settings privacy/scope wrong';
  end if;
end $$;

-- Service commission policy (append-only in the app; captured on insert).
insert into service_commission_policies(id, branch_id, effective_from, mode, doctor_share_pct, staff_share_pct, created_by)
 values (md5('a01n-policy')::uuid, md5('a01n-branch')::uuid, '2035-01-01', 'split', 60, 40, md5('a01n-owner')::uuid);
do $$
begin
  if pg_temp.a01n_actions('service_commission_policies') <> array['create'] then raise exception 'service_commission_policies capture missing'; end if;
  if exists(select 1 from activity_log where row_entity = 'service_commission_policies' and (module_id <> 'penjualan' or after_state <> '{}')) then
    raise exception 'service_commission_policies copied a value';
  end if;
end $$;

-- Private report preset: captured with its owner; only that owner can ever read the event.
select set_config('request.jwt.claim.sub', md5('a01n-admin')::uuid::text, true);
insert into private_report_presets(id, user_id, name, href) values (md5('a01n-preset')::uuid, md5('a01n-admin')::uuid, 'PRIVATE preset', '/laporan/penjualan-barang?dari=2035-01-01');
do $$
begin
  if not exists(select 1 from activity_log where row_entity = 'private_report_presets' and owner_ids = array[md5('a01n-admin')::uuid]
      and owner_required and module_id = 'laporan' and object_label not like '%PRIVATE%') then
    raise exception 'private_report_presets ownership not retained';
  end if;
end $$;

-- 4. Read side through the real RLS policy.
select set_config('a01n.pay_events', count(*)::text, true) from activity_log
 where row_entity in ('payslip_templates','payslip_template_components','employee_payslip_templates','employee_base_salaries');
set local role authenticated;
select set_config('request.jwt.claim.sub', md5('a01n-owner')::uuid::text, true);
do $$
begin
  if (select count(*) from public.activity_log where row_entity in ('payslip_templates','payslip_template_components','employee_payslip_templates','employee_base_salaries'))
      <> current_setting('a01n.pay_events')::int or current_setting('a01n.pay_events')::int <> 11 then
    raise exception 'OWNER cannot read pay configuration activity (% of %)',
      (select count(*) from public.activity_log where row_entity in ('payslip_templates','payslip_template_components','employee_payslip_templates','employee_base_salaries')),
      current_setting('a01n.pay_events');
  end if;
  if (select count(*) from public.activity_log where row_entity = 'campaign_codes') <> 3 then raise exception 'OWNER cannot read campaign code activity'; end if;
  if exists(select 1 from public.activity_log where row_entity = 'private_report_presets') then raise exception 'OWNER read another account private preset event'; end if;
end $$;
select set_config('request.jwt.claim.sub', md5('a01n-admin')::uuid::text, true);
do $$
begin
  if exists(select 1 from public.activity_log where row_entity in ('payslip_templates','payslip_template_components','employee_payslip_templates','employee_base_salaries')) then
    raise exception 'ADMIN can read OWNER-only pay configuration activity';
  end if;
  if (select count(*) from public.activity_log where row_entity = 'campaign_codes') <> 3 then raise exception 'ADMIN cannot read campaign code activity'; end if;
  if (select count(*) from public.activity_log where row_entity = 'private_report_presets') <> 1 then raise exception 'Preset owner cannot read own preset event'; end if;
end $$;
reset role;
rollback;
