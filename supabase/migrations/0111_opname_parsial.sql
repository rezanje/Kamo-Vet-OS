-- Stok opname parsial — permintaan Aldi 2026-08-12.
-- Sampai sekarang satu perintah opname selalu berarti "hitung SELURUH gudang".
-- Toko besar tidak sanggup menutup lapak untuk itu; yang dibutuhkan adalah
-- menghitung sebagian barang (mis. rak obat saja) tanpa menyentuh sisanya.
--
-- Lingkup disimpan sebagai daftar barang. Perintah TANPA baris di sini tetap
-- berarti seluruh gudang, jadi semua perintah lama tidak berubah artinya.
create table if not exists opname_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references opname_orders(id) on delete cascade,
  item_id uuid not null references items(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (order_id, item_id)
);

create index if not exists opname_order_items_order_idx on opname_order_items(order_id);

alter table opname_order_items enable row level security;
create policy opname_order_items_all on opname_order_items
  for all to authenticated using (true) with check (true);

comment on table opname_order_items is
  'Lingkup barang yang dihitung pada opname parsial. Kosong = seluruh gudang.';
