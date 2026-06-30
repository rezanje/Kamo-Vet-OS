-- HRIS: penilaian KPI karyawan per periode
create table kpi_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  periode varchar(7) not null,          -- YYYY-MM
  metrik varchar(80) not null,          -- mis. "Target Penjualan", "Kepuasan Pelanggan", "Kehadiran"
  target numeric,
  realisasi numeric,
  skor numeric not null default 0,      -- 0-100
  catatan text,
  created_at timestamptz not null default now()
);
create index on kpi_records(employee_id);
create index on kpi_records(periode);
alter table kpi_records enable row level security;
create policy kpi_all on kpi_records for all to authenticated using (true) with check (true);
