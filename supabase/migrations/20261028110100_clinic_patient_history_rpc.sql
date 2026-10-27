-- K13: read-only clinical history of ONE patient across all branches.
-- Branch RLS on visits/medical_records/prescription_items stays unchanged; this
-- checked SECURITY DEFINER reader returns a narrow clinical projection only.
--   * caller: authenticated, active profile, clinic module (same semantics as
--     clinic_record_correction_actor), and allowed on the anchor visit's branch;
--   * patient: the exact pets.id of that anchor visit (never a name match);
--   * output: visit date/branch/doctor/complaint, diagnosis, anamnesis, therapy,
--     prescription lines and K01 addenda. No invoice, payment, stock, owner contact.
--   * no clinical writes; cross-branch rows are display-only. The only write is
--     one audit row per call that discloses visits from branches the caller
--     cannot normally open (metadata only, mirrored into activity_log).
-- Depends on 20261028110000_clinic_record_addenda.sql. Idempotent.

-- Append-only access trail. Written only by the checked reader below; no
-- medical text, only which patient/anchor/branches were read, by whom, when.
create table if not exists public.clinic_history_reads (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null,
  anchor_visit_id uuid not null,
  branch_id uuid not null,            -- caller's (anchor) branch
  foreign_branch_ids uuid[] not null, -- branches disclosed beyond normal access
  foreign_visit_count integer not null check (foreign_visit_count > 0),
  read_by uuid not null,
  read_at timestamptz not null default clock_timestamp()
  -- No FK: deleting a patient/account must not erase evidence.
);
create index if not exists clinic_history_reads_pet_time on public.clinic_history_reads (pet_id, read_at desc);
alter table public.clinic_history_reads enable row level security;
revoke all on public.clinic_history_reads from public, anon, authenticated, service_role;
grant select on public.clinic_history_reads to authenticated;
drop policy if exists clinic_history_reads_owner_read on public.clinic_history_reads;
create policy clinic_history_reads_owner_read on public.clinic_history_reads for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active and p.role in ('OWNER', 'ADMIN')));

create or replace function public.clinic_history_reads_immutable() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'Log akses riwayat klinis tidak dapat diubah atau dihapus' using errcode = '42501';
end;
$$;
revoke all on function public.clinic_history_reads_immutable() from public, anon, authenticated, service_role;
drop trigger if exists clinic_history_reads_no_update on public.clinic_history_reads;
create trigger clinic_history_reads_no_update before update or delete on public.clinic_history_reads
  for each row execute function public.clinic_history_reads_immutable();
drop trigger if exists clinic_history_reads_no_truncate on public.clinic_history_reads;
create trigger clinic_history_reads_no_truncate before truncate on public.clinic_history_reads
  for each statement execute function public.clinic_history_reads_immutable();

-- Same A01 activity framework as other clinic sources: metadata only, OWNER/ADMIN.
insert into public.activity_log_sources(entity, module_id, label_key, value_keys, scope_kind, parent_entity, parent_key,
  identity_keys, branch_columns, scope_parents, metadata_only, reader_roles)
values ('clinic_history_reads', 'klinik', null, '{}', 'direct', null, null,
  array['id'], '{}', '[]'::jsonb, true, array['OWNER', 'ADMIN'])
on conflict (entity) do nothing;
drop trigger if exists a01_activity_change on public.clinic_history_reads;
create trigger a01_activity_change after insert on public.clinic_history_reads
  for each row execute function public.capture_activity_log();

-- Earlier revision of this function was STABLE; it now writes the trail.
drop function if exists public.clinic_patient_clinical_history(uuid, uuid);

create or replace function public.clinic_patient_clinical_history(p_pet_id uuid, p_anchor_visit_id uuid)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_anchor_pet uuid;
        v_anchor_branch uuid;
        v_result jsonb;
        v_foreign uuid[];
        v_foreign_visits integer;
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

  -- Audit: one row per call, only when other-branch visits were disclosed.
  select coalesce(array_agg(distinct x.branch_id order by x.branch_id) filter (where x.branch_id is not null), '{}'),
         count(*)
    into v_foreign, v_foreign_visits
  from public.visits x
  where x.pet_id = v_anchor_pet and (x.branch_id is null or not public.user_can_access_branch(x.branch_id));
  if v_foreign_visits > 0 then
    insert into public.clinic_history_reads(pet_id, anchor_visit_id, branch_id, foreign_branch_ids, foreign_visit_count, read_by)
    values (v_anchor_pet, p_anchor_visit_id, v_anchor_branch, v_foreign, v_foreign_visits, auth.uid());
  end if;

  return jsonb_build_object('pet_id', v_anchor_pet, 'visits', v_result);
end;
$$;
revoke all on function public.clinic_patient_clinical_history(uuid, uuid) from public, anon, service_role;
grant execute on function public.clinic_patient_clinical_history(uuid, uuid) to authenticated;
