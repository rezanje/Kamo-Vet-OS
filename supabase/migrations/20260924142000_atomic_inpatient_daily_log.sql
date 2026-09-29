-- Daily inpatient log, ordinary prescription and all compound issues commit together.
-- Lock the inpatient record to serialize retries for the same submission key.
alter table public.inpatient_daily_logs
  add column submission_key text,
  add column submission_hash text,
  add column submitted_by uuid references public.profiles(id);
create unique index inpatient_daily_logs_submission_key_unique
  on public.inpatient_daily_logs(submission_key) where submission_key is not null;

create function public.protect_inpatient_submission_identity() returns trigger
language plpgsql security definer set search_path = '' as $function$
begin
  if tg_op = 'DELETE' then
    if old.submission_key is not null then
      raise exception using errcode='P0001', message='LOG_POSTED: catatan tersimpan tidak boleh dihapus';
    end if;
    return old;
  end if;
  if old.submission_key is not null and (
    new.submission_key is distinct from old.submission_key
    or new.submission_hash is distinct from old.submission_hash
    or new.submitted_by is distinct from old.submitted_by
  ) then
    raise exception using errcode='P0001', message='LOG_POSTED: identitas catatan tersimpan tidak boleh diubah';
  end if;
  return new;
end;
$function$;
create trigger protect_inpatient_submission_identity
  before update or delete on public.inpatient_daily_logs
  for each row execute function public.protect_inpatient_submission_identity();
revoke all on function public.protect_inpatient_submission_identity()
  from public, anon, authenticated, service_role;

create function public.clinic_save_inpatient_log(
  p_inpatient_id uuid, p_medical_record_id uuid, p_log jsonb,
  p_rows jsonb, p_compounds jsonb, p_request_key text
) returns uuid language plpgsql security invoker set search_path = '' as $function$
declare
  v_inpatient public.inpatient_records%rowtype;
  v_existing public.inpatient_daily_logs%rowtype;
  v_log_id uuid;
  v_hash text;
  v_user uuid := auth.uid();
  v_row jsonb;
  v_key text := nullif(btrim(p_request_key), '');
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'authenticated'
     or v_user is null then
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
    inpatient_record_id, condition_note, tindakan, keterangan, doctor_name,
    created_by, makan, minum, bab, pipis, berat, suhu, foto_url,
    komunikasi_owner, komunikasi_via, log_date, created_at,
    submission_key, submission_hash, submitted_by
  ) values (
    p_inpatient_id, p_log->>'condition_note', p_log->>'tindakan',
    p_log->>'keterangan', p_log->>'doctor_name', v_user,
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
    if nullif(v_row->>'official_version_id', '') is not null then
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
$function$;
revoke all on function public.clinic_save_inpatient_log(uuid,uuid,jsonb,jsonb,jsonb,text)
  from public, anon, authenticated, service_role;
grant execute on function public.clinic_save_inpatient_log(uuid,uuid,jsonb,jsonb,jsonb,text)
  to authenticated;
