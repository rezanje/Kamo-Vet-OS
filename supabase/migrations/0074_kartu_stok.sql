-- Kartu stok / mutasi barang — permintaan klien 2026-07-31.
-- stock_layers cuma menyimpan sisa lapisan FIFO, jadi riwayat "kapan keluar,
-- lewat dokumen apa" hilang begitu layer habis. Tabel ini mencatat SETIAP mutasi
-- apa adanya (+ masuk / − keluar) supaya selisih stok bisa ditelusuri.
-- Semua qty dalam SATUAN DASAR items.unit, sama seperti tabel stock.

create table stock_moves (
  id uuid primary key default gen_random_uuid(),
  tanggal date not null default current_date,
  warehouse_id uuid not null references warehouses(id) on delete cascade,
  item_id uuid not null references items(id) on delete cascade,
  qty numeric not null,                    -- positif = masuk, negatif = keluar
  unit_cost numeric not null default 0,
  source varchar(24) not null,             -- purchase/sale/transfer/opname/retur/saldo-awal
  source_ref varchar(40),
  created_at timestamptz not null default now()
);
create index on stock_moves(item_id, tanggal);
create index on stock_moves(warehouse_id, item_id);

alter table stock_moves enable row level security;
create policy smov_all on stock_moves for all to authenticated using (true) with check (true);

-- Titik nol kartu stok: stok yang ada sekarang dicatat sebagai satu baris saldo
-- awal. Mutasi sebelum migrasi ini memang tidak pernah tercatat — lebih baik
-- jujur mulai dari saldo hari ini daripada mengarang riwayat masuk/keluar.
insert into stock_moves (tanggal, warehouse_id, item_id, qty, unit_cost, source, source_ref)
select current_date, s.warehouse_id, s.item_id, s.qty, coalesce(i.buy_price, 0), 'saldo-awal', 'migrasi-0074'
from stock s join items i on i.id = s.item_id
where s.qty <> 0;

comment on table stock_moves is
  'Kartu stok: satu baris per mutasi, qty positif masuk / negatif keluar (satuan dasar).';
