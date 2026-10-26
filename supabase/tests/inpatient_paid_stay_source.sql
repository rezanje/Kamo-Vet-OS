-- Append after the fictional inpatient consent and prescription evidence fixtures.
-- This runs only inside the disposable PostgreSQL test container.
reset role;
do $$
declare v_stay uuid;v_source uuid;v_item uuid;v_failed boolean;
begin
  select id into v_stay from public.inpatient_records
    where visit_id='ca600000-0000-4000-8000-000000000001';
  select id into v_source from public.prescription_items
    where inpatient_record_id=v_stay;
  select item_id into v_item from public.prescription_items where id=v_source;
  if v_stay is null or v_source is null or
    (select count(*) from public.prescription_items where inpatient_record_id=v_stay)<>1 or
    (select qty from public.prescription_items where id=v_source)<>greatest(1,ceil(extract(epoch from
      ((select discharged_at from public.inpatient_records where id=v_stay)-
       (select admitted_at from public.inpatient_records where id=v_stay)))/86400)::integer) then
    raise exception 'discharge did not bind exact stay and day quantity';
  end if;
  v_failed:=false;
  begin
    update public.prescription_items set inpatient_record_id=null where id=v_source;
  exception when others then v_failed:=sqlerrm like 'INPATIENT_SOURCE_LOCKED:%';end;
  if not v_failed then raise exception 'linked inpatient source was moved';end if;
  v_failed:=false;
  begin
    update public.prescription_items set qty=qty+1 where id=v_source;
  exception when others then v_failed:=sqlerrm like 'INPATIENT_SOURCE_LOCKED:%';end;
  if not v_failed then raise exception 'linked inpatient source quantity changed';end if;
  v_failed:=false;
  begin
    update public.prescription_items set harga=harga+1 where id=v_source;
  exception when others then v_failed:=sqlerrm like 'INPATIENT_SOURCE_LOCKED:%';end;
  if not v_failed then raise exception 'linked inpatient source price changed';end if;
  -- An unbilled source remains replaceable by the existing reopen/discharge
  -- workflow; billed sources are retained by the invoice FK and trigger.
  v_failed:=false;
  begin
    update public.prescription_items set inpatient_record_id=v_stay
      where id='ca910000-0000-4000-8000-000000000001';
  exception when others then v_failed:=sqlerrm like 'INPATIENT_SOURCE_LOCKED:%';end;
  if not v_failed then raise exception 'old prescription was retroactively linked to stay';end if;
  v_failed:=false;
  begin
    insert into public.prescription_items(medical_record_id,inpatient_record_id,item_id,nama_obat,qty,jenis,kategori)
    values ('ca700000-0000-4000-8000-000000000001',v_stay,v_item,'DEMO forged link',1,'jasa','Rawat Inap');
  exception when others then v_failed:=sqlerrm like 'INPATIENT_SOURCE_INVALID:%';end;
  if not v_failed then raise exception 'linked fee was created outside discharge RPC';end if;
  perform set_config('kamo.clinic_discharge_stay',v_stay::text,true);
  v_failed:=false;
  begin
    insert into public.prescription_items(medical_record_id,inpatient_record_id,item_id,nama_obat,qty,jenis,kategori)
    values ('ca700000-0000-4000-8000-000000000004',v_stay,v_item,'DEMO mismatched visit',1,'jasa','Rawat Inap');
  exception when others then v_failed:=sqlerrm like 'INPATIENT_SOURCE_INVALID:%';end;
  perform set_config('kamo.clinic_discharge_stay','',true);
  if not v_failed then raise exception 'source from another visit was bound to stay';end if;
  if has_function_privilege('anon','public.guard_inpatient_service_source()','EXECUTE') or
     has_function_privilege('authenticated','public.guard_inpatient_service_source()','EXECUTE') then
    raise exception 'source trigger function gained client execute access';
  end if;
end $$;
