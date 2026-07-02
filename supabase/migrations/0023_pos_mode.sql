-- POS kasir mode: redeem poin + voucher + draft transaksi

alter table sales
  add column poin_digunakan int not null default 0,
  add column voucher_code varchar(24);

-- draft keranjang kasir (dilanjutkan/dibuang oleh kasir).
create table sale_drafts (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references branches(id) on delete cascade,
  cashier_id uuid references profiles(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  cart jsonb not null default '[]',
  created_at timestamptz not null default now()
);
alter table sale_drafts enable row level security;
create policy sale_drafts_all on sale_drafts for all to authenticated using (true) with check (true);

-- voucher sederhana (nominal atau persen).
create table vouchers (
  id uuid primary key default gen_random_uuid(),
  code varchar(24) unique not null,
  tipe varchar(8) not null default 'nominal',  -- nominal / persen
  nilai numeric not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table vouchers enable row level security;
create policy vouchers_all on vouchers for all to authenticated using (true) with check (true);
