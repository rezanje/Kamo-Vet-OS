-- HRIS: absensi harian karyawan
create table attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  tanggal date not null default current_date,
  jam_masuk time,
  jam_pulang time,
  status varchar(10) not null default 'Hadir',   -- Hadir / Izin / Sakit / Alpha / Cuti
  keterangan text,
  created_at timestamptz not null default now(),
  unique(employee_id, tanggal)
);
create index on attendance(tanggal);
alter table attendance enable row level security;
create policy attendance_all on attendance for all to authenticated using (true) with check (true);
