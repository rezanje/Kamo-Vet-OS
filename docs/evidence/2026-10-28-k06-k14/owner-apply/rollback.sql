-- K06/K14 ROLLBACK - WRITES TO THE DATABASE. Run ONLY after an explicit owner decision.
-- Refuses when real data already uses the feature (continuation visits or pet hotel stays exist):
-- then the only safe path is roll-forward with a new migration.
-- Undo the app first if it is deployed (before migration the app refuses pet hotel / continuation clearly).
-- One transaction: any failure leaves the database exactly as before.
begin;
do $guard$
begin
  if exists(select 1 from public.visits where continued_from_visit_id is not null)
     or exists(select 1 from public.inpatient_records where stay_type <> 'sakit') then
    raise exception 'K06/K14 rollback refused: continuation visits or pet hotel stays exist; roll forward instead';
  end if;
end $guard$;
drop function if exists public.clinic_admit_inpatient_typed(uuid,text,text,text);
drop function if exists public.clinic_continue_visit_to_inpatient(uuid,text);
drop trigger if exists protect_inpatient_continuation_link on public.visits;
drop trigger if exists protect_inpatient_continuation_link on public.medical_records;
drop function if exists public.protect_inpatient_continuation_link();
alter table public.inpatient_records drop constraint if exists inpatient_records_stay_type_check;
alter table public.inpatient_records drop column if exists stay_type;
alter table public.medical_records drop column if exists continued_from_record_id;
drop index if exists public.visits_continued_from_idx;
alter table public.visits drop column if exists continued_from_visit_id;
commit;
