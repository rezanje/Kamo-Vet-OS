-- HRIS fase 3: pengajuan lembur, kasbon, dan reimburse oleh staf.
-- Spec docs/superpowers/specs/2026-08-02-hris-gaji-otomatis-design.md
--
-- Keputusan boss: lembur HARUS diajukan & disetujui (bukan otomatis dari jam pulang),
-- kasbon BOLEH dicicil beberapa bulan (tenor ditentukan saat menyetujui).

-- Piutang karyawan: kasbon yang sudah cair tapi belum lunas dipotong dari gaji.
insert into coa_accounts (code, name, type, normal_balance)
values ('1203', 'Piutang Karyawan (Kasbon)', 'ASET', 'D')
on conflict (code) do nothing;

-- ── Lembur ─────────────────────────────────────────────────────────────────────
create table overtime_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  tanggal date not null,
  jam numeric(5,2) not null check (jam > 0 and jam <= 24),
  alasan text,
  status varchar(12) not null default 'Menunggu' check (status in ('Menunggu', 'Disetujui', 'Ditolak')),
  catatan_penyetuju text,
  approved_by uuid references profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  -- Satu pengajuan per karyawan per tanggal: kalau kurang, ajukan ulang setelah ditolak.
  unique (employee_id, tanggal)
);
create index on overtime_requests(status);
alter table overtime_requests enable row level security;
create policy overtime_requests_all on overtime_requests for all to authenticated using (true) with check (true);

-- ── Kasbon ─────────────────────────────────────────────────────────────────────
create table cash_advances (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  tanggal date not null default current_date,
  jumlah numeric(15,2) not null check (jumlah > 0),
  tenor_bulan int not null default 1 check (tenor_bulan between 1 and 24),
  alasan text,
  status varchar(12) not null default 'Menunggu' check (status in ('Menunggu', 'Disetujui', 'Ditolak', 'Lunas')),
  catatan_penyetuju text,
  approved_by uuid references profiles(id) on delete set null,
  approved_at timestamptz,
  -- Kasbon baru menjadi utang karyawan saat uangnya benar-benar keluar.
  disbursed_at timestamptz,
  cash_account_id uuid references cash_accounts(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on cash_advances(employee_id);
create index on cash_advances(status);
alter table cash_advances enable row level security;
create policy cash_advances_all on cash_advances for all to authenticated using (true) with check (true);

-- Jejak cicilan yang sudah dipotong lewat slip gaji. Satu baris per periode,
-- supaya sisa utang bisa dihitung tanpa menebak dan slip lama tetap benar.
create table cash_advance_installments (
  id uuid primary key default gen_random_uuid(),
  advance_id uuid not null references cash_advances(id) on delete cascade,
  periode varchar(7) not null,                    -- YYYY-MM
  jumlah numeric(15,2) not null check (jumlah > 0),
  created_at timestamptz not null default now(),
  unique (advance_id, periode)
);
alter table cash_advance_installments enable row level security;
create policy cash_advance_inst_all on cash_advance_installments for all to authenticated using (true) with check (true);

-- ── Reimburse ──────────────────────────────────────────────────────────────────
create table reimbursements (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  tanggal date not null default current_date,
  kategori varchar(40) not null,
  jumlah numeric(15,2) not null check (jumlah > 0),
  keterangan text,
  status varchar(12) not null default 'Menunggu' check (status in ('Menunggu', 'Disetujui', 'Ditolak', 'Dibayar')),
  catatan_penyetuju text,
  approved_by uuid references profiles(id) on delete set null,
  approved_at timestamptz,
  -- Diisi saat ikut terbayar lewat penggajian periode itu.
  paid_periode varchar(7),
  created_at timestamptz not null default now()
);
create index on reimbursements(status);
alter table reimbursements enable row level security;
create policy reimbursements_all on reimbursements for all to authenticated using (true) with check (true);
