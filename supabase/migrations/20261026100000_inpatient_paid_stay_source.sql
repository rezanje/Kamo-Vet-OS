-- K07: bind the discharge fee to its exact inpatient stay. Old, unlinked rows
-- remain unknown; no amount, invoice, payment, or journal is rewritten.
alter table public.prescription_items
  add column inpatient_record_id uuid references public.inpatient_records(id) on delete restrict;
create unique index prescription_items_inpatient_record_unique
  on public.prescription_items(inpatient_record_id) where inpatient_record_id is not null;

create function public.guard_inpatient_service_source() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_stay public.inpatient_records%rowtype;v_visit uuid;v_category text;
begin
  if tg_op='DELETE' then
    -- The existing discharge RPC may replace an unbilled source when a stay is
    -- reopened and discharged again. A billed row retains its FK/audit source.
    if old.inpatient_record_id is not null and exists (
      select 1 from public.invoice_items where prescription_item_id=old.id
    ) then raise exception 'INPATIENT_SOURCE_LOCKED: sumber hari rawat inap sudah masuk faktur';end if;
    return old;
  end if;
  if tg_op='UPDATE' and (
    new.inpatient_record_id is distinct from old.inpatient_record_id
    or (old.inpatient_record_id is not null and to_jsonb(new) is distinct from to_jsonb(old))
  ) then raise exception 'INPATIENT_SOURCE_LOCKED: sumber hari rawat inap tidak dapat dipindah atau diubah';end if;
  if tg_op='UPDATE' then return new;end if;
  if new.inpatient_record_id is null then return new;end if;
  -- A matching fee inserted by another branch-scoped prescription writer is
  -- not a verified discharge source. The discharge RPC sets this transaction
  -- marker immediately before its insert; ordinary PostgREST writes cannot.
  if nullif(current_setting('kamo.clinic_discharge_stay',true),'')::uuid
    is distinct from new.inpatient_record_id then
    raise exception 'INPATIENT_SOURCE_INVALID: hanya proses pulang rawat inap dapat membuat tautan sumber';
  end if;
  select * into v_stay from public.inpatient_records where id=new.inpatient_record_id;
  select visit_id into v_visit from public.medical_records where id=new.medical_record_id;
  select tindakan_kategori into v_category from public.items where id=new.item_id;
  if v_stay.id is null or v_stay.discharged_at is null
    or v_visit is distinct from v_stay.visit_id
    or new.jenis is distinct from 'jasa' or new.kategori is distinct from 'Rawat Inap'
    or v_category is distinct from 'Rawat Inap'
    or new.qty is distinct from greatest(1,ceil(extract(epoch from
      (v_stay.discharged_at-v_stay.admitted_at))/86400)::integer) then
    raise exception 'INPATIENT_SOURCE_INVALID: jasa tidak cocok dengan rawat inap asal';
  end if;
  return new;
end $$;
create trigger guard_inpatient_service_source before insert or update or delete on public.prescription_items
  for each row execute function public.guard_inpatient_service_source();
revoke all on function public.guard_inpatient_service_source() from public,anon,authenticated,service_role;

-- Modify only the three source-line fragments of the reviewed discharge RPC.
-- Abort on drift; preserve its access checks, fee logic, owner, ACL, and search_path.
do $migration$
declare v_def text;
begin
  select pg_get_functiondef('public.clinic_change_inpatient_condition(uuid,text,text)'::regprocedure) into v_def;
  if v_def is null
    or (length(v_def)-length(replace(v_def,'where medical_record_id=v_medical_record_id and item_id=v_tariff.id;','')))/length('where medical_record_id=v_medical_record_id and item_id=v_tariff.id;')<>1
    or (length(v_def)-length(replace(v_def,'medical_record_id, item_id, nama_obat, qty, harga, satuan,','')))/length('medical_record_id, item_id, nama_obat, qty, harga, satuan,')<>1
    or (length(v_def)-length(replace(v_def,'v_medical_record_id, v_tariff.id, v_tariff.name, v_days,','')))/length('v_medical_record_id, v_tariff.id, v_tariff.name, v_days,')<>1
    or (length(v_def)-length(replace(v_def,'        insert into public.prescription_items(','') ))/length('        insert into public.prescription_items(')<>1
    or (length(v_def)-length(replace(v_def,E'        );\n      end if;','')))/length(E'        );\n      end if;')<>1 then
    raise exception 'INPATIENT_SOURCE_DRIFT: periksa fungsi pulang rawat inap sebelum migrasi';
  end if;
  v_def:=replace(v_def,
    'where medical_record_id=v_medical_record_id and item_id=v_tariff.id;',
    'where medical_record_id=v_medical_record_id and item_id=v_tariff.id and inpatient_record_id=p_inpatient_id;');
  v_def:=replace(v_def,
    'medical_record_id, item_id, nama_obat, qty, harga, satuan,',
    'medical_record_id, inpatient_record_id, item_id, nama_obat, qty, harga, satuan,');
  v_def:=replace(v_def,
    'v_medical_record_id, v_tariff.id, v_tariff.name, v_days,',
    'v_medical_record_id, p_inpatient_id, v_tariff.id, v_tariff.name, v_days,');
  v_def:=replace(v_def,
    '        insert into public.prescription_items(',
    E'        perform set_config(''kamo.clinic_discharge_stay'',p_inpatient_id::text,true);\n        insert into public.prescription_items(');
  v_def:=replace(v_def,
    E'        );\n      end if;',
    E'        );\n        perform set_config(''kamo.clinic_discharge_stay'','''',true);\n      end if;');
  execute v_def;
end $migration$;
