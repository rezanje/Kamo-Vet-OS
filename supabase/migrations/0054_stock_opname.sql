-- Stok Opname — kloning Accurate "Perintah Stok Opname" (OPO) + "Hasil Stok Opname" (OPR)
-- (spec: docs/superpowers/specs/2026-07-23-stok-opname-design.md)

-- Akun penyesuaian: 1 akun dua arah (PRD 10.8 disederhanakan ke COA 4 digit VetOS).
insert into coa_accounts (code, name, type, normal_balance)
values ('5902', 'Selisih Persediaan', 'BEBAN', 'D')
on conflict (code) do nothing;

create type opname_status as enum ('Terbuka','Selesai');

-- Perintah Stok Opname (surat tugas hitung fisik per gudang)
create table opname_orders (
  id uuid primary key default gen_random_uuid(),
  no_opname varchar(20) not null unique,          -- OPO.NNNNN (format Accurate)
  warehouse_id uuid not null references warehouses(id) on delete restrict,
  tanggal_mulai date not null default current_date,
  penanggung_jawab varchar(80) not null,
  dikerjakan_oleh varchar(120),
  keterangan text,
  status opname_status not null default 'Terbuka',
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on opname_orders(warehouse_id);

-- Hasil Stok Opname (hitungan fisik → penyesuaian stok)
create table opname_results (
  id uuid primary key default gen_random_uuid(),
  no_hasil varchar(20) not null unique,           -- OPR.NNNNN
  order_id uuid not null references opname_orders(id) on delete restrict,
  tanggal date not null default current_date,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on opname_results(order_id);

create table opname_result_items (
  id uuid primary key default gen_random_uuid(),
  result_id uuid not null references opname_results(id) on delete cascade,
  item_id uuid not null references items(id) on delete restrict,
  qty_sistem numeric not null default 0,
  qty_fisik numeric not null default 0,
  selisih numeric not null default 0
);
create index on opname_result_items(result_id);

alter table opname_orders enable row level security;
alter table opname_results enable row level security;
alter table opname_result_items enable row level security;

-- demo posture, ikut 0025/0032.
create policy opo_all on opname_orders for all to authenticated using (true) with check (true);
create policy opr_all on opname_results for all to authenticated using (true) with check (true);
create policy opri_all on opname_result_items for all to authenticated using (true) with check (true);
