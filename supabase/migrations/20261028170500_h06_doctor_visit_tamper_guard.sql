-- H06: the doctor-visit incentive pays from inpatient_daily_logs rows with log_kind='doctor_visit'.
-- Those rows must not be steerable from the browser:
--  * on save, a visit's time is the server's time (any client created_at/log_date is replaced);
--  * after save, only OWNER/ADMIN may change a visit's time, date, doctor or kind (also turning a
--    monitoring note into a visit or a visit into a monitoring note). Everyone else is refused.
-- Monitoring notes keep their current behaviour (backdated entry still allowed). Edits remain
-- audited by audit_inpatient_care_edit (before-row + reason).
create or replace function public.guard_inpatient_doctor_visit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.log_kind = 'doctor_visit' then
      new.created_at := now();
      new.log_date := (now() at time zone 'Asia/Jakarta')::date;
    end if;
    return new;
  end if;
  if (old.log_kind = 'doctor_visit' or new.log_kind = 'doctor_visit')
     and (new.created_at is distinct from old.created_at or new.log_date is distinct from old.log_date
       or new.visit_doctor_id is distinct from old.visit_doctor_id or new.log_kind is distinct from old.log_kind)
     and coalesce(auth.role(), '') = 'authenticated'
     and coalesce(private.hris_role(), '') not in ('OWNER', 'ADMIN') then
    raise exception using errcode = 'P0001',
      message = 'ACCESS_DENIED: waktu, dokter, atau jenis visit dokter hanya dapat dikoreksi OWNER/ADMIN';
  end if;
  return new;
end $$;
revoke all on function public.guard_inpatient_doctor_visit() from public, anon, authenticated, service_role;
drop trigger if exists h06_doctor_visit_guard on public.inpatient_daily_logs;
create trigger h06_doctor_visit_guard before insert or update on public.inpatient_daily_logs
  for each row execute function public.guard_inpatient_doctor_visit();
