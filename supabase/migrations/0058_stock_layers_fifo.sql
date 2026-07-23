-- HPP FIFO — cost layers per gudang per barang (PRD §10.2)
-- (spec: docs/superpowers/specs/2026-07-24-hpp-fifo-design.md)

create table stock_layers (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references warehouses(id) on delete cascade,
  item_id uuid not null references items(id) on delete cascade,
  tanggal date not null default current_date,
  qty_in numeric not null check (qty_in > 0),
  qty_left numeric not null check (qty_left >= 0),
  unit_cost numeric not null default 0,
  source varchar(24) not null,                    -- purchase/saldo-awal/transfer-in/retur-jual/opname/manual
  source_ref varchar(40),
  created_at timestamptz not null default now()
);
create index stock_layers_open on stock_layers(item_id, warehouse_id) where qty_left > 0;

alter table stock_layers enable row level security;
create policy slay_all on stock_layers for all to authenticated using (true) with check (true);

-- Bootstrap: stok existing jadi 1 layer saldo-awal @ buy_price (nilai buku tidak berubah).
insert into stock_layers (warehouse_id, item_id, tanggal, qty_in, qty_left, unit_cost, source, source_ref)
select s.warehouse_id, s.item_id, current_date, s.qty, s.qty, coalesce(i.buy_price, 0), 'saldo-awal', 'migrasi-0058'
from stock s join items i on i.id = s.item_id
where s.qty > 0;
