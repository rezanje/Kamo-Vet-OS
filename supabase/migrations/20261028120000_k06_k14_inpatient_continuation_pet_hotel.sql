-- K06: a paid/closed outpatient visit can continue to inpatient care.
--   The billing model is one active invoice per visit (invoices_visit_active_key),
--   so the stay is admitted on a *continuation visit* that is linked to the
--   original visit and its medical record. The original invoice is never touched;
--   inpatient charges are billed on the continuation visit's own invoice.
--   A visit still in Pembayaran whose invoice is not Lunas keeps the direct admission path.
-- K14: an inpatient stay has a type chosen at admission: 'sakit' (default,
--   unchanged flow) or 'pet_hotel' (healthy boarding; daily care log by paramedic).
-- Idempotent: safe to run more than once.

alter table public.visits
  add column if not exists continued_from_visit_id uuid references public.visits(id) on delete restrict;
create index if not exists visits_continued_from_idx
  on public.visits(continued_from_visit_id) where continued_from_visit_id is not null;

alter table public.medical_records
  add column if not exists continued_from_record_id uuid references public.medical_records(id) on delete restrict;

alter table public.inpatient_records
  add column if not exists stay_type text not null default 'sakit';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'inpatient_records_stay_type_check'
                 and conrelid = 'public.inpatient_records'::regclass) then
    alter table public.inpatient_records
      add constraint inpatient_records_stay_type_check check (stay_type in ('sakit','pet_hotel'));
  end if;
end $$;

-- The continuation links are written only by the RPC below. Direct writes from
-- the browser role could otherwise forge or move the link to another visit.
create or replace function public.protect_inpatient_continuation_link() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_user <> 'authenticated' then return new; end if;
  if tg_table_name = 'visits' then
    if (tg_op = 'INSERT' and new.continued_from_visit_id is not null)
       or (tg_op = 'UPDATE' and new.continued_from_visit_id is distinct from old.continued_from_visit_id) then
      raise exception using errcode = 'P0001', message = 'CONTINUATION_LOCKED: tautan kunjungan lanjutan hanya dibuat sistem';
    end if;
  else
    if (tg_op = 'INSERT' and new.continued_from_record_id is not null)
       or (tg_op = 'UPDATE' and new.continued_from_record_id is distinct from old.continued_from_record_id) then
      raise exception using errcode = 'P0001', message = 'CONTINUATION_LOCKED: tautan rekam medis lanjutan hanya dibuat sistem';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.protect_inpatient_continuation_link() from public, anon, authenticated, service_role;
drop trigger if exists protect_inpatient_continuation_link on public.visits;
create trigger protect_inpatient_continuation_link before insert or update on public.visits
  for each row execute function public.protect_inpatient_continuation_link();
drop trigger if exists protect_inpatient_continuation_link on public.medical_records;
create trigger protect_inpatient_continuation_link before insert or update on public.medical_records
  for each row execute function public.protect_inpatient_continuation_link();

-- Same clinic-module rule the app uses (lib/akses.ts): OWNER always; a role with saved
-- Akses Grup rows needs the 'klinik' module; without saved rows ADMIN/DOCTOR/STAFF have it.
create or replace function public.inpatient_clinic_module_access() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles p where p.id = auth.uid() and p.is_active is true and (
    p.role = 'OWNER'
    or exists(select 1 from public.role_modules m where m.role = p.role and m.module_id = 'klinik')
    or (p.role in ('ADMIN','DOCTOR','STAFF') and not exists(select 1 from public.role_modules m where m.role = p.role))
  ));
$$;
revoke all on function public.inpatient_clinic_module_access() from public, anon, authenticated, service_role;

-- One live stay per patient, enforced on every admission path (old RPC, typed RPC).
-- The pet row lock serializes concurrent admissions of the same patient from different
-- visits; the re-check runs right before the insert. Lock order everywhere: visit, then pet.
create or replace function public.guard_one_live_stay_per_pet() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_pet uuid;
begin
  select pet_id into v_pet from public.visits where id = new.visit_id;
  if v_pet is null then return new; end if;
  perform 1 from public.pets where id = v_pet for no key update;
  if exists(select 1 from public.inpatient_records r join public.visits v on v.id = r.visit_id
            where v.pet_id = v_pet and r.discharged_at is null and r.id <> new.id) then
    raise exception 'ADMISSION_INVALID: pasien sudah memiliki rawat inap aktif';
  end if;
  return new;
end $$;
revoke all on function public.guard_one_live_stay_per_pet() from public, anon, authenticated, service_role;
drop trigger if exists guard_one_live_stay_per_pet on public.inpatient_records;
create trigger guard_one_live_stay_per_pet before insert on public.inpatient_records
  for each row execute function public.guard_one_live_stay_per_pet();

-- K06: open (or reuse) the continuation visit of a closed outpatient visit.
-- "Closed" = Selesai, checked out, or its invoice is Lunas. Returns the continuation
-- visit id; the caller then signs the inpatient consent and admits on that visit.
create or replace function public.clinic_continue_visit_to_inpatient(p_visit_id uuid, p_request_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_visit public.visits%rowtype;
  v_medical public.medical_records%rowtype;
  v_existing public.medical_records%rowtype;
  v_key text := nullif(btrim(p_request_key), '');
  v_submission text;
  v_new_visit uuid;
  v_now timestamptz := now();
begin
  if coalesce(auth.role(), '') <> 'authenticated' or auth.uid() is null or not exists(
    select 1 from public.profiles where id = auth.uid() and is_active
  ) then raise exception 'ACCESS_DENIED: pengguna tidak aktif atau tidak terautentikasi'; end if;
  if not public.inpatient_clinic_module_access() then
    raise exception 'ACCESS_DENIED: peran ini tidak memiliki akses modul klinik'; end if;
  if v_key is null or length(v_key) > 100 then
    raise exception 'ADMISSION_INVALID: muat ulang formulir rawat inap'; end if;
  v_submission := 'k06-continue:' || v_key;

  -- Visit then pet: serializes concurrent clicks on this visit and admissions of this patient.
  select * into v_visit from public.visits where id = p_visit_id for update;
  if not found or not public.user_can_access_branch(v_visit.branch_id) then
    raise exception 'ACCESS_DENIED: kunjungan atau cabang tidak dapat diakses'; end if;
  perform 1 from public.pets where id = v_visit.pet_id for no key update;

  select * into v_existing from public.medical_records where submission_key = v_submission;
  if found then
    if v_existing.submitted_by is distinct from auth.uid() or not exists(
      select 1 from public.visits where id = v_existing.visit_id and continued_from_visit_id = p_visit_id
    ) then raise exception 'IDEMPOTENCY_CONFLICT: kunci lanjutan rawat inap dipakai untuk data berbeda'; end if;
    return v_existing.visit_id;
  end if;

  if not (v_visit.status = 'Selesai' or v_visit.checked_out_at is not null or exists(
    select 1 from public.invoices where visit_id = p_visit_id and voided_at is null and paid_status = 'Lunas'
  )) then
    raise exception 'ADMISSION_INVALID: kunjungan belum selesai; masukkan rawat inap langsung dari kunjungan ini';
  end if;
  select * into v_medical from public.medical_records where visit_id = p_visit_id
    order by created_at desc, id desc limit 1;
  if v_medical.id is null or v_visit.doctor_id is null then
    raise exception 'ADMISSION_INVALID: selesaikan pemeriksaan dan pilih dokter terlebih dahulu'; end if;

  if exists(select 1 from public.inpatient_records r join public.visits v on v.id = r.visit_id
            where v.pet_id = v_visit.pet_id and r.discharged_at is null) then
    raise exception 'ADMISSION_INVALID: pasien sudah memiliki rawat inap aktif'; end if;

  -- A continuation that is still open (not admitted, not billed) is reused.
  select v.id into v_new_visit from public.visits v
  where v.continued_from_visit_id = p_visit_id and v.status <> 'Selesai' and v.checked_out_at is null
    and not exists(select 1 from public.invoices i where i.visit_id = v.id and i.voided_at is null)
    and not exists(select 1 from public.inpatient_records r where r.visit_id = v.id)
  order by v.created_at desc, v.id desc limit 1;
  if v_new_visit is not null then return v_new_visit; end if;

  insert into public.visits(branch_id, customer_id, pet_id, poli, dokter, doctor_id, keluhan, status, source,
    checked_in_at, service_started_at, service_finished_at, continued_from_visit_id)
  values (v_visit.branch_id, v_visit.customer_id, v_visit.pet_id, v_visit.poli, v_visit.dokter, v_visit.doctor_id,
    'Lanjutan rawat inap dari kunjungan ' || to_char(v_visit.created_at at time zone 'Asia/Jakarta', 'DD-MM-YYYY'),
    'Pembayaran', 'walk_in', v_now, v_now, v_now, p_visit_id)
  returning id into v_new_visit;

  -- Clinical findings carry over for continuity; prescriptions and billing do not.
  insert into public.medical_records(visit_id, anamnesis, diagnosis, therapy, suhu, berat, gejala_klinis,
    hasil_penunjang, penunjang_urls, continued_from_record_id, submission_key, submission_hash, submitted_by)
  values (v_new_visit, v_medical.anamnesis, v_medical.diagnosis, v_medical.therapy, v_medical.suhu, v_medical.berat,
    v_medical.gejala_klinis, v_medical.hasil_penunjang, v_medical.penunjang_urls, v_medical.id, v_submission,
    md5(jsonb_build_object('visit', p_visit_id, 'actor', auth.uid())::text), auth.uid());
  return v_new_visit;
end $$;
revoke all on function public.clinic_continue_visit_to_inpatient(uuid, text) from public, anon, service_role;
grant execute on function public.clinic_continue_visit_to_inpatient(uuid, text) to authenticated;

-- K14: admission with a stay type. Wraps the existing admission RPC so its
-- consent, doctor and idempotency rules stay the single source of truth.
create or replace function public.clinic_admit_inpatient_typed(
  p_visit_id uuid, p_treatment_plan text, p_request_key text, p_stay_type text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_key text := nullif(btrim(p_request_key), '');
  v_visit public.visits%rowtype;
  v_prior public.inpatient_records%rowtype;
  v_id uuid;
  v_stored text;
begin
  if coalesce(auth.role(), '') <> 'authenticated' or auth.uid() is null then
    raise exception 'ACCESS_DENIED: pengguna tidak aktif atau tidak terautentikasi'; end if;
  if not public.inpatient_clinic_module_access() then
    raise exception 'ACCESS_DENIED: peran ini tidak memiliki akses modul klinik'; end if;
  if p_stay_type is null or p_stay_type not in ('sakit', 'pet_hotel') then
    raise exception 'ADMISSION_INVALID: pilih tipe rawat inap'; end if;
  if v_key is null or length(v_key) > 100 then
    raise exception 'ADMISSION_INVALID: isi rencana tindakan dan muat ulang formulir'; end if;
  -- Same-key retries are serialized before anything is read, whatever visit they name.
  perform pg_advisory_xact_lock(hashtextextended('inpatient-admission:' || v_key, 0));
  -- Visit then pet: same order as the base RPC and the per-patient guard.
  select * into v_visit from public.visits where id = p_visit_id for update;
  if not found or not public.user_can_access_branch(v_visit.branch_id) then
    raise exception 'ACCESS_DENIED: kunjungan atau cabang tidak dapat diakses'; end if;
  perform 1 from public.pets where id = v_visit.pet_id for no key update;

  select * into v_prior from public.inpatient_records where admission_request_key = v_key for update;
  v_id := public.clinic_admit_inpatient(p_visit_id, p_treatment_plan, p_request_key);
  if v_prior.id is not null then
    if v_prior.stay_type is distinct from p_stay_type then
      raise exception 'IDEMPOTENCY_CONFLICT: kunci masuk rawat inap dipakai untuk data berbeda'; end if;
    return v_id;
  end if;
  if p_stay_type <> 'sakit' then
    update public.inpatient_records set stay_type = p_stay_type where id = v_id;
  end if;
  select stay_type into v_stored from public.inpatient_records where id = v_id;
  if v_stored is distinct from p_stay_type then
    raise exception 'IDEMPOTENCY_CONFLICT: kunci masuk rawat inap dipakai untuk data berbeda'; end if;
  return v_id;
end $$;
revoke all on function public.clinic_admit_inpatient_typed(uuid, text, text, text) from public, anon, service_role;
grant execute on function public.clinic_admit_inpatient_typed(uuid, text, text, text) to authenticated;
