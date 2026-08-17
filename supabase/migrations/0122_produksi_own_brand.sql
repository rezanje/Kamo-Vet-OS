-- Produksi own brand: bahan baku → barang jadi (permintaan Reza, meeting 14
-- Agustus; jawabannya sudah dicatat di docs/CATATAN-6-MENU-SISA-2026-08-10.md).
--
-- Sengaja BUKAN memakai racikan klinik (compounding_recipes): racikan memotong
-- stok saat transaksi berjalan dan tidak punya tahap produksi. Own brand punya
-- tahapnya sendiri — bahan keluar dulu, barang jadi masuk belakangan, dan harga
-- pokoknya terbentuk dari bahan yang benar-benar terpakai.

-- Akun antara: nilai bahan yang sudah keluar tapi barang jadinya belum masuk.
-- Tanpa akun ini, nilai persediaan ikut hilang selama proses berjalan.
insert into coa_accounts (code, name, type, normal_balance)
values ('1302', 'Persediaan Dalam Proses', 'ASET', 'D')
on conflict (code) do nothing;

-- Resep produksi = daftar bahan untuk sekian unit barang jadi.
create table if not exists production_recipes (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete restrict,   -- barang jadi
  nama varchar(120) not null,
  output_qty numeric not null default 1 check (output_qty > 0),
  is_active boolean not null default true,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists production_recipes_item_idx on production_recipes(item_id);

create table if not exists production_recipe_items (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references production_recipes(id) on delete cascade,
  item_id uuid not null references items(id) on delete restrict,   -- bahan
  qty numeric not null check (qty > 0),
  unique (recipe_id, item_id)
);

-- Perintah produksi: satu dokumen per batch.
create table if not exists production_orders (
  id uuid primary key default gen_random_uuid(),
  no_produksi varchar(30) not null unique,                          -- PRD.YYYY.MM.NNNNN
  recipe_id uuid not null references production_recipes(id) on delete restrict,
  warehouse_id uuid not null references warehouses(id) on delete restrict,
  batch numeric not null default 1 check (batch > 0),               -- kelipatan resep
  qty_jadi numeric not null default 0,                              -- diisi saat penyelesaian
  nilai_bahan numeric(15,2) not null default 0,                     -- modal bahan yang keluar
  status varchar(10) not null default 'berjalan'
    check (status in ('berjalan', 'selesai', 'batal')),
  tanggal date not null default current_date,
  tanggal_selesai date,
  catatan text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists production_orders_status_idx on production_orders(status);

-- Bahan yang BENAR-BENAR keluar untuk perintah ini (snapshot + modal riil FIFO).
create table if not exists production_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references production_orders(id) on delete cascade,
  item_id uuid not null references items(id) on delete restrict,
  nama varchar(160) not null,
  qty numeric not null default 0,
  hpp numeric(15,2) not null default 0
);
create index if not exists production_order_items_order_idx on production_order_items(order_id);

alter table production_recipes enable row level security;
alter table production_recipe_items enable row level security;
alter table production_orders enable row level security;
alter table production_order_items enable row level security;

drop policy if exists prod_recipes_all on production_recipes;
create policy prod_recipes_all on production_recipes for all to authenticated using (true) with check (true);
drop policy if exists prod_recipe_items_all on production_recipe_items;
create policy prod_recipe_items_all on production_recipe_items for all to authenticated using (true) with check (true);
drop policy if exists prod_orders_all on production_orders;
create policy prod_orders_all on production_orders for all to authenticated using (true) with check (true);
drop policy if exists prod_order_items_all on production_order_items;
create policy prod_order_items_all on production_order_items for all to authenticated using (true) with check (true);

comment on table production_recipes is
  'Resep produksi own brand: bahan apa saja untuk menghasilkan output_qty barang jadi.';
comment on column production_orders.nilai_bahan is
  'Modal bahan yang keluar (FIFO riil). Harga pokok barang jadi = nilai ini ÷ qty jadi.';
