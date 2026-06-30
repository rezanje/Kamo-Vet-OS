-- HRIS: pengajuan cuti / izin / lembur + persetujuan
create type leave_status as enum ('Menunggu','Disetujui','Ditolak');
create table leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  jenis varchar(10) not null,           -- Cuti / Izin / Sakit / Lembur
  tanggal_mulai date not null,
  tanggal_selesai date,
  durasi numeric,                       -- hari (cuti/izin) atau jam (lembur)
  alasan text,
  status leave_status not null default 'Menunggu',
  created_at timestamptz not null default now()
);
create index on leave_requests(employee_id);
alter table leave_requests enable row level security;
create policy leave_all on leave_requests for all to authenticated using (true) with check (true);
