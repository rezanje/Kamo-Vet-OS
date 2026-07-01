-- Keuangan: rekonsiliasi bank (saldo-level) + akun bank charge/bunga

-- akun baru untuk penyesuaian bank
insert into coa_accounts (code, name, type, normal_balance) values
  ('5501','Beban Administrasi Bank','BEBAN','D'),
  ('4301','Pendapatan Bunga Bank','PENDAPATAN','K')
on conflict (code) do nothing;

create table bank_reconciliations (
  id uuid primary key default gen_random_uuid(),
  tanggal date not null default current_date,
  saldo_buku numeric not null default 0,   -- snapshot saldo akun Bank (1102) saat rekon
  saldo_bank numeric not null default 0,    -- dari rekening koran
  biaya_adm numeric not null default 0,
  bunga numeric not null default 0,
  selisih numeric not null default 0,       -- saldo_bank - (saldo_buku + bunga - biaya_adm)
  catatan text,
  created_at timestamptz not null default now()
);
create index on bank_reconciliations(tanggal);
alter table bank_reconciliations enable row level security;
create policy bankrec_all on bank_reconciliations for all to authenticated using (true) with check (true);
