CREATE OR REPLACE FUNCTION public.clinic_change_inpatient_condition(p_inpatient_id uuid, p_new_status text, p_notes text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_record public.inpatient_records%rowtype;
  v_tariff public.items%rowtype;
  v_medical_record_id uuid;
  v_days integer;
  v_discharged_at timestamptz;
begin

  -- ranap-compound-coordinator: same key as clinic_private.billing_keys_visit.
  perform pg_advisory_xact_lock(hashtextextended('clinic-billing:' ||
    case when v.customer_id is not null then 'c:' || v.customer_id::text
         else 'v:' || coalesce(v.id::text,'-') end || '@' || coalesce(v.branch_id::text,'-'),0))
    from public.visits v where v.id=(select visit_id from public.inpatient_records where id=p_inpatient_id);

  if (false) and (coalesce(auth.role(),'')<>'authenticated' or auth.uid() is null
    or not exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active
      and p.role in ('OWNER','ADMIN','DOCTOR','STAFF'))
    or not exists(select 1 from public.visits v where v.id=(select visit_id from public.inpatient_records where id=p_inpatient_id)
      and public.user_can_access_branch(v.branch_id))) then
    raise exception using errcode='P0001', message='ACCESS_DENIED: akses racikan atau cabang tidak diizinkan';
  end if;
  if (false) and not exists(select 1 from public.profiles p where p.id=auth.uid()
      and p.is_active and p.role in ('OWNER','ADMIN','DOCTOR')) then
    raise exception using errcode='P0001', message='ACCESS_DENIED: komposisi racikan hanya untuk pemilik/admin/dokter';
  end if;
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
  -- Tagihan berjalan: pasien boleh pulang walau tagihannya sudah terbit dan belum
  -- lunas. Sisanya diselesaikan lewat layar tagihan rawat inap atau menjadi piutang.
  insert into public.inpatient_status_log(
    inpatient_record_id, previous_status, new_status, changed_by, notes
  ) values (p_inpatient_id, v_record.condition_status, p_new_status, v_user, p_notes);
  update public.inpatient_records set condition_status=p_new_status,
    discharged_at=v_discharged_at where id=p_inpatient_id;

  if v_discharged_at is not null and not exists(select 1 from public.invoices i
      where i.visit_id=v_record.visit_id and i.request_key is not null)
     and not exists(select 1 from public.prescription_items pi
      join public.medical_records mr on mr.id=pi.medical_record_id
      where mr.visit_id=v_record.visit_id and pi.kategori='Rawat Inap') then
    select * into v_tariff from public.items
    where tindakan_kategori='Rawat Inap' and is_active
    order by name, id limit 1;
    if found then
      select m.id into v_medical_record_id from public.medical_records m
      where m.visit_id = v_record.visit_id
      order by m.created_at desc, m.id desc limit 1;
      if v_medical_record_id is not null then
        v_days := greatest(1, ceil(extract(epoch from
          (v_discharged_at - v_record.admitted_at)) / 86400)::integer);
        delete from public.prescription_items
        where medical_record_id=v_medical_record_id and item_id=v_tariff.id;
        insert into public.prescription_items(
          medical_record_id, item_id, nama_obat, qty, harga, satuan,
          jenis, kategori, aturan_pakai
        ) values (
          v_medical_record_id, v_tariff.id, v_tariff.name, v_days,
          coalesce(v_tariff.sell_price, 0), coalesce(v_tariff.unit, 'hari'),
          'jasa', 'Rawat Inap',
          'Otomatis dari lama rawat inap: ' || v_days || ' hari'
        );
      end if;
    end if;
  end if;
  return true;
end;
$function$
