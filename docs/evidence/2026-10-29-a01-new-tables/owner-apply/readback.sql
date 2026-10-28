-- A01 new tables READBACK — READ ONLY. Run after apply.sql. Every row must show ok = true.
with expected(entity, metadata_only, reader_roles) as (values
  ('campaign_codes', false, array['OWNER','ADMIN']), ('payslip_templates', true, array['OWNER']),
  ('payslip_template_components', true, array['OWNER']), ('employee_payslip_templates', true, array['OWNER']),
  ('employee_base_salaries', true, array['OWNER']), ('service_commission_policies', true, array['OWNER','ADMIN']),
  ('branch_grooming_rules', false, array['OWNER','ADMIN']), ('opening_invoice_batches', false, array['OWNER','ADMIN']),
  ('opening_invoice_lines', false, array['OWNER','ADMIN']), ('recurring_journal_sources', true, array['OWNER','ADMIN']),
  ('recurring_source_occurrences', true, array['OWNER','ADMIN']), ('clinic_refund_items', false, array['OWNER','ADMIN']),
  ('clinic_record_addenda', true, array['OWNER','ADMIN']), ('inpatient_rx_evidence', true, array['OWNER','ADMIN']),
  ('inpatient_rx_evidence_settings', true, array['OWNER','ADMIN']), ('quest_new_customer_claims', true, '{}'::text[]),
  ('purchase_invoice_receipts', false, array['OWNER','ADMIN']), ('private_report_presets', true, array['OWNER','ADMIN'])
), trig as (
  select c.relname as entity, t.tgname, t.tgtype, t.tgenabled, t.tgfoid
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
  where c.relnamespace = 'public'::regnamespace and t.tgname like 'a01\_activity\_%' and not t.tgisinternal
), checks(check_name, ok) as (
  select 'all 18 tables registered with the reviewed privacy (wrong/missing: '
      || coalesce((select string_agg(e.entity, ', ') from expected e left join public.activity_log_sources s using (entity)
         where s.entity is null or s.metadata_only is distinct from e.metadata_only or s.reader_roles is distinct from e.reader_roles), 'none') || ')',
    not exists(select 1 from expected e left join public.activity_log_sources s using (entity)
      where s.entity is null or s.metadata_only is distinct from e.metadata_only or s.reader_roles is distinct from e.reader_roles)
  union all select 'private report presets stay owner-only in the log',
    (select owner_column from public.activity_log_sources where entity = 'private_report_presets') = 'user_id'
  union all select 'change + delete capture on all 18 tables (36 triggers, enabled, capture_activity_log)',
    (select count(*) from trig join expected using (entity) where tgenabled = 'O' and tgfoid = 'public.capture_activity_log()'::regprocedure
      and ((tgname = 'a01_activity_change' and tgtype = 21) or (tgname = 'a01_activity_delete' and tgtype = 11))) = 36
  union all select 'delete capture added on clinic_refunds and clinic_refund_requests',
    (select count(*) from trig where entity in ('clinic_refunds', 'clinic_refund_requests') and tgname = 'a01_activity_delete'
      and tgtype = 11 and tgenabled = 'O' and tgfoid = 'public.capture_activity_log()'::regprocedure) = 2
  union all select 'no table carries capture triggers without a registry row',
    not exists(select 1 from trig where not exists(select 1 from public.activity_log_sources s where s.entity = trig.entity))
  union all select 'activity log itself still immutable',
    exists(select 1 from pg_trigger where tgrelid = 'public.activity_log'::regclass and tgname = 'activity_log_immutable')
  union all select 'informational: public tables outside the log that are not in the reviewed exclusion list: '
      || coalesce((select string_agg(c.relname, ', ' order by c.relname) from pg_class c
         where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
           and not exists(select 1 from public.activity_log_sources s where s.entity = c.relname)
           and c.relname not in ('activity_log', 'activity_log_sources',
             'bank_reconciliation_requests', 'cash_entry_revision_requests', 'cash_transfer_requests', 'clinic_invoice_operations',
             'expense_posting_requests', 'fixed_asset_value_requests', 'journal_revision_requests', 'manual_journal_create_requests',
             'monetary_opening_requests', 'opening_balance_create_requests', 'purchase_invoice_cancellation_requests', 'purchase_operations',
             'purchase_order_requests', 'purchase_payment_cancellation_requests', 'purchase_payment_order_requests', 'purchase_payment_requests',
             'return_record_requests', 'sale_cancellation_requests', 'sales_posting_requests', 'staff_reward_requests',
             'stock_document_correction_requests', 'unit_posting_requests', 'wholesale_operation_requests',
             'bank_reconciliation_revisions', 'cash_entry_revisions', 'cash_transfer_revisions', 'expense_revisions', 'fixed_asset_corrections',
             'inpatient_daily_log_edits', 'inpatient_status_log', 'invoice_edit_log', 'journal_revisions', 'master_data_lifecycle_audit',
             'monetary_opening_corrections', 'purchase_order_revisions', 'purchase_payment_cancellations', 'return_record_corrections',
             'sale_cancellations', 'simulation_reset_audits', 'stock_document_corrections', 'wholesale_invoice_corrections',
             'pos_sale_postings', 'purchase_invoice_postings', 'return_record_postings', 'wholesale_payroll_epochs',
             'purchase_advance_requests', 'opname_posting_receipts', 'production_atomic_postings', 'sale_payment_correction_requests',
             'purchase_advance_cascade_cancellations', 'promo_import_batches', 'purchase_advance_cancellations',
             'purchase_order_receipt_closures', 'user_account_edits', 'clinic_record_corrections', 'sale_payment_corrections',
             'purchase_invoice_corrections', 'payslip_override_history', 'purchase_receipt_cancellations',
             'purchase_invoice_correction_layers', 'promo_import_targets', 'purchase_advance_capacity_locks', 'sale_payment_correction_gate')), 'none'),
    true
)
select check_name, ok from checks
union all select 'SUMMARY: ' || count(*) filter (where not ok) || ' failed', count(*) filter (where not ok) = 0 from checks;
