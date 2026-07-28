-- Satuan berjenjang (pcs↔box, gr↔kg↔sak, ml↔btl) — spec 2026-07-28.
-- items.unit tetap SATUAN DASAR (faktor 1) & satu-satunya satuan stok. Turunan
-- disimpan di sini dgn faktor = isi dalam satuan dasar, plus harga sendiri:
-- harga box tidak selalu 12× harga pcs, jadi harga dieksplisitkan bukan dihitung.
create table item_units (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete cascade,
  unit varchar(20) not null,
  factor numeric(15,4) not null check (factor > 0),
  sell_price numeric(15,2) not null default 0,
  buy_price numeric(15,2) not null default 0,
  created_at timestamptz not null default now(),
  unique (item_id, unit)
);
create index on item_units(item_id);

alter table item_units enable row level security;
-- Guard peran (OWNER/ADMIN) ada di server action master SKU, sama pola dgn items_insert.
create policy item_units_all on item_units for all to authenticated using (true) with check (true);

-- Baris transaksi menyimpan qty & harga DALAM SATUAN YANG DIPILIH (biar struk/PO
-- cocok dgn yang diketik kasir dan total = qty × harga persis, tanpa pembagian).
-- faktor dipakai saat konversi ke stok: qty_stok = qty × faktor.
alter table sale_items
  add column satuan varchar(20),
  add column faktor numeric(15,4) not null default 1;

alter table purchase_order_items
  add column satuan varchar(20),
  add column faktor numeric(15,4) not null default 1;

-- prescription_items.satuan sudah ada sejak 0040; tinggal faktornya.
alter table prescription_items
  add column faktor numeric(15,4) not null default 1;

alter table compounding_ingredients
  add column faktor numeric(15,4) not null default 1;

comment on column item_units.factor is
  'Isi 1 satuan ini dalam satuan dasar items.unit. Contoh: box→12 (pcs), sak→25000 (gr).';
