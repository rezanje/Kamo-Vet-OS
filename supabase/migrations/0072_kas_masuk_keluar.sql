-- Kas Masuk / Kas Keluar (petty cash) — spec 2026-07-30.
-- Bukan pelunasan hutang/piutang: itu tetap lewat modul hutang & piutang yang
-- terikat faktur. Tabel ini untuk uang kas yang TIDAK punya faktur — setoran
-- modal kecil, isi ulang kas kecil, beli galon, parkir, dsb.
--
-- Akun lawan disimpan sebagai KODE COA (bukan id) supaya sejalan dgn postJournal
-- yang memang memetakan baris jurnal berdasarkan code.
create table cash_entries (
  id uuid primary key default gen_random_uuid(),
  no_bukti varchar(24) not null unique,             -- KM.YYYY.MM.NNNNN / KK.YYYY.MM.NNNNN
  jenis varchar(6) not null check (jenis in ('Masuk', 'Keluar')),
  tanggal date not null default current_date,
  account_id uuid not null references cash_accounts(id) on delete restrict,
  lawan_code varchar(12) not null references coa_accounts(code),
  jumlah numeric(15,2) not null check (jumlah > 0),
  branch_id uuid references branches(id) on delete set null,
  keterangan text,
  created_by uuid references profiles(id) on delete set null,
  voided_at timestamptz,
  created_at timestamptz not null default now()
);
create index on cash_entries(tanggal);
create index on cash_entries(account_id);

alter table cash_entries enable row level security;
-- Guard peran (OWNER/ADMIN/FINANCE) ada di server action, pola cash_transfers (0068).
create policy cash_entries_all on cash_entries for all to authenticated using (true) with check (true);

comment on column cash_entries.voided_at is
  'Dibatalkan, tidak pernah dihapus. Jurnal baliknya bertanggal SAMA dengan bukti asli supaya laporan bulan lain tidak ikut bergeser.';
