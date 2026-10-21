-- Explicit reviewed registry: unknown public tables stop maintenance.
create function kamo_maintenance.reset_master_tables() returns text[] language sql immutable set search_path='' as $$select array[
 'accounting_locks',
 'approval_rules',
 'asset_categories',
 'branch_capacity_periods',
 'branches',
 'brands',
 'budgets',
 'cash_accounts',
 'category_discounts',
 'clinic_demo_policies',
 'coa_accounts',
 'commission_rules',
 'company_settings',
 'compound_formula_versions',
 'compound_formulas',
 'consent_rules',
 'consent_templates',
 'customer_categories',
 'customer_review_statuses',
 'customers',
 'document_numbering',
 'employee_branch_assignments',
 'employee_import_details',
 'employee_salary_components',
 'employee_schedules',
 'employees',
 'fixed_assets',
 'initial_stock_scope_mappings',
 'item_branch_prices',
 'item_categories',
 'item_group_components',
 'item_price_tiers',
 'item_units',
 'item_variant_families',
 'item_variant_members',
 'items',
 'medical_equipment',
 'operational_alert_settings',
 'payment_account_map',
 'payroll_settings',
 'pets',
 'production_recipe_items',
 'production_recipes',
 'profiles',
 'promo_items',
 'promos',
 'quest_settings',
 'recurring_journals',
 'role_capabilities',
 'role_modules',
 'salary_components',
 'sales_targets',
 'simulation_reset_audits',
 'staff_quest_definitions',
 'staff_reward_catalog',
 'supplier_categories',
 'suppliers',
 'tax_asset_categories',
 'tier_settings',
 'units',
 'user_branches',
 'vouchers',
 'wa_engine_settings',
 'warehouses',
 'work_shifts']::text[]$$;
revoke all on function kamo_maintenance.reset_master_tables() from public,anon,authenticated,service_role;
create function kamo_maintenance.reset_operational_tables() returns text[] language sql immutable set search_path='' as $$select array[
 'approval_requests',
 'asset_changes',
 'asset_depreciations',
 'asset_disposals',
 'asset_transfers',
 'attendance',
 'bank_reconciliations',
 'bank_reconciliation_requests',
 'bank_reconciliation_revisions',
 'bookings',
 'budget_transfers',
 'cash_advance_installments',
 'cash_advances',
 'cash_entries',
 'cash_entry_revision_requests',
 'cash_entry_revisions',
 'cash_transfer_requests',
 'cash_transfer_revisions',
 'cash_transfers',
 'cashier_shifts',
 'clinic_compound_sales',
 'clinic_demo_incentive_allocations',
 'clinic_demo_invoice_snapshots',
 'clinic_invoice_operations',
 'compound_issues',
 'compound_official_usage',
 'compounding_ingredients',
 'compounding_recipes',
 'consents',
 'document_attachments',
 'expense_posting_requests',
 'expense_revisions',
 'expenses',
 'follow_ups',
 'goods_receipt_items',
 'goods_receipts',
 'import_run_rows',
 'import_runs',
 'inpatient_daily_log_edits',
 'inpatient_daily_logs',
 'inpatient_med_doses',
 'inpatient_medications',
 'inpatient_records',
 'inpatient_status_log',
 'inventory_adjustment_items',
 'inventory_adjustments',
 'invoice_edit_log',
 'invoice_items',
 'invoice_payments',
 'invoices',
 'journal_entries',
 'journal_lines',
 'journal_revision_requests',
 'journal_revisions',
 'kpi_records',
 'leave_requests',
 'manual_journal_create_requests',
 'medical_equipment_maintenance',
 'medical_records',
 'month_end_runs',
 'notifications',
 'opening_balance_requests',
 'opening_balance_revisions',
 'opname_counts',
 'opname_order_items',
 'opname_orders',
 'opname_result_items',
 'opname_results',
 'overtime_requests',
 'payment_order_items',
 'payment_orders',
 'payrolls',
 'pet_ownership_transfers',
 'po_payments',
 'point_ledger',
 'pos_sale_postings',
 'prescription_items',
 'production_order_items',
 'production_orders',
 'purchase_advances',
 'purchase_invoice_items',
 'purchase_invoice_payments',
 'purchase_invoices',
 'purchase_operations',
 'purchase_order_items',
 'purchase_order_requests',
 'purchase_order_revisions',
 'purchase_orders',
 'purchase_payment_cancellation_requests',
 'purchase_payment_cancellations',
 'purchase_payment_order_requests',
 'purchase_payment_requests',
 'purchase_return_items',
 'purchase_returns',
 'reimbursements',
 'sale_cancellation_requests',
 'sale_cancellations',
 'sale_drafts',
 'sale_item_group_components',
 'sale_items',
 'sale_payment_refunds',
 'sale_payments',
 'sale_staff_effects',
 'sales',
 'sales_advances',
 'sales_deliveries',
 'sales_delivery_items',
 'sales_invoice_delivery_allocations',
 'sales_invoice_items',
 'sales_invoices',
 'sales_order_items',
 'sales_orders',
 'sales_posting_requests',
 'sales_quotation_items',
 'sales_quotations',
 'sales_receipts',
 'sales_return_items',
 'sales_returns',
 'staff_points',
 'staff_points_ledger',
 'staff_quest_progress',
 'staff_reward_redemptions',
 'staff_reward_requests',
 'staff_streaks',
 'stock',
 'stock_layers',
 'stock_moves',
 'stock_receipt_items',
 'stock_receipts',
 'stock_request_items',
 'stock_requests',
 'stock_transfer_items',
 'stock_transfers',
 'unit_posting_requests',
 'visit_operational_events',
 'visit_referrals',
 'visits',
 'whatsapp_message_log']::text[]$$;
revoke all on function kamo_maintenance.reset_operational_tables() from public,anon,authenticated,service_role;

create function public.operational_reset_cutoff() returns date
language sql stable security definer set search_path='' as $$
 select max((reset_at at time zone 'Asia/Jakarta')::date) from kamo_maintenance.simulation_backups
$$;
revoke all on function public.operational_reset_cutoff() from public,anon,authenticated,service_role;
grant execute on function public.operational_reset_cutoff() to authenticated,service_role;

-- Preserve recurring definitions while preventing historical catch-up after a reset.
do $$declare d text;needle text:=' v_date:=(p_periode||''-''||lpad(v_schedule.day_of_month::text,2,''0''))::date;';begin
 d:=pg_get_functiondef('public.post_recurring_journal_period(uuid,text)'::regprocedure);
 if position(needle in d)=0 then raise exception 'Recurring reset insertion point not found';end if;
 d:=replace(d,' if current_user<>''service_role'' and v_schedule.branch_id is not null
    and not public.user_can_access_branch(v_schedule.branch_id) then',
  ' if current_user<>''service_role'' then
  if v_schedule.branch_id is not null and not public.user_can_access_branch(v_schedule.branch_id) then');
 d:=replace(d,'RECURRING_SCOPE: Cabang jurnal berulang tidak dapat diakses.'' using errcode=''42501'';
 end if;',
  'RECURRING_SCOPE: Cabang jurnal berulang tidak dapat diakses.'' using errcode=''42501'';
  end if;
 end if;');
 d:=replace(d,needle,' if p_periode<=to_char(public.operational_reset_cutoff(),''YYYY-MM'') then
  return query select null::uuid,''RESET_PERIOD_SKIPPED''::text,false;return;
 end if;
'||needle);
 execute d;
end$$;

create function public.protect_reset_automation_cutoff() returns trigger
language plpgsql security definer set search_path='' as $$
declare cutoff date:=public.operational_reset_cutoff();begin
 if cutoff is not null and
  ((tg_table_name='asset_depreciations' and to_jsonb(new)->>'periode'<=to_char(cutoff,'YYYY-MM'))
   or (tg_table_name='journal_entries' and to_jsonb(new)->>'source' in ('depreciation','recurring')
    and (to_jsonb(new)->>'tanggal')::date <= (date_trunc('month',cutoff)+interval '1 month - 1 day')::date)) then
  raise exception 'RESET_PERIOD: periode otomatis lama telah dikosongkan; gunakan periode setelah reset';end if;
 return new;
end$$;
revoke all on function public.protect_reset_automation_cutoff() from public,anon,authenticated,service_role;
create trigger protect_reset_automation_cutoff before insert or update on public.asset_depreciations
 for each row execute function public.protect_reset_automation_cutoff();
create trigger protect_reset_automation_cutoff before insert or update on public.journal_entries
 for each row execute function public.protect_reset_automation_cutoff();

create function kamo_maintenance.master_reset_fingerprint(p_snapshot jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_object_agg(key,encode(sha256(convert_to(
  (select coalesce(jsonb_agg(case when key='customers' then r- 'points'- 'total_spending'- 'tier'- 'tier_downgraded_at'
   when key='recurring_journals' then r-'last_posted' else r end order by r->>'id'),'[]')
   from jsonb_array_elements(value) r)::text,'UTF8')),'hex'))
 from jsonb_each(p_snapshot->'tables') where key=any(kamo_maintenance.reset_master_tables())
$$;
revoke all on function kamo_maintenance.master_reset_fingerprint(jsonb) from public,anon,authenticated,service_role;

create function public.reset_verified_operational_history(p_actor_id uuid,p_backup_id uuid,p_sha256 text,p_confirmation text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare b kamo_maintenance.simulation_backups%rowtype;v_all text[];v_clear text[]:=kamo_maintenance.reset_operational_tables();
 v_master text[]:=kamo_maintenance.reset_master_tables();v_remaining text[];v_ready text[];v_tables text;
 v_before jsonb;v_after jsonb;v_triggers jsonb;v_counts jsonb:='{}';v_table text;v_count bigint;r record;v_result jsonb;
begin
 if p_confirmation is distinct from 'RESET SIMULASI TOTAL' then raise exception 'Konfirmasi reset seluruh cabang tidak cocok';end if;
 perform 1 from public.profiles where id=p_actor_id and is_active and role='OWNER' for share;
 if not found then raise exception 'Owner aktif diperlukan untuk reset seluruh cabang';end if;
 select * into b from kamo_maintenance.simulation_backups where id=p_backup_id for update;
 if not found or b.requested_by<>p_actor_id or b.sha256 is distinct from p_sha256 or b.verified_at is null then
  raise exception 'Cadangan terverifikasi milik Owner diperlukan sebelum reset';end if;
 if b.reset_at is not null then return b.reset_result;end if;
 select array_agg(c.relname::text order by c.relname),string_agg(format('public.%I',c.relname),',' order by c.relname)
  into v_all,v_tables from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p');
 if v_all is distinct from (select array_agg(x order by x) from unnest(v_clear||v_master) x) then
  raise exception 'Daftar data aplikasi berubah; tinjau cakupan reset sebelum melanjutkan';end if;
 lock table auth.users in share mode;
 execute 'lock table '||v_tables||' in access exclusive mode';
 v_before:=kamo_maintenance.public_snapshot();
 if encode(sha256(convert_to(v_before::text,'UTF8')),'hex') is distinct from b.sha256 then
  raise exception 'Data berubah setelah cadangan; buat dan uji cadangan baru sebelum reset';end if;
 if exists(select 1 from pg_catalog.pg_constraint c where c.contype='f'
  and c.conrelid in(select format('public.%I',x)::regclass from unnest(v_master) x)
  and c.confrelid in(select format('public.%I',x)::regclass from unnest(v_clear) x)) then
  raise exception 'Data master bergantung pada riwayat; cakupan reset harus ditinjau';end if;
 select coalesce(jsonb_agg(jsonb_build_object('relation',c.relname,'name',g.tgname,'mode',g.tgenabled)),'[]') into v_triggers
  from pg_catalog.pg_trigger g join pg_catalog.pg_class c on c.oid=g.tgrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname=any(v_clear||array['customers','recurring_journals']) and not g.tgisinternal;
 -- Exclusive locks and this transaction keep maintenance trigger changes invisible to other sessions.
 foreach v_table in array v_clear||array['customers','recurring_journals'] loop
  execute format('alter table public.%I disable trigger user',v_table);
 end loop;
 v_remaining:=v_clear;
 while cardinality(v_remaining)>0 loop
  select array_agg(t order by t) into v_ready from unnest(v_remaining) t where not exists(
   select 1 from pg_catalog.pg_constraint c where c.contype='f' and c.confrelid=format('public.%I',t)::regclass
    and c.conrelid<>c.confrelid and c.conrelid in(select format('public.%I',x)::regclass from unnest(v_remaining) x));
  if v_ready is null then raise exception 'Ketergantungan riwayat melingkar; reset dibatalkan';end if;
  foreach v_table in array v_ready loop
   execute format('delete from public.%I',v_table);get diagnostics v_count=row_count;
   v_counts:=v_counts||jsonb_build_object(v_table,v_count);
  end loop;
  select coalesce(array_agg(t),'{}') into v_remaining from unnest(v_remaining) t where not(t=any(v_ready));
 end loop;
 update public.customers set points=0,total_spending=0,tier='New',tier_downgraded_at=null;
 update public.recurring_journals set last_posted=to_char(now() at time zone 'Asia/Jakarta','YYYY-MM');
 for r in select * from jsonb_to_recordset(v_triggers) x(relation text,name text,mode text) loop
  execute format('alter table public.%I %s trigger %I',r.relation,
   case r.mode when 'D' then 'disable' when 'R' then 'enable replica' when 'A' then 'enable always' else 'enable' end,r.name);
 end loop;
 v_after:=kamo_maintenance.public_snapshot();
 if kamo_maintenance.master_reset_fingerprint(v_after) is distinct from kamo_maintenance.master_reset_fingerprint(v_before)
  or v_after->'schema' is distinct from v_before->'schema'
  or v_after->'auth_ids' is distinct from v_before->'auth_ids' then raise exception 'Data master atau pengaman berubah; reset dibatalkan';end if;
 if exists(select 1 from jsonb_each(v_after->'tables') where key=any(v_clear) and jsonb_array_length(value)<>0) then
  raise exception 'Riwayat belum kosong; reset dibatalkan';end if;
 v_result:=jsonb_build_object('backup_id',b.id,'scope','all_branches','medical_history_cleared',true,'deleted_counts',v_counts,
  'masters_sha256',encode(sha256(convert_to(kamo_maintenance.master_reset_fingerprint(v_after)::text,'UTF8')),'hex'),
  'reset_at',now(),'accounts_preserved',jsonb_array_length(v_after->'tables'->'profiles'));
 update kamo_maintenance.simulation_backups set reset_at=now(),reset_result=v_result where id=b.id;
 return v_result;
end$$;
revoke all on function public.reset_verified_operational_history(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.reset_verified_operational_history(uuid,uuid,text,text) to service_role;

-- The old reset deletes master items and has no verified recovery gate.
revoke all on function public.reset_simulasi_barang_dan_stok(text) from public,anon,authenticated,service_role;
