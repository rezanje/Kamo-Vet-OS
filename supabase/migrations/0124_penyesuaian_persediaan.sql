-- Penyesuaian Persediaan: dokumen bernomor untuk koreksi stok (S2).
--
-- Sebelum ini koreksi stok dilakukan lewat form cepat di layar Stok per Gudang.
-- Jurnalnya sudah benar sejak 12 Agustus (lawan 5902, bukan 2101), tapi tidak ada
-- dokumennya: tidak bernomor, alasannya cuma teks bebas yang boleh kosong, dan
-- tidak ada satu layar pun yang bisa menjawab "bulan ini berapa barang hilang".
--
-- Nilainya sengaja MODAL (HPP), bukan harga jual. Ini beda kasus dengan selisih
-- stok opname yang menurut keputusan meeting 14 Agustus ditagihkan ke kepala toko
-- lewat faktur penjualan: barang rusak/kadaluarsa adalah kerugian perusahaan
-- sebesar modalnya, bukan penjualan yang tidak tertagih.

create table if not exists inventory_adjustments (
  id uuid primary key default gen_random_uuid(),
  no_adj varchar(30) not null unique,                               -- PS.YYYY.MM.NNNNN
  warehouse_id uuid not null references warehouses(id) on delete restrict,
  tanggal date not null default current_date,
  alasan varchar(12) not null
    check (alasan in ('rusak', 'hilang', 'kadaluarsa', 'temuan', 'lainnya')),
  keterangan text,
  nilai_masuk numeric(15,2) not null default 0,                     -- modal barang yang bertambah
  nilai_keluar numeric(15,2) not null default 0,                    -- modal barang yang berkurang
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists inventory_adjustments_wh_idx on inventory_adjustments(warehouse_id);
create index if not exists inventory_adjustments_tgl_idx on inventory_adjustments(tanggal);

-- Snapshot per barang: qty sistem saat dokumen dibuat ikut disimpan supaya
-- dokumennya tetap terbaca utuh walau stoknya berubah lagi setelahnya.
create table if not exists inventory_adjustment_items (
  id uuid primary key default gen_random_uuid(),
  adjustment_id uuid not null references inventory_adjustments(id) on delete cascade,
  item_id uuid not null references items(id) on delete restrict,
  nama varchar(160) not null,
  qty_sistem numeric not null default 0,
  qty_baru numeric not null default 0,
  selisih numeric not null default 0,
  nilai numeric(15,2) not null default 0,                           -- modal riil selisih ini
  unique (adjustment_id, item_id)
);

alter table inventory_adjustments enable row level security;
alter table inventory_adjustment_items enable row level security;
create policy invadj_all on inventory_adjustments for all to authenticated using (true) with check (true);
create policy invadji_all on inventory_adjustment_items for all to authenticated using (true) with check (true);
