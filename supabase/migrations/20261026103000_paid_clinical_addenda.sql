-- Paid clinical addenda are append-only evidence. The submitted record, invoice,
-- payment, prescription, stock and journal are never updated by this workflow.
-- Depends on 20261024074043_unpaid_clinical_correction.sql for the existing
-- active-profile, clinic-module, operational-branch and source-RLS access check.
create table public.clinic_paid_record_addenda (
  id uuid primary key default gen_random_uuid(),
  medical_record_id uuid not null references public.medical_records(id) on delete restrict,
  visit_id uuid not null references public.visits(id) on delete restrict,
  paid_invoice_id uuid not null references public.invoices(id) on delete restrict,
  invoice_paid_at timestamptz not null,
  original_record jsonb not null,
  amendment text not null,
  reason text not null,
  request_key text not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  unique (created_by, request_key)
);
create index clinic_paid_record_addenda_record_time
  on public.clinic_paid_record_addenda (medical_record_id, created_at, id);
alter table public.clinic_paid_record_addenda enable row level security;
revoke all on public.clinic_paid_record_addenda from public, anon, authenticated, service_role;
grant select, insert on public.clinic_paid_record_addenda to authenticated;

create function public.clinic_can_add_paid_addendum(p_record_id uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.medical_records m
    join public.visits v on v.id = m.visit_id
    where m.id = p_record_id and m.submission_key is not null
      and public.clinic_record_correction_actor(v.id)
      and exists (
        select 1 from public.invoices i where i.visit_id = v.id
          and i.voided_at is null and i.paid_status = 'Lunas' and i.paid_at is not null
      )
  );
$$;
revoke all on function public.clinic_can_add_paid_addendum(uuid) from public, anon, service_role;
grant execute on function public.clinic_can_add_paid_addendum(uuid) to authenticated;

create policy clinic_paid_addenda_read on public.clinic_paid_record_addenda
  for select to authenticated using (
    exists (select 1 from public.medical_records m where m.id = medical_record_id
      and public.clinic_record_correction_actor(m.visit_id))
  );
create policy clinic_paid_addenda_insert on public.clinic_paid_record_addenda
  for insert to authenticated with check (
    created_by = auth.uid() and public.clinic_can_add_paid_addendum(medical_record_id)
  );

-- Direct inserts cannot forge the source snapshot, invoice, actor or timestamp.
create function public.prepare_clinic_paid_addendum() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare source public.medical_records%rowtype;
        paid public.invoices%rowtype;
        source_visit_id uuid;
begin
  select m.visit_id into source_visit_id from public.medical_records m where m.id = new.medical_record_id;
  if source_visit_id is null or not public.clinic_record_correction_actor(source_visit_id) then
    raise exception 'Akses addendum rekam medis ditolak' using errcode = '42501';
  end if;
  -- Same visit-first lock order as invoice posting and unpaid correction.
  perform 1 from public.visits v where v.id = source_visit_id for update;
  select * into source from public.medical_records m where m.id = new.medical_record_id for share;
  if not found or not public.clinic_can_add_paid_addendum(source.id) then
    raise exception 'Addendum memerlukan rekam medis tersimpan dan invoice aktif yang telah lunas';
  end if;
  select * into paid from public.invoices i
    where i.visit_id = source.visit_id and i.voided_at is null
      and i.paid_status = 'Lunas' and i.paid_at is not null
    order by i.paid_at desc, i.id limit 1 for share;
  if not found then raise exception 'Bukti pembayaran belum dapat diverifikasi'; end if;
  if nullif(btrim(new.request_key), '') is null or length(new.request_key) > 100
    or length(btrim(coalesce(new.amendment, ''))) not between 3 and 4000
    or length(btrim(coalesce(new.reason, ''))) not between 3 and 1000 then
    raise exception 'Isi, alasan, dan kunci addendum wajib valid';
  end if;
  new.visit_id := source.visit_id;
  new.paid_invoice_id := paid.id;
  new.invoice_paid_at := paid.paid_at;
  new.original_record := to_jsonb(source);
  new.amendment := btrim(new.amendment);
  new.reason := btrim(new.reason);
  new.request_key := btrim(new.request_key);
  new.created_by := auth.uid();
  new.created_at := clock_timestamp();
  return new;
end;
$$;
create trigger prepare_clinic_paid_addendum before insert on public.clinic_paid_record_addenda
  for each row execute function public.prepare_clinic_paid_addendum();

create function public.clinic_paid_addendum_immutable() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'Addendum rekam medis tidak dapat diubah atau dihapus' using errcode = '42501';
end;
$$;
create trigger clinic_paid_addendum_no_update before update or delete on public.clinic_paid_record_addenda
  for each row execute function public.clinic_paid_addendum_immutable();
create trigger clinic_paid_addendum_no_truncate before truncate on public.clinic_paid_record_addenda
  for each statement execute function public.clinic_paid_addendum_immutable();
revoke all on function public.prepare_clinic_paid_addendum(), public.clinic_paid_addendum_immutable()
  from public, anon, authenticated, service_role;

create function public.clinic_add_paid_record_addendum(
  p_visit_id uuid, p_record_id uuid, p_amendment text, p_reason text, p_request_key text
) returns uuid
language plpgsql security invoker set search_path = '' set lock_timeout = '8s' as $$
declare prior public.clinic_paid_record_addenda%rowtype;
        saved_id uuid;
begin
  if not public.clinic_record_correction_actor(p_visit_id) then
    raise exception 'Akses addendum rekam medis ditolak' using errcode = '42501';
  end if;
  if nullif(btrim(p_request_key), '') is null or length(p_request_key) > 100 then
    raise exception 'Kunci addendum tidak valid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'clinic-paid-addendum:' || auth.uid()::text || ':' || btrim(p_request_key), 0));
  perform 1 from public.visits where id = p_visit_id for update;
  if not exists (select 1 from public.medical_records where id = p_record_id and visit_id = p_visit_id) then
    raise exception 'Rekam medis tidak sesuai kunjungan';
  end if;
  select * into prior from public.clinic_paid_record_addenda
    where created_by = auth.uid() and request_key = btrim(p_request_key);
  if found then
    if prior.medical_record_id is distinct from p_record_id
      or prior.amendment is distinct from btrim(p_amendment)
      or prior.reason is distinct from btrim(p_reason) then
      raise exception 'Kunci addendum telah dipakai untuk data berbeda';
    end if;
    return prior.id;
  end if;
  insert into public.clinic_paid_record_addenda (
    medical_record_id, visit_id, paid_invoice_id, invoice_paid_at, original_record,
    amendment, reason, request_key, created_by
  ) values (
    -- The BEFORE trigger fills all source columns under lock before NOT NULL/FK checks.
    p_record_id, null, null, null, null,
    p_amendment, p_reason, p_request_key, auth.uid()
  ) returning id into saved_id;
  return saved_id;
end;
$$;
revoke all on function public.clinic_add_paid_record_addendum(uuid, uuid, text, text, text)
  from public, anon, service_role;
grant execute on function public.clinic_add_paid_record_addendum(uuid, uuid, text, text, text)
  to authenticated;
