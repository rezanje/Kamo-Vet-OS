-- A01 new tables ROLLBACK — only if the owner decides to undo. One transaction.
--
-- Effect: the 18 tables stop writing to the activity log, and clinic_refunds /
-- clinic_refund_requests stop logging deletes again. No business data is touched.
-- Events already written stay in activity_log (it is immutable), but the viewer hides
-- events whose source is no longer registered. Running apply.sql again shows them again.
--
-- If a feature rollback (e.g. K01, J03, H02, C05, M05, N01) will drop one of these tables,
-- run THIS file first so the registry never points at a dropped table.
begin;
do $$
declare t text;
begin
  foreach t in array array['campaign_codes', 'payslip_templates', 'payslip_template_components', 'employee_payslip_templates',
    'employee_base_salaries', 'service_commission_policies', 'branch_grooming_rules', 'opening_invoice_batches',
    'opening_invoice_lines', 'recurring_journal_sources', 'recurring_source_occurrences', 'clinic_refund_items',
    'clinic_record_addenda', 'inpatient_rx_evidence', 'inpatient_rx_evidence_settings', 'quest_new_customer_claims',
    'purchase_invoice_receipts', 'private_report_presets'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists a01_activity_change on public.%I', t);
      execute format('drop trigger if exists a01_activity_delete on public.%I', t);
    end if;
    delete from public.activity_log_sources where entity = t;
  end loop;
  foreach t in array array['clinic_refunds', 'clinic_refund_requests'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists a01_activity_delete on public.%I', t);
    end if;
  end loop;
end $$;
commit;
