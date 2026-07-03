-- Addendum §3: rawat inap — 4 kondisi (stabil/kritis/sembuh/rip), log status, laporan harian append-only.
create table inpatient_records (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id) on delete restrict,
  visit_id uuid not null references visits(id) on delete cascade,
  medical_record_id uuid references medical_records(id) on delete set null,
  doctor_name varchar(100),                  -- dokter PIC (visits.dokter masih varchar di skema existing)
  treatment_plan text,                       -- rencana tindakan dokter PIC (popup design klinik/07)
  condition_status text not null default 'stabil' check (condition_status in ('stabil','kritis','sembuh','rip')),
  admitted_at timestamptz not null default now(),
  discharged_at timestamptz,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on inpatient_records(branch_id);
create index on inpatient_records(visit_id);

create table inpatient_status_log (
  id uuid primary key default gen_random_uuid(),
  inpatient_record_id uuid not null references inpatient_records(id) on delete cascade,
  previous_status text,
  new_status text not null,
  changed_by uuid not null references profiles(id) on delete restrict,
  notes text,
  changed_at timestamptz not null default now()
);
create index on inpatient_status_log(inpatient_record_id);

-- laporan harian: append-only by design — tidak ada policy update/delete.
create table inpatient_daily_logs (
  id uuid primary key default gen_random_uuid(),
  inpatient_record_id uuid not null references inpatient_records(id) on delete cascade,
  log_date date not null default current_date,
  condition_note text not null,
  tindakan text,
  keterangan text,
  doctor_name varchar(100),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on inpatient_daily_logs(inpatient_record_id);

alter table inpatient_records enable row level security;
alter table inpatient_status_log enable row level security;
alter table inpatient_daily_logs enable row level security;

create policy ir_all on inpatient_records for all to authenticated
  using (public.user_can_access_branch(branch_id))
  with check (public.user_can_access_branch(branch_id));
create policy isl_sel on inpatient_status_log for select to authenticated using (true);
create policy isl_ins on inpatient_status_log for insert to authenticated with check (true);
create policy idl_sel on inpatient_daily_logs for select to authenticated using (true);
create policy idl_ins on inpatient_daily_logs for insert to authenticated with check (true);
