-- K13/K01 ROLLBACK — only if the owner decides to undo. One transaction.
--
-- SAFETY: aborts if any addendum or access-trail row exists, because dropping the
-- tables would delete clinical notes / audit evidence. To roll back anyway:
--   1. export first:  select * from public.clinic_record_addenda;
--                     select * from public.clinic_history_reads;
--      (access-trail rows are also mirrored in activity_log and stay there)
--   2. uncomment the set_config line below, then run this whole file.
--
-- The app keeps working after rollback: history falls back to branch-scoped reads,
-- and the addendum section hides itself.
begin;
-- select set_config('vetos.k13_k01_rollback_discard', 'yes', true);
do $$
declare n_addenda bigint := 0; n_reads bigint := 0;
begin
  if to_regclass('public.clinic_record_addenda') is not null then
    execute 'select count(*) from public.clinic_record_addenda' into n_addenda;
  end if;
  if to_regclass('public.clinic_history_reads') is not null then
    execute 'select count(*) from public.clinic_history_reads' into n_reads;
  end if;
  if (n_addenda > 0 or n_reads > 0)
    and coalesce(current_setting('vetos.k13_k01_rollback_discard', true), '') <> 'yes' then
    raise exception 'ROLLBACK DIBATALKAN: % adendum dan % log akses masih ada. Ekspor dulu, lalu aktifkan baris set_config di atas.',
      n_addenda, n_reads;
  end if;
end $$;
drop function if exists public.clinic_patient_clinical_history(uuid, uuid);
drop table if exists public.clinic_history_reads;  -- policies and triggers go with it
drop function if exists public.clinic_history_reads_immutable();
delete from public.activity_log_sources where entity = 'clinic_history_reads';
drop function if exists public.clinic_add_record_addendum(uuid, uuid, text, text, text, text);
drop table if exists public.clinic_record_addenda;
drop function if exists public.clinic_can_add_record_addendum(uuid);
drop function if exists public.prepare_clinic_record_addendum();
drop function if exists public.clinic_record_addendum_immutable();
commit;
notify pgrst, 'reload schema';
