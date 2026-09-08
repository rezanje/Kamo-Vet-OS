-- Nomor telepon lama tidak selalu unik. Impor rekam medis harus mencocokkan
-- gabungan nama owner + nomor telepon agar hewan milik owner berbeda tidak tercampur.
alter table public.visits add column if not exists legacy_record_no text;
alter table public.visits alter column branch_id drop not null;

-- Riwayat lama tidak selalu mencantumkan cabang pemeriksaan. Catatan ini bersifat
-- lintas cabang, sementara kunjungan baru tetap wajib punya cabang.
create or replace function public.can_read_legacy_medical_history()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('OWNER', 'ADMIN', 'DOCTOR')
  ) or exists (
    select 1
    from public.user_branches ub
    join public.branches b on b.id = ub.branch_id
    where ub.user_id = (select auth.uid())
      and b.type in ('KLINIK', 'BOTH')
  );
$$;
revoke all on function public.can_read_legacy_medical_history() from public;
grant execute on function public.can_read_legacy_medical_history() to authenticated;

drop policy if exists visits_select on public.visits;
create policy visits_select on public.visits for select to authenticated
  using (
    public.user_can_access_branch(branch_id)
    or (legacy_source_key is not null and public.can_read_legacy_medical_history())
  );

drop policy if exists visits_write on public.visits;
create policy visits_write on public.visits for all to authenticated
  using (
    public.user_can_access_branch(branch_id)
    or (legacy_source_key is not null and public.is_admin())
  )
  with check (
    public.user_can_access_branch(branch_id)
    or (legacy_source_key is not null and public.is_admin())
  );

drop policy if exists mr_all on public.medical_records;
create policy mr_select on public.medical_records for select to authenticated
  using (exists (
    select 1 from public.visits v
    where v.id = medical_records.visit_id
      and (
        public.user_can_access_branch(v.branch_id)
        or (v.legacy_source_key is not null and public.can_read_legacy_medical_history())
      )
  ));
create policy mr_write on public.medical_records for all to authenticated
  using (exists (
    select 1 from public.visits v
    where v.id = medical_records.visit_id
      and (
        public.user_can_access_branch(v.branch_id)
        or (v.legacy_source_key is not null and public.is_admin())
      )
  ))
  with check (exists (
    select 1 from public.visits v
    where v.id = medical_records.visit_id
      and (
        public.user_can_access_branch(v.branch_id)
        or (v.legacy_source_key is not null and public.is_admin())
      )
  ));

create unique index if not exists visits_legacy_source_key_global_unique
  on public.visits(legacy_source_key)
  where legacy_source_key is not null and branch_id is null;

drop function if exists public.import_legacy_medical_record(
  uuid, text, timestamptz, text, text, text, text, text, text, text, date, text, text, text, text, text
);

create or replace function public.import_legacy_medical_record(
  p_source_key text,
  p_record_no text,
  p_record_date timestamptz,
  p_owner_name text,
  p_phone text,
  p_address text,
  p_patient_name text,
  p_species text,
  p_breed text,
  p_gender text,
  p_dob date,
  p_doctor text,
  p_note text,
  p_anamnesis text,
  p_clinical_findings text,
  p_diagnosis text,
  p_therapy text
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_customer_id uuid;
  v_pet_id uuid;
  v_visit_id uuid;
  v_owner_key text;
  v_phone_key text;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Hanya OWNER/ADMIN yang boleh mengimpor rekam medis';
  end if;
  if p_source_key is null or btrim(p_source_key) = '' then
    raise exception 'Jejak sumber wajib diisi';
  end if;
  if p_record_date is null or p_owner_name is null or p_phone is null or p_patient_name is null then
    raise exception 'Tanggal, pemilik, nomor telepon, dan pasien wajib diisi';
  end if;
  select v.id into v_visit_id
  from public.visits v
  where v.legacy_source_key = p_source_key;
  if v_visit_id is not null then
    return v_visit_id;
  end if;

  v_owner_key := lower(regexp_replace(btrim(p_owner_name), '\s+', ' ', 'g'));
  v_phone_key := regexp_replace(p_phone, '\D', '', 'g');
  perform pg_advisory_xact_lock(hashtext(v_owner_key || ':' || v_phone_key));

  select c.id into v_customer_id
  from public.customers c
  where lower(regexp_replace(btrim(c.name), '\s+', ' ', 'g')) = v_owner_key
    and regexp_replace(c.phone, '\D', '', 'g') = v_phone_key
  order by c.created_at asc
  limit 1;

  if v_customer_id is null then
    insert into public.customers(name, phone, address)
    values (p_owner_name, p_phone, nullif(p_address, ''))
    returning id into v_customer_id;
  end if;

  select p.id into v_pet_id
  from public.pets p
  where p.customer_id = v_customer_id
    and lower(btrim(p.name)) = lower(btrim(p_patient_name))
  order by p.created_at asc
  limit 1;

  if v_pet_id is null then
    insert into public.pets(customer_id, name, species, breed, gender, dob)
    values (v_customer_id, p_patient_name, nullif(p_species, ''), nullif(p_breed, ''), nullif(p_gender, ''), p_dob)
    returning id into v_pet_id;
  end if;

  insert into public.visits(
    branch_id, customer_id, pet_id, poli, dokter, keluhan, status, created_at, legacy_source_key, legacy_record_no
  ) values (
    null, v_customer_id, v_pet_id, 'Poli Umum', nullif(p_doctor, ''),
    coalesce(nullif(p_note, ''), nullif(p_anamnesis, '')), 'Selesai', p_record_date, p_source_key, nullif(p_record_no, '')
  ) returning id into v_visit_id;

  insert into public.medical_records(visit_id, diagnosis, anamnesis, gejala_klinis, catatan_resep)
  values (
    v_visit_id, nullif(p_diagnosis, ''), nullif(p_anamnesis, ''),
    nullif(p_clinical_findings, ''), nullif(p_therapy, '')
  );
  return v_visit_id;
end;
$$;

revoke execute on function public.import_legacy_medical_record(
  text, text, timestamptz, text, text, text, text, text, text, text, date, text, text, text, text, text, text
) from public;
grant execute on function public.import_legacy_medical_record(
  text, text, timestamptz, text, text, text, text, text, text, text, date, text, text, text, text, text, text
) to authenticated;
