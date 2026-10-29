begin;
-- A01 coverage guard (fictional data; never run against a shared database).
-- Every public business table must be a registered activity source with both capture
-- triggers enabled, or appear below with the reason it is deliberately not a source.
-- A new table that is neither fails this test, so later migrations cannot silently
-- fall outside the general activity log.
create temporary table a01_excluded(entity text primary key, reason text not null) on commit drop;
insert into a01_excluded values
 -- The activity framework itself.
 ('activity_log','framework: the log itself'),
 ('activity_log_sources','framework: private registry'),
 -- Idempotency/request receipts: the business rows they create are captured.
 ('bank_reconciliation_requests','request receipt'),('cash_entry_revision_requests','request receipt'),
 ('cash_transfer_requests','request receipt'),('clinic_invoice_operations','request receipt'),
 ('expense_posting_requests','request receipt'),('fixed_asset_value_requests','request receipt'),
 ('journal_revision_requests','request receipt'),('manual_journal_create_requests','request receipt'),
 ('monetary_opening_requests','request receipt'),('opening_balance_create_requests','request receipt'),
 ('purchase_advance_cascade_cancellations','request receipt'),('purchase_advance_requests','request receipt'),
 ('purchase_invoice_cancellation_requests','request receipt'),('purchase_operations','request receipt'),
 ('purchase_order_requests','request receipt'),('purchase_payment_cancellation_requests','request receipt'),
 ('purchase_payment_order_requests','request receipt'),('purchase_payment_requests','request receipt'),
 ('return_record_requests','request receipt'),('sale_cancellation_requests','request receipt'),
 ('sale_payment_correction_requests','request receipt'),('sales_posting_requests','request receipt'),
 ('staff_reward_requests','request receipt'),('stock_document_correction_requests','request receipt'),
 ('inventory_adjustment_requests','request receipt'),
 ('unit_posting_requests','request receipt'),('wholesale_operation_requests','request receipt'),
 ('promo_import_batches','import receipt: imported promos are captured'),
 ('promo_import_targets','import receipt: imported promos are captured'),
 -- Concurrency gates, locks and epochs.
 ('sale_payment_correction_gate','transaction gate'),('purchase_advance_capacity_locks','lock row'),
 ('wholesale_payroll_epochs','epoch counter'),
 -- Posting proofs/receipts: the journals, stock moves and documents are captured.
 ('pos_sale_postings','posting proof'),('purchase_invoice_postings','posting proof'),
 ('return_record_postings','posting proof'),('opname_posting_receipts','posting proof'),
 ('production_atomic_postings','posting proof'),('recurring_source_occurrences','posting proof: occurrence journal is captured'),
 ('purchase_invoice_correction_layers','posting proof'),('purchase_advance_cancellations','posting proof'),
 ('purchase_order_receipt_closures','closure proof: the purchase order change is captured'),
 -- Domain correction/audit trails stay authoritative; their effects are captured on sources.
 ('bank_reconciliation_revisions','domain revision trail'),('cash_entry_revisions','domain revision trail'),
 ('cash_transfer_revisions','domain revision trail'),('expense_revisions','domain revision trail'),
 ('journal_revisions','domain revision trail'),('purchase_order_revisions','domain revision trail'),
 ('fixed_asset_corrections','domain correction trail'),('monetary_opening_corrections','domain correction trail'),
 ('stock_document_corrections','domain correction trail'),('return_record_corrections','domain correction trail'),
 ('sale_cancellations','domain correction trail'),('sale_payment_corrections','domain correction trail'),
 ('purchase_payment_cancellations','domain correction trail'),('wholesale_invoice_corrections','domain correction trail'),
 ('purchase_invoice_corrections','domain correction trail'),('purchase_receipt_cancellations','domain correction trail'),
 ('sales_receipt_cancellations','domain correction trail: reversal receipt and journals are captured'),
 ('stock_request_shipment_cancellations','domain correction trail: reversal stock moves and request change are captured'),
 ('clinic_payment_corrections','domain correction trail: payment rows and journals are captured'),
 ('clinic_payment_correction_requests','request receipt'),
 ('clinic_record_corrections','domain correction trail: medical record change is captured'),
 ('compound_adjustments','domain correction trail: compound ingredients are captured'),
 ('master_data_lifecycle_audit','domain audit trail'),('payslip_override_history','domain audit trail'),
 ('user_account_edits','domain audit trail'),('inpatient_daily_log_edits','domain audit trail'),
 ('inpatient_status_log','domain audit trail'),('invoice_edit_log','domain audit trail'),
 ('simulation_reset_audits','domain audit trail'),
 -- Personal viewer preference, not business data.
 ('private_report_presets','personal saved report link');

do $$declare missing text;stale text;both_lists text;broken text;begin
 select string_agg(c.relname,', ' order by c.relname) into missing
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind in ('r','p') and not c.relispartition
  and not exists(select 1 from public.activity_log_sources s where s.entity=c.relname)
  and not exists(select 1 from a01_excluded e where e.entity=c.relname);
 if missing is not null then raise exception 'A01 coverage: register or explicitly exclude: %',missing;end if;
 select string_agg(e.entity,', ' order by e.entity) into stale from a01_excluded e
 where to_regclass('public.'||quote_ident(e.entity)) is null;
 if stale is not null then raise exception 'A01 coverage: exclusion names a missing table: %',stale;end if;
 select string_agg(e.entity,', ' order by e.entity) into both_lists from a01_excluded e join public.activity_log_sources s using(entity);
 if both_lists is not null then raise exception 'A01 coverage: both registered and excluded: %',both_lists;end if;
 select string_agg(s.entity,', ' order by s.entity) into broken from public.activity_log_sources s
 where to_regclass('public.'||quote_ident(s.entity)) is null
  -- 21 = ROW AFTER INSERT OR UPDATE, 11 = ROW BEFORE DELETE (same shape as the framework suite).
  or (select count(*) from pg_trigger t
      where t.tgrelid=('public.'||quote_ident(s.entity))::regclass and not t.tgisinternal and t.tgenabled='O'
       and t.tgfoid='public.capture_activity_log()'::regprocedure
       and ((t.tgname='a01_activity_change' and t.tgtype=21) or (t.tgname='a01_activity_delete' and t.tgtype=11)))<>2;
 if broken is not null then raise exception 'A01 coverage: source without enabled change+delete capture: %',broken;end if;
 -- Registered identity must be the table's actual primary key.
 select string_agg(s.entity,', ' order by s.entity) into broken from public.activity_log_sources s
 where s.identity_keys is distinct from (
  select array_agg(a.attname::text order by k.ordinality)
  from pg_index i cross join lateral unnest(i.indkey) with ordinality k(attnum,ordinality)
  join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum
  where i.indisprimary and i.indrelid=('public.'||quote_ident(s.entity))::regclass)
  and s.entity in ('campaign_codes','payslip_templates','payslip_template_components','employee_payslip_templates',
   'employee_base_salaries','service_commission_policies','branch_grooming_rules','opening_invoice_batches','opening_invoice_lines',
   'recurring_journal_sources','clinic_refund_items','clinic_record_addenda','inpatient_rx_evidence','inpatient_rx_evidence_settings',
   'purchase_invoice_receipts','quest_new_customer_claims');
 if broken is not null then raise exception 'A01 coverage: identity differs from primary key: %',broken;end if;
 -- Pay configuration never reaches ADMIN readers and never copies an amount.
 if exists(select 1 from public.activity_log_sources where entity in
  ('payslip_templates','payslip_template_components','employee_payslip_templates','employee_base_salaries')
  and (not metadata_only or cardinality(value_keys)>0 or reader_roles<>array['OWNER'])) then
  raise exception 'A01 coverage: HRIS pay source exposes values or ADMIN readers';end if;
end$$;

-- Real DML on representative new sources: create/update/delete, scope, grouping, payload.
insert into auth.users(id,raw_user_meta_data) values(md5('a01c-owner')::uuid,'{"full_name":"Fictional coverage owner"}');
update profiles set role='OWNER',is_active=true where id=md5('a01c-owner')::uuid;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',md5('a01c-owner')::uuid::text,true);
insert into branches(id,code,name,type) values(md5('a01c-branch')::uuid,'A01C-A','PRIVATE coverage branch','KLINIK');
insert into employees(id,nik,nama,branch_id) values(md5('a01c-employee')::uuid,'A01C-E','PRIVATE coverage employee',md5('a01c-branch')::uuid);
insert into salary_components(id,nama,tipe) values(md5('a01c-component')::uuid,'PRIVATE coverage component','tunjangan');

create function pg_temp.coverage_check(p_entity text,p_actions text[],p_root text) returns void language plpgsql as $$
declare actual text[];begin
 select array_agg(action order by id) into actual from public.activity_log where row_entity=p_entity;
 if actual is distinct from p_actions then raise exception 'A01 coverage: % captured % instead of %',p_entity,actual,p_actions;end if;
 if exists(select 1 from public.activity_log where row_entity=p_entity and (entity<>p_root or actor_id is distinct from md5('a01c-owner')::uuid)) then
  raise exception 'A01 coverage: % not grouped under % or wrong actor',p_entity,p_root;end if;
end$$;

insert into inpatient_rx_evidence_settings(branch_id,administration_requires_handover,max_backdate_minutes) values(md5('a01c-branch')::uuid,false,0);
update inpatient_rx_evidence_settings set max_backdate_minutes=30 where branch_id=md5('a01c-branch')::uuid;
update inpatient_rx_evidence_settings set max_backdate_minutes=30 where branch_id=md5('a01c-branch')::uuid;
delete from inpatient_rx_evidence_settings where branch_id=md5('a01c-branch')::uuid;
select pg_temp.coverage_check('inpatient_rx_evidence_settings',array['create','update','delete'],'inpatient_rx_evidence_settings');
do $$begin
 if exists(select 1 from activity_log where row_entity='inpatient_rx_evidence_settings'
  and (scope<>'branches' or branch_ids<>array[md5('a01c-branch')::uuid] or module_id<>'klinik' or row_id<>md5('a01c-branch')::uuid::text)) then
  raise exception 'A01 coverage: settings scope/identity wrong';end if;
 if (select after_state from activity_log where row_entity='inpatient_rx_evidence_settings' and action='update')<>'{"max_backdate_minutes":30}' then
  raise exception 'A01 coverage: settings value not captured';end if;
end$$;

insert into branch_grooming_rules(branch_id,doctor_required,updated_by) values(md5('a01c-branch')::uuid,true,md5('a01c-owner')::uuid);
update branch_grooming_rules set doctor_required=false where branch_id=md5('a01c-branch')::uuid;
delete from branch_grooming_rules where branch_id=md5('a01c-branch')::uuid;
select pg_temp.coverage_check('branch_grooming_rules',array['create','update','delete'],'branch_grooming_rules');

insert into payslip_templates(id,kode,nama) values(md5('a01c-template')::uuid,'a01c-groomer','PRIVATE template name');
insert into payslip_template_components(id,template_id,component_id,nominal) values(md5('a01c-template-component')::uuid,md5('a01c-template')::uuid,md5('a01c-component')::uuid,12345);
update payslip_template_components set nominal=98765 where id=md5('a01c-template-component')::uuid;
insert into employee_payslip_templates(id,employee_id,template_id) values(md5('a01c-link')::uuid,md5('a01c-employee')::uuid,md5('a01c-template')::uuid);
insert into employee_base_salaries(employee_id,gaji_pokok) values(md5('a01c-employee')::uuid,12345);
update employee_base_salaries set gaji_pokok=98765 where employee_id=md5('a01c-employee')::uuid;
delete from employee_base_salaries where employee_id=md5('a01c-employee')::uuid;
delete from employee_payslip_templates where id=md5('a01c-link')::uuid;
-- Template deletion cascades its components; both deletions are retained.
delete from payslip_templates where id=md5('a01c-template')::uuid;
select pg_temp.coverage_check('payslip_templates',array['create','delete'],'payslip_templates');
select pg_temp.coverage_check('payslip_template_components',array['create','update','delete'],'payslip_templates');
select pg_temp.coverage_check('employee_payslip_templates',array['create','delete'],'employees');
select pg_temp.coverage_check('employee_base_salaries',array['create','update','delete'],'employees');
do $$begin
 if exists(select 1 from activity_log where row_entity in ('payslip_templates','payslip_template_components','employee_payslip_templates','employee_base_salaries')
  and (before_state<>'{}' or after_state<>'{}' or changed_fields<>array['metadata'] or reader_roles<>array['OWNER'] or module_id<>'hris')) then
  raise exception 'A01 coverage: HRIS pay payload or reader leak';end if;
 if not exists(select 1 from activity_log where row_entity='employee_payslip_templates' and object_refs @> jsonb_build_array(jsonb_build_object('entity','payslip_templates','id',md5('a01c-template')::uuid::text))) then
  raise exception 'A01 coverage: employee template link missing template reference';end if;
 if exists(select 1 from activity_log where row_entity='employee_base_salaries' and (scope<>'branches' or branch_ids<>array[md5('a01c-branch')::uuid])) then
  raise exception 'A01 coverage: salary not scoped to employee branch';end if;
end$$;

insert into service_commission_policies(id,branch_id,effective_from,mode,doctor_share_pct,staff_share_pct)
 values(md5('a01c-policy')::uuid,null,'2035-01-01','split',60,40);
select pg_temp.coverage_check('service_commission_policies',array['create'],'service_commission_policies');
do $$begin
 if (select scope from activity_log where row_entity='service_commission_policies')<>'all' then
  raise exception 'A01 coverage: company-wide policy must require all-branch access';end if;
end$$;
rollback;
