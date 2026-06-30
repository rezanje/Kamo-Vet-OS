-- Klinik module: real customer/pet registration + visit queue (PRD Smart Clinic)

-- customers/pets were SELECT-only (Fase 1 gap). Frontliner registrasi needs insert/update.
create policy customers_write on customers for insert to authenticated with check (true);
create policy customers_update on customers for update to authenticated using (true) with check (true);
create policy pets_write on pets for insert to authenticated with check (true);
create policy pets_update on pets for update to authenticated using (true) with check (true);

create type visit_status as enum ('Menunggu','Diperiksa','Selesai');

create table visits (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id) on delete restrict,
  customer_id uuid not null references customers(id) on delete cascade,
  pet_id uuid not null references pets(id) on delete cascade,
  poli varchar(50) not null default 'Poli Umum',
  dokter varchar(100),
  keluhan text,
  status visit_status not null default 'Menunggu',
  created_at timestamptz not null default now()
);
create index on visits(branch_id);
create index on visits(status);

alter table visits enable row level security;

-- ponytail: reuses user_can_access_branch() — same branch-isolation gate as warehouses.
create policy visits_select on visits for select to authenticated
  using (public.user_can_access_branch(branch_id));
create policy visits_write on visits for all to authenticated
  using (public.user_can_access_branch(branch_id))
  with check (public.user_can_access_branch(branch_id));
