-- Anggaran, Monitor Anggaran, dan Transfer Anggaran (tiga tile terakhir Buku Besar).
--
-- Sekarang beban cuma bisa dilihat setelah terjadi. Tidak ada angka pembanding, jadi
-- tidak ada cara tahu satu pos sudah kebobolan sebelum tutup buku. Anggaran menaruh
-- batas di depan, monitor menunjukkan serapannya berjalan.

create table budgets (
  id uuid primary key default gen_random_uuid(),
  periode varchar(7) not null,                          -- YYYY-MM
  coa_code varchar(12) not null references coa_accounts(code) on delete cascade,
  branch_id uuid references branches(id) on delete cascade,   -- null = seluruh perusahaan
  jumlah numeric(15,2) not null check (jumlah >= 0),
  catatan text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (periode ~ '^\d{4}-\d{2}$')
);
-- nulls not distinct: anggaran "seluruh perusahaan" ikut dianggap satu kombinasi,
-- supaya tidak bisa dibuat dua kali untuk akun & periode yang sama.
create unique index budgets_unik on budgets (periode, coa_code, branch_id) nulls not distinct;
create index on budgets(periode);

alter table budgets enable row level security;
create policy budgets_all on budgets for all to authenticated using (true) with check (true);

-- Geser jatah antar pos tanpa mengubah total anggaran periode itu. Disimpan sebagai
-- dokumen sendiri, bukan menimpa angka anggaran aslinya — kalau ditimpa, jejak
-- "pos ini dulu dianggarkan berapa" hilang dan pergeserannya tidak bisa diaudit.
create table budget_transfers (
  id uuid primary key default gen_random_uuid(),
  periode varchar(7) not null,
  dari_coa varchar(12) not null references coa_accounts(code) on delete restrict,
  ke_coa varchar(12) not null references coa_accounts(code) on delete restrict,
  branch_id uuid references branches(id) on delete cascade,
  jumlah numeric(15,2) not null check (jumlah > 0),
  alasan text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (dari_coa <> ke_coa),
  check (periode ~ '^\d{4}-\d{2}$')
);
create index on budget_transfers(periode);

alter table budget_transfers enable row level security;
create policy budget_transfers_all on budget_transfers for all to authenticated using (true) with check (true);

comment on table budget_transfers is
  'Pergeseran jatah anggaran antar akun dalam satu periode. Tidak menyentuh jurnal — ini rencana, bukan transaksi.';
