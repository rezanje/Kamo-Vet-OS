-- Klinik: rekam medis + resep per-item (PRD Addendum §3.4 state machine, §3.5 per-item dosage)

create table medical_records (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references visits(id) on delete cascade,
  diagnosis text,
  anamnesis text,
  created_at timestamptz not null default now()
);
create index on medical_records(visit_id);

create table prescription_items (
  id uuid primary key default gen_random_uuid(),
  medical_record_id uuid not null references medical_records(id) on delete cascade,
  nama_obat varchar(120) not null,
  qty int not null default 1,
  aturan_pakai text,            -- §3.5: per-item dosage instruction, not one global note
  created_at timestamptz not null default now()
);
create index on prescription_items(medical_record_id);

alter table medical_records enable row level security;
alter table prescription_items enable row level security;

-- ponytail: gate through visits.branch_id, no denormalized branch column to keep in sync.
create policy mr_all on medical_records for all to authenticated
  using (exists (select 1 from visits v where v.id = medical_records.visit_id and public.user_can_access_branch(v.branch_id)))
  with check (exists (select 1 from visits v where v.id = medical_records.visit_id and public.user_can_access_branch(v.branch_id)));

create policy pi_all on prescription_items for all to authenticated
  using (exists (select 1 from medical_records m join visits v on v.id = m.visit_id
                 where m.id = prescription_items.medical_record_id and public.user_can_access_branch(v.branch_id)))
  with check (exists (select 1 from medical_records m join visits v on v.id = m.visit_id
                 where m.id = prescription_items.medical_record_id and public.user_can_access_branch(v.branch_id)));
