-- PR #310 (K08 + A01 + Q01) READBACK — READ ONLY. Run after apply.sql; select only the `with checks … ;` statement in the SQL editor.
-- Every row must show ok = true and the last row SUMMARY must say "0 failed".
begin read only;
with t(name) as (
  select unnest(array['campaign_codes','payslip_templates','payslip_template_components','employee_payslip_templates',
    'employee_base_salaries','service_commission_policies','branch_grooming_rules','opening_invoice_batches','opening_invoice_lines',
    'recurring_journal_sources','clinic_refund_items','clinic_record_addenda','inpatient_rx_evidence','inpatient_rx_evidence_settings',
    'purchase_invoice_receipts','quest_new_customer_claims','clinic_refund_requests','clinic_refunds','clinic_history_reads'])
), fn as (
  select pg_get_functiondef('public.apply_sale_staff_effects(uuid)'::regprocedure) as staff,
         pg_get_functiondef('public.clinic_change_inpatient_condition(uuid,text,text)'::regprocedure) as inap
), checks(check_name, expected, actual) as (
  select 'history: 3 versions recorded', '3',
      (select count(*) from supabase_migrations.schema_migrations where version in ('20261030110000','20261030111000','20261030112000'))::text
  union all select 'rollback backup: 2 functions saved in vetos_release.pr310_backup', '2',
      (select count(*) from vetos_release.pr310_backup where kind = 'function')::text
  union all select 'rollback backup: not readable by authenticated', 'false', has_schema_privilege('authenticated', 'vetos_release', 'usage')::text
  -- K08
  union all select 'K08: re-discharge bills every period (v_billed_days)', 'true', (position('v_billed_days' in (select inap from fn)) > 0)::text
  union all select 'K08: session role via auth.role()', 'true', (position($r$coalesce(auth.role(), '')$r$ in (select inap from fn)) > 0)::text
  union all select 'K08: legacy request.jwt.claim.role gone', 'false', (position('request.jwt.claim.role' in (select inap from fn)) > 0)::text
  union all select 'K08: security definer', 'true', (select prosecdef from pg_proc where oid = 'public.clinic_change_inpatient_condition(uuid,text,text)'::regprocedure)::text
  union all select 'K08: authenticated may execute, anon may not', 'true false',
      has_function_privilege('authenticated', 'public.clinic_change_inpatient_condition(uuid,text,text)', 'execute')::text || ' ' ||
      has_function_privilege('anon', 'public.clinic_change_inpatient_condition(uuid,text,text)', 'execute')::text
  -- Q01
  union all select 'Q01: apply_sale_staff_effects patched', 'true', (position('Q01 recovery' in (select staff from fn)) > 0)::text
  union all select 'Q01: apply_pending_sale_staff_effects() exists, security definer', 'true',
      coalesce((select prosecdef from pg_proc where oid = to_regprocedure('public.apply_pending_sale_staff_effects()')), false)::text
  union all select 'Q01: pending function authenticated yes, anon no', 'true false',
      has_function_privilege('authenticated', 'public.apply_pending_sale_staff_effects()', 'execute')::text || ' ' ||
      has_function_privilege('anon', 'public.apply_pending_sale_staff_effects()', 'execute')::text
  union all select 'Q01: apply_sale_staff_effects authenticated yes, anon no', 'true false',
      has_function_privilege('authenticated', 'public.apply_sale_staff_effects(uuid)', 'execute')::text || ' ' ||
      has_function_privilege('anon', 'public.apply_sale_staff_effects(uuid)', 'execute')::text
  union all select 'Q01: index sales_staff_effects_pending_idx', 'true', (to_regclass('public.sales_staff_effects_pending_idx') is not null)::text
  -- A01
  union all select 'A01: 19 sources registered', '19', (select count(*) from public.activity_log_sources s join t on t.name = s.entity)::text
  union all select 'A01: change + delete trigger on all 19 tables', '38',
      (select count(*) from pg_trigger g join pg_class c on c.oid = g.tgrelid join t on t.name = c.relname
        where c.relnamespace = 'public'::regnamespace and not g.tgisinternal and g.tgenabled <> 'D'
          and g.tgname in ('a01_activity_change','a01_activity_delete'))::text
)
select check_name, expected, actual, actual is not distinct from expected as ok from checks
union all
select 'SUMMARY', null, (count(*) filter (where actual is distinct from expected))::text || ' failed', null from checks;
rollback;
