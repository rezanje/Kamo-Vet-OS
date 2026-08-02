-- HRIS fase 1: master shift, jadwal per karyawan, komponen gaji, aturan gaji, lokasi cabang.
-- Spec docs/superpowers/specs/2026-08-02-hris-gaji-otomatis-design.md
--
-- Latar: slip gaji selama ini diketik manual seluruhnya dan absensi tidak berpengaruh
-- sepeser pun ke bayaran. Fase ini menyiapkan datanya; hitungannya di fase 4.

-- ── Master shift ────────────────────────────────────────────────────────────────
-- Libur ikut jadi "shift" supaya papan jadwal punya satu jenis sel saja, dan hari
-- libur terjadwal tidak dihitung bolos saat penggajian.
create table work_shifts (
  id uuid primary key default gen_random_uuid(),
  nama varchar(40) not null,
  jam_masuk time,
  jam_pulang time,
  is_libur boolean not null default false,
  warna varchar(9) not null default '#2563eb',
  branch_id uuid references branches(id) on delete cascade,   -- null = semua cabang
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  -- Shift kerja wajib punya jam; shift libur justru tidak boleh punya.
  check ((is_libur and jam_masuk is null and jam_pulang is null)
      or (not is_libur and jam_masuk is not null and jam_pulang is not null))
);
alter table work_shifts enable row level security;
create policy work_shifts_all on work_shifts for all to authenticated using (true) with check (true);

comment on column work_shifts.jam_pulang is
  'Boleh lebih kecil dari jam_masuk (shift melewati tengah malam) — penggajian menanganinya.';

-- ── Jadwal: satu sel = satu karyawan pada satu tanggal ─────────────────────────
create table employee_schedules (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  tanggal date not null,
  shift_id uuid not null references work_shifts(id) on delete cascade,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (employee_id, tanggal)
);
create index on employee_schedules(tanggal);
alter table employee_schedules enable row level security;
create policy employee_schedules_all on employee_schedules for all to authenticated using (true) with check (true);

-- ── Komponen gaji tetap ────────────────────────────────────────────────────────
create table salary_components (
  id uuid primary key default gen_random_uuid(),
  nama varchar(60) not null,
  tipe varchar(10) not null check (tipe in ('tunjangan', 'potongan')),
  nominal numeric(15,2) not null default 0 check (nominal >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table salary_components enable row level security;
create policy salary_components_all on salary_components for all to authenticated using (true) with check (true);

-- nominal null = pakai nominal bawaan komponennya; diisi = khusus karyawan ini.
create table employee_salary_components (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  component_id uuid not null references salary_components(id) on delete cascade,
  nominal numeric(15,2) check (nominal >= 0),
  created_at timestamptz not null default now(),
  unique (employee_id, component_id)
);
alter table employee_salary_components enable row level security;
create policy emp_salary_components_all on employee_salary_components for all to authenticated using (true) with check (true);

-- ── Aturan gaji (singleton, pola company_settings 0057) ────────────────────────
-- Semua nominal diatur pemilik lewat layar pengaturan, tidak dipatok di kode.
-- Bawaan sengaja 0 rupiah: fitur baru tidak boleh diam-diam memotong gaji orang
-- sebelum pemilik menetapkan aturannya.
create table payroll_settings (
  id boolean primary key default true check (id),
  telat_mulai_menit int not null default 1 check (telat_mulai_menit >= 0),
  telat_blok_menit int not null default 5 check (telat_blok_menit > 0),
  telat_nominal_per_blok numeric(15,2) not null default 0 check (telat_nominal_per_blok >= 0),
  telat_maks numeric(15,2) not null default 0 check (telat_maks >= 0),
  bolos_per_hari numeric(15,2) not null default 0 check (bolos_per_hari >= 0),
  lembur_per_jam numeric(15,2) not null default 0 check (lembur_per_jam >= 0),
  updated_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into payroll_settings (id) values (true);
alter table payroll_settings enable row level security;
create policy payroll_settings_all on payroll_settings for all to authenticated using (true) with check (true);

comment on column payroll_settings.telat_maks is
  'Batas atas potongan telat per hari. 0 = tanpa batas atas.';

-- ── Lokasi cabang untuk absen ──────────────────────────────────────────────────
-- Koordinat kosong = pengecekan lokasi dimatikan untuk cabang itu, absen jalan
-- seperti sebelumnya. Fitur baru tidak boleh melumpuhkan absensi harian.
alter table branches
  add column lat numeric(10,7),
  add column lng numeric(10,7),
  add column radius_m int not null default 500 check (radius_m > 0);
