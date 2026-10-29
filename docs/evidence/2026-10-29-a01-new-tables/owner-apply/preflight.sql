-- A01 new tables PREFLIGHT — READ ONLY. Nothing here writes. Every row must show ok = true.
-- Run before apply.sql. A row with ok = false means: stop, do not apply, send the output to the developer.
with expected(entity, pk) as (values
  ('campaign_codes', 'id'), ('payslip_templates', 'id'), ('payslip_template_components', 'id'),
  ('employee_payslip_templates', 'id'), ('employee_base_salaries', 'employee_id'), ('service_commission_policies', 'id'),
  ('branch_grooming_rules', 'branch_id'), ('opening_invoice_batches', 'id'), ('opening_invoice_lines', 'id'),
  ('recurring_journal_sources', 'schedule_id'), ('recurring_source_occurrences', 'schedule_id,period'),
  ('clinic_refund_items', 'id'), ('clinic_record_addenda', 'id'), ('inpatient_rx_evidence', 'id'),
  ('inpatient_rx_evidence_settings', 'branch_id'), ('quest_new_customer_claims', 'customer_id'),
  ('purchase_invoice_receipts', 'invoice_id,goods_receipt_id'), ('private_report_presets', 'id')
), actual as (
  select e.entity, e.pk, to_regclass('public.' || e.entity) as rel,
    (select string_agg(a.attname, ',' order by k.o) from pg_index i
      cross join lateral unnest(i.indkey) with ordinality k(n, o)
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.n
      where i.indisprimary and i.indrelid = to_regclass('public.' || e.entity)) as actual_pk
  from expected e
), checks(check_name, ok) as (
  select 'dependency: A01 activity framework (capture_activity_log + registry columns)',
    to_regprocedure('public.capture_activity_log()') is not null
    and to_regprocedure('public.activity_log_resolve(text,jsonb,text[])') is not null
    and (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'activity_log_sources'
      and column_name in ('identity_keys', 'branch_columns', 'scope_parents', 'metadata_only', 'reader_roles', 'owner_column')) = 6
  union all select 'dependency: all 18 tables exist with the reviewed primary key (missing/different: '
      || coalesce((select string_agg(entity, ', ') from actual where rel is null or actual_pk is distinct from pk), 'none') || ')',
    not exists(select 1 from actual where rel is null or actual_pk is distinct from pk)
  union all select 'dependency: parent sources already registered',
    (select count(*) from public.activity_log_sources where entity in ('vouchers', 'promos', 'salary_components', 'employees', 'branches',
      'journal_entries', 'purchase_invoices', 'sales_invoices', 'recurring_journals', 'clinic_refunds', 'clinic_refund_requests', 'invoice_items',
      'medical_records', 'inpatient_records', 'prescription_items', 'sales', 'customers', 'goods_receipts')) = 18
  union all select 'dependency: clinic_refunds / clinic_refund_requests already have change capture',
    (select count(*) from pg_trigger where tgname = 'a01_activity_change' and not tgisinternal
      and tgrelid in (to_regclass('public.clinic_refunds'), to_regclass('public.clinic_refund_requests'))) = 2
  union all select 'state: not yet applied (0) or re-run of this same package (18) — registered now: '
      || (select count(*) from public.activity_log_sources s join expected e using (entity))::text,
    (select count(*) from public.activity_log_sources s join expected e using (entity)) in (0, 18)
  union all select 'state: no foreign a01 trigger on these tables',
    not exists(select 1 from pg_trigger t join actual a on t.tgrelid = a.rel
      where t.tgname like 'a01\_activity\_%' and not t.tgisinternal and t.tgfoid <> 'public.capture_activity_log()'::regprocedure)
)
select check_name, ok from checks
union all select 'SUMMARY: ' || count(*) filter (where not ok) || ' failed', count(*) filter (where not ok) = 0 from checks;
