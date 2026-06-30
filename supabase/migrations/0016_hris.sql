-- HRIS: master karyawan (PRD HRIS)
create table employees (
  id uuid primary key default gen_random_uuid(),
  nik varchar(20) unique,
  nama varchar(100) not null,
  jabatan varchar(60),
  departemen varchar(60),
  branch_id uuid references branches(id) on delete set null,
  phone varchar(20),
  email varchar(120),
  tgl_masuk date,
  gaji_pokok numeric not null default 0,
  status varchar(12) not null default 'Aktif',   -- Aktif / Nonaktif
  created_at timestamptz not null default now()
);
create index on employees(branch_id);
alter table employees enable row level security;
-- ponytail: karyawan dibaca/tulis semua authenticated (master HR, lintas cabang dikelola admin).
create policy employees_all on employees for all to authenticated using (true) with check (true);
