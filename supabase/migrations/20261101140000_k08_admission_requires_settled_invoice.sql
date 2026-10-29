-- K08 (keputusan owner 29 Okt): kunjungan yang masih punya tagihan klinik AKTIF tidak boleh
-- langsung masuk rawat inap.
--   * Tagihan aktif belum lunas (Belum Lunas / DP): lunasi atau batalkan (void) dulu.
--     Setelah lunas -> "Lanjutkan ke Rawat Inap" (kunjungan lanjutan K06, PR #276).
--     Setelah di-void -> kunjungan bisa dimasukkan langsung seperti biasa.
--   * Tagihan aktif sudah lunas: selalu lewat kunjungan lanjutan (K06), tidak pernah langsung.
-- Dulu jalur langsung tetap terbuka untuk tagihan belum lunas, sehingga rawat inap terbuka di
-- kunjungan yang tagihannya sudah terbit: pasien tidak bisa dipulangkan (INVOICE_EXISTS) dan
-- biaya inap tidak bisa ditagih.
--
-- Diterapkan di clinic_admit_inpatient (dipakai juga oleh clinic_admit_inpatient_typed untuk
-- tipe 'sakit'). Pesan penolakan lanjutan K06 untuk tagihan belum lunas ikut diperjelas.
-- Signature, SECURITY DEFINER, search_path, owner dan grant sama; peran sesi dibaca lewat
-- auth.role() (perbaikan 20261031095000). Tidak ada tabel, kolom atau data yang diubah.

create or replace function public.clinic_admit_inpatient(p_visit_id uuid,p_treatment_plan text,p_request_key text)
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
  -- K08: an active invoice closes the direct path (the visit row lock above also serializes
  -- invoice posting, which locks the same visit first).
  if exists(select 1 from public.invoices where visit_id=p_visit_id and voided_at is null and paid_status='Lunas') then
    raise exception 'ADMISSION_INVALID: tagihan kunjungan ini sudah lunas; gunakan Lanjutkan ke Rawat Inap';end if;
  if exists(select 1 from public.invoices where visit_id=p_visit_id and voided_at is null) then
    raise exception 'ADMISSION_INVALID: tagihan kunjungan ini belum lunas; lunasi atau batalkan tagihan terlebih dahulu sebelum masuk rawat inap';end if;
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

-- K06 continuation: same rules as 20261028120000; only the refusal for a visit that is still
-- open with an unpaid invoice now names the real next step (pay or void, not "admit directly").
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
    if exists(select 1 from public.invoices where visit_id = p_visit_id and voided_at is null) then
      raise exception 'ADMISSION_INVALID: tagihan kunjungan ini belum lunas; lunasi atau batalkan tagihan terlebih dahulu sebelum masuk rawat inap';
    end if;
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
