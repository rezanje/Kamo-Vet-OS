-- Run after concurrent medication evidence fixture in the disposable database.
begin;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','ca100000-0000-4000-8000-000000000001',true);
do $$
declare v_stay uuid;v_first uuid;v_second uuid;
begin
  select id into v_stay from public.inpatient_records
    where visit_id='ca600000-0000-4000-8000-000000000004';
  if not public.clinic_change_inpatient_condition(v_stay,'sembuh','DEMO discharge') then
    raise exception 'first healed discharge failed';end if;
  select id into v_first from public.prescription_items where inpatient_record_id=v_stay;
  if v_first is null then raise exception 'first source missing';end if;
  if not public.clinic_change_inpatient_condition(v_stay,'stabil','DEMO reopened') then
    raise exception 'existing reopen workflow failed';end if;
  if not public.clinic_change_inpatient_condition(v_stay,'sembuh','DEMO second discharge') then
    raise exception 'second healed discharge failed';end if;
  select id into v_second from public.prescription_items where inpatient_record_id=v_stay;
  if v_second is null or v_second=v_first or
    (select count(*) from public.prescription_items where inpatient_record_id=v_stay)<>1 then
    raise exception 're-discharge did not replace only its unbilled source';end if;
end $$;
rollback;
