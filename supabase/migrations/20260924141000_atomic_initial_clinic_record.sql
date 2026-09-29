-- Initial exam, follow-ups, ordinary prescription, official/manual compound
-- issuance, visit completion and pet weight are one database transaction.
-- A failure to issue even the last formula leaves no partial medical record.
alter table public.medical_records
  add column submission_key text,
  add column submission_hash text,
  add column submitted_by uuid references public.profiles(id);
create unique index medical_records_submission_key_unique
  on public.medical_records(submission_key) where submission_key is not null;

create function public.protect_submitted_clinic_record() returns trigger
language plpgsql security definer set search_path = '' as $function$
begin
  if old.submission_key is not null then
    raise exception using errcode='P0001', message='RECORD_POSTED: pemeriksaan tersimpan tidak dapat diubah atau dihapus';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;
create trigger protect_submitted_clinic_record
  before update or delete on public.medical_records
  for each row execute function public.protect_submitted_clinic_record();
revoke all on function public.protect_submitted_clinic_record()
  from public, anon, authenticated, service_role;

create function public.clinic_save_initial_record(
  p_visit_id uuid, p_pet_id uuid, p_record jsonb, p_followups jsonb,
  p_rows jsonb, p_compounds jsonb, p_provider_id uuid,
  p_doctor_id uuid, p_dokter text, p_keluhan text, p_request_key text
) returns uuid language plpgsql security invoker set search_path = '' as $function$
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
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'authenticated'
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
    if nullif(v_row->>'official_version_id', '') is not null then
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
$function$;

revoke all on function public.clinic_save_initial_record(
  uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid,uuid,text,text,text
) from public, anon, authenticated, service_role;
grant execute on function public.clinic_save_initial_record(
  uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid,uuid,text,text,text
) to authenticated;
