
do $kamo_reset$
declare
 v_mode text := 'EXECUTE';
 v_reset text[] := array['approval_requests','asset_changes','asset_depreciations','asset_disposals','asset_transfers','bank_reconciliation_requests','bank_reconciliation_revisions','bank_reconciliations','cash_entries','cash_entry_revision_requests','cash_entry_revisions','cash_transfer_requests','cash_transfer_revisions','cash_transfers','cashier_shift_supervisor_closures','cashier_shifts','clinic_advance_applications','clinic_advance_release_requests','clinic_customer_advances','clinic_demo_incentive_allocations','clinic_demo_invoice_snapshots','clinic_dp_overrides','clinic_invoice_operations','clinic_payment_receipt_parts','clinic_payment_receipts','clinic_refund_items','clinic_refund_requests','clinic_refunds','compound_adjustments','compound_issues','expense_posting_requests','expense_revisions','expenses','fixed_asset_corrections','fixed_asset_value_requests','goods_receipt_items','goods_receipts','inventory_adjustment_items','inventory_adjustment_requests','inventory_adjustments','inventory_cost_events','inventory_month_closes','inventory_month_values','invoice_edit_log','invoice_items','invoice_payments','invoices','journal_entries','journal_lines','journal_revision_requests','journal_revisions','manual_journal_create_requests','monetary_opening_corrections','monetary_opening_requests','month_end_runs','opening_balance_create_requests','opening_invoice_batches','opening_invoice_lines','opname_counts','opname_order_items','opname_orders','opname_posting_receipts','opname_result_items','opname_results','payment_order_items','payment_orders','po_payments','point_ledger','pos_sale_postings','production_atomic_postings','production_order_items','production_orders','purchase_advance_cancellations','purchase_advance_capacity_locks','purchase_advance_cascade_cancellations','purchase_advance_requests','purchase_advances','purchase_correction_requests','purchase_invoice_cancellation_requests','purchase_invoice_correction_layers','purchase_invoice_corrections','purchase_invoice_items','purchase_invoice_layer_proofs','purchase_invoice_payments','purchase_invoice_postings','purchase_invoice_receipts','purchase_invoices','purchase_operations','purchase_order_items','purchase_order_receipt_closures','purchase_order_requests','purchase_order_revisions','purchase_orders','purchase_payment_cancellation_requests','purchase_payment_cancellations','purchase_payment_order_requests','purchase_payment_requests','purchase_receipt_cancellations','purchase_return_items','purchase_returns','quest_new_customer_claims','recurring_journal_sources','recurring_source_occurrences','return_record_corrections','return_record_postings','return_record_requests','sale_cancellation_requests','sale_cancellations','sale_drafts','sale_item_group_components','sale_items','sale_payment_correction_gate','sale_payment_correction_requests','sale_payment_corrections','sale_payment_refunds','sale_payments','sale_staff_effects','sales','sales_advances','sales_deliveries','sales_delivery_items','sales_invoice_delivery_allocations','sales_invoice_items','sales_invoices','sales_order_items','sales_orders','sales_posting_requests','sales_quotation_items','sales_quotations','sales_receipt_cancellations','sales_receipts','sales_refund_payouts','sales_refund_requests','sales_return_items','sales_returns','staff_points','staff_points_ledger','staff_quest_progress','staff_reward_redemptions','staff_reward_requests','staff_streaks','stock','stock_document_correction_requests','stock_document_corrections','stock_document_issue_proofs','stock_layers','stock_moves','stock_receipt_items','stock_receipts','stock_request_items','stock_request_shipment_cancellations','stock_requests','stock_transfer_items','stock_transfers','unit_posting_requests','wholesale_invoice_corrections','wholesale_operation_requests','wholesale_payroll_epochs','accurate_inventory_accounting']::text[];
 v_side text[] := array['clinic_private.inpatient_bill_pay_requests','clinic_private.inpatient_cashier_requests','clinic_private.posting_ctx']::text[];
 v_all text[] := array['accounting_locks','accurate_inventory_accounting','activity_log','activity_log_sources','approval_requests','approval_rules','asset_categories','asset_changes','asset_depreciations','asset_disposals','asset_transfers','attendance','bank_reconciliation_requests','bank_reconciliation_revisions','bank_reconciliations','bookings','branch_capacity_periods','branch_grooming_rules','branches','brands','budget_transfers','budgets','campaign_codes','cash_accounts','cash_advance_installments','cash_advances','cash_entries','cash_entry_revision_requests','cash_entry_revisions','cash_transfer_requests','cash_transfer_revisions','cash_transfers','cashier_shift_supervisor_closures','cashier_shifts','category_discounts','clinic_advance_applications','clinic_advance_release_requests','clinic_billing_settings','clinic_compound_sales','clinic_customer_advances','clinic_demo_incentive_allocations','clinic_demo_invoice_snapshots','clinic_demo_policies','clinic_dp_overrides','clinic_full_record_edits','clinic_history_reads','clinic_inpatient_billable_entries','clinic_invoice_operations','clinic_payment_receipt_parts','clinic_payment_receipts','clinic_pending_cart_edits','clinic_record_addenda','clinic_record_corrections','clinic_record_item_additions','clinic_refund_items','clinic_refund_requests','clinic_refunds','coa_accounts','commission_rules','company_settings','compound_adjustments','compound_formula_versions','compound_formulas','compound_issues','compound_official_usage','compounding_ingredients','compounding_recipes','consent_rules','consent_templates','consents','customer_categories','customer_review_statuses','customers','document_attachments','document_numbering','employee_base_salaries','employee_branch_assignments','employee_branch_change_log','employee_import_details','employee_payslip_templates','employee_salary_components','employee_schedules','employees','expense_posting_requests','expense_revisions','expenses','fixed_asset_corrections','fixed_asset_value_requests','fixed_assets','follow_ups','goods_receipt_items','goods_receipts','import_run_rows','import_runs','initial_stock_scope_mappings','inpatient_daily_log_edits','inpatient_daily_logs','inpatient_med_doses','inpatient_medications','inpatient_records','inpatient_rx_evidence','inpatient_rx_evidence_settings','inpatient_status_log','inventory_adjustment_items','inventory_adjustment_requests','inventory_adjustments','inventory_cost_events','inventory_costing_settings','inventory_month_closes','inventory_month_values','invoice_edit_log','invoice_items','invoice_payments','invoices','item_branch_prices','item_categories','item_group_components','item_price_tiers','item_units','item_variant_families','item_variant_members','items','journal_entries','journal_lines','journal_revision_requests','journal_revisions','kpi_records','leave_requests','manual_journal_create_requests','master_data_lifecycle_audit','medical_equipment','medical_equipment_maintenance','medical_records','monetary_opening_corrections','monetary_opening_requests','month_end_runs','notifications','opening_balance_create_requests','opening_invoice_batches','opening_invoice_lines','operational_alert_settings','opname_counts','opname_order_items','opname_orders','opname_posting_receipts','opname_result_items','opname_results','overtime_requests','payment_account_map','payment_order_items','payment_orders','payroll_settings','payrolls','payslip_override_history','payslip_template_components','payslip_templates','pet_ownership_transfers','pets','po_payments','point_ledger','pos_sale_postings','prescription_items','private_report_presets','production_atomic_postings','production_order_items','production_orders','production_recipe_items','production_recipes','profiles','promo_import_batches','promo_import_targets','promo_items','promos','purchase_advance_cancellations','purchase_advance_capacity_locks','purchase_advance_cascade_cancellations','purchase_advance_requests','purchase_advances','purchase_correction_requests','purchase_invoice_cancellation_requests','purchase_invoice_correction_layers','purchase_invoice_corrections','purchase_invoice_items','purchase_invoice_layer_proofs','purchase_invoice_payments','purchase_invoice_postings','purchase_invoice_receipts','purchase_invoices','purchase_operations','purchase_order_items','purchase_order_receipt_closures','purchase_order_requests','purchase_order_revisions','purchase_orders','purchase_payment_cancellation_requests','purchase_payment_cancellations','purchase_payment_order_requests','purchase_payment_requests','purchase_receipt_cancellations','purchase_return_items','purchase_returns','quest_new_customer_claims','quest_settings','recurring_journal_sources','recurring_journals','recurring_source_occurrences','reimbursements','return_record_corrections','return_record_postings','return_record_requests','role_capabilities','role_modules','salary_components','sale_cancellation_requests','sale_cancellations','sale_drafts','sale_item_group_components','sale_items','sale_payment_correction_gate','sale_payment_correction_requests','sale_payment_corrections','sale_payment_refunds','sale_payments','sale_staff_effects','sales','sales_advances','sales_deliveries','sales_delivery_items','sales_invoice_delivery_allocations','sales_invoice_items','sales_invoices','sales_order_items','sales_orders','sales_posting_requests','sales_quotation_items','sales_quotations','sales_receipt_cancellations','sales_receipts','sales_refund_payouts','sales_refund_requests','sales_return_items','sales_returns','sales_targets','service_commission_policies','simulation_reset_audits','staff_points','staff_points_ledger','staff_quest_definitions','staff_quest_progress','staff_reward_catalog','staff_reward_redemptions','staff_reward_requests','staff_streaks','stock','stock_document_correction_requests','stock_document_corrections','stock_document_issue_proofs','stock_layers','stock_moves','stock_receipt_items','stock_receipts','stock_request_items','stock_request_shipment_cancellations','stock_requests','stock_transfer_items','stock_transfers','supplier_categories','suppliers','tax_asset_categories','tier_settings','unit_posting_requests','units','user_account_edits','user_branches','visit_operational_events','visit_referrals','visits','vouchers','wa_engine_settings','warehouses','whatsapp_message_log','wholesale_invoice_corrections','wholesale_operation_requests','wholesale_payroll_epochs','work_shifts']::text[];
 v_keep text[] := array['accounting_locks','activity_log','activity_log_sources','approval_rules','asset_categories','attendance','bookings','branch_capacity_periods','branch_grooming_rules','branches','brands','budget_transfers','budgets','campaign_codes','cash_accounts','cash_advance_installments','cash_advances','category_discounts','clinic_billing_settings','clinic_compound_sales','clinic_demo_policies','clinic_full_record_edits','clinic_history_reads','clinic_inpatient_billable_entries','clinic_pending_cart_edits','clinic_record_addenda','clinic_record_corrections','clinic_record_item_additions','coa_accounts','commission_rules','company_settings','compound_formula_versions','compound_formulas','compound_official_usage','compounding_ingredients','compounding_recipes','consent_rules','consent_templates','consents','customer_categories','customer_review_statuses','customers','document_attachments','document_numbering','employee_base_salaries','employee_branch_assignments','employee_branch_change_log','employee_import_details','employee_payslip_templates','employee_salary_components','employee_schedules','employees','fixed_assets','follow_ups','import_run_rows','import_runs','initial_stock_scope_mappings','inpatient_daily_log_edits','inpatient_daily_logs','inpatient_med_doses','inpatient_medications','inpatient_records','inpatient_rx_evidence','inpatient_rx_evidence_settings','inpatient_status_log','inventory_costing_settings','item_branch_prices','item_categories','item_group_components','item_price_tiers','item_units','item_variant_families','item_variant_members','items','kpi_records','leave_requests','master_data_lifecycle_audit','medical_equipment','medical_equipment_maintenance','medical_records','notifications','operational_alert_settings','overtime_requests','payment_account_map','payroll_settings','payrolls','payslip_override_history','payslip_template_components','payslip_templates','pet_ownership_transfers','pets','prescription_items','private_report_presets','production_recipe_items','production_recipes','profiles','promo_import_batches','promo_import_targets','promo_items','promos','quest_settings','recurring_journals','reimbursements','role_capabilities','role_modules','salary_components','sales_targets','service_commission_policies','simulation_reset_audits','staff_quest_definitions','staff_reward_catalog','supplier_categories','suppliers','tax_asset_categories','tier_settings','units','user_account_edits','user_branches','visit_operational_events','visit_referrals','visits','vouchers','wa_engine_settings','warehouses','whatsapp_message_log','work_shifts']::text[];
 v_now timestamptz := clock_timestamp();
 v_tables text[]; v_remaining text[]; v_ready text[]; v_t text; v_n bigint; v_counts jsonb := '{}';
 v_fp_before jsonb; v_fp_after jsonb; v_al_max bigint; v_al_n bigint; v_al_h text; v_al_h2 text; v_al_n2 bigint;
 v_patch record; v_def text; v_new text; v_cnt int := 0; v_bad text; v_manifest jsonb; v_receipt jsonb;
 v_expense_ids uuid[]; v_att jsonb; v_cust jsonb; v_pos int; v_idx int;
begin
 perform set_config('lock_timeout','20s',true);
 -- 0. Scope: the table set must equal the reviewed classification exactly.
 select array_agg(c.relname::text order by c.relname) into v_tables from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p');
 if v_tables is distinct from v_all then
  raise exception 'KAMO_RESET_ABORT: daftar tabel berubah sejak manifest ditinjau (baru: %, hilang: %)',
   (select array_agg(x) from unnest(v_tables) x where x<>all(v_all)), (select array_agg(x) from unnest(v_all) x where x<>all(v_tables));
 end if;

 -- 1. Freeze writes for the whole reset (reads stay possible). Lock waits fail fast.
 lock table auth.users in share mode;
 execute (select 'lock table '||string_agg(format('%I.%I',n.nspname,c.relname),',')||' in exclusive mode'
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where c.relkind in ('r','p') and n.nspname in ('public','clinic_private','kamo_import','kamo_maintenance','arsip_20260801') and has_table_privilege(c.oid,'UPDATE'));
 -- Tables this role may only read (import staging) are read-locked; their fingerprint is verified below.
 execute coalesce((select 'lock table '||string_agg(format('%I.%I',n.nspname,c.relname),',')||' in access share mode'
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where c.relkind in ('r','p') and n.nspname in ('public','clinic_private','kamo_import','kamo_maintenance','arsip_20260801') and not has_table_privilege(c.oid,'UPDATE')),'select 1');

 -- 2. Fingerprints of everything that must stay identical.
 create temp table kr_fp(tbl text primary key, n bigint, h text) on commit drop;
 select coalesce(array_agg(id),'{}') into v_expense_ids from public.expenses;
 for v_t in select format('%I.%I',n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where c.relkind in ('r','p') and ((n.nspname='public' and c.relname<>all(v_reset) and c.relname not in ('activity_log','customers','document_attachments'))
     or n.nspname in ('kamo_import','kamo_maintenance','arsip_20260801')
     or (n.nspname='clinic_private' and format('%I.%I',n.nspname,c.relname)<>all(v_side))) loop
  execute format('insert into kr_fp select %L,count(*),md5(coalesce(string_agg(h,'','' order by h),'''')) from (select md5(to_jsonb(t)::text) h from %s t) s',v_t,v_t);
 end loop;
 insert into kr_fp select 'public.customers*',count(*),md5(coalesce(string_agg(h,',' order by h),'')) from
  (select md5((to_jsonb(t)-array['points','total_spending','tier','tier_downgraded_at'])::text) h from public.customers t) s;
 insert into kr_fp select 'public.document_attachments*',count(*),md5(coalesce(string_agg(h,',' order by h),'')) from
  (select md5(to_jsonb(t)::text) h from public.document_attachments t where t.modul<>'pengeluaran') s;
 insert into kr_fp select 'auth.users.id',count(*),md5(coalesce(string_agg(id::text,',' order by id),'')) from auth.users;
 insert into kr_fp select 'storage.objects',count(*),md5(coalesce(string_agg(bucket_id||'/'||name,',' order by bucket_id,name),'')) from storage.objects;
 select max(id),count(*) into v_al_max,v_al_n from public.activity_log;
 select md5(coalesce(string_agg(md5(to_jsonb(t)::text),',' order by id),'')) into v_al_h from public.activity_log t;
 v_fp_before := (select jsonb_object_agg(k,h) from (
 select 'col:'||c.table_schema||'.'||c.table_name||'.'||c.column_name k, md5(c.data_type||'|'||c.udt_name||'|'||c.is_nullable||'|'||coalesce(c.column_default,'')) h from information_schema.columns c where c.table_schema in ('public','clinic_private','kamo_import','private')
 union all select 'con:'||n.nspname||'.'||t.relname||'.'||x.conname, md5(pg_get_constraintdef(x.oid)) from pg_constraint x join pg_class t on t.oid=x.conrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname in ('public','clinic_private','kamo_import','private')
 union all select 'trg:'||n.nspname||'.'||t.relname||'.'||g.tgname, md5(pg_get_triggerdef(g.oid)||g.tgenabled::text) from pg_trigger g join pg_class t on t.oid=g.tgrelid join pg_namespace n on n.oid=t.relnamespace where not g.tgisinternal and n.nspname in ('public','clinic_private','kamo_import','private')
 union all select 'fn:'||p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','clinic_private','kamo_import','private') and p.prokind in ('f','p')
 union all select 'rls:'||n.nspname||'.'||t.relname, md5(t.relrowsecurity::text||t.relforcerowsecurity::text) from pg_class t join pg_namespace n on n.oid=t.relnamespace where t.relkind='r' and n.nspname in ('public','clinic_private','kamo_import','private')
 union all select 'pol:'||schemaname||'.'||tablename||'.'||policyname, md5(coalesce(qual,'')||coalesce(with_check,'')||cmd||array_to_string(roles,',')) from pg_policies where schemaname in ('public','clinic_private','kamo_import','private')
) s);

 -- 3. Manifest (what is about to be emptied) recorded in the receipt.
 v_manifest := '{}';
 foreach v_t in array v_reset loop
  execute format('select count(*) from public.%I',v_t) into v_n; v_manifest := v_manifest||jsonb_build_object(v_t,v_n);
 end loop;
 foreach v_t in array v_side loop
  execute format('select count(*) from %s',v_t) into v_n; v_manifest := v_manifest||jsonb_build_object(v_t,v_n);
 end loop;
 select jsonb_agg(to_jsonb(t)) into v_att from public.document_attachments t where t.modul='pengeluaran';
 select jsonb_agg(jsonb_build_object('id',id,'points',points,'total_spending',total_spending,'tier',tier,'tier_downgraded_at',tier_downgraded_at))
  into v_cust from public.customers where points<>0 or total_spending<>0 or tier is distinct from 'New' or tier_downgraded_at is not null;

 -- 4. Scoped, transaction-local delete permission on guard functions of reset tables.
 create temp table kr_patch(oid oid primary key, fn text, def text, md5_orig text) on commit drop;
 insert into kr_patch select distinct p.oid, p.oid::regprocedure::text, pg_get_functiondef(p.oid), md5(pg_get_functiondef(p.oid))
  from pg_trigger g join pg_class c on c.oid=g.tgrelid join pg_namespace n on n.oid=c.relnamespace join pg_proc p on p.oid=g.tgfoid
  where not g.tgisinternal and g.tgenabled<>'D' and (g.tgtype & 1)=1 and (g.tgtype & 2)=2 and (g.tgtype & 8)=8
   and ((n.nspname='public' and c.relname=any(v_reset)) or format('%I.%I',n.nspname,c.relname)=any(v_side))
   and p.proname<>'capture_activity_log' and (array['guard_accurate_inventory_accounting','guard_completed_opname_counts','guard_po_receipt_closure_immutable','guard_purchase_receipt_cancellation_immutable','pos_sale_allocation_immutable','sales_allocations_immutable','guard_cancelled_opname_children','unit_posted_sale_source_immutable','guard_posted_sale_movement','guard_opening_invoice']::text[] is null or p.proname=any(array['guard_accurate_inventory_accounting','guard_completed_opname_counts','guard_po_receipt_closure_immutable','guard_purchase_receipt_cancellation_immutable','pos_sale_allocation_immutable','sales_allocations_immutable','guard_cancelled_opname_children','unit_posted_sale_source_immutable','guard_posted_sale_movement','guard_opening_invoice']::text[]));
 for v_patch in select * from kr_patch order by fn loop
  v_pos := strpos(v_patch.def, 'AS $function$') + 13;
  v_idx := regexp_instr(substr(v_patch.def, v_pos), '\mbegin\M', 1, 1, 0, 'i');
  if v_pos<=13 or v_idx=0 then raise exception 'KAMO_RESET_ABORT: badan fungsi % tidak dikenali',v_patch.fn; end if;
  v_new := left(v_patch.def, v_pos+v_idx-2)||'begin if tg_op=''DELETE'' and tg_table_name=any('||'array[''approval_requests'',''asset_changes'',''asset_depreciations'',''asset_disposals'',''asset_transfers'',''bank_reconciliation_requests'',''bank_reconciliation_revisions'',''bank_reconciliations'',''cash_entries'',''cash_entry_revision_requests'',''cash_entry_revisions'',''cash_transfer_requests'',''cash_transfer_revisions'',''cash_transfers'',''cashier_shift_supervisor_closures'',''cashier_shifts'',''clinic_advance_applications'',''clinic_advance_release_requests'',''clinic_customer_advances'',''clinic_demo_incentive_allocations'',''clinic_demo_invoice_snapshots'',''clinic_dp_overrides'',''clinic_invoice_operations'',''clinic_payment_receipt_parts'',''clinic_payment_receipts'',''clinic_refund_items'',''clinic_refund_requests'',''clinic_refunds'',''compound_adjustments'',''compound_issues'',''expense_posting_requests'',''expense_revisions'',''expenses'',''fixed_asset_corrections'',''fixed_asset_value_requests'',''goods_receipt_items'',''goods_receipts'',''inventory_adjustment_items'',''inventory_adjustment_requests'',''inventory_adjustments'',''inventory_cost_events'',''inventory_month_closes'',''inventory_month_values'',''invoice_edit_log'',''invoice_items'',''invoice_payments'',''invoices'',''journal_entries'',''journal_lines'',''journal_revision_requests'',''journal_revisions'',''manual_journal_create_requests'',''monetary_opening_corrections'',''monetary_opening_requests'',''month_end_runs'',''opening_balance_create_requests'',''opening_invoice_batches'',''opening_invoice_lines'',''opname_counts'',''opname_order_items'',''opname_orders'',''opname_posting_receipts'',''opname_result_items'',''opname_results'',''payment_order_items'',''payment_orders'',''po_payments'',''point_ledger'',''pos_sale_postings'',''production_atomic_postings'',''production_order_items'',''production_orders'',''purchase_advance_cancellations'',''purchase_advance_capacity_locks'',''purchase_advance_cascade_cancellations'',''purchase_advance_requests'',''purchase_advances'',''purchase_correction_requests'',''purchase_invoice_cancellation_requests'',''purchase_invoice_correction_layers'',''purchase_invoice_corrections'',''purchase_invoice_items'',''purchase_invoice_layer_proofs'',''purchase_invoice_payments'',''purchase_invoice_postings'',''purchase_invoice_receipts'',''purchase_invoices'',''purchase_operations'',''purchase_order_items'',''purchase_order_receipt_closures'',''purchase_order_requests'',''purchase_order_revisions'',''purchase_orders'',''purchase_payment_cancellation_requests'',''purchase_payment_cancellations'',''purchase_payment_order_requests'',''purchase_payment_requests'',''purchase_receipt_cancellations'',''purchase_return_items'',''purchase_returns'',''quest_new_customer_claims'',''recurring_journal_sources'',''recurring_source_occurrences'',''return_record_corrections'',''return_record_postings'',''return_record_requests'',''sale_cancellation_requests'',''sale_cancellations'',''sale_drafts'',''sale_item_group_components'',''sale_items'',''sale_payment_correction_gate'',''sale_payment_correction_requests'',''sale_payment_corrections'',''sale_payment_refunds'',''sale_payments'',''sale_staff_effects'',''sales'',''sales_advances'',''sales_deliveries'',''sales_delivery_items'',''sales_invoice_delivery_allocations'',''sales_invoice_items'',''sales_invoices'',''sales_order_items'',''sales_orders'',''sales_posting_requests'',''sales_quotation_items'',''sales_quotations'',''sales_receipt_cancellations'',''sales_receipts'',''sales_refund_payouts'',''sales_refund_requests'',''sales_return_items'',''sales_returns'',''staff_points'',''staff_points_ledger'',''staff_quest_progress'',''staff_reward_redemptions'',''staff_reward_requests'',''staff_streaks'',''stock'',''stock_document_correction_requests'',''stock_document_corrections'',''stock_document_issue_proofs'',''stock_layers'',''stock_moves'',''stock_receipt_items'',''stock_receipts'',''stock_request_items'',''stock_request_shipment_cancellations'',''stock_requests'',''stock_transfer_items'',''stock_transfers'',''unit_posting_requests'',''wholesale_invoice_corrections'',''wholesale_operation_requests'',''wholesale_payroll_epochs'',''accurate_inventory_accounting'']'||') then return old; end if; '||substr(v_patch.def, v_pos+v_idx+4);
  if v_new=v_patch.def then raise exception 'KAMO_RESET_ABORT: tidak dapat menyiapkan izin hapus untuk %',v_patch.fn; end if;
  execute v_new; v_cnt := v_cnt+1;
 end loop;

 -- 5. Delete reset tables, children before parents (FKs, triggers and audit stay active).
 v_remaining := v_reset;
 while cardinality(v_remaining)>0 loop
  select array_agg(t order by t) into v_ready from unnest(v_remaining) t where not exists(
   select 1 from pg_constraint c where c.contype='f' and c.confrelid=format('public.%I',t)::regclass
    and c.conrelid<>c.confrelid and c.conrelid in (select format('public.%I',x)::regclass from unnest(v_remaining) x));
  if v_ready is null then
   -- An empty table in a reference cycle can be removed from the ordering safely.
   v_ready := '{}';
   foreach v_t in array v_remaining loop
    execute format('select count(*) from public.%I',v_t) into v_n;
    if v_n=0 then v_ready := v_ready||v_t; end if;
   end loop;
   if cardinality(v_ready)=0 then raise exception 'KAMO_RESET_ABORT: ketergantungan melingkar %',v_remaining; end if;
  end if;
  foreach v_t in array v_ready loop
   execute format('delete from public.%I',v_t); get diagnostics v_n=row_count;
   v_counts := v_counts||jsonb_build_object(v_t,v_n);
  end loop;
  select coalesce(array_agg(t),'{}') into v_remaining from unnest(v_remaining) t where t<>all(v_ready);
 end loop;
 foreach v_t in array v_side loop
  execute format('delete from %s',v_t); get diagnostics v_n=row_count; v_counts := v_counts||jsonb_build_object(v_t,v_n);
 end loop;

 -- 6. Derived effects of the removed transactions.
 update public.customers set points=0,total_spending=0,tier='New',tier_downgraded_at=null
  where points<>0 or total_spending<>0 or tier is distinct from 'New' or tier_downgraded_at is not null;
 get diagnostics v_n=row_count; v_counts := v_counts||jsonb_build_object('customers(poin/belanja/tier)',v_n);
 delete from public.document_attachments where modul='pengeluaran';
 get diagnostics v_n=row_count; v_counts := v_counts||jsonb_build_object('document_attachments(bukti pengeluaran)',v_n);

 -- 7. Re-create the exact original guard definitions.
 for v_patch in select * from kr_patch order by fn loop
  execute v_patch.def;
  if md5(pg_get_functiondef(v_patch.oid)) is distinct from v_patch.md5_orig then
   raise exception 'KAMO_RESET_ABORT: definisi pengaman % tidak kembali identik',v_patch.fn; end if;
 end loop;

 -- 8. Verification. Any failure raises and rolls everything back.
 foreach v_t in array v_reset loop
  execute format('select count(*) from public.%I',v_t) into v_n;
  if v_n<>0 then raise exception 'KAMO_RESET_VERIFY: % masih berisi % baris',v_t,v_n; end if;
 end loop;
 foreach v_t in array v_side loop
  execute format('select count(*) from %s',v_t) into v_n;
  if v_n<>0 then raise exception 'KAMO_RESET_VERIFY: % masih berisi % baris',v_t,v_n; end if;
 end loop;
 for v_t in select tbl from kr_fp loop
  if v_t='public.customers*' then
   select md5(coalesce(string_agg(h,',' order by h),'')) into v_bad from (select md5((to_jsonb(t)-array['points','total_spending','tier','tier_downgraded_at'])::text) h from public.customers t) s;
  elsif v_t='public.document_attachments*' then
   select md5(coalesce(string_agg(h,',' order by h),'')) into v_bad from (select md5(to_jsonb(t)::text) h from public.document_attachments t) s;
  elsif v_t='auth.users.id' then
   select md5(coalesce(string_agg(id::text,',' order by id),'')) into v_bad from auth.users;
  elsif v_t='storage.objects' then
   select md5(coalesce(string_agg(bucket_id||'/'||name,',' order by bucket_id,name),'')) into v_bad from storage.objects;
  else
   execute format('select md5(coalesce(string_agg(h,'','' order by h),'''')) from (select md5(to_jsonb(t)::text) h from %s t) s',v_t) into v_bad;
  end if;
  if v_bad is distinct from (select h from kr_fp where tbl=v_t) then raise exception 'KAMO_RESET_VERIFY: data yang dilindungi berubah: %',v_t; end if;
 end loop;
 if exists(select 1 from public.customers where points<>0 or total_spending<>0 or tier is distinct from 'New' or tier_downgraded_at is not null) then
  raise exception 'KAMO_RESET_VERIFY: poin/belanja pelanggan belum bersih'; end if;
 select md5(coalesce(string_agg(md5(to_jsonb(t)::text),',' order by id),'')),count(*) into v_al_h2,v_al_n2 from public.activity_log t where id<=v_al_max;
 if v_al_h2 is distinct from v_al_h or v_al_n2<>v_al_n then raise exception 'KAMO_RESET_VERIFY: log aktivitas lama berubah'; end if;
 v_fp_after := (select jsonb_object_agg(k,h) from (
 select 'col:'||c.table_schema||'.'||c.table_name||'.'||c.column_name k, md5(c.data_type||'|'||c.udt_name||'|'||c.is_nullable||'|'||coalesce(c.column_default,'')) h from information_schema.columns c where c.table_schema in ('public','clinic_private','kamo_import','private')
 union all select 'con:'||n.nspname||'.'||t.relname||'.'||x.conname, md5(pg_get_constraintdef(x.oid)) from pg_constraint x join pg_class t on t.oid=x.conrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname in ('public','clinic_private','kamo_import','private')
 union all select 'trg:'||n.nspname||'.'||t.relname||'.'||g.tgname, md5(pg_get_triggerdef(g.oid)||g.tgenabled::text) from pg_trigger g join pg_class t on t.oid=g.tgrelid join pg_namespace n on n.oid=t.relnamespace where not g.tgisinternal and n.nspname in ('public','clinic_private','kamo_import','private')
 union all select 'fn:'||p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','clinic_private','kamo_import','private') and p.prokind in ('f','p')
 union all select 'rls:'||n.nspname||'.'||t.relname, md5(t.relrowsecurity::text||t.relforcerowsecurity::text) from pg_class t join pg_namespace n on n.oid=t.relnamespace where t.relkind='r' and n.nspname in ('public','clinic_private','kamo_import','private')
 union all select 'pol:'||schemaname||'.'||tablename||'.'||policyname, md5(coalesce(qual,'')||coalesce(with_check,'')||cmd||array_to_string(roles,',')) from pg_policies where schemaname in ('public','clinic_private','kamo_import','private')
) s);
 if v_fp_after is distinct from v_fp_before then raise exception 'KAMO_RESET_VERIFY: struktur/pengaman/RLS berubah'; end if;
 if exists(select 1 from pg_trigger g join pg_class c on c.oid=g.tgrelid join pg_namespace n on n.oid=c.relnamespace
   where n.nspname in ('public','clinic_private','kamo_import') and not g.tgisinternal and g.tgenabled<>'O') then
  raise exception 'KAMO_RESET_VERIFY: ada trigger yang tidak aktif'; end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity) then
  raise exception 'KAMO_RESET_VERIFY: ada tabel tanpa RLS'; end if;

 v_receipt := jsonb_build_object('mode',v_mode,'started_at',v_now,'finished_at',clock_timestamp(),'database',current_database(),
  'manifest_before',v_manifest,'deleted',v_counts,'guards_scoped',v_cnt,'protected_tables_checked',(select count(*) from kr_fp),
  'protected_fingerprint',(select md5(string_agg(tbl||':'||n||':'||h,',' order by tbl)) from kr_fp),
  'activity_log_preserved_rows',v_al_n,'activity_log_rows_added',(select count(*) from public.activity_log where id>v_al_max),
  'customer_derived_before',coalesce(v_cust,'[]'),'expense_attachments_removed',coalesce(v_att,'[]'),
  'schema_fingerprint',md5(v_fp_before::text));
 if v_mode='DRYRUN' then raise exception 'KAMO_RESET_DRYRUN_OK %',v_receipt::text; end if;
 create table if not exists kamo_maintenance.transaction_reset_runs(id uuid primary key default gen_random_uuid(),created_at timestamptz not null default now(),receipt jsonb not null);
 insert into kamo_maintenance.transaction_reset_runs(receipt) values(v_receipt);
end $kamo_reset$;
