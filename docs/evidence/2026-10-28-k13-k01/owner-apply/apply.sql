-- K13/K01 APPLY. Generated from the two repository migrations (same text); one transaction.
-- Run preflight.sql first (all ok = true). Safe to re-run.
begin;

-- ===== 20261028110000_clinic_record_addenda.sql =====
-- K01: append-only diagnosis/therapy addenda for a medical record whose visit
-- already has (or had) a posted invoice, active or voided. The submitted record, prescriptions,
-- invoice, payments, stock and journals are never written by this workflow.
-- Unpaid records without an invoice keep using clinic_record_corrections
-- (20261024074043); once billing is posted, only an addendum is possible.
-- Supersedes the unapplied draft 20261026103000_paid_clinical_addenda.sql (PR #239).
-- Idempotent: safe to re-run.

create table if not exists public.clinic_record_addenda (
  id uuid primary key default gen_random_uuid(),
  medical_record_id uuid not null references public.medical_records(id) on delete restrict,
  visit_id uuid not null references public.visits(id) on delete restrict,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  invoice_paid_status text not null,
  invoice_paid_at timestamptz,
  original_record jsonb not null,
  diagnosis_addendum text,
  therapy_addendum text,
  reason text,
  request_key text not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  unique (created_by, request_key),
  constraint clinic_record_addenda_has_text
    check (diagnosis_addendum is not null or therapy_addendum is not null)
);
create index if not exists clinic_record_addenda_record_time
  on public.clinic_record_addenda (medical_record_id, created_at, id);
alter table public.clinic_record_addenda enable row level security;
revoke all on public.clinic_record_addenda from public, anon, authenticated, service_role;
grant select, insert on public.clinic_record_addenda to authenticated;

-- Same actor gate as unpaid correction (active profile, clinic module, operational
-- branch); posted billing is the only state where an addendum replaces Edit.
create or replace function public.clinic_can_add_record_addendum(p_record_id uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.medical_records m
    join public.visits v on v.id = m.visit_id
    where m.id = p_record_id
      and public.clinic_record_correction_actor(v.id)
      -- Any invoice, active or voided: unpaid Edit is closed once one ever existed
      -- (clinic_can_correct_record), so a voided-only visit must still be annotatable.
      and exists (select 1 from public.invoices i where i.visit_id = v.id)
  );
$$;
revoke all on function public.clinic_can_add_record_addendum(uuid) from public, anon, service_role;
grant execute on function public.clinic_can_add_record_addendum(uuid) to authenticated;

drop policy if exists clinic_record_addenda_read on public.clinic_record_addenda;
create policy clinic_record_addenda_read on public.clinic_record_addenda
  for select to authenticated using (
    exists (select 1 from public.medical_records m where m.id = medical_record_id
      and public.clinic_record_correction_actor(m.visit_id))
  );
drop policy if exists clinic_record_addenda_insert on public.clinic_record_addenda;
create policy clinic_record_addenda_insert on public.clinic_record_addenda
  for insert to authenticated with check (
    created_by = auth.uid() and public.clinic_can_add_record_addendum(medical_record_id)
  );

-- Direct inserts cannot forge the source snapshot, invoice, actor or timestamp.
create or replace function public.prepare_clinic_record_addendum() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare source public.medical_records%rowtype;
        inv public.invoices%rowtype;
        source_visit_id uuid;
begin
  select m.visit_id into source_visit_id from public.medical_records m where m.id = new.medical_record_id;
  if source_visit_id is null or not public.clinic_record_correction_actor(source_visit_id) then
    raise exception 'Akses adendum rekam medis ditolak' using errcode = '42501';
  end if;
  -- Same visit-first lock order as invoice posting and unpaid correction.
  perform 1 from public.visits v where v.id = source_visit_id for update;
  select * into source from public.medical_records m where m.id = new.medical_record_id for share;
  if not found or not public.clinic_can_add_record_addendum(source.id) then
    raise exception 'Adendum hanya untuk rekam medis yang tagihannya pernah diterbitkan';
  end if;
  select * into inv from public.invoices i
    where i.visit_id = source.visit_id
    order by (i.voided_at is null) desc, i.created_at desc, i.id limit 1;  -- visit row lock above serialises invoice posting/void
  if not found then raise exception 'Tagihan kunjungan belum dapat diverifikasi'; end if;
  new.diagnosis_addendum := nullif(btrim(coalesce(new.diagnosis_addendum, '')), '');
  new.therapy_addendum := nullif(btrim(coalesce(new.therapy_addendum, '')), '');
  new.reason := nullif(btrim(coalesce(new.reason, '')), '');
  if nullif(btrim(coalesce(new.request_key, '')), '') is null or length(new.request_key) > 100
    or (new.diagnosis_addendum is null and new.therapy_addendum is null)
    or length(coalesce(new.diagnosis_addendum, '')) > 4000
    or length(coalesce(new.therapy_addendum, '')) > 4000
    or length(coalesce(new.reason, '')) > 1000 then
    raise exception 'Isi adendum diagnosa atau terapi wajib diisi (maks. 4000 karakter)';
  end if;
  new.visit_id := source.visit_id;
  new.invoice_id := inv.id;
  new.invoice_paid_status := inv.paid_status;
  new.invoice_paid_at := inv.paid_at;
  new.original_record := to_jsonb(source);
  new.request_key := btrim(new.request_key);
  new.created_by := auth.uid();
  new.created_at := clock_timestamp();
  return new;
end;
$$;
drop trigger if exists prepare_clinic_record_addendum on public.clinic_record_addenda;
create trigger prepare_clinic_record_addendum before insert on public.clinic_record_addenda
  for each row execute function public.prepare_clinic_record_addendum();

create or replace function public.clinic_record_addendum_immutable() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'Adendum rekam medis tidak dapat diubah atau dihapus' using errcode = '42501';
end;
$$;
drop trigger if exists clinic_record_addendum_no_update on public.clinic_record_addenda;
create trigger clinic_record_addendum_no_update before update or delete on public.clinic_record_addenda
  for each row execute function public.clinic_record_addendum_immutable();
drop trigger if exists clinic_record_addendum_no_truncate on public.clinic_record_addenda;
create trigger clinic_record_addendum_no_truncate before truncate on public.clinic_record_addenda
  for each statement execute function public.clinic_record_addendum_immutable();
revoke all on function public.prepare_clinic_record_addendum(), public.clinic_record_addendum_immutable()
  from public, anon, authenticated, service_role;

create or replace function public.clinic_add_record_addendum(
  p_visit_id uuid, p_record_id uuid, p_diagnosis text, p_therapy text, p_reason text, p_request_key text
) returns uuid
language plpgsql security invoker set search_path = '' set lock_timeout = '8s' as $$
declare prior public.clinic_record_addenda%rowtype;
        saved_id uuid;
begin
  if not public.clinic_record_correction_actor(p_visit_id) then
    raise exception 'Akses adendum rekam medis ditolak' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_request_key, '')), '') is null or length(p_request_key) > 100 then
    raise exception 'Kunci adendum tidak valid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'clinic-record-addendum:' || auth.uid()::text || ':' || btrim(p_request_key), 0));
  perform 1 from public.visits where id = p_visit_id for update;
  if not exists (select 1 from public.medical_records where id = p_record_id and visit_id = p_visit_id) then
    raise exception 'Rekam medis tidak sesuai kunjungan';
  end if;
  select * into prior from public.clinic_record_addenda
    where created_by = auth.uid() and request_key = btrim(p_request_key);
  if found then
    if prior.medical_record_id is distinct from p_record_id
      or prior.diagnosis_addendum is distinct from nullif(btrim(coalesce(p_diagnosis, '')), '')
      or prior.therapy_addendum is distinct from nullif(btrim(coalesce(p_therapy, '')), '')
      or prior.reason is distinct from nullif(btrim(coalesce(p_reason, '')), '') then
      raise exception 'Kunci adendum telah dipakai untuk data berbeda';
    end if;
    return prior.id;
  end if;
  insert into public.clinic_record_addenda (
    medical_record_id, visit_id, invoice_id, invoice_paid_status, original_record,
    diagnosis_addendum, therapy_addendum, reason, request_key, created_by
  ) values (
    -- The BEFORE trigger fills every source column under lock before NOT NULL/FK checks.
    p_record_id, null, null, null, null,
    p_diagnosis, p_therapy, p_reason, p_request_key, auth.uid()
  ) returning id into saved_id;
  return saved_id;
end;
$$;
revoke all on function public.clinic_add_record_addendum(uuid, uuid, text, text, text, text)
  from public, anon, service_role;
grant execute on function public.clinic_add_record_addendum(uuid, uuid, text, text, text, text)
  to authenticated;

-- ===== 20261028110100_clinic_patient_history_rpc.sql =====
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

commit;
notify pgrst, 'reload schema';
