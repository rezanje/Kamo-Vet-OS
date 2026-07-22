-- Retur Pembelian & Retur Penjualan — kloning Accurate (lean)
-- (spec: docs/superpowers/specs/2026-07-23-retur-design.md)
-- Retur beli: potong hutang pemasok. Retur jual: refund tunai kasir (via expenses).

create table purchase_returns (
  id uuid primary key default gen_random_uuid(),
  no_retur varchar(30) not null unique,           -- RB.YYYY.MM.NNNNN
  po_id uuid not null references purchase_orders(id) on delete restrict,
  tanggal date not null default current_date,
  keterangan text,
  total numeric not null default 0,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on purchase_returns(po_id);

create table purchase_return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references purchase_returns(id) on delete cascade,
  item_id uuid references items(id) on delete set null,
  nama varchar(160) not null,
  qty numeric not null check (qty > 0),
  harga numeric not null default 0
);
create index on purchase_return_items(return_id);

create table sales_returns (
  id uuid primary key default gen_random_uuid(),
  no_retur varchar(30) not null unique,           -- RJ.YYYY.MM.NNNNN
  sale_id uuid not null references sales(id) on delete restrict,
  tanggal date not null default current_date,
  keterangan text,
  total numeric not null default 0,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on sales_returns(sale_id);

create table sales_return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references sales_returns(id) on delete cascade,
  item_id uuid references items(id) on delete set null,
  nama varchar(160) not null,
  qty numeric not null check (qty > 0),
  harga numeric not null default 0
);
create index on sales_return_items(return_id);

alter table purchase_returns enable row level security;
alter table purchase_return_items enable row level security;
alter table sales_returns enable row level security;
alter table sales_return_items enable row level security;

-- demo posture, ikut 0025/0032.
create policy pr_all on purchase_returns for all to authenticated using (true) with check (true);
create policy pri_all on purchase_return_items for all to authenticated using (true) with check (true);
create policy sr2_all on sales_returns for all to authenticated using (true) with check (true);
create policy sri2_all on sales_return_items for all to authenticated using (true) with check (true);
