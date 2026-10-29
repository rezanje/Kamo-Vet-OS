-- K14 (keputusan owner 29 Okt): pet hotel (sehat) berbeda dari rawat inap sakit.
--
-- (a) Check-in pet hotel TIDAK mewajibkan pemeriksaan dokter selesai, dokter pada kunjungan,
--     maupun persetujuan khusus Rawat Inap: paramedis/staf klinik bisa check-in. Belum ada jenis
--     formulir persetujuan khusus pet hotel, jadi tidak ada formulir yang diwajibkan.
--     Kunjungan yang belum diperiksa dibuatkan rekam medis ringkas (tanpa diagnosis) supaya
--     biaya menginap punya tempat, lalu kunjungan pindah ke tahap Pembayaran (sama seperti
--     rawat inap sakit setelah pemeriksaan). Rawat inap sakit: semua syarat lama tetap.
--     Aturan K08 (20261101140000) juga berlaku: tagihan aktif menutup jalur check-in langsung.
-- (b) Tarif harian terpisah: biaya otomatis saat pulang memakai jasa berkategori 'Pet Hotel'
--     untuk periode pet hotel (diatur di master SKU seperti jasa Rawat Inap). Bila tarif pet
--     hotel belum diisi (jasanya tidak ada atau harganya 0), tarif Rawat Inap dipakai dan baris
--     tagihan diberi catatan peringatan. Satu jasa 'Pet Hotel' disiapkan dengan harga 0
--     (= belum diatur) bila belum ada; harga tidak dikarang.
-- Signature, SECURITY DEFINER, search_path dan grant semua fungsi sama; peran sesi dibaca lewat
-- auth.role() (perbaikan 20261031095000). Idempoten: aman dijalankan ulang.

-- 1. Kategori tindakan baru untuk jasa tarif pet hotel.
do $$
declare v_name text;
begin
  for v_name in
    select c.conname from pg_constraint c
    where c.conrelid = 'public.items'::regclass and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%tindakan_kategori%'
  loop
    execute format('alter table public.items drop constraint %I', v_name);
  end loop;
end $$;
alter table public.items add constraint items_tindakan_kategori_check
  check (tindakan_kategori in ('Konsultasi', 'Vaksinasi', 'Operasi', 'Grooming', 'Rawat Inap', 'Lab', 'Pet Hotel'));

-- 2. Jasa tarif pet hotel. Harga 0 = belum diatur; owner/admin mengisi tarifnya di master SKU.
insert into public.items(code, name, unit, item_type, is_active, tindakan_kategori, sell_price, category_id)
select 'JASA-PET-HOTEL', 'Pet Hotel (per hari)', 'hari', 'Jasa', true, 'Pet Hotel', 0,
  (select i.category_id from public.items i where i.tindakan_kategori = 'Rawat Inap' and i.is_active
   order by i.name, i.id limit 1)
where not exists (select 1 from public.items where tindakan_kategori = 'Pet Hotel')
on conflict (code) do nothing;

-- 3. Penjaga petugas rawat inap: sama dengan 20261006090000, kecuali check-in pet hotel tidak
--    mengikat dokter PJ (tidak butuh dokter pada kunjungan).
create or replace function public.protect_inpatient_care_staff() returns trigger
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
     if not found or v_visit.branch_id is distinct from new.branch_id then
       raise exception using errcode='P0001',message='CARE_INVALID: pilih dokter PJ pada kunjungan sebelum masuk rawat inap';
     end if;
     -- K14: a pet hotel guest is healthy boarding checked in by staff; no PIC doctor is bound.
     if new.stay_type='pet_hotel' then
       new.doctor_id:=null;
       new.doctor_name:=null;
       return new;
     end if;
     if v_visit.doctor_id is null then
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

-- 4. Masuk rawat inap bertipe. 'sakit': tetap lewat clinic_admit_inpatient (dokter, pemeriksaan,
--    persetujuan, K08). 'pet_hotel': check-in sendiri tanpa dokter/pemeriksaan/persetujuan.
create or replace function public.clinic_admit_inpatient_typed(
  p_visit_id uuid, p_treatment_plan text, p_request_key text, p_stay_type text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_key text := nullif(btrim(p_request_key), '');
  v_plan text := nullif(btrim(p_treatment_plan), '');
  v_visit public.visits%rowtype;
  v_prior public.inpatient_records%rowtype;
  v_id uuid;
  v_stored text;
  v_hash text;
  v_legacy_hash text;
  v_medical uuid;
  v_now timestamptz := now();
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

  if p_stay_type = 'sakit' then
    v_id := public.clinic_admit_inpatient(p_visit_id, p_treatment_plan, p_request_key);
    if v_prior.id is not null then
      if v_prior.stay_type is distinct from p_stay_type then
        raise exception 'IDEMPOTENCY_CONFLICT: kunci masuk rawat inap dipakai untuk data berbeda'; end if;
      return v_id;
    end if;
    select stay_type into v_stored from public.inpatient_records where id = v_id;
    if v_stored is distinct from p_stay_type then
      raise exception 'IDEMPOTENCY_CONFLICT: kunci masuk rawat inap dipakai untuk data berbeda'; end if;
    return v_id;
  end if;

  -- K14 pet hotel check-in.
  if v_plan is null or length(v_plan) > 4000 then
    raise exception 'ADMISSION_INVALID: isi catatan penitipan dan muat ulang formulir'; end if;
  v_hash := md5(jsonb_build_object('visit', p_visit_id, 'plan', v_plan, 'actor', auth.uid(), 'stay', 'pet_hotel')::text);
  -- Stays checked in before this migration were written by the base RPC (its hash format).
  v_legacy_hash := md5(jsonb_build_object('visit', p_visit_id, 'plan', v_plan, 'actor', auth.uid())::text);
  if v_prior.id is not null then
    if v_prior.stay_type is distinct from 'pet_hotel'
       or v_prior.admission_request_hash not in (v_hash, v_legacy_hash) then
      raise exception 'IDEMPOTENCY_CONFLICT: kunci masuk rawat inap dipakai untuk data berbeda'; end if;
    return v_prior.id;
  end if;
  if exists(select 1 from public.inpatient_records where visit_id = p_visit_id and discharged_at is null) then
    raise exception 'ADMISSION_INVALID: pasien sudah memiliki rawat inap aktif'; end if;
  if v_visit.checked_out_at is not null or v_visit.status = 'Selesai' then
    raise exception 'ADMISSION_INVALID: kunjungan sudah selesai; daftarkan kunjungan baru untuk pet hotel'; end if;
  -- K08: an active invoice closes the direct path for pet hotel too.
  if exists(select 1 from public.invoices where visit_id = p_visit_id and voided_at is null and paid_status = 'Lunas') then
    raise exception 'ADMISSION_INVALID: tagihan kunjungan ini sudah lunas; gunakan Lanjutkan ke Rawat Inap'; end if;
  if exists(select 1 from public.invoices where visit_id = p_visit_id and voided_at is null) then
    raise exception 'ADMISSION_INVALID: tagihan kunjungan ini belum lunas; lunasi atau batalkan tagihan terlebih dahulu sebelum masuk rawat inap'; end if;

  -- No doctor examination is required. A visit that was never examined gets a short record so
  -- the boarding fee has a billing home; it carries no diagnosis and is locked like a posted record.
  select id into v_medical from public.medical_records where visit_id = p_visit_id
    order by created_at desc, id desc limit 1;
  if v_medical is null then
    insert into public.medical_records(visit_id, anamnesis, submission_key, submission_hash, submitted_by)
    values (p_visit_id, 'Check-in pet hotel (hewan sehat), tanpa pemeriksaan dokter',
      'k14-pet-hotel:' || v_key, v_hash, auth.uid())
    returning id into v_medical;
  end if;
  if v_visit.status in ('Menunggu', 'Diperiksa') then
    update public.visits set status = 'Pembayaran', called_at = coalesce(called_at, v_now),
      service_started_at = coalesce(service_started_at, v_now),
      service_finished_at = coalesce(service_finished_at, v_now)
    where id = p_visit_id;
    insert into public.visit_operational_events(visit_id, branch_id, event_type, payload, created_by)
    values (p_visit_id, v_visit.branch_id, 'service_finished', jsonb_build_object('source', 'pet_hotel_check_in'), auth.uid());
  end if;

  insert into public.inpatient_records(branch_id, visit_id, medical_record_id, treatment_plan, created_by,
    admission_request_key, admission_request_hash, stay_type)
  values (v_visit.branch_id, p_visit_id, v_medical, v_plan, auth.uid(), v_key, v_hash, 'pet_hotel')
  returning id into v_id;
  insert into public.inpatient_status_log(inpatient_record_id, previous_status, new_status, changed_by, notes)
  values (v_id, null, 'stabil', auth.uid(), 'Check-in pet hotel');
  return v_id;
end $$;
revoke all on function public.clinic_admit_inpatient_typed(uuid, text, text, text) from public, anon, service_role;
grant execute on function public.clinic_admit_inpatient_typed(uuid, text, text, text) to authenticated;

-- 5. Pemulangan: sama dengan 20261030110000 (K08 semua periode, hari yang sudah ditagih tidak
--    ditagih dua kali), tetapi hari dihitung per tarif: periode 'sakit' memakai jasa Rawat Inap,
--    periode 'pet_hotel' memakai jasa Pet Hotel (fallback tarif Rawat Inap + catatan peringatan).
create or replace function public.clinic_change_inpatient_condition(
  p_inpatient_id uuid, p_new_status text, p_notes text
) returns boolean language plpgsql security definer set search_path = '' as $function$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_record public.inpatient_records%rowtype;
  v_sick public.items%rowtype;
  v_hotel public.items%rowtype;
  v_group record;
  v_medical_record_id uuid;
  v_days integer;
  v_total_days integer;
  v_billed_days numeric;
  v_periods integer;
  v_sick_periods integer;
  v_hotel_periods integer;
  v_price numeric;
  v_name text;
  v_unit text;
  v_kategori text;
  v_label text;
  v_warning text;
  v_discharged_at timestamptz;
begin
  if coalesce(auth.role(), '') <> 'authenticated'
     or v_user is null then
    raise exception using errcode='P0001', message='ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  if p_new_status not in ('stabil','kritis','sembuh','rip','pulang_paksa') then
    raise exception using errcode='P0001', message='LOG_INVALID: status rawat inap tidak valid';
  end if;
  select * into v_record from public.inpatient_records
  where id = p_inpatient_id for update;
  if not found or not public.user_can_access_branch(v_record.branch_id) then
    raise exception using errcode='P0001', message='ACCESS_DENIED: rawat inap tidak dapat diakses';
  end if;
  if not exists(select 1 from public.visits v where v.id=v_record.visit_id
    and v.branch_id=v_record.branch_id) then
    raise exception using errcode='P0001', message='ACCESS_DENIED: cabang kunjungan tidak cocok'; end if;
  select role into v_role from public.profiles where id = v_user;
  if v_role is null or (p_new_status = 'rip' and v_role <> 'DOCTOR') then
    raise exception using errcode='P0001', message='ACCESS_DENIED: status RIP hanya boleh diubah dokter';
  end if;
  if v_record.condition_status = p_new_status then return false; end if;
  if v_record.condition_status = 'pulang_paksa' then
    raise exception using errcode='P0001', message='INPATIENT_CLOSED: pasien sudah keluar';
  end if;
  if p_new_status = 'pulang_paksa' then
    if v_record.discharged_at is not null then
      raise exception using errcode='P0001', message='INPATIENT_CLOSED: pasien sudah keluar';
    end if;
    -- A distinct Owner/Admin-managed form is required. The signed snapshot and
    -- admission time are both retained; an older admission form cannot qualify.
    if not exists (
      select 1 from public.consents c
      join public.consent_templates t on t.id = c.template_id
      where c.visit_id = v_record.visit_id
        and c.consent_branch_id = v_record.branch_id
        and c.status = 'sudah_ttd' and c.kategori = 'Pulang Paksa'
        and nullif(btrim(c.signer_name), '') is not null
        and nullif(btrim(c.signature_data), '') is not null
        and c.signed_at >= v_record.admitted_at
        and t.kategori = 'Pulang Paksa' and t.is_active
        and (t.branch_id is null or t.branch_id = v_record.branch_id)
    ) then
      raise exception using errcode='P0001', message='CONSENT_REQUIRED: tandatangani form Pulang Paksa yang berlaku untuk cabang pasien';
    end if;
  end if;

  v_discharged_at := case when p_new_status in ('sembuh','rip','pulang_paksa') then now() else null end;
  if v_discharged_at is not null and exists(select 1 from public.invoices
      where visit_id=v_record.visit_id and voided_at is null) then
    raise exception using errcode='P0001', message='INVOICE_EXISTS: tagihan sudah terbit sebelum biaya rawat inap dihitung';
  end if;
  -- K08: reopening a discharged stay. With an active invoice the stay could never be
  -- discharged again (INVOICE_EXISTS) nor invoiced (INPATIENT_OPEN); use a continuation.
  if v_discharged_at is null and v_record.discharged_at is not null then
    if exists(select 1 from public.invoices
        where visit_id=v_record.visit_id and voided_at is null) then
      raise exception using errcode='P0001', message='INVOICE_EXISTS: tagihan sudah terbit; rawat inap yang sudah pulang tidak dapat dibuka lagi pada kunjungan ini';
    end if;
    if exists(select 1 from public.inpatient_records r
        join public.visits v on v.id = r.visit_id
        where v.pet_id = (select pet_id from public.visits where id = v_record.visit_id)
          and r.discharged_at is null and r.id <> p_inpatient_id) then
      raise exception using errcode='P0001', message='ADMISSION_INVALID: pasien sudah memiliki rawat inap aktif';
    end if;
  end if;
  insert into public.inpatient_status_log(
    inpatient_record_id, previous_status, new_status, changed_by, notes
  ) values (p_inpatient_id, v_record.condition_status, p_new_status, v_user, p_notes);
  update public.inpatient_records set condition_status=p_new_status,
    discharged_at=v_discharged_at where id=p_inpatient_id;

  if v_discharged_at is not null then
    select * into v_sick from public.items
    where tindakan_kategori='Rawat Inap' and is_active
    order by name, id limit 1;
    -- K14: separate daily tariff for pet hotel periods.
    select * into v_hotel from public.items
    where tindakan_kategori='Pet Hotel' and is_active
    order by name, id limit 1;
    select m.id into v_medical_record_id from public.medical_records m
    where m.visit_id = v_record.visit_id
    order by m.created_at desc, m.id desc limit 1;
    if v_medical_record_id is not null then
      -- Never-billed automatic fee lines of both tariffs are recalculated below (also a line
      -- written before K14 with the Rawat Inap tariff for a pet hotel period).
      delete from public.prescription_items p
      using public.medical_records m
      where m.id = p.medical_record_id and m.visit_id = v_record.visit_id
        and p.item_id in (v_sick.id, v_hotel.id)
        and not exists(select 1 from public.invoice_items ii where ii.prescription_item_id = p.id);
      -- One fee line per tariff item. Without a Pet Hotel service both stay types share the
      -- Rawat Inap item, so their days are counted (and deducted) together as before K14.
      for v_group in
        select g.item_id, array_agg(g.stay_type) as stay_types
        from (values ('sakit'::text, v_sick.id), ('pet_hotel'::text, coalesce(v_hotel.id, v_sick.id))) g(stay_type, item_id)
        where g.item_id is not null
        group by g.item_id
      loop
        -- K08: every discharged period of this visit, each rounded up per 24 hours (min 1).
        select count(*), coalesce(sum(greatest(1, ceil(extract(epoch from
            (r.discharged_at - r.admitted_at)) / 86400)::integer)), 0),
          count(*) filter (where r.stay_type = 'sakit'), count(*) filter (where r.stay_type = 'pet_hotel')
          into v_periods, v_total_days, v_sick_periods, v_hotel_periods
        from public.inpatient_records r
        where r.visit_id = v_record.visit_id and r.discharged_at is not null
          and r.stay_type = any(v_group.stay_types);
        continue when v_periods = 0;
        -- Days already billed: fee lines on an active invoice, plus fee lines on the billing
        -- record that an older invoice still references (kept, and shown again at checkout).
        select coalesce(sum(p.qty), 0) into v_billed_days
        from public.prescription_items p
        join public.medical_records m on m.id = p.medical_record_id
        where m.visit_id = v_record.visit_id and p.item_id = v_group.item_id
          and (exists(select 1 from public.invoice_items ii
                 join public.invoices i on i.id = ii.invoice_id
                 where ii.prescription_item_id = p.id and i.voided_at is null)
               or (p.medical_record_id = v_medical_record_id and exists(
                 select 1 from public.invoice_items ii where ii.prescription_item_id = p.id)));
        v_days := v_total_days - ceil(v_billed_days)::integer;
        continue when v_days <= 0;

        v_warning := '';
        if v_group.item_id = v_hotel.id then
          v_name := v_hotel.name;
          v_unit := coalesce(v_hotel.unit, 'hari');
          if coalesce(v_hotel.sell_price, 0) > 0 then
            v_price := v_hotel.sell_price;
          else
            v_price := coalesce(v_sick.sell_price, 0);
            v_warning := '; tarif Pet Hotel belum diatur, memakai tarif Rawat Inap';
          end if;
        else
          v_name := v_sick.name;
          v_unit := coalesce(v_sick.unit, 'hari');
          v_price := coalesce(v_sick.sell_price, 0);
          if v_hotel_periods > 0 then
            v_warning := '; tarif Pet Hotel belum diatur, memakai tarif Rawat Inap';
          end if;
        end if;
        -- Rawat Inap stays keep their consent-bearing category; pure pet hotel lines do not.
        v_kategori := case when v_sick_periods > 0 then 'Rawat Inap' else 'Pet Hotel' end;
        v_label := case when v_sick_periods > 0 then 'rawat inap' else 'pet hotel' end;
        insert into public.prescription_items(
          medical_record_id, item_id, nama_obat, qty, harga, satuan,
          jenis, kategori, aturan_pakai
        ) values (
          v_medical_record_id, v_group.item_id, v_name, v_days,
          v_price, v_unit,
          'jasa', v_kategori,
          'Otomatis dari lama ' || v_label || ': ' || v_days || ' hari'
            || case when v_periods > 1 or v_billed_days > 0 then
                 ' (total ' || v_total_days || ' hari dari ' || v_periods || ' periode'
                 || case when v_billed_days > 0 then ', ' || trim_scale(v_billed_days)::text || ' hari sudah ditagih' else '' end
                 || ')'
               else '' end
            || v_warning
        );
      end loop;
    end if;
  end if;
  return true;
end;
$function$;
revoke all on function public.clinic_change_inpatient_condition(uuid,text,text)
  from public, anon, service_role;
grant execute on function public.clinic_change_inpatient_condition(uuid,text,text)
  to authenticated;
