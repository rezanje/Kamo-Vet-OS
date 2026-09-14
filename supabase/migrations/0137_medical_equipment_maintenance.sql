-- PKS/SPH: maintenance alat medis per cabang.

create table if not exists medical_equipment (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id) on delete restrict,
  name varchar(160) not null,
  category varchar(80),
  serial_number varchar(100),
  location varchar(120),
  purchase_date date,
  warranty_until date,
  maintenance_interval_days integer not null default 180 check (maintenance_interval_days between 1 and 3650),
  next_maintenance_date date,
  status varchar(16) not null default 'Aktif' check (status in ('Aktif', 'Perbaikan', 'Pensiun')),
  notes text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists medical_equipment_maintenance (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references medical_equipment(id) on delete cascade,
  maintenance_date date not null default current_date,
  maintenance_type varchar(80) not null,
  technician varchar(120),
  vendor varchar(120),
  cost numeric(15,2) not null default 0 check (cost >= 0),
  result text,
  next_due_date date,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists medical_equipment_branch_idx on medical_equipment(branch_id, status);
create index if not exists medical_equipment_next_date_idx on medical_equipment(next_maintenance_date);
create index if not exists medical_equipment_maintenance_equipment_idx on medical_equipment_maintenance(equipment_id, maintenance_date desc);

alter table medical_equipment enable row level security;
alter table medical_equipment_maintenance enable row level security;

drop policy if exists medical_equipment_all on medical_equipment;
create policy medical_equipment_all on medical_equipment for all to authenticated
  using (public.user_can_access_branch(branch_id))
  with check (public.user_can_access_branch(branch_id));
drop policy if exists medical_equipment_maintenance_all on medical_equipment_maintenance;
create policy medical_equipment_maintenance_all on medical_equipment_maintenance for all to authenticated
  using (exists (select 1 from medical_equipment e where e.id = equipment_id and public.user_can_access_branch(e.branch_id)))
  with check (exists (select 1 from medical_equipment e where e.id = equipment_id and public.user_can_access_branch(e.branch_id)));
