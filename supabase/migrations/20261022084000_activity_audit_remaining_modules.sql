-- Explicit remaining business modules: CRM/clinic are metadata-only; no
-- medical text, customer fields, signatures, bank details, payloads or secrets.
insert into public.activity_log_sources(entity,module_id,label_key,value_keys,scope_kind,parent_entity,parent_key,identity_keys,branch_columns,scope_parents,metadata_only,reader_roles) values
 ('coa_accounts','buku-besar','code','{}','global',null,null,array['id'],'{}','[]'::jsonb,true,array['OWNER','ADMIN']),
 ('cash_accounts','kas-bank',null,'{}','account',null,null,array['id'],'{}','[]'::jsonb,true,array['OWNER','ADMIN']),
 ('payment_account_map','kas-bank',null,'{}','refs',null,null,array['id'],array['branch_id'],'[{"entity":"cash_accounts","key":"cash_account_id"}]'::jsonb,true,array['OWNER','ADMIN']),
 ('budgets','buku-besar',null,'{}','direct',null,null,array['id'],'{}','[]'::jsonb,true,array['OWNER','ADMIN']),
 ('budget_transfers','buku-besar',null,'{}','direct',null,null,array['id'],'{}','[]'::jsonb,true,array['OWNER','ADMIN']),
 ('recurring_journals','buku-besar',null,'{}','direct',null,null,array['id'],'{}','[]'::jsonb,true,array['OWNER','ADMIN']),
 ('accounting_locks','buku-besar',null,'{}','all',null,null,array['id'],'{}','[]'::jsonb,true,array['OWNER','ADMIN']),
 ('month_end_runs','perusahaan',null,'{}','all',null,null,array['id'],'{}','[]'::jsonb,true,array['OWNER','ADMIN']),
 ('asset_categories','aset-tetap',null,'{}','global',null,null,array['id'],'{}','[]'::jsonb,true,array['OWNER','ADMIN']),
 ('tax_asset_categories','pajak',null,'{}','global',null,null,array['id'],'{}','[]'::jsonb,true,array['OWNER','ADMIN']),
 ('customer_categories','crm',null,'{}','global',null,null,array['id'],'{}','[]'::jsonb,true,array['OWNER','ADMIN']),
 ('customer_review_statuses','crm',null,'{}','global',null,null,array['id'],'{}','[]'::jsonb,true,array['OWNER','ADMIN']),
 ('promos','crm',null,'{}','global',null,null,array['id'],'{}','[]'::jsonb,true,array['OWNER','ADMIN']),
 ('vouchers','crm',null,'{}','global',null,null,array['id'],'{}','[]'::jsonb,true,array['OWNER','ADMIN']),
 ('category_discounts','crm',null,'{}','global',null,null,array['id'],'{}','[]'::jsonb,true,array['OWNER','ADMIN']),
 ('pets','crm',null,'{}','refs',null,null,array['id'],'{}','[{"entity":"customers","key":"customer_id"}]'::jsonb,true,array['OWNER','ADMIN']),
 ('pet_ownership_transfers','crm',null,'{}','refs',null,null,array['id'],'{}','[{"entity":"pets","key":"pet_id"},{"entity":"customers","key":"from_customer_id"},{"entity":"customers","key":"to_customer_id"}]'::jsonb,true,array['OWNER','ADMIN']),
 ('promo_items','crm',null,'{}','refs','promos','promo_id',array['promo_id','item_id'],'{}','[{"entity":"promos","key":"promo_id"}]'::jsonb,true,array['OWNER','ADMIN']),
 ('medical_records','klinik',null,'{}','refs','visits','visit_id',array['id'],'{}','[{"entity":"visits","key":"visit_id"}]'::jsonb,true,array['OWNER','ADMIN']),
 ('prescription_items','klinik',null,'{}','refs','medical_records','medical_record_id',array['id'],'{}','[]'::jsonb,true,array['OWNER','ADMIN']),
 ('inpatient_records','klinik',null,'{}','refs',null,null,array['id'],array['branch_id'],'[{"entity":"visits","key":"visit_id"}]'::jsonb,true,array['OWNER','ADMIN']),
 ('inpatient_daily_logs','klinik',null,'{}','refs','inpatient_records','inpatient_record_id',array['id'],'{}','[]'::jsonb,true,array['OWNER','ADMIN']),
 ('inpatient_medications','klinik',null,'{}','refs','inpatient_records','inpatient_record_id',array['id'],'{}','[]'::jsonb,true,array['OWNER','ADMIN']),
 ('inpatient_med_doses','klinik',null,'{}','refs','inpatient_medications','medication_id',array['id'],'{}','[]'::jsonb,true,array['OWNER','ADMIN']),
 ('compounding_recipes','klinik',null,'{}','refs','medical_records','medical_record_id',array['id'],'{}','[]'::jsonb,true,array['OWNER','ADMIN']),
 ('compounding_ingredients','klinik',null,'{}','refs','compounding_recipes','recipe_id',array['id'],'{}','[]'::jsonb,true,array['OWNER','ADMIN']),
 ('compound_formulas','klinik','code','{}','global',null,null,array['id'],'{}','[]'::jsonb,true,array['OWNER','ADMIN']),
 ('compound_formula_versions','klinik',null,'{}','refs','compound_formulas','formula_id',array['id'],'{}','[]'::jsonb,true,array['OWNER','ADMIN']),
 ('compound_issues','klinik',null,'{}','refs','compounding_recipes','recipe_id',array['id'],'{}','[{"entity":"warehouses","key":"warehouse_id"}]'::jsonb,true,'{}'),
 ('compound_official_usage','klinik',null,'{}','refs','compounding_recipes','recipe_id',array['recipe_id'],'{}','[]'::jsonb,true,array['OWNER','ADMIN']),
 ('clinic_demo_policies','klinik',null,'{}','all',null,null,array['id'],'{}','[]'::jsonb,true,array['OWNER','ADMIN']),
 ('clinic_demo_invoice_snapshots','klinik',null,'{}','refs','invoices','invoice_id',array['invoice_id'],array['branch_id'],'[]'::jsonb,true,array['OWNER','ADMIN']),
 ('clinic_demo_incentive_allocations','klinik',null,'{}','refs','invoices','invoice_id',array['invoice_id','employee_id'],'{}','[]'::jsonb,true,array['OWNER','ADMIN']),
 ('bookings','klinik',null,'{}','direct',null,null,array['id'],'{}','[]'::jsonb,true,array['OWNER','ADMIN']),
 ('branch_capacity_periods','klinik',null,'{}','direct',null,null,array['id'],'{}','[]'::jsonb,true,array['OWNER','ADMIN']),
 ('consents','klinik',null,'{}','refs','visits','visit_id',array['id'],'{}','[]'::jsonb,true,array['OWNER','ADMIN']),
 ('consent_templates','klinik',null,'{}','direct',null,null,array['id'],'{}','[]'::jsonb,true,array['OWNER','ADMIN']),
 ('consent_rules','klinik',null,'{}','all',null,null,array['kategori'],'{}','[]'::jsonb,true,array['OWNER','ADMIN']),
 ('follow_ups','klinik',null,'{}','refs',null,null,array['id'],array['branch_id'],'[{"entity":"visits","key":"visit_id"},{"entity":"medical_records","key":"medical_record_id"}]'::jsonb,true,array['OWNER','ADMIN']),
 ('medical_equipment','klinik',null,'{}','direct',null,null,array['id'],'{}','[]'::jsonb,true,array['OWNER','ADMIN']),
 ('medical_equipment_maintenance','klinik',null,'{}','refs','medical_equipment','equipment_id',array['id'],'{}','[]'::jsonb,true,array['OWNER','ADMIN']),
 ('visit_referrals','klinik',null,'{}','refs','visits','visit_id',array['id'],array['branch_id'],'[]'::jsonb,true,array['OWNER','ADMIN']),
 ('visit_operational_events','klinik',null,'{}','refs',null,null,array['id'],array['branch_id'],'[{"entity":"visits","key":"visit_id"},{"entity":"bookings","key":"booking_id"}]'::jsonb,true,array['OWNER','ADMIN']),
 ('whatsapp_message_log','pengaturan',null,'{}','direct',null,null,array['id'],'{}','[]'::jsonb,true,array['OWNER','ADMIN']),
 ('import_runs','pengaturan',null,'{}','direct',null,null,array['id'],'{}','[]'::jsonb,true,array['OWNER','ADMIN']),
 ('import_run_rows','pengaturan',null,'{}','refs','import_runs','run_id',array['id'],'{}','[]'::jsonb,true,array['OWNER','ADMIN']),
 ('initial_stock_scope_mappings','pengaturan',null,'{}','refs',null,null,array['id'],array['branch_id'],'[{"entity":"warehouses","key":"warehouse_id"}]'::jsonb,true,array['OWNER','ADMIN']),
 ('document_attachments','perusahaan',null,'{}','refs',null,null,array['id'],'{}','[]'::jsonb,true,array['OWNER','ADMIN']),
 ('accurate_inventory_accounting','pos',null,'{}','refs','import_runs','run_id',array['run_id'],'{}','[]'::jsonb,true,'{}');

-- Associate pre-existing registered headers with their actual document parents.
-- No old event is inferred from source state; these references apply only to
-- mutations captured after this migration.
update public.activity_log_sources set scope_parents='[{"entity":"visits","key":"visit_id"}]' where entity='invoices';
update public.activity_log_sources set scope_parents='[{"entity":"sales_orders","key":"order_id"}]' where entity='sales_deliveries';
update public.activity_log_sources set scope_parents='[{"entity":"purchase_orders","key":"po_id"}]' where entity in ('goods_receipts','purchase_invoices');
update public.activity_log_sources set scope_parents='[{"entity":"stock_requests","key":"stock_request_id"}]' where entity='stock_receipts';
update public.activity_log_sources set scope_parents='[{"entity":"opname_orders","key":"order_id"}]' where entity='opname_results';

-- Attachment references are polymorphic in the existing application. Resolve
-- only known module/table pairs that actually exist (or have a tombstone).
-- Matching ambiguous IDs require every matching scope; unknown IDs stay all-scope.
update public.activity_log_sources set module_column='modul',
 module_map='{"penjualan":"pos","pembelian":"pembelian","pengeluaran":"kas-bank"}'::jsonb,
 scope_parents='[{"entity":"sales","key":"ref_id","when_key":"modul","when_value":"penjualan","optional":true,"group":true},
 {"entity":"purchase_orders","key":"ref_id","when_key":"modul","when_value":"pembelian","optional":true,"group":true},
 {"entity":"purchase_invoices","key":"ref_id","when_key":"modul","when_value":"pembelian","optional":true,"group":true},
 {"entity":"expenses","key":"ref_id","when_key":"modul","when_value":"pengeluaran","optional":true,"group":true},
 {"entity":"cash_entries","key":"ref_id","when_key":"modul","when_value":"pengeluaran","optional":true,"group":true}]'::jsonb
 where entity='document_attachments';

do $$declare t text;begin
 foreach t in array array['coa_accounts','cash_accounts','payment_account_map','budgets','budget_transfers','recurring_journals','accounting_locks','month_end_runs','asset_categories','tax_asset_categories','customer_categories','customer_review_statuses','promos','vouchers','category_discounts','pets','pet_ownership_transfers','promo_items','medical_records','prescription_items','inpatient_records','inpatient_daily_logs','inpatient_medications','inpatient_med_doses','compounding_recipes','compounding_ingredients','compound_formulas','compound_formula_versions','compound_issues','compound_official_usage','clinic_demo_policies','clinic_demo_invoice_snapshots','clinic_demo_incentive_allocations','bookings','branch_capacity_periods','consents','consent_templates','consent_rules','follow_ups','medical_equipment','medical_equipment_maintenance','visit_referrals','visit_operational_events','whatsapp_message_log','import_runs','import_run_rows','initial_stock_scope_mappings','document_attachments','accurate_inventory_accounting'] loop
  execute format('create trigger a01_activity_change after insert or update on public.%I for each row execute function public.capture_activity_log()',t);
  execute format('create trigger a01_activity_delete before delete on public.%I for each row execute function public.capture_activity_log()',t);
 end loop;
end$$;
