-- HRIS: penggajian (payroll run per karyawan per periode)
create table payrolls (
  id uuid primary key default gen_random_uuid(),
  periode varchar(7) not null,        -- YYYY-MM
  employee_id uuid not null references employees(id) on delete cascade,
  gaji_pokok numeric not null default 0,
  tunjangan numeric not null default 0,
  potongan numeric not null default 0,
  total numeric not null default 0,   -- gaji_pokok + tunjangan - potongan
  created_at timestamptz not null default now(),
  unique(periode, employee_id)
);
create index on payrolls(periode);
alter table payrolls enable row level security;
create policy payrolls_all on payrolls for all to authenticated using (true) with check (true);
