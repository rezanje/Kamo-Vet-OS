-- K06/K14 PREFLIGHT - READ ONLY. Nothing here writes.
-- Every row must show ok = true before running apply.sql. A row "already applied" = true only means
-- apply.sql was run before; apply.sql is idempotent and may be re-run safely.
with checks(name, ok) as (values
  ('base admission RPC clinic_admit_inpatient(uuid,text,text) exists',
    to_regprocedure('public.clinic_admit_inpatient(uuid,text,text)') is not null),
  ('discharge RPC clinic_change_inpatient_condition exists',
    to_regprocedure('public.clinic_change_inpatient_condition(uuid,text,text)') is not null),
  ('user_can_access_branch exists', to_regprocedure('public.user_can_access_branch(uuid)') is not null),
  ('visits.checked_out_at exists', exists(select 1 from information_schema.columns where table_schema='public' and table_name='visits' and column_name='checked_out_at')),
  ('visits.doctor_id exists', exists(select 1 from information_schema.columns where table_schema='public' and table_name='visits' and column_name='doctor_id')),
  ('medical_records copy columns exist (therapy, suhu, berat, gejala_klinis, hasil_penunjang, penunjang_urls, submission_key, submission_hash, submitted_by)',
    (select count(*) from information_schema.columns where table_schema='public' and table_name='medical_records'
      and column_name in ('therapy','suhu','berat','gejala_klinis','hasil_penunjang','penunjang_urls','submission_key','submission_hash','submitted_by')) = 9),
  ('inpatient_records.admission_request_key exists', exists(select 1 from information_schema.columns where table_schema='public' and table_name='inpatient_records' and column_name='admission_request_key')),
  ('one active invoice per visit index present (reason for the continuation visit)',
    exists(select 1 from pg_indexes where schemaname='public' and indexname='invoices_visit_active_key')),
  ('no existing column/constraint name clash with an incompatible definition',
    not exists(select 1 from information_schema.columns where table_schema='public' and table_name='inpatient_records'
      and column_name='stay_type' and data_type <> 'text'))
)
select name, ok from checks
union all
select 'already applied (informational)', to_regprocedure('public.clinic_continue_visit_to_inpatient(uuid,text)') is not null
union all
select 'SUMMARY: ' || count(*) filter (where not ok) || ' failed', count(*) filter (where not ok) = 0 from checks;
