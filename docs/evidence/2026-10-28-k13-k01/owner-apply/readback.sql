-- K13/K01 READBACK — READ ONLY. Run after apply.sql. Every row must show ok = true.
select check_name, ok from (values
  ('table clinic_record_addenda exists with RLS on',
    coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.clinic_record_addenda')), false)),
  ('authenticated may only SELECT/INSERT addenda (no UPDATE/DELETE)',
    has_table_privilege('authenticated','public.clinic_record_addenda','SELECT')
    and has_table_privilege('authenticated','public.clinic_record_addenda','INSERT')
    and not has_table_privilege('authenticated','public.clinic_record_addenda','UPDATE')
    and not has_table_privilege('authenticated','public.clinic_record_addenda','DELETE')),
  ('anon has no access to addenda', not has_table_privilege('anon','public.clinic_record_addenda','SELECT')),
  ('immutability triggers present',
    -- a01_activity_* capture triggers (20261029150000) are counted separately, not as immutability guards.
    (select count(*) from pg_trigger where tgrelid = to_regclass('public.clinic_record_addenda') and not tgisinternal
      and tgname not like 'a01\_activity\_%') = 3),
  ('clinic_add_record_addendum executable by authenticated, not anon',
    has_function_privilege('authenticated','public.clinic_add_record_addendum(uuid,uuid,text,text,text,text)','EXECUTE')
    and not has_function_privilege('anon','public.clinic_add_record_addendum(uuid,uuid,text,text,text,text)','EXECUTE')),
  ('clinic_can_add_record_addendum executable by authenticated',
    has_function_privilege('authenticated','public.clinic_can_add_record_addendum(uuid)','EXECUTE')),
  ('history reader is SECURITY DEFINER with fixed search_path (volatile: writes access trail)',
    exists(select 1 from pg_proc where oid = to_regprocedure('public.clinic_patient_clinical_history(uuid,uuid)')
      and prosecdef and provolatile = 'v' and proconfig @> array['search_path=""'])),
  ('access trail table has RLS; authenticated read-only (no INSERT/UPDATE/DELETE)',
    coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.clinic_history_reads')), false)
    and not has_table_privilege('authenticated','public.clinic_history_reads','INSERT')
    and not has_table_privilege('authenticated','public.clinic_history_reads','UPDATE')
    and not has_table_privilege('authenticated','public.clinic_history_reads','DELETE')),
  ('access trail mirrored to activity log (source registered + trigger)',
    exists(select 1 from public.activity_log_sources where entity = 'clinic_history_reads' and metadata_only)
    and exists(select 1 from pg_trigger where tgrelid = to_regclass('public.clinic_history_reads') and tgname = 'a01_activity_change')),
  ('history reader executable by authenticated, not anon',
    has_function_privilege('authenticated','public.clinic_patient_clinical_history(uuid,uuid)','EXECUTE')
    and not has_function_privilege('anon','public.clinic_patient_clinical_history(uuid,uuid)','EXECUTE')),
  ('branch RLS on visits/medical_records unchanged (still enabled)',
    (select bool_and(relrowsecurity) from pg_class where oid in (to_regclass('public.visits'), to_regclass('public.medical_records'), to_regclass('public.prescription_items'))))
) t(check_name, ok);
-- After this, run: NOTIFY pgrst, 'reload schema';  (only if the app still says the feature is unavailable)
