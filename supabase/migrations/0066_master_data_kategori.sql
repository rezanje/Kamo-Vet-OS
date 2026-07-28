-- Master data & kategori ala Accurate — spec 2026-07-28.
-- Enam master: satuan global, kategori barang bertingkat, kategori pemasok,
-- kategori aset (umur + akun jurnal), kategori pelanggan (diskon persen).
-- Merek sudah lahir di 0065.
--
-- Prinsip backfill: nol data hilang. Nilai teks bebas yang sudah keburu diisi
-- dipetakan ke master baru; baris transaksi historis TIDAK disentuh.
--
-- Kondisi sebelum migrasi (2026-07-28): items=18, item_units=1, satuan unik=2
-- (pcs, tindakan; item_units: box), customers berkategori=32 (Umum 28, Member 4),
-- fixed_assets=1 (kategori 'Peralatan'), stock_layers.qty_left=432, stock.qty=430.

-- ── 1. Satuan Barang (master global) ────────────────────────────────────────
create table units (
  id uuid primary key default gen_random_uuid(),
  nama varchar(20) not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table units enable row level security;
-- Guard peran (OWNER/ADMIN) ada di server action, sama pola dgn brands (0065).
create policy units_all on units for all to authenticated using (true) with check (true);

insert into units (nama)
select distinct lower(btrim(u)) from (
  select unit as u from items where unit is not null and btrim(unit) <> ''
  union all
  select unit as u from item_units where unit is not null and btrim(unit) <> ''
) s
on conflict (nama) do nothing;

-- Normalisasi bisa bentrok dgn unique(item_id, unit) kalau satu barang punya
-- "Box" dan "box" sekaligus — buang baris yang lebih baru dulu, deterministik.
delete from item_units a using item_units b
where a.item_id = b.item_id
  and lower(btrim(a.unit)) = lower(btrim(b.unit))
  and (a.created_at, a.id) > (b.created_at, b.id);

-- Nilai master dinormalkan. sale_items.satuan / purchase_order_items.satuan /
-- prescription_items.satuan SENGAJA dibiarkan: itu catatan historis.
update items set unit = lower(btrim(unit)) where unit is distinct from lower(btrim(unit));
update item_units set unit = lower(btrim(unit)) where unit is distinct from lower(btrim(unit));

-- ── 2. Kategori Barang bertingkat (2 tingkat) ───────────────────────────────
-- Batas 2 tingkat ditegakkan di server action (satu pintu tulis), bukan trigger.
alter table item_categories
  add column parent_id uuid references item_categories(id) on delete restrict,
  add column is_active boolean not null default true;
create index on item_categories(parent_id);
comment on column item_categories.parent_id is
  'Induk kategori. NULL = kategori ini induk. Maksimum 2 tingkat (induk → anak).';

-- ── 3. Kategori Pemasok ────────────────────────────────────────────────────
create table supplier_categories (
  id uuid primary key default gen_random_uuid(),
  nama varchar(60) not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table supplier_categories enable row level security;
create policy supcat_all on supplier_categories for all to authenticated using (true) with check (true);

insert into supplier_categories (nama) values ('Obat'), ('Pakan'), ('Alat'), ('Jasa');

alter table suppliers
  add column category_id uuid references supplier_categories(id) on delete set null;

-- ── 4. Kategori Aset ───────────────────────────────────────────────────────
create table asset_categories (
  id uuid primary key default gen_random_uuid(),
  nama varchar(60) not null unique,
  umur_bulan int not null check (umur_bulan > 0),
  akun_beban varchar(10) not null default '5601',
  akun_akumulasi varchar(10) not null default '1509',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table asset_categories enable row level security;
create policy asetcat_all on asset_categories for all to authenticated using (true) with check (true);

insert into asset_categories (nama, umur_bulan) values
  ('Peralatan', 48), ('Inventaris Kantor', 48), ('Kendaraan', 96), ('Bangunan', 240);

alter table fixed_assets
  add column category_id uuid references asset_categories(id) on delete set null;

-- fixed_assets.kategori (teks) dibiarkan sebagai jejak historis.
update fixed_assets f set category_id = c.id
from asset_categories c where c.nama = f.kategori;

-- ── 5. Kategori Pelanggan + diskon ─────────────────────────────────────────
create table customer_categories (
  id uuid primary key default gen_random_uuid(),
  nama varchar(60) not null unique,
  diskon_persen numeric(5,2) not null default 0
    check (diskon_persen >= 0 and diskon_persen <= 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table customer_categories enable row level security;
create policy custcat_all on customer_categories for all to authenticated using (true) with check (true);

-- Daftar tetap lama (0042: Umum/Member/B2B/Rescuer) dinaikkan jadi master.
insert into customer_categories (nama) values ('Umum'), ('Member'), ('B2B'), ('Rescuer');

alter table customers
  add column category_id uuid references customer_categories(id) on delete set null;

update customers c set category_id = k.id
from customer_categories k where k.nama = c.kategori;

alter table sales add column diskon_kategori numeric not null default 0;
comment on column sales.diskon_kategori is
  'Diskon dari golongan pelanggan, dihitung server dari customer_categories.diskon_persen. Terpisah dari sales.discount (diskon manual kasir/promo).';
