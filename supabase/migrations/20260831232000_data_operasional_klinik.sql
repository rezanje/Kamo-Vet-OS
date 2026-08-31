-- Data operasional klinik: outcome, sumber kunjungan, waktu layanan, kapasitas,
-- referral, dan audit append-only.
create extension if not exists btree_gist;

alter table bookings
  add column if not exists attendance_outcome text not null default 'pending'
    check (attendance_outcome in ('pending', 'hadir', 'no_show')),
  add column if not exists outcome_by uuid references profiles(id),
  add column if not exists outcome_at timestamptz;

alter table visits
  add column if not exists source text not null default 'walk_in'
    check (source in ('booking', 'walk_in')),
  add column if not exists checked_in_at timestamptz,
  add column if not exists service_started_at timestamptz,
  add column if not exists service_finished_at timestamptz,
  add column if not exists checked_out_at timestamptz,
  add column if not exists service_provider_id uuid references employees(id);

alter table follow_ups
  add column if not exists completed_at timestamptz,
  add column if not exists completed_by uuid references profiles(id);

create index if not exists bookings_outcome_scope_idx
  on bookings (branch_id, attendance_outcome, tanggal);
create index if not exists visits_operations_scope_idx
  on visits (branch_id, source, created_at);
create index if not exists follow_ups_completion_idx
  on follow_ups (branch_id, tanggal, status, completed_at);

create table if not exists branch_capacity_periods (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id) on delete cascade,
  capacity_type text not null default 'rawat_inap' check (capacity_type in ('rawat_inap')),
  capacity int not null check (capacity > 0),
  valid_from date not null,
  valid_until date,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  check (valid_until is null or valid_until >= valid_from),
  exclude using gist (
    branch_id with =,
    capacity_type with =,
    daterange(valid_from, coalesce(valid_until + 1, 'infinity'::date), '[)') with &&
  )
);

create table if not exists visit_referrals (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references visits(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete restrict,
  direction text not null check (direction in ('masuk', 'keluar')),
  facility text not null,
  reason text not null,
  notes text,
  referred_at timestamptz not null default now(),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists visit_operational_events (
  id bigint generated always as identity primary key,
  visit_id uuid references visits(id) on delete cascade,
  booking_id uuid references bookings(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete restrict,
  event_type text not null check (event_type in (
    'booking_hadir', 'booking_no_show', 'check_in', 'service_started',
    'service_finished', 'check_out', 'provider_changed', 'referral_created'
  )),
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_by uuid not null references profiles(id),
  check ((visit_id is not null)::int + (booking_id is not null)::int >= 1)
);

create index if not exists branch_capacity_periods_scope_idx
  on branch_capacity_periods (branch_id, valid_from, valid_until);
create index if not exists visit_referrals_scope_idx
  on visit_referrals (branch_id, referred_at desc);
create index if not exists visit_operational_events_scope_idx
  on visit_operational_events (branch_id, occurred_at desc);

alter table branch_capacity_periods enable row level security;
alter table visit_referrals enable row level security;
alter table visit_operational_events enable row level security;

create policy branch_capacity_select on branch_capacity_periods
  for select to authenticated using (public.user_can_access_branch(branch_id));
create policy branch_capacity_insert on branch_capacity_periods
  for insert to authenticated
  with check (public.is_admin() and public.user_can_access_branch(branch_id));

create policy visit_referrals_select on visit_referrals
  for select to authenticated using (public.user_can_access_branch(branch_id));
create policy visit_referrals_insert on visit_referrals
  for insert to authenticated
  with check (public.user_can_access_branch(branch_id));

create policy visit_events_select on visit_operational_events
  for select to authenticated using (public.user_can_access_branch(branch_id));
create policy visit_events_insert on visit_operational_events
  for insert to authenticated
  with check (public.user_can_access_branch(branch_id));

create or replace function public.mark_booking_no_show(p_booking_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_booking bookings%rowtype;
begin
  select * into v_booking from bookings where id = p_booking_id for update;
  if not found or not public.user_can_access_branch(v_booking.branch_id) then
    raise exception 'Booking tidak ditemukan atau cabang tidak dapat diakses';
  end if;
  if v_booking.status <> 'dikonfirmasi'
     or v_booking.attendance_outcome <> 'pending'
     or v_booking.visit_id is not null
     or ((v_booking.tanggal::text || ' ' || v_booking.jam)::timestamp without time zone at time zone 'Asia/Jakarta') >= now() then
    raise exception 'Booking belum memenuhi syarat no-show';
  end if;

  update bookings
  set attendance_outcome = 'no_show', outcome_by = auth.uid(), outcome_at = now()
  where id = p_booking_id and status = 'dikonfirmasi'
    and attendance_outcome = 'pending' and visit_id is null;

  insert into visit_operational_events (booking_id, branch_id, event_type, payload, created_by)
  values (p_booking_id, v_booking.branch_id, 'booking_no_show', '{}'::jsonb, auth.uid());
end;
$$;

revoke all on function public.mark_booking_no_show(uuid) from public;
grant execute on function public.mark_booking_no_show(uuid) to authenticated;

create or replace function public.record_visit_check_in(p_visit_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_visit visits%rowtype;
begin
  select * into v_visit from visits where id = p_visit_id for update;
  if not found or not public.user_can_access_branch(v_visit.branch_id) then
    raise exception 'Kunjungan tidak ditemukan atau cabang tidak dapat diakses';
  end if;
  insert into visit_operational_events (visit_id, branch_id, event_type, payload, created_by)
  values (p_visit_id, v_visit.branch_id, 'check_in', '{}'::jsonb, auth.uid());
end;
$$;

create or replace function public.record_booking_visit(p_booking_id uuid, p_visit_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_booking bookings%rowtype;
  v_visit visits%rowtype;
begin
  select * into v_booking from bookings where id = p_booking_id for update;
  select * into v_visit from visits where id = p_visit_id for update;
  if v_booking.id is null or v_visit.id is null
     or not public.user_can_access_branch(v_booking.branch_id)
     or v_visit.branch_id <> v_booking.branch_id then
    raise exception 'Booking dan kunjungan tidak cocok';
  end if;
  if v_booking.visit_id is not null or v_booking.attendance_outcome <> 'pending' then
    raise exception 'Booking sudah memiliki hasil kunjungan';
  end if;
  update bookings
  set status = 'dikonfirmasi', visit_id = p_visit_id,
      attendance_outcome = 'hadir', outcome_by = auth.uid(), outcome_at = now(),
      handled_by = coalesce(handled_by, auth.uid()), handled_at = coalesce(handled_at, now())
  where id = p_booking_id and visit_id is null and attendance_outcome = 'pending';
  insert into visit_operational_events (visit_id, booking_id, branch_id, event_type, payload, created_by)
  values (p_visit_id, p_booking_id, v_visit.branch_id, 'booking_hadir', '{}'::jsonb, auth.uid());
  insert into visit_operational_events (visit_id, booking_id, branch_id, event_type, payload, created_by)
  values (p_visit_id, p_booking_id, v_visit.branch_id, 'check_in', '{}'::jsonb, auth.uid());
end;
$$;

revoke all on function public.record_visit_check_in(uuid) from public;
grant execute on function public.record_visit_check_in(uuid) to authenticated;
revoke all on function public.record_booking_visit(uuid, uuid) from public;
grant execute on function public.record_booking_visit(uuid, uuid) to authenticated;

create or replace function public.set_visit_service_state(
  p_visit_id uuid,
  p_action text,
  p_provider_id uuid default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_visit visits%rowtype;
  v_provider employees%rowtype;
begin
  select * into v_visit from visits where id = p_visit_id for update;
  if not found or not public.user_can_access_branch(v_visit.branch_id) then
    raise exception 'Kunjungan tidak ditemukan atau cabang tidak dapat diakses';
  end if;

  if p_action = 'start' then
    if v_visit.status <> 'Menunggu' or v_visit.service_started_at is not null then
      raise exception 'Kunjungan tidak siap dimulai';
    end if;
    update visits set status = 'Diperiksa', service_started_at = now(), called_at = coalesce(called_at, now()) where id = p_visit_id;
    insert into visit_operational_events (visit_id, branch_id, event_type, payload, created_by)
    values (p_visit_id, v_visit.branch_id, 'service_started', '{}'::jsonb, auth.uid());
  elsif p_action = 'finish' then
    if v_visit.service_started_at is null or v_visit.service_finished_at is not null then
      raise exception 'Kunjungan belum siap diselesaikan';
    end if;
    update visits set status = 'Pembayaran', service_finished_at = now() where id = p_visit_id;
    insert into visit_operational_events (visit_id, branch_id, event_type, payload, created_by)
    values (p_visit_id, v_visit.branch_id, 'service_finished', '{}'::jsonb, auth.uid());
  elsif p_action = 'checkout' then
    if v_visit.checked_out_at is null then
      update visits set status = 'Selesai', checked_out_at = now() where id = p_visit_id;
      insert into visit_operational_events (visit_id, branch_id, event_type, payload, created_by)
      values (p_visit_id, v_visit.branch_id, 'check_out', '{}'::jsonb, auth.uid());
    end if;
  elsif p_action = 'provider' then
    if p_provider_id is null then
      raise exception 'Pelaksana wajib dipilih';
    end if;
    select * into v_provider from employees where id = p_provider_id;
    if not found or v_provider.branch_id <> v_visit.branch_id or v_provider.status <> 'Aktif' then
      raise exception 'Pelaksana tidak aktif atau bukan dari cabang kunjungan';
    end if;
    update visits set service_provider_id = p_provider_id where id = p_visit_id;
    insert into visit_operational_events (visit_id, branch_id, event_type, payload, created_by)
    values (p_visit_id, v_visit.branch_id, 'provider_changed', jsonb_build_object('provider_id', p_provider_id), auth.uid());
  else
    raise exception 'Aksi layanan tidak dikenal';
  end if;
end;
$$;

revoke all on function public.set_visit_service_state(uuid, text, uuid) from public;
grant execute on function public.set_visit_service_state(uuid, text, uuid) to authenticated;

create or replace function public.create_visit_referral(
  p_visit_id uuid,
  p_direction text,
  p_facility text,
  p_reason text,
  p_notes text,
  p_referred_at timestamptz default now()
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_visit visits%rowtype;
  v_referral_id uuid;
begin
  select * into v_visit from visits where id = p_visit_id for update;
  if not found or not public.user_can_access_branch(v_visit.branch_id) then
    raise exception 'Kunjungan tidak ditemukan atau cabang tidak dapat diakses';
  end if;
  if p_direction not in ('masuk', 'keluar') or nullif(btrim(p_facility), '') is null
     or nullif(btrim(p_reason), '') is null then
    raise exception 'Data referral belum lengkap';
  end if;
  insert into visit_referrals (visit_id, branch_id, direction, facility, reason, notes, referred_at, created_by)
  values (p_visit_id, v_visit.branch_id, p_direction, btrim(p_facility), btrim(p_reason), nullif(btrim(p_notes), ''), p_referred_at, auth.uid())
  returning id into v_referral_id;
  insert into visit_operational_events (visit_id, branch_id, event_type, payload, occurred_at, created_by)
  values (p_visit_id, v_visit.branch_id, 'referral_created', jsonb_build_object('referral_id', v_referral_id, 'direction', p_direction), p_referred_at, auth.uid());
  return v_referral_id;
end;
$$;

revoke all on function public.create_visit_referral(uuid, text, text, text, text, timestamptz) from public;
grant execute on function public.create_visit_referral(uuid, text, text, text, text, timestamptz) to authenticated;

-- Booking staff hanya boleh melihat dan mengubah booking cabangnya. INSERT anonim
-- dari halaman publik tetap memakai bookings_public_insert.
drop policy if exists bookings_staff_all on bookings;
create policy bookings_staff_select on bookings for select to authenticated
  using (public.user_can_access_branch(branch_id));
create policy bookings_staff_insert on bookings for insert to authenticated
  with check (public.user_can_access_branch(branch_id));
create policy bookings_staff_update on bookings for update to authenticated
  using (public.user_can_access_branch(branch_id))
  with check (public.user_can_access_branch(branch_id));

-- Demo policy lama pada visits dibuang agar cabang tidak bocor lintas pengguna.
drop policy if exists visits_all on visits;
drop policy if exists visits_select on visits;
drop policy if exists visits_write on visits;
create policy visits_select on visits for select to authenticated
  using (public.user_can_access_branch(branch_id));
create policy visits_write on visits for all to authenticated
  using (public.user_can_access_branch(branch_id))
  with check (public.user_can_access_branch(branch_id));

drop policy if exists fu_all on follow_ups;
create policy fu_select on follow_ups for select to authenticated
  using (
    (branch_id is not null and public.user_can_access_branch(branch_id))
    or (branch_id is null and exists (
      select 1 from visits v where v.id = follow_ups.visit_id
        and public.user_can_access_branch(v.branch_id)
    ))
  );
create policy fu_insert on follow_ups for insert to authenticated
  with check (
    (branch_id is not null and public.user_can_access_branch(branch_id))
    or (branch_id is null and exists (
      select 1 from visits v where v.id = follow_ups.visit_id
        and public.user_can_access_branch(v.branch_id)
    ))
  );
create policy fu_update on follow_ups for update to authenticated
  using (
    (branch_id is not null and public.user_can_access_branch(branch_id))
    or (branch_id is null and exists (
      select 1 from visits v where v.id = follow_ups.visit_id
        and public.user_can_access_branch(v.branch_id)
    ))
  )
  with check (
    (branch_id is not null and public.user_can_access_branch(branch_id))
    or (branch_id is null and exists (
      select 1 from visits v where v.id = follow_ups.visit_id
        and public.user_can_access_branch(v.branch_id)
    ))
  );
