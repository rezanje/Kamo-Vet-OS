-- Diskon golongan pelanggan per produk / per kategori produk — spec 2026-08-01.
--
-- Sebelum ini satu golongan hanya punya SATU angka diskon yang berlaku rata ke
-- semua barang (customer_categories.diskon_persen, migrasi 0066). Permintaan
-- tim: golongan seperti B2B perlu diskon berbeda per kategori produk atau per
-- produk tertentu — margin pakan tidak sama dengan margin obat.
--
-- Angka lama TIDAK dipindah ke sini: dia tetap jadi diskon DASAR golongan.
-- Tabel ini isinya PENGECUALIAN saja, jadi mengosongkan tabel ini mengembalikan
-- perilaku persis seperti sebelumnya.

create table category_discounts (
  id uuid primary key default gen_random_uuid(),
  customer_category_id uuid not null references customer_categories(id) on delete cascade,
  -- Tepat SATU dari dua kolom ini terisi: aturan berlaku untuk satu produk,
  -- atau untuk satu kategori produk.
  item_id          uuid references items(id) on delete cascade,
  item_category_id uuid references item_categories(id) on delete cascade,
  diskon_persen numeric(5,2) not null check (diskon_persen >= 0 and diskon_persen <= 100),
  created_at timestamptz not null default now(),

  constraint catdisc_satu_sasaran check (
    (item_id is not null and item_category_id is null)
    or (item_id is null and item_category_id is not null)
  )
);

-- Satu golongan tidak boleh punya dua aturan untuk sasaran yang sama — kalau
-- boleh, angka mana yang menang jadi tidak deterministik.
create unique index catdisc_produk_unik
  on category_discounts (customer_category_id, item_id) where item_id is not null;
create unique index catdisc_kategori_unik
  on category_discounts (customer_category_id, item_category_id) where item_category_id is not null;

create index on category_discounts(customer_category_id);

alter table category_discounts enable row level security;
-- Guard peran (OWNER/ADMIN) ada di server action, sama pola dgn customer_categories.
create policy catdisc_all on category_discounts for all to authenticated using (true) with check (true);

comment on table category_discounts is
  'Pengecualian diskon golongan pelanggan. Urutan menang: per produk → per kategori produk → per kategori induk → diskon dasar golongan.';
