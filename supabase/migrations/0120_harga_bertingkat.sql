-- Harga jual bertingkat menurut jumlah beli (permintaan Bu Nisa, meeting 14
-- Agustus: "seperti Accurate").
--
-- Beda dengan satuan berjenjang (item_units): itu soal kemasan (dus vs pcs, harga
-- per kemasan). Ini soal VOLUME dalam satuan yang sama — beli 1 botol Rp35.000,
-- beli 12 botol jadi Rp32.000 per botol, tanpa harus membuat kemasan palsu.
create table if not exists item_price_tiers (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete cascade,
  min_qty numeric not null check (min_qty > 0),
  harga numeric(15,2) not null check (harga >= 0),
  created_at timestamptz not null default now(),
  unique (item_id, min_qty)
);
create index if not exists item_price_tiers_item_idx on item_price_tiers(item_id);

alter table item_price_tiers enable row level security;
drop policy if exists item_price_tiers_read on item_price_tiers;
create policy item_price_tiers_read on item_price_tiers
  for select to authenticated using (true);
-- Harga adalah master data: yang boleh mengubah sama dengan yang boleh mengubah
-- barang (OWNER/ADMIN), ditegakkan lagi di server action.
drop policy if exists item_price_tiers_write on item_price_tiers;
create policy item_price_tiers_write on item_price_tiers
  for all to authenticated using (true) with check (true);

comment on table item_price_tiers is
  'Harga jual bertingkat per jumlah: beli >= min_qty (satuan dasar) memakai harga ini.';
