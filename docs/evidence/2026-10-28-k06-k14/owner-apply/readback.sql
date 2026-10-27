-- K06/K14 READBACK - READ ONLY. Run after apply.sql; every row must show ok = true.
with checks(name, ok) as (values
  ('visits.continued_from_visit_id exists', exists(select 1 from information_schema.columns where table_schema='public' and table_name='visits' and column_name='continued_from_visit_id')),
  ('medical_records.continued_from_record_id exists', exists(select 1 from information_schema.columns where table_schema='public' and table_name='medical_records' and column_name='continued_from_record_id')),
  ('inpatient_records.stay_type default sakit, not null',
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='inpatient_records'
      and column_name='stay_type' and is_nullable='NO' and column_default like '%sakit%')),
  ('every existing stay is sakit or pet_hotel', not exists(select 1 from public.inpatient_records where stay_type not in ('sakit','pet_hotel'))),
  ('stay_type check constraint present', exists(select 1 from pg_constraint where conname='inpatient_records_stay_type_check')),
  ('continuation link guard on visits', exists(select 1 from pg_trigger where tgname='protect_inpatient_continuation_link' and tgrelid='public.visits'::regclass)),
  ('continuation link guard on medical_records', exists(select 1 from pg_trigger where tgname='protect_inpatient_continuation_link' and tgrelid='public.medical_records'::regclass)),
  ('one-live-stay-per-patient guard on inpatient_records', exists(select 1 from pg_trigger where tgname='guard_one_live_stay_per_pet' and tgrelid='public.inpatient_records'::regclass)),
  ('clinic-role gate helper present and not callable by authenticated directly',
    to_regprocedure('public.inpatient_clinic_module_access()') is not null
    and not has_function_privilege('authenticated','public.inpatient_clinic_module_access()','execute')),
  ('clinic_continue_visit_to_inpatient executable by authenticated',
    has_function_privilege('authenticated','public.clinic_continue_visit_to_inpatient(uuid,text)','execute')),
  ('clinic_admit_inpatient_typed executable by authenticated',
    has_function_privilege('authenticated','public.clinic_admit_inpatient_typed(uuid,text,text,text)','execute')),
  ('new RPCs not executable by anon',
    not has_function_privilege('anon','public.clinic_continue_visit_to_inpatient(uuid,text)','execute')
    and not has_function_privilege('anon','public.clinic_admit_inpatient_typed(uuid,text,text,text)','execute'))
)
select name, ok from checks
union all
select 'SUMMARY: ' || count(*) filter (where not ok) || ' failed', count(*) filter (where not ok) = 0 from checks;
