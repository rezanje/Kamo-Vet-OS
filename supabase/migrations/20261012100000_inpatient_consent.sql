alter table public.consent_templates add column kategori text not null default 'Umum'
  check (kategori in ('Umum','Konsultasi','Vaksinasi','Operasi','Grooming','Rawat Inap','Lab'));
alter table public.consents add column kategori text not null default 'Umum';
alter table public.consents
  add column consent_branch_id uuid references public.branches(id),
  add column consent_pet_id uuid references public.pets(id),
  add column consent_customer_id uuid references public.customers(id);
update public.consents c set consent_branch_id=v.branch_id,consent_pet_id=v.pet_id,consent_customer_id=v.customer_id
  from public.visits v where v.id=c.visit_id;
alter table public.inpatient_records
  add column consent_id uuid references public.consents(id) on delete restrict,
  add column admission_request_key text,
  add column admission_request_hash text;
create unique index inpatient_admission_request_unique on public.inpatient_records(admission_request_key)
  where admission_request_key is not null;

create function public.guard_consent_document() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_template public.consent_templates%rowtype;v_branch uuid;v_visit public.visits%rowtype;
begin
  if tg_op<>'INSERT' and old.status='sudah_ttd' then
    raise exception 'CONSENT_LOCKED: dokumen bertanda tangan tidak dapat diubah atau dihapus';
  end if;
  if tg_op='DELETE' then return old;end if;
  -- Serialize creation/signing with visit identity changes. UPDATE visit holds
  -- this same row lock before checking for a committed signature.
  select * into v_visit from public.visits where id=new.visit_id for update;
  v_branch:=v_visit.branch_id;
  if current_setting('role',true)='authenticated' and (
    coalesce(auth.role(),'')<>'authenticated' or auth.uid() is null
    or not exists(select 1 from public.profiles where id=auth.uid() and is_active)
    or not public.user_can_access_branch(v_branch)
  ) then raise exception 'ACCESS_DENIED: formulir atau cabang tidak dapat diakses';end if;
  if tg_op='INSERT' then
    select * into v_template from public.consent_templates where id=new.template_id for share;
    if not found or not v_template.is_active or (v_template.branch_id is not null and v_template.branch_id is distinct from v_branch) then
      raise exception 'CONSENT_INVALID: pilih template aktif untuk cabang pasien';
    end if;
    if current_setting('role',true)='authenticated' and new.status<>'belum_ttd' then
      raise exception 'CONSENT_INVALID: buat dokumen sebelum menandatangani';
    end if;
    new.kategori:=v_template.kategori;
    new.consent_branch_id:=v_visit.branch_id;new.consent_pet_id:=v_visit.pet_id;new.consent_customer_id:=v_visit.customer_id;
  elsif new.visit_id is distinct from old.visit_id or new.template_id is distinct from old.template_id
    or new.kategori is distinct from old.kategori or new.isi_snapshot is distinct from old.isi_snapshot
    or new.tindakan is distinct from old.tindakan
    or new.consent_branch_id is distinct from old.consent_branch_id
    or new.consent_pet_id is distinct from old.consent_pet_id
    or new.consent_customer_id is distinct from old.consent_customer_id then
    raise exception 'CONSENT_LOCKED: identitas dan isi snapshot tidak dapat diubah';
  end if;
  if new.status='sudah_ttd' then
    if new.consent_branch_id is distinct from v_visit.branch_id or new.consent_pet_id is distinct from v_visit.pet_id
      or new.consent_customer_id is distinct from v_visit.customer_id then
      raise exception 'CONSENT_INVALID: identitas kunjungan berubah; buat ulang draf sebelum tanda tangan';end if;
    select * into v_template from public.consent_templates where id=new.template_id for share;
    if not found or not v_template.is_active or (v_template.branch_id is not null and v_template.branch_id is distinct from v_visit.branch_id) then
      raise exception 'CONSENT_INVALID: template tidak lagi berlaku untuk cabang pasien';end if;
  end if;
  if new.status='sudah_ttd' and (nullif(btrim(new.signer_name),'') is null
    or nullif(btrim(new.signature_data),'') is null or new.signed_at is null) then
    raise exception 'CONSENT_INVALID: nama, tanda tangan dan waktu wajib tersedia';
  end if;
  return new;
end $$;
revoke all on function public.guard_consent_document() from public,anon,authenticated,service_role;
create trigger consent_document_guard before insert or update or delete on public.consents
  for each row execute function public.guard_consent_document();

-- The signature covers this visit's patient, owner and branch. Moving that
-- identity afterwards would reuse a signed branch-specific document elsewhere.
create function public.guard_signed_consent_visit_identity() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if (new.branch_id is distinct from old.branch_id or new.pet_id is distinct from old.pet_id
    or new.customer_id is distinct from old.customer_id)
    and exists(select 1 from public.consents where visit_id=old.id and status='sudah_ttd') then
    raise exception 'CONSENT_LOCKED: cabang, pasien dan pemilik kunjungan bertanda tangan tetap tersimpan';
  end if;
  return new;
end $$;
revoke all on function public.guard_signed_consent_visit_identity() from public,anon,authenticated,service_role;
create trigger signed_consent_visit_identity before update of branch_id,pet_id,customer_id on public.visits
  for each row execute function public.guard_signed_consent_visit_identity();

create function public.guard_consent_template_admin() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if current_setting('role',true)='authenticated' and not exists(
    select 1 from public.profiles where id=auth.uid() and is_active and role in ('OWNER','ADMIN')
  ) then raise exception 'ACCESS_DENIED: hanya OWNER/ADMIN aktif dapat mengubah template';end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function public.guard_consent_template_admin() from public,anon,authenticated,service_role;
create trigger consent_template_admin_guard before insert or update or delete on public.consent_templates
  for each row execute function public.guard_consent_template_admin();

create function public.clinic_admit_inpatient(p_visit_id uuid,p_treatment_plan text,p_request_key text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_visit public.visits%rowtype;v_existing public.inpatient_records%rowtype;
  v_key text:=nullif(btrim(p_request_key),'');v_plan text:=nullif(btrim(p_treatment_plan),'');
  v_hash text;v_medical uuid;v_consent uuid;v_template uuid;v_required boolean;v_id uuid;
begin
  if coalesce(auth.role(),'')<>'authenticated' or auth.uid() is null or not exists(
    select 1 from public.profiles where id=auth.uid() and is_active
  ) then raise exception 'ACCESS_DENIED: pengguna tidak aktif atau tidak terautentikasi';end if;
  if v_key is null or length(v_key)>100 or v_plan is null or length(v_plan)>4000 then
    raise exception 'ADMISSION_INVALID: isi rencana tindakan dan muat ulang formulir';end if;
  select * into v_visit from public.visits where id=p_visit_id for update;
  if not found or not public.user_can_access_branch(v_visit.branch_id) then
    raise exception 'ACCESS_DENIED: kunjungan atau cabang tidak dapat diakses';end if;
  v_hash:=md5(jsonb_build_object('visit',p_visit_id,'plan',v_plan,'actor',auth.uid())::text);
  select * into v_existing from public.inpatient_records where admission_request_key=v_key;
  if found then
    if v_existing.admission_request_hash is distinct from v_hash then
      raise exception 'IDEMPOTENCY_CONFLICT: kunci masuk rawat inap dipakai untuk data berbeda';end if;
    return v_existing.id;
  end if;
  if exists(select 1 from public.inpatient_records where visit_id=p_visit_id and discharged_at is null) then
    raise exception 'ADMISSION_INVALID: pasien sudah memiliki rawat inap aktif';end if;
  if v_visit.checked_out_at is not null or v_visit.status='Selesai' then
    raise exception 'ADMISSION_INVALID: kunjungan sudah selesai';end if;
  select id into v_medical from public.medical_records where visit_id=p_visit_id order by created_at desc limit 1;
  if v_medical is null or v_visit.doctor_id is null then raise exception 'ADMISSION_INVALID: selesaikan pemeriksaan dan pilih dokter terlebih dahulu';end if;
  perform public.clinic_staff_name(v_visit.doctor_id,v_visit.branch_id,'doctor');
  select wajib,template_id into v_required,v_template from public.consent_rules where kategori='Rawat Inap';
  v_required:=coalesce(v_required,true);
  select id into v_consent from public.consents where visit_id=p_visit_id and status='sudah_ttd'
    and kategori='Rawat Inap' and (v_template is null or template_id=v_template)
    order by signed_at desc,id limit 1 for share;
  if v_required and v_consent is null then raise exception 'CONSENT_REQUIRED: tandatangani persetujuan khusus rawat inap terlebih dahulu';end if;
  insert into public.inpatient_records(branch_id,visit_id,medical_record_id,doctor_id,doctor_name,treatment_plan,
    created_by,consent_id,admission_request_key,admission_request_hash)
  values(v_visit.branch_id,p_visit_id,v_medical,v_visit.doctor_id,v_visit.dokter,v_plan,auth.uid(),v_consent,v_key,v_hash)
  returning id into v_id;
  insert into public.inpatient_status_log(inpatient_record_id,previous_status,new_status,changed_by,notes)
  values(v_id,null,'stabil',auth.uid(),'Admit rawat inap');
  return v_id;
end $$;
revoke all on function public.clinic_admit_inpatient(uuid,text,text) from public,anon,service_role;
grant execute on function public.clinic_admit_inpatient(uuid,text,text) to authenticated;

create function public.require_atomic_inpatient_admission() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' then
    if new.consent_id is distinct from old.consent_id or new.admission_request_key is distinct from old.admission_request_key
      or new.admission_request_hash is distinct from old.admission_request_hash then
      raise exception 'CONSENT_LOCKED: consent dan identitas masuk rawat inap tetap tersimpan';end if;
    return new;
  end if;
  if current_user='authenticated' then
    raise exception 'ADMISSION_ATOMIC_REQUIRED: masuk rawat inap harus melalui formulir terbaru';
  end if;
  return new;
end $$;
revoke all on function public.require_atomic_inpatient_admission() from public,anon,authenticated,service_role;
create trigger inpatient_atomic_admission before insert or update on public.inpatient_records
  for each row execute function public.require_atomic_inpatient_admission();

create function public.clinic_inpatient_consent_valid(p_visit_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare v_branch uuid;
begin
  select branch_id into v_branch from public.visits where id=p_visit_id;
  if coalesce(auth.role(),'')<>'authenticated' or auth.uid() is null or not public.user_can_access_branch(v_branch) then
    raise exception 'ACCESS_DENIED: kunjungan atau cabang tidak dapat diakses';end if;
  return not exists(select 1 from public.inpatient_records r where r.visit_id=p_visit_id and r.consent_id is not null
    and not exists(select 1 from public.consents c where c.id=r.consent_id and c.visit_id=p_visit_id
      and c.kategori='Rawat Inap' and c.status='sudah_ttd'));
end $$;
revoke all on function public.clinic_inpatient_consent_valid(uuid) from public,anon,service_role;
grant execute on function public.clinic_inpatient_consent_valid(uuid) to authenticated;
