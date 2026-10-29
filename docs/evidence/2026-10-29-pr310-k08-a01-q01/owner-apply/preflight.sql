-- PR #310 (K08 + A01 + Q01) PREFLIGHT — READ ONLY. Nothing here writes; the transaction is read only and ends with rollback.
-- In the Supabase SQL editor select only the `with checks … ;` statement and Run it.
-- Every row with an expected value must show ok = true. Rows with expected = null are information only.
begin read only;
with t(name) as (
  select unnest(array['campaign_codes','payslip_templates','payslip_template_components','employee_payslip_templates',
    'employee_base_salaries','service_commission_policies','branch_grooming_rules','opening_invoice_batches','opening_invoice_lines',
    'recurring_journal_sources','clinic_refund_items','clinic_record_addenda','inpatient_rx_evidence','inpatient_rx_evidence_settings',
    'purchase_invoice_receipts','quest_new_customer_claims','clinic_refund_requests','clinic_refunds','clinic_history_reads'])
), fn as (
  select pg_get_functiondef(to_regprocedure('public.apply_sale_staff_effects(uuid)')) as staff,
         pg_get_functiondef(to_regprocedure('public.clinic_change_inpatient_condition(uuid,text,text)')) as inap
), checks(check_name, expected, actual) as (
  select 'info: server version', null, current_setting('server_version')
  union all select 'role: running as postgres (apply requires it)', 'postgres', current_user::text
  union all select 'server: PostgreSQL 16+', 'true', (current_setting('server_version_num')::int >= 160000)::text
  union all select 'history: table supabase_migrations.schema_migrations', 'true', (to_regclass('supabase_migrations.schema_migrations') is not null)::text
  union all select 'history: 20261030110000/111000/112000 not recorded', '0',
      (select count(*) from supabase_migrations.schema_migrations where version in ('20261030110000','20261030111000','20261030112000'))::text
  union all select 'not yet applied: backup vetos_release.pr310_backup absent', 'true', (to_regclass('vetos_release.pr310_backup') is null)::text
  -- K08
  union all select 'K08: clinic_change_inpatient_condition(uuid,text,text) exists', 'true', ((select inap from fn) is not null)::text
  union all select 'K08: not yet applied (no v_billed_days)', 'false', (position('v_billed_days' in (select inap from fn)) > 0)::text
  union all select 'info: K08 function still reads legacy request.jwt.claim.role (PR #315 not applied; K08 fixes it too)', null,
      (position('request.jwt.claim.role' in (select inap from fn)) > 0)::text
  -- Q01
  union all select 'Q01: apply_sale_staff_effects(uuid) exists', 'true', ((select staff from fn) is not null)::text
  union all select 'Q01: not yet applied (no "Q01 recovery")', 'false', (position('Q01 recovery' in (select staff from fn)) > 0)::text
  union all select 'Q01: anchor "already applied" appears exactly once', '1',
      ((length((select staff from fn)) - length(replace((select staff from fn),
        $a$ if exists(select 1 from public.sale_staff_effects where sale_id=s.id) then return jsonb_build_object('applied',true);end if;$a$, '')))
       / length($a$ if exists(select 1 from public.sale_staff_effects where sale_id=s.id) then return jsonb_build_object('applied',true);end if;$a$))::text
  union all select 'Q01: anchor streak test appears exactly once', '1',
      ((length((select staff from fn)) - length(replace((select staff from fn), ' if st.last_active_date is distinct from d then', '')))
       / length(' if st.last_active_date is distinct from d then'))::text
  union all select 'Q01: apply_pending_sale_staff_effects() absent', 'true', (to_regprocedure('public.apply_pending_sale_staff_effects()') is null)::text
  union all select 'Q01: index sales_staff_effects_pending_idx absent', 'true', (to_regclass('public.sales_staff_effects_pending_idx') is null)::text
  union all select 'Q01: sales.quest_effects_tracked column exists', '1',
      (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'sales' and column_name = 'quest_effects_tracked')::text
  -- A01
  union all select 'A01: activity_log_sources + capture_activity_log() exist', 'true',
      (to_regclass('public.activity_log_sources') is not null and to_regprocedure('public.capture_activity_log()') is not null)::text
  union all select 'A01: all 19 source tables exist', '19', (select count(*) from t where to_regclass('public.' || t.name) is not null)::text
  union all select 'info: of the 16 new sources, already registered (apply keeps them as they are)', null,
      (select count(*) from public.activity_log_sources s join t on t.name = s.entity
        where s.entity not in ('clinic_refund_requests','clinic_refunds','clinic_history_reads'))::text
  union all select 'info: a01 triggers already present on the 19 tables (kept on rollback)', null,
      (select count(*) from pg_trigger g join pg_class c on c.oid = g.tgrelid join t on t.name = c.relname
        where c.relnamespace = 'public'::regnamespace and not g.tgisinternal and g.tgname in ('a01_activity_change','a01_activity_delete'))::text
)
select check_name, expected, actual, case when expected is null then null else actual is not distinct from expected end as ok
from checks
union all
select 'SUMMARY', null, (count(*) filter (where expected is not null and actual is distinct from expected))::text || ' failed', null
from checks;
rollback;
