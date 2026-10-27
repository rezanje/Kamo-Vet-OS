-- K13/K01 ROLLBACK — only if the owner decides to undo. Wrapped in one transaction.
-- WARNING: dropping the addenda table deletes every addendum written since apply.
-- Export it first if any rows exist:  select * from public.clinic_record_addenda;
-- The app keeps working after rollback: history falls back to branch-scoped reads,
-- and the addendum section hides itself.
begin;
drop function if exists public.clinic_patient_clinical_history(uuid, uuid);
drop function if exists public.clinic_add_record_addendum(uuid, uuid, text, text, text, text);
drop table if exists public.clinic_record_addenda;  -- also drops its policies and triggers
drop function if exists public.clinic_can_add_record_addendum(uuid);
drop function if exists public.prepare_clinic_record_addendum();
drop function if exists public.clinic_record_addendum_immutable();
commit;
notify pgrst, 'reload schema';
