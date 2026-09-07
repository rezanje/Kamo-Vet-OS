-- Riwayat medis lama harus punya jejak sumber yang unik per cabang. Tanpa ini,
-- unggahan file sama dua kali bisa membuat kunjungan dan rekam medis kembar.
alter table public.visits add column if not exists legacy_source_key text;
create unique index if not exists visits_legacy_source_key_unique
  on public.visits(branch_id, legacy_source_key)
  where legacy_source_key is not null;

-- Satu fungsi atomik: pelanggan, pasien, kunjungan, dan rekam medis selalu
-- tersimpan lengkap atau tidak sama sekali. Akses tetap dibatasi OWNER/ADMIN.
create or replace function public.import_legacy_medical_record(
  p_branch_id uuid,
  p_source_key text,
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
  if not exists (select 1 from public.branches b where b.id = p_branch_id and b.type in ('KLINIK', 'BOTH')) then
    raise exception 'Cabang klinik tidak valid';
  end if;

  select v.id into v_visit_id
  from public.visits v
  where v.branch_id = p_branch_id and v.legacy_source_key = p_source_key;
  if v_visit_id is not null then
    return v_visit_id;
  end if;

  -- customers.phone belum unique di database lama. Kunci transaksi ini mencegah
  -- dua unggahan bersamaan membuat dua pelanggan untuk nomor telepon yang sama.
  perform pg_advisory_xact_lock(hashtext(p_phone));
  select c.id into v_customer_id from public.customers c
  where c.phone = p_phone order by c.created_at asc limit 1;
  if v_customer_id is null then
    insert into public.customers(name, phone, address)
    values (p_owner_name, p_phone, nullif(p_address, ''))
    returning id into v_customer_id;
  end if;

  select p.id into v_pet_id from public.pets p
  where p.customer_id = v_customer_id and lower(p.name) = lower(p_patient_name)
  order by p.created_at asc limit 1;
  if v_pet_id is null then
    insert into public.pets(customer_id, name, species, breed, gender, dob)
    values (v_customer_id, p_patient_name, nullif(p_species, ''), nullif(p_breed, ''), nullif(p_gender, ''), p_dob)
    returning id into v_pet_id;
  end if;

  insert into public.visits(
    branch_id, customer_id, pet_id, poli, dokter, keluhan, status, created_at, legacy_source_key
  ) values (
    p_branch_id, v_customer_id, v_pet_id, 'Poli Umum', nullif(p_doctor, ''),
    nullif(p_anamnesis, ''), 'Selesai', p_record_date, p_source_key
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
  uuid, text, timestamptz, text, text, text, text, text, text, text, date, text, text, text, text, text
) from public;
grant execute on function public.import_legacy_medical_record(
  uuid, text, timestamptz, text, text, text, text, text, text, text, date, text, text, text, text, text
) to authenticated;
