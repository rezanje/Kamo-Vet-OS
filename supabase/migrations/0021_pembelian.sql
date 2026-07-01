-- Pembelian: supplier + purchase order + penerimaan
create table suppliers (
  id uuid primary key default gen_random_uuid(),
  nama varchar(100) not null,
  kontak varchar(60),
  telp varchar(20),
  alamat text,
  created_at timestamptz not null default now()
);
create type po_status as enum ('Draft','Dipesan','Diterima','Batal');
create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  no_po varchar(24) unique,
  supplier_id uuid references suppliers(id) on delete set null,
  to_warehouse_id uuid references warehouses(id) on delete set null,
  branch_id uuid references branches(id) on delete set null,
  tanggal date not null default current_date,
  status po_status not null default 'Draft',
  total numeric not null default 0,
  created_at timestamptz not null default now()
);
create index on purchase_orders(branch_id);
create table purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references purchase_orders(id) on delete cascade,
  item_id uuid references items(id) on delete set null,
  nama varchar(160) not null,
  qty numeric not null default 0,
  harga_beli numeric not null default 0,
  created_at timestamptz not null default now()
);
create index on purchase_order_items(po_id);
alter table suppliers enable row level security;
alter table purchase_orders enable row level security;
alter table purchase_order_items enable row level security;
create policy suppliers_all on suppliers for all to authenticated using (true) with check (true);
create policy po_all on purchase_orders for all to authenticated
  using (branch_id is null or public.user_can_access_branch(branch_id))
  with check (branch_id is null or public.user_can_access_branch(branch_id));
create policy poi_all on purchase_order_items for all to authenticated
  using (exists (select 1 from purchase_orders p where p.id = purchase_order_items.po_id and (p.branch_id is null or public.user_can_access_branch(p.branch_id))))
  with check (exists (select 1 from purchase_orders p where p.id = purchase_order_items.po_id and (p.branch_id is null or public.user_can_access_branch(p.branch_id))));
