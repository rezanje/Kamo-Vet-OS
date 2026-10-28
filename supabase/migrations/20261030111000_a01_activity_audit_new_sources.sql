-- A01: business tables created after the 22-24 Oct audit registry join the same
-- general activity log and per-object history. Same capture function, same
-- AFTER INSERT/UPDATE + BEFORE DELETE triggers, same private registry.
-- Pay, clinical, bank and contact payloads stay metadata-only; free text, notes,
-- names, request keys and JSON snapshots are never values. Source ACLs, RLS and
-- guards are unchanged. Idempotent: safe to re-run.
--
-- Deliberately NOT registered (request/idempotency receipts, gates, epochs, posting
-- proofs and domain correction/audit trails whose effects are already captured on the
-- registered source rows) are listed in supabase/tests/activity_audit_coverage.sql.

insert into public.activity_log_sources
 (entity,module_id,label_key,value_keys,scope_kind,parent_entity,parent_key,identity_keys,branch_columns,scope_parents,metadata_only,reader_roles)
values
 -- C05 campaign code: alias of one voucher or promo (both global masters).
 ('campaign_codes','crm','code',array['code','max_uses','is_active'],'global',null,null,array['id'],'{}',
  '[{"entity":"vouchers","key":"voucher_id"},{"entity":"promos","key":"promo_id"}]'::jsonb,false,array['OWNER','ADMIN']),
 -- H02/HRIS pay configuration: source readers are OWNER/FINANCE only, so the
 -- general log never adds ADMIN and never copies an amount.
 ('payslip_templates','hris','kode','{}','global',null,null,array['id'],'{}','[]'::jsonb,true,array['OWNER']),
 ('payslip_template_components','hris',null,'{}','refs','payslip_templates','template_id',array['id'],'{}',
  '[{"entity":"payslip_templates","key":"template_id"}]'::jsonb,true,array['OWNER']),
 ('employee_payslip_templates','hris',null,'{}','refs','employees','employee_id',array['id'],'{}',
  '[{"entity":"employees","key":"employee_id"},{"entity":"payslip_templates","key":"template_id"}]'::jsonb,true,array['OWNER']),
 ('employee_base_salaries','hris',null,'{}','refs','employees','employee_id',array['employee_id'],'{}',
  '[{"entity":"employees","key":"employee_id"}]'::jsonb,true,array['OWNER']),
 -- S04 append-only commission policy; no branch means the company-wide default.
 ('service_commission_policies','penjualan',null,array['doctor_share_pct','staff_share_pct'],'refs',null,null,array['id'],array['branch_id'],'[]'::jsonb,false,array['OWNER','ADMIN']),
 -- S05 per-branch grooming performer rule.
 ('branch_grooming_rules','pengaturan',null,array['doctor_required'],'refs',null,null,array['branch_id'],array['branch_id'],'[]'::jsonb,false,array['OWNER','ADMIN']),
 -- M05 opening AP/AR import: batch totals only; party names, numbers and notes stay out.
 ('opening_invoice_batches','buku-besar',null,array['ap_count','ap_total','ar_count','ar_total'],'refs',null,null,array['id'],array['branch_id'],
  '[{"entity":"journal_entries","key":"journal_id"}]'::jsonb,false,array['OWNER','ADMIN']),
 ('opening_invoice_lines','buku-besar',null,array['tanggal','jatuh_tempo','outstanding','original_total'],'refs','opening_invoice_batches','batch_id',array['id'],'{}',
  '[{"entity":"opening_invoice_batches","key":"batch_id"},{"entity":"purchase_invoices","key":"purchase_invoice_id"},{"entity":"sales_invoices","key":"sales_invoice_id"}]'::jsonb,false,array['OWNER','ADMIN']),
 -- J04 schedule source: payload/snapshot/config are JSON, so metadata only.
 ('recurring_journal_sources','buku-besar',null,'{}','refs','recurring_journals','schedule_id',array['schedule_id'],array['branch_id'],
  '[{"entity":"recurring_journals","key":"schedule_id"},{"entity":"journal_entries","key":"source_entry_id"}]'::jsonb,true,array['OWNER','ADMIN']),
 -- J03 refund lines under their posted clinic refund (descriptions excluded).
 ('clinic_refund_items','klinik',null,array['qty','amount','restock','kondisi','base_qty','hpp'],'refs','clinic_refunds','refund_id',array['id'],'{}',
  '[{"entity":"clinic_refunds","key":"refund_id"},{"entity":"invoice_items","key":"invoice_item_id"}]'::jsonb,false,array['OWNER','ADMIN']),
 -- K01 addendum: medical text and the frozen original record are never copied.
 ('clinic_record_addenda','klinik',null,'{}','refs','medical_records','medical_record_id',array['id'],'{}',
  '[{"entity":"medical_records","key":"medical_record_id"},{"entity":"invoices","key":"invoice_id"}]'::jsonb,true,array['OWNER','ADMIN']),
 -- K07 inpatient handover/administration evidence and its per-branch input rule.
 ('inpatient_rx_evidence','klinik',null,'{}','refs','inpatient_records','inpatient_record_id',array['id'],array['branch_id'],
  '[{"entity":"inpatient_records","key":"inpatient_record_id"},{"entity":"prescription_items","key":"prescription_item_id"}]'::jsonb,true,array['OWNER','ADMIN']),
 ('inpatient_rx_evidence_settings','klinik',null,array['administration_requires_handover','max_backdate_minutes'],'refs',null,null,array['branch_id'],array['branch_id'],'[]'::jsonb,false,array['OWNER','ADMIN']),
 -- N01 invoice <-> goods receipt link; only the active flag changes afterwards.
 ('purchase_invoice_receipts','pembelian',null,array['active'],'refs','purchase_invoices','invoice_id',array['invoice_id','goods_receipt_id'],'{}',
  '[{"entity":"purchase_invoices","key":"invoice_id"},{"entity":"goods_receipts","key":"goods_receipt_id"}]'::jsonb,false,array['OWNER','ADMIN']),
 -- Q01 claim carries a phone key and has no authenticated reader: retain metadata
 -- under its sale but never expose it through the viewer (as sale_staff_effects).
 ('quest_new_customer_claims','pos',null,'{}','refs','sales','sale_id',array['customer_id'],array['branch_id'],
  '[{"entity":"sales","key":"sale_id"}]'::jsonb,true,'{}')
on conflict (entity) do nothing;

do $$
declare t text;
 new_sources text[]:=array['campaign_codes','payslip_templates','payslip_template_components','employee_payslip_templates',
  'employee_base_salaries','service_commission_policies','branch_grooming_rules','opening_invoice_batches','opening_invoice_lines',
  'recurring_journal_sources','clinic_refund_items','clinic_record_addenda','inpatient_rx_evidence','inpatient_rx_evidence_settings',
  'purchase_invoice_receipts','quest_new_customer_claims'];
begin
 -- Sources registered after 24 Oct with only a change trigger (refunds) or an
 -- insert-only one (immutable history reads) get the same standard pair, so every
 -- source keeps its private deletion record before cascades run.
 foreach t in array new_sources||array['clinic_refund_requests','clinic_refunds','clinic_history_reads'] loop
  if not exists(select 1 from public.activity_log_sources where entity=t) then
   raise exception 'A01 source % is not registered',t;
  end if;
  execute format('create or replace trigger a01_activity_change after insert or update on public.%I for each row execute function public.capture_activity_log()',t);
  execute format('create or replace trigger a01_activity_delete before delete on public.%I for each row execute function public.capture_activity_log()',t);
 end loop;
end$$;
