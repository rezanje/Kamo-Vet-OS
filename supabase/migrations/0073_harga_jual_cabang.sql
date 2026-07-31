-- Harga jual per cabang — permintaan klien 2026-07-31.
-- items.sell_price / item_units.sell_price tetap jadi harga "Semua Cabang".
-- Tabel ini HANYA menyimpan pengecualian: cabang yang harganya beda.
-- Kosong = cabang itu ikut harga pusat, jadi tidak ada baris kembar untuk
-- ribuan barang × belasan cabang yang harganya sebenarnya sama.

create table item_branch_prices (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete cascade,
  unit varchar(20) not null,                         -- satuan dasar ATAU turunan
  sell_price numeric(15,2) not null check (sell_price >= 0),
  updated_at timestamptz not null default now(),
  unique (item_id, branch_id, unit)
);
create index on item_branch_prices(branch_id);

alter table item_branch_prices enable row level security;
-- Guard peran (OWNER/ADMIN) ada di server action harga jual, sama pola dgn item_units.
create policy ibp_all on item_branch_prices for all to authenticated using (true) with check (true);

comment on table item_branch_prices is
  'Override harga jual per cabang. Tidak ada baris = cabang ikut harga Semua Cabang.';
