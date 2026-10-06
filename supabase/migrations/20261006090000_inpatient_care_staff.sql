-- Historical names stay intact. New admissions/logs bind employees explicitly.
alter table public.inpatient_records add column doctor_id uuid references public.employees(id) on delete restrict;
alter table public.inpatient_daily_logs
  add column log_kind text check(log_kind in ('monitoring','doctor_visit')),
  add column visit_doctor_id uuid references public.employees(id) on delete restrict,
  add column paramedic_id uuid references public.employees(id) on delete restrict,
  add column paramedic_name text;
alter table public.inpatient_daily_logs alter column log_kind set default 'monitoring';

create function public.clinic_employee_roles(p_job text) returns text[]
language sql immutable set search_path='' as $$
 select array_remove(array[
 case when lower(coalesce(p_job,'')) ~ 'paramedis|perawat|nurse|asisten.*(dokter|doctor)|vet.*technician' then 'paramedic' end,
 case when lower(coalesce(p_job,'')) !~ 'paramedis|perawat|nurse|asisten.*(dokter|doctor)|vet.*technician'
   and lower(coalesce(p_job,'')) ~ 'dokter|doctor|drh|(^|[^a-z])dr[[:space:]]+hewan([^a-z]|$)' then 'doctor' end,
 case when lower(coalesce(p_job,'')) ~ 'groomer|grooming' then 'groomer' end
 ],null);
$$;
revoke all on function public.clinic_employee_roles(text) from public,anon,authenticated,service_role;
grant execute on function public.clinic_employee_roles(text) to authenticated;

create function public.clinic_staff_name(p_employee_id uuid,p_branch_id uuid,p_role text) returns text
language plpgsql security definer set search_path='' as $$
declare v_employee public.employees%rowtype;
begin
 select * into v_employee from public.employees where id=p_employee_id for share;
 if not found or v_employee.status is distinct from 'Aktif'
   or not (p_role=any(public.clinic_employee_roles(v_employee.jabatan))) then
   raise exception using errcode='P0001',message='CARE_INVALID: pilih petugas aktif dengan jabatan yang sesuai';
 end if;
 if v_employee.branch_id is distinct from p_branch_id then
   perform 1 from public.employee_branch_assignments where employee_id=p_employee_id
     and branch_id=p_branch_id and effective_date <= (now() at time zone 'Asia/Jakarta')::date for share;
   if not found then
     raise exception using errcode='P0001',message='CARE_INVALID: petugas tidak ditugaskan di cabang pasien';
   end if;
 end if;
 return v_employee.nama;
end;
$$;
revoke all on function public.clinic_staff_name(uuid,uuid,text) from public,anon,authenticated,service_role;

create function public.protect_inpatient_care_staff() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_record public.inpatient_records%rowtype;v_visit public.visits%rowtype;
begin
 if coalesce(auth.role(),'')<>'authenticated' or auth.uid() is null then
   raise exception using errcode='P0001',message='ACCESS_DENIED: pengguna tidak terautentikasi';
 end if;
 perform 1 from public.profiles where id=auth.uid() and is_active=true for share;
 if not found then raise exception using errcode='P0001',message='ACCESS_DENIED: pengguna tidak aktif';end if;
 if tg_table_name='inpatient_records' then
   if not public.user_can_access_branch(new.branch_id) then
     raise exception using errcode='P0001',message='ACCESS_DENIED: cabang tidak dapat diakses';
   end if;
   if tg_op='UPDATE' then
     if new.doctor_id is distinct from old.doctor_id or new.doctor_name is distinct from old.doctor_name
       or new.visit_id is distinct from old.visit_id or new.branch_id is distinct from old.branch_id then
       raise exception using errcode='P0001',message='CARE_INVALID: dokter PJ awal tetap tersimpan';
     end if;
   else
     select * into v_visit from public.visits where id=new.visit_id for share;
     if not found or v_visit.branch_id is distinct from new.branch_id or v_visit.doctor_id is null then
       raise exception using errcode='P0001',message='CARE_INVALID: pilih dokter PJ pada kunjungan sebelum masuk rawat inap';
     end if;
     new.doctor_id:=v_visit.doctor_id;
     new.doctor_name:=public.clinic_staff_name(new.doctor_id,new.branch_id,'doctor');
   end if;
   return new;
 end if;
 select * into v_record from public.inpatient_records where id=new.inpatient_record_id for update;
 if not found or not public.user_can_access_branch(v_record.branch_id) then
   raise exception using errcode='P0001',message='ACCESS_DENIED: rawat inap tidak dapat diakses';
 end if;
 if v_record.discharged_at is not null then
   raise exception using errcode='P0001',message='CARE_INVALID: rawat inap sudah ditutup';
 end if;
 if nullif(btrim(new.condition_note),'') is null then
   raise exception using errcode='P0001',message='CARE_INVALID: kondisi pasien wajib diisi';
 end if;
 if tg_op='UPDATE' then
   if new.inpatient_record_id is distinct from old.inpatient_record_id then
     raise exception using errcode='P0001',message='CARE_INVALID: catatan tidak dapat dipindahkan ke pasien lain';
   end if;
   new.updated_at:=now();new.updated_by:=auth.uid();new.created_by:=old.created_by;
 else new.created_by:=auth.uid();
 end if;
 if new.log_kind is null then
   if tg_op<>'UPDATE' or old.log_kind is not null
     or new.visit_doctor_id is not null or new.paramedic_id is not null then
     raise exception using errcode='P0001',message='CARE_INVALID: pilih jenis laporan pemantauan atau visit dokter';
   end if;
   new.doctor_name:=old.doctor_name;new.paramedic_name:=old.paramedic_name;
   return new;
 end if;
 if new.log_kind='doctor_visit' and new.visit_doctor_id is null then
   raise exception using errcode='P0001',message='CARE_INVALID: dokter visit wajib dipilih';
 end if;
 if new.visit_doctor_id is null then new.doctor_name:=null;
 elsif tg_op='UPDATE' and new.visit_doctor_id is not distinct from old.visit_doctor_id
   and new.log_kind is not distinct from old.log_kind then new.doctor_name:=old.doctor_name;
 else new.doctor_name:=public.clinic_staff_name(new.visit_doctor_id,v_record.branch_id,'doctor');end if;
 if new.paramedic_id is null then new.paramedic_name:=null;
 elsif tg_op='UPDATE' and new.paramedic_id is not distinct from old.paramedic_id then new.paramedic_name:=old.paramedic_name;
 else new.paramedic_name:=public.clinic_staff_name(new.paramedic_id,v_record.branch_id,'paramedic');end if;
 return new;
end;
$$;
revoke all on function public.protect_inpatient_care_staff() from public,anon,authenticated,service_role;
create trigger protect_inpatient_care_staff before insert or update on public.inpatient_records
 for each row execute function public.protect_inpatient_care_staff();
create trigger protect_inpatient_care_staff before insert or update on public.inpatient_daily_logs
 for each row execute function public.protect_inpatient_care_staff();

-- Every correction carries its old row in the same transaction, including direct updates.
create function public.audit_inpatient_care_edit() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.inpatient_daily_log_edits(log_id,edited_by,before,alasan)
 values(old.id,auth.uid(),to_jsonb(old),nullif(current_setting('clinic.inpatient_edit_reason',true),''));
 return new;
end;
$$;
revoke all on function public.audit_inpatient_care_edit() from public,anon,authenticated,service_role;
create trigger audit_inpatient_care_edit after update on public.inpatient_daily_logs
 for each row execute function public.audit_inpatient_care_edit();
revoke insert,update,delete on public.inpatient_daily_log_edits from authenticated,anon;
drop policy if exists idle_ins on public.inpatient_daily_log_edits;

create function public.clinic_update_inpatient_log(p_inpatient_id uuid,p_log_id uuid,p_patch jsonb,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare v_record public.inpatient_records%rowtype;v_log public.inpatient_daily_logs%rowtype;v_patch public.inpatient_daily_logs%rowtype;v_reason text;
begin
 if coalesce(auth.role(),'')<>'authenticated' or auth.uid() is null
   or not exists(select 1 from public.profiles where id=auth.uid() and is_active=true) then
   raise exception using errcode='P0001',message='ACCESS_DENIED: pengguna tidak aktif';
 end if;
 select * into v_record from public.inpatient_records where id=p_inpatient_id for update;
 if not found or not public.user_can_access_branch(v_record.branch_id) then
   raise exception using errcode='P0001',message='ACCESS_DENIED: rawat inap tidak dapat diakses';
 end if;
 select * into v_log from public.inpatient_daily_logs where id=p_log_id for update;
 if not found or v_log.inpatient_record_id is distinct from p_inpatient_id
   or jsonb_typeof(p_patch) is distinct from 'object' then
   raise exception using errcode='P0001',message='CARE_INVALID: catatan tidak sesuai pasien';
 end if;
 v_patch:=jsonb_populate_record(v_log,p_patch);
 v_reason:=current_setting('clinic.inpatient_edit_reason',true);
 perform set_config('clinic.inpatient_edit_reason',coalesce(p_reason,''),true);
 update public.inpatient_daily_logs set
  condition_note=v_patch.condition_note,
  tindakan=v_patch.tindakan,
  keterangan=v_patch.keterangan,
  log_kind=v_patch.log_kind,
  visit_doctor_id=v_patch.visit_doctor_id,
  paramedic_id=v_patch.paramedic_id,
  makan=v_patch.makan,
  minum=v_patch.minum,
  bab=v_patch.bab,
  pipis=v_patch.pipis,
  berat=v_patch.berat,
  suhu=v_patch.suhu,
  foto_url=v_patch.foto_url,
  komunikasi_owner=v_patch.komunikasi_owner,
  komunikasi_via=v_patch.komunikasi_via,
  log_date=v_patch.log_date,
  created_at=v_patch.created_at
 where id=p_log_id;
 perform set_config('clinic.inpatient_edit_reason',coalesce(v_reason,''),true);
end;
$$;
revoke all on function public.clinic_update_inpatient_log(uuid,uuid,jsonb,text) from public,anon,service_role;
grant execute on function public.clinic_update_inpatient_log(uuid,uuid,jsonb,text) to authenticated;

CREATE OR REPLACE FUNCTION public.clinic_save_inpatient_log(p_inpatient_id uuid, p_medical_record_id uuid, p_log jsonb, p_rows jsonb, p_compounds jsonb, p_request_key text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_inpatient public.inpatient_records%rowtype;
  v_existing public.inpatient_daily_logs%rowtype;
  v_log_id uuid;
  v_hash text;
  v_user uuid := auth.uid();
  v_row jsonb;
  v_key text := nullif(btrim(p_request_key), '');
begin
  if coalesce(auth.role(), '') <> 'authenticated'
     or v_user is null or not exists (select 1 from public.profiles where id=v_user and is_active=true) then
    raise exception using errcode='P0001', message='ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  if v_key is null or length(v_key) > 100
     or jsonb_typeof(p_log) is distinct from 'object'
     or nullif(btrim(p_log->>'condition_note'), '') is null
     or jsonb_typeof(p_rows) is distinct from 'array'
     or jsonb_typeof(p_compounds) is distinct from 'array'
     or jsonb_array_length(p_rows) > 200 or jsonb_array_length(p_compounds) > 50 then
    raise exception using errcode='P0001', message='LOG_INVALID: catatan rawat inap tidak lengkap';
  end if;
  v_hash := md5(jsonb_build_object(
    'inpatient', p_inpatient_id, 'medical_record', p_medical_record_id,
    'log', p_log, 'rows', p_rows, 'compounds', p_compounds
  )::text);
  select * into v_inpatient from public.inpatient_records
  where id = p_inpatient_id for update;
  if not found or not public.user_can_access_branch(v_inpatient.branch_id) then
    raise exception using errcode='P0001', message='ACCESS_DENIED: rawat inap tidak dapat diakses';
  end if;
  select * into v_existing from public.inpatient_daily_logs
  where submission_key = v_key for update;
  if found then
    if v_existing.inpatient_record_id is distinct from p_inpatient_id
       or v_existing.submitted_by is distinct from v_user
       or v_existing.submission_hash is distinct from v_hash then
      raise exception using errcode='P0001', message='IDEMPOTENCY_CONFLICT: kunci catatan dipakai untuk data berbeda';
    end if;
    return v_existing.id;
  end if;
  if (jsonb_array_length(p_rows) > 0 or jsonb_array_length(p_compounds) > 0)
     and (p_medical_record_id is null or not exists (
       select 1 from public.medical_records m where m.id = p_medical_record_id
       and m.visit_id = v_inpatient.visit_id
     )) then
    raise exception using errcode='P0001', message='LOG_INVALID: rekam medis belum tersedia untuk menautkan tagihan';
  end if;
  insert into public.inpatient_daily_logs(
    inpatient_record_id, condition_note, tindakan, keterangan, doctor_name, log_kind, visit_doctor_id, paramedic_id,
    created_by, makan, minum, bab, pipis, berat, suhu, foto_url,
    komunikasi_owner, komunikasi_via, log_date, created_at,
    submission_key, submission_hash, submitted_by
  ) values (
    p_inpatient_id, p_log->>'condition_note', p_log->>'tindakan',
    p_log->>'keterangan', p_log->>'doctor_name', coalesce(p_log->>'log_kind','monitoring'),
    nullif(p_log->>'visit_doctor_id','')::uuid, nullif(p_log->>'paramedic_id','')::uuid, v_user,
    p_log->>'makan', p_log->>'minum', p_log->>'bab', p_log->>'pipis',
    (p_log->>'berat')::numeric, (p_log->>'suhu')::numeric,
    p_log->>'foto_url', p_log->>'komunikasi_owner', p_log->>'komunikasi_via',
    coalesce((p_log->>'log_date')::date, current_date),
    coalesce((p_log->>'created_at')::timestamptz, now()),
    v_key, v_hash, v_user
  ) returning id into v_log_id;
  for v_row in select value from jsonb_array_elements(p_rows) as r(value) loop
    insert into public.prescription_items(
      medical_record_id, nama_obat, item_id, qty, satuan, faktor,
      harga, aturan_pakai, jenis
    ) values (
      p_medical_record_id, v_row->>'nama_obat', (v_row->>'item_id')::uuid,
      (v_row->>'qty')::integer, v_row->>'satuan',
      (v_row->>'faktor')::numeric, (v_row->>'harga')::numeric,
      v_row->>'aturan_pakai', v_row->>'jenis'
    );
  end loop;
  for v_row in select value from jsonb_array_elements(p_compounds) as c(value) loop
    if nullif(v_row->>'sale_item_id', '') is not null then
      perform public.clinic_issue_master_compound(
        p_medical_record_id, v_inpatient.visit_id, (v_row->>'sale_item_id')::uuid,
        v_row->'recipe', v_row->>'request_key',
        nullif(v_row->>'official_version_id','')::uuid, v_row->>'dosage_instruction'
      );
    elsif nullif(v_row->>'official_version_id', '') is not null then
      perform public.clinic_issue_official_compound(
        p_medical_record_id, v_inpatient.visit_id,
        (v_row->>'official_version_id')::uuid,
        v_row->>'request_key', v_row->>'dosage_instruction'
      );
    else
      perform public.clinic_issue_compound(
        p_medical_record_id, v_inpatient.visit_id,
        v_row->'recipe', v_row->>'request_key'
      );
    end if;
  end loop;
  return v_log_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.clinic_save_inpatient_log_with_status(p_inpatient_id uuid, p_medical_record_id uuid, p_log jsonb, p_rows jsonb, p_compounds jsonb, p_request_key text, p_new_status text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := auth.uid();
  v_record public.inpatient_records%rowtype;
  v_existing public.inpatient_daily_logs%rowtype;
  v_log jsonb := p_log || jsonb_build_object('_new_status', p_new_status);
  v_hash text;
  v_log_id uuid;
begin
  if coalesce(auth.role(), '') <> 'authenticated'
     or v_user is null or not exists (select 1 from public.profiles where id=v_user and is_active=true) then
    raise exception using errcode='P0001', message='ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  select * into v_record from public.inpatient_records
  where id=p_inpatient_id for update;
  if not found or not public.user_can_access_branch(v_record.branch_id) then
    raise exception using errcode='P0001', message='ACCESS_DENIED: rawat inap tidak dapat diakses';
  end if;
  v_hash := md5(jsonb_build_object(
    'inpatient', p_inpatient_id, 'medical_record', p_medical_record_id,
    'log', v_log, 'rows', p_rows, 'compounds', p_compounds
  )::text);
  select * into v_existing from public.inpatient_daily_logs
  where submission_key=p_request_key for update;
  if found then
    if v_existing.inpatient_record_id is distinct from p_inpatient_id
       or v_existing.submitted_by is distinct from v_user
       or v_existing.submission_hash is distinct from v_hash then
      raise exception using errcode='P0001', message='IDEMPOTENCY_CONFLICT: kunci catatan dipakai untuk data berbeda';
    end if;
    return v_existing.id;
  end if;
  v_log_id := public.clinic_save_inpatient_log(
    p_inpatient_id, p_medical_record_id, v_log,
    p_rows, p_compounds, p_request_key
  );
  if p_new_status is not null then
    perform public.clinic_change_inpatient_condition(
      p_inpatient_id, p_new_status, 'Diubah dari catatan harian'
    );
  end if;
  return v_log_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.clinic_save_initial_record(p_visit_id uuid, p_pet_id uuid, p_record jsonb, p_followups jsonb, p_rows jsonb, p_compounds jsonb, p_provider_id uuid, p_doctor_id uuid, p_dokter text, p_keluhan text, p_request_key text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_visit public.visits%rowtype;
  v_existing public.medical_records%rowtype;
  v_record_id uuid;
  v_customer_id uuid;
  v_hash text;
  v_user uuid := auth.uid();
  v_row jsonb;
  v_urls text[];
  v_key text := nullif(btrim(p_request_key), '');
begin
  if coalesce(auth.role(), '') <> 'authenticated'
     or v_user is null then
    raise exception using errcode='P0001', message='ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  if v_key is null or length(v_key) > 100
     or jsonb_typeof(p_record) is distinct from 'object'
     or jsonb_typeof(p_followups) is distinct from 'array'
     or jsonb_typeof(p_rows) is distinct from 'array'
     or jsonb_typeof(p_compounds) is distinct from 'array'
     or jsonb_array_length(p_followups) > 100
     or jsonb_array_length(p_rows) > 200
     or jsonb_array_length(p_compounds) > 50 then
    raise exception using errcode='P0001', message='RECORD_INVALID: pemeriksaan tidak lengkap';
  end if;
  v_hash := md5(jsonb_build_object(
    'visit', p_visit_id, 'pet', p_pet_id, 'record', p_record,
    'followups', p_followups, 'rows', p_rows, 'compounds', p_compounds,
    'provider', p_provider_id, 'doctor', p_doctor_id,
    'doctor_name', p_dokter, 'complaint', p_keluhan
  )::text);

  select * into v_visit from public.visits where id = p_visit_id for update;
  if not found or v_visit.pet_id is distinct from p_pet_id
     or not public.user_can_access_branch(v_visit.branch_id) then
    raise exception using errcode='P0001', message='ACCESS_DENIED: kunjungan atau pasien tidak dapat diakses';
  end if;
  select * into v_existing from public.medical_records
  where submission_key = v_key for update;
  if found then
    if v_existing.visit_id is distinct from p_visit_id
       or v_existing.submitted_by is distinct from v_user
       or v_existing.submission_hash is distinct from v_hash then
      raise exception using errcode='P0001', message='IDEMPOTENCY_CONFLICT: kunci pemeriksaan dipakai untuk data berbeda';
    end if;
    return v_existing.id;
  end if;
  if v_visit.service_started_at is null or v_visit.service_finished_at is not null then
    raise exception using errcode='P0001', message='RECORD_INVALID: kunjungan belum siap disimpan';
  end if;
  -- Validate before any record, prescription, compound or service-state write.
  -- Grooming/boarding are not medical visits; registration drafts remain allowed.
  if lower(btrim(coalesce(v_visit.poli, ''))) not in ('grooming','penitipan') then
    if p_doctor_id is null or not exists (
      select 1 from public.employees e where e.id=p_doctor_id and e.status='Aktif'
        and 'doctor'=any(public.clinic_employee_roles(e.jabatan))
        and (e.branch_id=v_visit.branch_id or exists (
          select 1 from public.employee_branch_assignments a
          where a.employee_id=e.id and a.branch_id=v_visit.branch_id
            and a.effective_date <= (now() at time zone 'Asia/Jakarta')::date
        ))
    ) then
      raise exception using errcode='P0001', message='DOCTOR_REQUIRED: pilih dokter aktif yang ditugaskan ke cabang';
    end if;
    if nullif(btrim(p_keluhan), '') is null then
      raise exception using errcode='P0001', message='COMPLAINT_REQUIRED: keluhan pasien wajib diisi';
    end if;
  end if;
  select customer_id into v_customer_id from public.pets where id = p_pet_id;

  if p_provider_id is not null then
    perform public.set_visit_service_state(p_visit_id, 'provider', p_provider_id);
  end if;
  if jsonb_typeof(p_record->'penunjang_urls') = 'array' then
    select array_agg(value) into v_urls
    from jsonb_array_elements_text(p_record->'penunjang_urls') as u(value);
  end if;
  insert into public.medical_records(
    visit_id, diagnosis, anamnesis, suhu, berat, gejala_klinis,
    hasil_penunjang, follow_up, catatan_resep, penunjang_urls,
    submission_key, submission_hash, submitted_by
  ) values (
    p_visit_id, p_record->>'diagnosis', p_record->>'anamnesis',
    (p_record->>'suhu')::numeric, (p_record->>'berat')::numeric,
    p_record->>'gejala_klinis', p_record->>'hasil_penunjang',
    p_record->>'follow_up', p_record->>'catatan_resep', v_urls,
    v_key, v_hash, v_user
  ) returning id into v_record_id;

  for v_row in select value from jsonb_array_elements(p_followups) as f(value) loop
    insert into public.follow_ups(
      visit_id, medical_record_id, pet_id, customer_id, branch_id,
      jenis, tanggal, catatan, created_by
    ) values (
      p_visit_id, v_record_id, p_pet_id, v_customer_id, v_visit.branch_id,
      v_row->>'jenis', (v_row->>'tanggal')::date,
      nullif(v_row->>'catatan', ''), v_user
    );
  end loop;
  for v_row in select value from jsonb_array_elements(p_rows) as r(value) loop
    insert into public.prescription_items(
      medical_record_id, nama_obat, item_id, qty, satuan, faktor,
      harga, aturan_pakai, jenis, kategori
    ) values (
      v_record_id, v_row->>'nama_obat', (v_row->>'item_id')::uuid,
      (v_row->>'qty')::integer, v_row->>'satuan',
      (v_row->>'faktor')::numeric, (v_row->>'harga')::numeric,
      v_row->>'aturan_pakai', v_row->>'jenis', v_row->>'kategori'
    );
  end loop;
  for v_row in select value from jsonb_array_elements(p_compounds) as c(value) loop
    if nullif(v_row->>'sale_item_id', '') is not null then
      perform public.clinic_issue_master_compound(
        v_record_id, p_visit_id, (v_row->>'sale_item_id')::uuid,
        v_row->'recipe', v_row->>'request_key',
        nullif(v_row->>'official_version_id','')::uuid, v_row->>'dosage_instruction'
      );
    elsif nullif(v_row->>'official_version_id', '') is not null then
      perform public.clinic_issue_official_compound(
        v_record_id, p_visit_id, (v_row->>'official_version_id')::uuid,
        v_row->>'request_key', v_row->>'dosage_instruction'
      );
    else
      -- Only the OWNER/ADMIN exception wrapper accepts this call.
      perform public.clinic_issue_compound(
        v_record_id, p_visit_id, v_row->'recipe', v_row->>'request_key'
      );
    end if;
  end loop;
  if (p_record->>'berat')::numeric > 0 then
    update public.pets set weight = (p_record->>'berat')::numeric where id = p_pet_id;
  end if;
  perform public.set_visit_service_state(p_visit_id, 'finish');
  update public.visits
  set status = 'Pembayaran', dokter = p_dokter, doctor_id = p_doctor_id, keluhan = p_keluhan
  where id = p_visit_id;
  return v_record_id;
end;
$function$
;

-- Service performer follows effective secondary assignments as well as the primary branch.
CREATE OR REPLACE FUNCTION public.set_visit_service_state(p_visit_id uuid, p_action text, p_provider_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_visit visits%rowtype;
  v_provider employees%rowtype;
begin
  select * into v_visit from visits where id = p_visit_id for update;
  if not found or not public.user_can_access_branch(v_visit.branch_id) then
    raise exception 'Kunjungan tidak ditemukan atau cabang tidak dapat diakses';
  end if;

  if p_action = 'start' then
    if v_visit.status <> 'Menunggu' or v_visit.service_started_at is not null then
      raise exception 'Kunjungan tidak siap dimulai';
    end if;
    update visits set status = 'Diperiksa', service_started_at = now(), called_at = coalesce(called_at, now()) where id = p_visit_id;
    insert into visit_operational_events (visit_id, branch_id, event_type, payload, created_by)
    values (p_visit_id, v_visit.branch_id, 'service_started', '{}'::jsonb, auth.uid());
  elsif p_action = 'finish' then
    if v_visit.service_started_at is null or v_visit.service_finished_at is not null then
      raise exception 'Kunjungan belum siap diselesaikan';
    end if;
    update visits set status = 'Pembayaran', service_finished_at = now() where id = p_visit_id;
    insert into visit_operational_events (visit_id, branch_id, event_type, payload, created_by)
    values (p_visit_id, v_visit.branch_id, 'service_finished', '{}'::jsonb, auth.uid());
  elsif p_action = 'checkout' then
    if v_visit.checked_out_at is null then
      update visits set status = 'Selesai', checked_out_at = now() where id = p_visit_id;
      insert into visit_operational_events (visit_id, branch_id, event_type, payload, created_by)
      values (p_visit_id, v_visit.branch_id, 'check_out', '{}'::jsonb, auth.uid());
    end if;
  elsif p_action = 'provider' then
    if p_provider_id is null then
      raise exception 'Pelaksana wajib dipilih';
    end if;
    select * into v_provider from employees where id = p_provider_id for share;
    if not found or v_provider.status is distinct from 'Aktif'
      or (v_provider.branch_id is distinct from v_visit.branch_id and not exists (
        select 1 from public.employee_branch_assignments a where a.employee_id=p_provider_id
          and a.branch_id=v_visit.branch_id and a.effective_date <= (now() at time zone 'Asia/Jakarta')::date
      )) then
      raise exception 'Pelaksana tidak aktif atau bukan dari cabang kunjungan';
    end if;
    update visits set service_provider_id = p_provider_id where id = p_visit_id;
    insert into visit_operational_events (visit_id, branch_id, event_type, payload, created_by)
    values (p_visit_id, v_visit.branch_id, 'provider_changed', jsonb_build_object('provider_id', p_provider_id), auth.uid());
  else
    raise exception 'Aksi layanan tidak dikenal';
  end if;
end;
$function$;
