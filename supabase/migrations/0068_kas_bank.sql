-- Modul Kas & Bank: master rekening + transfer antar rekening — spec 2026-07-29.
--
-- Satu rekening = satu akun COA supaya neraca, buku besar, dan rekonsiliasi bisa
-- dibaca PER REKENING. Kalau semua bank ditumpuk di satu akun, BCA dan Mandiri
-- tidak bisa dipisah dan rekonsiliasi bank jadi mustahil.
--
-- Dua baris seed memetakan akun 1101/1102 yang sudah dipakai ~20 server action
-- (kasir, klinik, gaji, pembelian, ...). Tanpa itu, saldo transaksi berjalan
-- tidak akan muncul di layar rekening.
--
-- Kondisi sebelum migrasi (2026-07-29): coa_accounts=30, journal_entries=63,
-- journal_lines=157, kode 11xx terpakai = 1101, 1102, 1105 (PPN Masukan).

create table cash_accounts (
  id uuid primary key default gen_random_uuid(),
  nama varchar(80) not null,
  jenis varchar(8) not null check (jenis in ('Kas', 'Bank')),
  coa_code varchar(12) not null unique references coa_accounts(code),
  bank_nama varchar(60),
  no_rekening varchar(40),
  branch_id uuid references branches(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table cash_accounts enable row level security;
-- Guard peran (OWNER/ADMIN) ada di server action, pola brands/units (0065/0066).
create policy cash_accounts_all on cash_accounts for all to authenticated using (true) with check (true);

insert into cash_accounts (nama, jenis, coa_code, bank_nama) values
  ('Kas', 'Kas', '1101', null),
  ('Bank BCA', 'Bank', '1102', 'BCA');

create table cash_transfers (
  id uuid primary key default gen_random_uuid(),
  no_transfer varchar(24) not null unique,          -- TF.YYYY.MM.NNNNN
  tanggal date not null default current_date,
  from_account_id uuid not null references cash_accounts(id) on delete restrict,
  to_account_id uuid not null references cash_accounts(id) on delete restrict,
  jumlah numeric(15,2) not null check (jumlah > 0),
  biaya_admin numeric(15,2) not null default 0 check (biaya_admin >= 0),
  branch_id uuid references branches(id) on delete set null,
  keterangan text,
  created_by uuid references profiles(id) on delete set null,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  check (from_account_id <> to_account_id)
);
create index on cash_transfers(tanggal);
create index on cash_transfers(from_account_id);
create index on cash_transfers(to_account_id);

alter table cash_transfers enable row level security;
create policy cash_transfers_all on cash_transfers for all to authenticated using (true) with check (true);

comment on column cash_transfers.biaya_admin is
  'Biaya admin bank, ditanggung rekening SUMBER: kredit sumber = jumlah + biaya_admin, debit 5501 = biaya_admin.';
comment on column cash_transfers.voided_at is
  'Transfer dibatalkan, tidak pernah dihapus. Jurnal baliknya bertanggal SAMA dengan transfer asli supaya laporan bulan lain tidak ikut bergeser.';
