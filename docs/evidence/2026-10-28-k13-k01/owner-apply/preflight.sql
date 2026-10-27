-- K13/K01 PREFLIGHT — READ ONLY. Nothing here writes. Every row must show ok = true.
select check_name, ok from (values
  ('dependency: clinic_record_correction_actor(uuid) exists (20261024074043)',
    to_regprocedure('public.clinic_record_correction_actor(uuid)') is not null),
  ('dependency: user_can_access_branch(uuid) exists',
    to_regprocedure('public.user_can_access_branch(uuid)') is not null),
  ('dependency: role_modules table exists', to_regclass('public.role_modules') is not null),
  ('dependency: activity audit framework (capture_activity_log, activity_log_sources.metadata_only)',
    to_regprocedure('public.capture_activity_log()') is not null
    and exists(select 1 from information_schema.columns where table_schema='public' and table_name='activity_log_sources' and column_name='metadata_only')),
  ('dependency: medical_records.therapy column exists',
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='medical_records' and column_name='therapy')),
  ('dependency: invoices.voided_at column exists',
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='invoices' and column_name='voided_at')),
  ('dependency: prescription_items.satuan/jenis exist',
    (select count(*) from information_schema.columns where table_schema='public' and table_name='prescription_items' and column_name in ('satuan','jenis'))=2),
  ('new table not yet present (or re-run of this same package)',
    to_regclass('public.clinic_record_addenda') is null
    or exists(select 1 from information_schema.columns where table_schema='public' and table_name='clinic_record_addenda' and column_name='diagnosis_addendum')),
  ('draft PR #239 table was NOT applied (informational; true = clean)',
    to_regclass('public.clinic_paid_record_addenda') is null)
) t(check_name, ok);
