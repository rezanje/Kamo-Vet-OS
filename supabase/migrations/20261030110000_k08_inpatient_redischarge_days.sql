-- K08 (rawat inap): pemulangan ulang menagih SEMUA periode rawat inap kunjungan.
--
-- Sebelumnya biaya rawat inap otomatis dihitung dari periode yang sedang dipulangkan saja,
-- lalu baris biaya lama pada rekam medis yang sama dihapus. Kunjungan yang masuk rawat inap
-- dua kali (pulang -> masuk lagi -> pulang) kehilangan hari periode pertama. Baris biaya yang
-- sudah pernah tertaut ke invoice (termasuk invoice yang di-void) juga tidak dapat dihapus
-- (FK RESTRICT), sehingga pemulangan ulang gagal dengan galat mentah.
--
-- Sekarang:
--   * total hari = jumlah hari per periode (pembulatan ke atas per 24 jam, minimal 1) dari
--     semua rawat inap kunjungan ini yang sudah pulang;
--   * hari yang sudah ditagih (baris biaya pada invoice aktif, atau baris pada rekam medis
--     tagihan yang tertaut invoice lama dan tidak bisa dihapus) dikurangkan, tidak ditagih dua kali;
--   * baris biaya otomatis yang belum pernah ditagih diganti satu baris berisi sisa hari;
--   * rawat inap yang sudah pulang tidak bisa dibuka lagi bila kunjungan sudah punya invoice
--     aktif (pasien tidak akan bisa dipulangkan lagi) atau pasien sudah punya rawat inap aktif lain.
-- Aturan lama dipertahankan: invoice aktif tetap menolak pemulangan (INVOICE_EXISTS), RIP hanya
-- dokter, pulang paksa butuh form bertanda tangan. Tidak ada tabel, kolom, hak akses atau data
-- yang diubah; signature, SECURITY DEFINER, search_path dan grant sama dengan versi sebelumnya.

create or replace function public.clinic_change_inpatient_condition(
  p_inpatient_id uuid, p_new_status text, p_notes text
) returns boolean language plpgsql security definer set search_path = '' as $function$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_record public.inpatient_records%rowtype;
  v_tariff public.items%rowtype;
  v_medical_record_id uuid;
  v_days integer;
  v_total_days integer;
  v_billed_days numeric;
  v_periods integer;
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
    select * into v_tariff from public.items
    where tindakan_kategori='Rawat Inap' and is_active
    order by name, id limit 1;
    if found then
      select m.id into v_medical_record_id from public.medical_records m
      where m.visit_id = v_record.visit_id
      order by m.created_at desc, m.id desc limit 1;
      if v_medical_record_id is not null then
        -- K08: every discharged period of this visit, each rounded up per 24 hours (min 1).
        select count(*), coalesce(sum(greatest(1, ceil(extract(epoch from
            (r.discharged_at - r.admitted_at)) / 86400)::integer)), 0)
          into v_periods, v_total_days
        from public.inpatient_records r
        where r.visit_id = v_record.visit_id and r.discharged_at is not null;
        -- Days already billed: fee lines on an active invoice, plus fee lines on the billing
        -- record that an older invoice still references (kept, and shown again at checkout).
        select coalesce(sum(p.qty), 0) into v_billed_days
        from public.prescription_items p
        join public.medical_records m on m.id = p.medical_record_id
        where m.visit_id = v_record.visit_id and p.item_id = v_tariff.id
          and (exists(select 1 from public.invoice_items ii
                 join public.invoices i on i.id = ii.invoice_id
                 where ii.prescription_item_id = p.id and i.voided_at is null)
               or (p.medical_record_id = v_medical_record_id and exists(
                 select 1 from public.invoice_items ii where ii.prescription_item_id = p.id)));
        -- Never-billed automatic fee lines are recalculated below.
        delete from public.prescription_items p
        using public.medical_records m
        where m.id = p.medical_record_id and m.visit_id = v_record.visit_id
          and p.item_id = v_tariff.id
          and not exists(select 1 from public.invoice_items ii where ii.prescription_item_id = p.id);
        v_days := v_total_days - ceil(v_billed_days)::integer;
        if v_days > 0 then
          insert into public.prescription_items(
            medical_record_id, item_id, nama_obat, qty, harga, satuan,
            jenis, kategori, aturan_pakai
          ) values (
            v_medical_record_id, v_tariff.id, v_tariff.name, v_days,
            coalesce(v_tariff.sell_price, 0), coalesce(v_tariff.unit, 'hari'),
            'jasa', 'Rawat Inap',
            'Otomatis dari lama rawat inap: ' || v_days || ' hari'
              || case when v_periods > 1 or v_billed_days > 0 then
                   ' (total ' || v_total_days || ' hari dari ' || v_periods || ' periode'
                   || case when v_billed_days > 0 then ', ' || trim_scale(v_billed_days)::text || ' hari sudah ditagih' else '' end
                   || ')'
                 else '' end
          );
        end if;
      end if;
    end if;
  end if;
  return true;
end;
$function$;
revoke all on function public.clinic_change_inpatient_condition(uuid,text,text)
  from public, anon, service_role;
grant execute on function public.clinic_change_inpatient_condition(uuid,text,text)
  to authenticated;
