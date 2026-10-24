-- Reviewed operational rollback only; NOT executed on any target.
-- Freeze correction entry, retain all medical values, revisions and immutable audit evidence.
begin;
revoke insert on public.clinic_record_corrections from authenticated;
revoke execute on function public.clinic_correct_unpaid_record(uuid,uuid,integer,jsonb,text,text) from authenticated;
create or replace function public.clinic_can_correct_record(p_record_id uuid) returns boolean
language sql stable security invoker set search_path='' as $$select false$$;
create or replace function public.protect_submitted_clinic_record() returns trigger
language plpgsql security definer set search_path = '' as $function$
begin
  if old.submission_key is not null then
    raise exception using errcode='P0001', message='RECORD_POSTED: pemeriksaan tersimpan tidak dapat diubah atau dihapus';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

commit;
