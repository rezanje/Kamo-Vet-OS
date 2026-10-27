-- K13: read-only clinical history of ONE patient across all branches.
-- Branch RLS on visits/medical_records/prescription_items stays unchanged; this
-- checked SECURITY DEFINER reader returns a narrow clinical projection only.
--   * caller: authenticated, active profile, clinic module (same semantics as
--     clinic_record_correction_actor), and allowed on the anchor visit's branch;
--   * patient: the exact pets.id of that anchor visit (never a name match);
--   * output: visit date/branch/doctor/complaint, diagnosis, anamnesis, therapy,
--     prescription lines and K01 addenda. No invoice, payment, stock, owner contact.
--   * STABLE, no writes; cross-branch rows are display-only.
-- Depends on 20261028110000_clinic_record_addenda.sql. Idempotent.

create or replace function public.clinic_patient_clinical_history(p_pet_id uuid, p_anchor_visit_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_anchor_pet uuid;
        v_anchor_branch uuid;
        v_result jsonb;
begin
  if auth.uid() is null or coalesce(auth.role(), '') <> 'authenticated'
    or not exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_active
        and (p.role = 'OWNER'
          or exists (select 1 from public.role_modules m where m.role = p.role and m.module_id = 'klinik')
          or (not exists (select 1 from public.role_modules m where m.role = p.role)
              and p.role in ('ADMIN', 'DOCTOR', 'STAFF')))
    ) then
    raise exception 'Akses riwayat klinis ditolak' using errcode = '42501';
  end if;

  select v.pet_id, v.branch_id into v_anchor_pet, v_anchor_branch
    from public.visits v where v.id = p_anchor_visit_id;
  if not found or p_pet_id is null or v_anchor_pet is distinct from p_pet_id
    or not public.user_can_access_branch(v_anchor_branch) then
    raise exception 'Akses riwayat klinis ditolak' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(visit_row order by visit_created desc, visit_id), '[]'::jsonb)
    into v_result
  from (
    select v.id as visit_id, v.created_at as visit_created,
      jsonb_build_object(
        'id', v.id, 'pet_id', v.pet_id, 'branch_id', v.branch_id,
        'branch_name', b.name, 'created_at', v.created_at,
        'poli', v.poli, 'dokter', v.dokter, 'keluhan', v.keluhan,
        'can_open', public.user_can_access_branch(v.branch_id),
        'records', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', m.id, 'created_at', m.created_at, 'diagnosis', m.diagnosis,
            'anamnesis', m.anamnesis, 'therapy', m.therapy,
            'prescriptions', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', pi.id, 'nama_obat', pi.nama_obat, 'qty', pi.qty, 'satuan', pi.satuan,
                'jenis', pi.jenis, 'aturan_pakai', pi.aturan_pakai) order by pi.created_at, pi.id)
              from public.prescription_items pi where pi.medical_record_id = m.id), '[]'::jsonb),
            'addenda', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', a.id, 'created_at', a.created_at, 'author', pr.full_name,
                'diagnosis', a.diagnosis_addendum, 'therapy', a.therapy_addendum, 'reason', a.reason)
                order by a.created_at, a.id)
              from public.clinic_record_addenda a
              left join public.profiles pr on pr.id = a.created_by
              where a.medical_record_id = m.id), '[]'::jsonb)
          ) order by m.created_at desc, m.id)
          from public.medical_records m where m.visit_id = v.id), '[]'::jsonb)
      ) as visit_row
    from public.visits v
    left join public.branches b on b.id = v.branch_id
    where v.pet_id = v_anchor_pet
  ) rows;

  return jsonb_build_object('pet_id', v_anchor_pet, 'visits', v_result);
end;
$$;
revoke all on function public.clinic_patient_clinical_history(uuid, uuid) from public, anon, service_role;
grant execute on function public.clinic_patient_clinical_history(uuid, uuid) to authenticated;
