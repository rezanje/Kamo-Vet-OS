-- Pemindahan Barang antar gudang — kloning Accurate "Pemindahan Barang"
-- (spec: docs/superpowers/specs/2026-07-22-pemindahan-barang-design.md)
-- Pola: Kirim Barang (stok: asal -> Transit) lalu Terima Barang (Transit -> tujuan).

create type transfer_proses as enum ('Kirim Barang','Terima Barang');
create type transfer_status as enum ('Sedang dikirim','Diterima Sebagian','Diterima Seluruhnya','Dibatalkan');

create table stock_transfers (
  id uuid primary key default gen_random_uuid(),
  no_pemindahan varchar(30) not null unique,      -- IT.YYYY.MM.NNNNN (format Accurate)
  proses transfer_proses not null,
  tanggal date not null default current_date,
  from_warehouse_id uuid not null references warehouses(id) on delete restrict,
  to_warehouse_id uuid not null references warehouses(id) on delete restrict,
  keterangan text,
  -- status hanya dipakai dokumen Kirim; dokumen Terima ikut status induknya.
  status transfer_status,
  -- dokumen Terima merujuk dokumen Kirim yang dipenuhi.
  source_transfer_id uuid references stock_transfers(id) on delete set null,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on stock_transfers(from_warehouse_id);
create index on stock_transfers(to_warehouse_id);
create index on stock_transfers(source_transfer_id);
create index on stock_transfers(tanggal);

create table stock_transfer_items (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references stock_transfers(id) on delete cascade,
  item_id uuid not null references items(id) on delete restrict,
  qty numeric not null check (qty > 0)
);
create index on stock_transfer_items(transfer_id);

alter table stock_transfers enable row level security;
alter table stock_transfer_items enable row level security;

-- demo posture, ikut 0025/0032: semua authenticated boleh (gudang Transit lintas cabang).
create policy stf_all on stock_transfers for all to authenticated using (true) with check (true);
create policy stfi_all on stock_transfer_items for all to authenticated using (true) with check (true);
