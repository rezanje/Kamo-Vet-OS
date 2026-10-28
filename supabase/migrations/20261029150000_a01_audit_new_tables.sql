-- A01 (audit 29 Oct): the general activity log did not cover business tables added after
-- 24 Oct. Register them with the SAME mechanism as 20261022070000..084000: one private
-- activity_log_sources row per table plus the a01_activity_change (AFTER INSERT/UPDATE) and
-- a01_activity_delete (BEFORE DELETE) row triggers calling capture_activity_log().
-- No source table, grant, policy, RPC or existing log row is changed. Future writes only; no backfill.
--
-- Privacy follows the existing registry rules:
--  * HRIS pay configuration (templates, base salary, commission policy), clinical rows (addenda,
--    inpatient medicine evidence/settings), recurring-journal snapshots, CRM claims and private
--    report presets are metadata-only: no values, names, notes, payloads or phone keys are copied.
--  * Pay configuration is readable in the log by OWNER only (source: OWNER manages, FINANCE reads;
--    the general audit never adds ADMIN), as for inventory_month_closes.
--  * quest_new_customer_claims has no authenticated SELECT at all: recorded, readable by nobody,
--    as for sale_staff_effects.
--  * private_report_presets keeps its private ownership: only the preset's own user (OWNER/ADMIN)
--    can see its events (owner_column).
--  * Elsewhere only numeric/boolean/date/code values already allowed by activity_log_safe_value.
-- Also closes a gap left by J03 (20261028140000): clinic_refunds and clinic_refund_requests had
-- no a01_activity_delete trigger (same fix as 20261024114433 for the petshop refund sources).
--
-- Deliberately NOT registered (existing A01 exclusion classes, see
-- docs/evidence/2026-10-22-a01/source-coverage.md); the business rows they belong to are captured:
--  request_receipt:       purchase_advance_requests, opname_posting_receipts, production_atomic_postings,
--                         sale_payment_correction_requests, purchase_advance_cascade_cancellations,
--                         promo_import_batches
--  domain_history:        purchase_advance_cancellations, purchase_order_receipt_closures, user_account_edits,
--                         clinic_record_corrections, sale_payment_corrections, purchase_invoice_corrections,
--                         payslip_override_history, purchase_receipt_cancellations
--  posting_proof:         purchase_invoice_correction_layers, promo_import_targets
--  technical_concurrency: purchase_advance_capacity_locks, sale_payment_correction_gate
--
-- Idempotent: a re-run with the same registry is a no-op. Any drift (missing framework/table,
-- different registry row, primary key or column mismatch, foreign trigger) aborts the transaction.

do $$
begin
  if to_regprocedure('public.capture_activity_log()') is null
    or to_regprocedure('public.activity_log_resolve(text,jsonb,text[])') is null
    or (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'activity_log_sources'
        and column_name in ('identity_keys', 'branch_columns', 'scope_parents', 'metadata_only', 'reader_roles', 'owner_column')) <> 6 then
    raise exception 'A01 activity framework (20261022070000..084000) is missing or changed';
  end if;
end $$;

drop table if exists pg_temp.a01_new_sources;
create temporary table a01_new_sources (like public.activity_log_sources including defaults);

insert into a01_new_sources
  (entity, module_id, label_key, value_keys, scope_kind, parent_entity, parent_key, identity_keys, branch_columns, scope_parents, metadata_only, reader_roles, owner_column)
values
 ('campaign_codes', 'crm', 'code', array['code', 'max_uses', 'is_active'], 'global', null, null, array['id'], '{}',
  '[{"entity":"vouchers","key":"voucher_id"},{"entity":"promos","key":"promo_id"}]', false, array['OWNER', 'ADMIN'], null),
 ('payslip_templates', 'hris', null, '{}', 'all', null, null, array['id'], '{}', '[]', true, array['OWNER'], null),
 ('payslip_template_components', 'hris', null, '{}', 'refs', 'payslip_templates', 'template_id', array['id'], '{}',
  '[{"entity":"salary_components","key":"component_id"}]', true, array['OWNER'], null),
 ('employee_payslip_templates', 'hris', null, '{}', 'refs', 'employees', 'employee_id', array['id'], '{}',
  '[{"entity":"payslip_templates","key":"template_id"}]', true, array['OWNER'], null),
 ('employee_base_salaries', 'hris', null, '{}', 'refs', 'employees', 'employee_id', array['employee_id'], '{}', '[]', true, array['OWNER'], null),
 ('service_commission_policies', 'penjualan', null, '{}', 'refs', null, null, array['id'], array['branch_id'], '[]', true, array['OWNER', 'ADMIN'], null),
 ('branch_grooming_rules', 'pengaturan', null, array['doctor_required'], 'refs', null, null, array['branch_id'], array['branch_id'],
  '[{"entity":"branches","key":"branch_id"}]', false, array['OWNER', 'ADMIN'], null),
 ('opening_invoice_batches', 'buku-besar', null, array['ap_count', 'ap_total', 'ar_count', 'ar_total'], 'refs', null, null, array['id'], array['branch_id'],
  '[{"entity":"journal_entries","key":"journal_id"}]', false, array['OWNER', 'ADMIN'], null),
 ('opening_invoice_lines', 'buku-besar', null, array['row_no', 'tanggal', 'jatuh_tempo', 'outstanding', 'original_total'], 'refs',
  'opening_invoice_batches', 'batch_id', array['id'], '{}',
  '[{"entity":"purchase_invoices","key":"purchase_invoice_id"},{"entity":"sales_invoices","key":"sales_invoice_id"}]', false, array['OWNER', 'ADMIN'], null),
 ('recurring_journal_sources', 'buku-besar', null, '{}', 'refs', 'recurring_journals', 'schedule_id', array['schedule_id'], array['branch_id'],
  '[{"entity":"journal_entries","key":"source_entry_id"}]', true, array['OWNER', 'ADMIN'], null),
 ('recurring_source_occurrences', 'buku-besar', null, '{}', 'refs', 'recurring_journal_sources', 'schedule_id', array['schedule_id', 'period'], '{}',
  '[{"entity":"journal_entries","key":"journal_id"}]', true, array['OWNER', 'ADMIN'], null),
 ('clinic_refund_items', 'klinik', null, array['qty', 'amount', 'hpp', 'kondisi', 'restock'], 'refs', 'clinic_refunds', 'refund_id', array['id'], '{}',
  '[{"entity":"invoice_items","key":"invoice_item_id"}]', false, array['OWNER', 'ADMIN'], null),
 ('clinic_record_addenda', 'klinik', null, '{}', 'refs', 'medical_records', 'medical_record_id', array['id'], '{}', '[]', true, array['OWNER', 'ADMIN'], null),
 ('inpatient_rx_evidence', 'klinik', null, '{}', 'refs', 'inpatient_records', 'inpatient_record_id', array['id'], array['branch_id'],
  '[{"entity":"prescription_items","key":"prescription_item_id"}]', true, array['OWNER', 'ADMIN'], null),
 ('inpatient_rx_evidence_settings', 'klinik', null, '{}', 'refs', null, null, array['branch_id'], array['branch_id'], '[]', true, array['OWNER', 'ADMIN'], null),
 ('quest_new_customer_claims', 'pos', null, '{}', 'refs', 'sales', 'sale_id', array['customer_id'], array['branch_id'],
  '[{"entity":"customers","key":"customer_id"}]', true, '{}', null),
 ('purchase_invoice_receipts', 'pembelian', null, array['active'], 'refs', 'purchase_invoices', 'invoice_id', array['invoice_id', 'goods_receipt_id'], '{}',
  '[{"entity":"goods_receipts","key":"goods_receipt_id"}]', false, array['OWNER', 'ADMIN'], null),
 ('private_report_presets', 'laporan', null, '{}', 'global', null, null, array['id'], '{}', '[]', true, array['OWNER', 'ADMIN'], 'user_id');

-- Validate every new row against the migrated catalog before anything is registered.
do $$
declare s record; rel regclass; parent_rel regclass; actual_keys text[]; col text; ref jsonb; local_type oid; parent_type oid;
begin
  for s in select * from a01_new_sources loop
    rel := to_regclass('public.' || s.entity);
    if rel is null then raise exception 'A01 source table missing: %', s.entity; end if;
    select array_agg(a.attname::text order by k.ordinality) into actual_keys
      from pg_index i cross join lateral unnest(i.indkey) with ordinality k(attnum, ordinality)
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
      where i.indisprimary and i.indrelid = rel;
    if actual_keys is distinct from s.identity_keys then
      raise exception 'A01 identity differs from primary key: % (%)', s.entity, actual_keys;
    end if;
    foreach col in array s.value_keys || coalesce(array[s.label_key], '{}') || coalesce(array[s.parent_key], '{}') loop
      if col is not null and not exists(select 1 from pg_attribute where attrelid = rel and attname = col and attnum > 0 and not attisdropped) then
        raise exception 'A01 column missing: %.%', s.entity, col;
      end if;
    end loop;
    foreach col in array s.branch_columns || coalesce(array[s.owner_column], '{}') loop
      if col is not null and not exists(select 1 from pg_attribute where attrelid = rel and attname = col and atttypid = 'uuid'::regtype and attnum > 0 and not attisdropped) then
        raise exception 'A01 branch/owner column must be uuid: %.%', s.entity, col;
      end if;
    end loop;
    if not s.reader_roles <@ array['OWNER', 'ADMIN'] then raise exception 'A01 unreviewed reader role: %', s.entity; end if;
    if cardinality(s.reader_roles) > 0 and exists(
      select 1 from unnest(s.identity_keys || s.value_keys || coalesce(array[s.label_key], '{}')) k
      where k is not null and not has_column_privilege('authenticated', rel, k, 'SELECT')) then
      raise exception 'A01 would expose a source without authenticated SELECT: %', s.entity;
    end if;
    for ref in select value from jsonb_array_elements(s.scope_parents || case when s.parent_entity is null then '[]'::jsonb
        else jsonb_build_array(jsonb_build_object('entity', s.parent_entity, 'key', s.parent_key)) end) loop
      parent_rel := to_regclass('public.' || (ref->>'entity'));
      if parent_rel is null or not exists(
        select 1 from public.activity_log_sources where entity = ref->>'entity' and cardinality(identity_keys) = 1
        union all select 1 from a01_new_sources where entity = ref->>'entity' and cardinality(identity_keys) = 1) then
        raise exception 'A01 scope parent not registered with a single-column identity: % -> %', s.entity, ref;
      end if;
      select atttypid into local_type from pg_attribute where attrelid = rel and attname = ref->>'key' and attnum > 0 and not attisdropped;
      select a.atttypid into parent_type
        from (select entity, identity_keys from public.activity_log_sources union all select entity, identity_keys from a01_new_sources) p
        join pg_attribute a on a.attrelid = parent_rel and a.attname = p.identity_keys[1] and a.attnum > 0 and not a.attisdropped
        where p.entity = ref->>'entity' limit 1;
      if local_type is null or local_type is distinct from parent_type then
        raise exception 'A01 scope reference type mismatch: % -> %', s.entity, ref;
      end if;
    end loop;
  end loop;
end $$;

insert into public.activity_log_sources select * from a01_new_sources on conflict (entity) do nothing;

do $$
declare src record; rel regclass; trg record; kind text;
begin
  -- A pre-existing row must be exactly this reviewed registration (a re-run), never a different one.
  if exists(select 1 from a01_new_sources n join public.activity_log_sources r using (entity) where to_jsonb(n) is distinct from to_jsonb(r)) then
    raise exception 'A01 registry drift: % already registered differently',
      (select string_agg(n.entity, ', ') from a01_new_sources n join public.activity_log_sources r using (entity) where to_jsonb(n) is distinct from to_jsonb(r));
  end if;
  for src in
    select entity, array['a01_activity_change', 'a01_activity_delete'] as names from a01_new_sources
    union all select v, array['a01_activity_delete'] from unnest(array['clinic_refunds', 'clinic_refund_requests']) v
  loop
    rel := to_regclass('public.' || src.entity);
    if rel is null or not exists(select 1 from public.activity_log_sources where entity = src.entity)
      or (not 'a01_activity_change' = any(src.names)
        and not exists(select 1 from pg_trigger where tgrelid = rel and tgname = 'a01_activity_change'
          and tgfoid = 'public.capture_activity_log()'::regprocedure and tgenabled = 'O' and not tgisinternal)) then
      raise exception 'A01 source % is not registered with change capture', src.entity;
    end if;
    foreach kind in array src.names loop
      select tgfoid, tgtype, tgenabled into trg from pg_trigger where tgrelid = rel and tgname = kind and not tgisinternal;
      if not found then
        if kind = 'a01_activity_change' then
          execute format('create trigger a01_activity_change after insert or update on public.%I for each row execute function public.capture_activity_log()', src.entity);
        else
          execute format('create trigger a01_activity_delete before delete on public.%I for each row execute function public.capture_activity_log()', src.entity);
        end if;
      elsif trg.tgfoid <> 'public.capture_activity_log()'::regprocedure or trg.tgenabled <> 'O'
        or (kind = 'a01_activity_change' and trg.tgtype <> 21) or (kind = 'a01_activity_delete' and trg.tgtype <> 11) then
        raise exception 'A01 trigger % on % exists with a different definition', kind, src.entity;
      end if;
    end loop;
  end loop;
end $$;

drop table a01_new_sources;
