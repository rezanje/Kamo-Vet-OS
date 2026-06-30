-- POS Fase 1: penjualan + atribusi pelanggan (§1.3) + poin ledger (§1.4)

-- §1.3: kategori spesies target produk (cocok dgn pets.species: Kucing/Anjing/Universal).
alter table items add column target_species varchar(12) not null default 'Universal';

create table sales (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id) on delete restrict,
  customer_id uuid references customers(id) on delete set null,
  pet_id uuid references pets(id) on delete set null,         -- §1.3 tag anabul (opsional)
  no_struk varchar(24) unique,
  subtotal numeric not null default 0,
  discount numeric not null default 0,
  total numeric not null default 0,
  metode_bayar varchar(16) not null default 'Tunai',
  bayar numeric not null default 0,
  kembali numeric not null default 0,
  poin_earned int not null default 0,
  cashier_id uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on sales(branch_id);
create index on sales(customer_id);

create table sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references sales(id) on delete cascade,
  item_id uuid references items(id) on delete set null,
  nama varchar(160) not null,
  qty int not null default 1,
  harga numeric not null default 0,
  target_species varchar(12) not null default 'Universal',    -- §1.3 snapshot saat jual
  created_at timestamptz not null default now()
);
create index on sale_items(sale_id);

-- §1.4: ledger poin dgn saldo berjalan + referensi struk.
create table point_ledger (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  delta int not null,
  saldo int not null,
  ref varchar(24),
  description varchar(160),
  created_at timestamptz not null default now()
);
create index on point_ledger(customer_id);

alter table sales enable row level security;
alter table sale_items enable row level security;
alter table point_ledger enable row level security;

create policy sales_all on sales for all to authenticated
  using (public.user_can_access_branch(branch_id))
  with check (public.user_can_access_branch(branch_id));

create policy sale_items_all on sale_items for all to authenticated
  using (exists (select 1 from sales s where s.id = sale_items.sale_id and public.user_can_access_branch(s.branch_id)))
  with check (exists (select 1 from sales s where s.id = sale_items.sale_id and public.user_can_access_branch(s.branch_id)));

-- ponytail: ledger dibaca/ditulis semua authenticated (pelanggan global, bukan per-cabang).
create policy point_ledger_all on point_ledger for all to authenticated using (true) with check (true);
