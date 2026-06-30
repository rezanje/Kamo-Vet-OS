-- Stok level per gudang (PRD Inventory)
create table stock (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references warehouses(id) on delete cascade,
  item_id uuid not null references items(id) on delete cascade,
  qty numeric not null default 0,
  updated_at timestamptz not null default now(),
  unique(warehouse_id, item_id)
);
create index on stock(warehouse_id);
alter table stock enable row level security;
-- gate lewat warehouse -> branch
create policy stock_all on stock for all to authenticated
  using (exists (select 1 from warehouses w where w.id = stock.warehouse_id and public.user_can_access_branch(w.branch_id)))
  with check (exists (select 1 from warehouses w where w.id = stock.warehouse_id and public.user_can_access_branch(w.branch_id)));
