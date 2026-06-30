-- Permintaan barang antar cabang/gudang (PRD §2.4)
create type stock_request_status as enum ('Menunggu Persetujuan','Disetujui','Dikirim','Selesai','Ditolak');
create table stock_requests (
  id uuid primary key default gen_random_uuid(),
  no_request varchar(24) unique,
  from_branch_id uuid not null references branches(id) on delete restrict,
  to_warehouse_id uuid not null references warehouses(id) on delete restrict,
  status stock_request_status not null default 'Menunggu Persetujuan',
  catatan text,
  created_at timestamptz not null default now()
);
create index on stock_requests(from_branch_id);
create table stock_request_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references stock_requests(id) on delete cascade,
  item_id uuid references items(id) on delete set null,
  nama varchar(160) not null,
  qty_diminta numeric not null default 0,
  qty_diterima numeric,
  kondisi varchar(20),
  created_at timestamptz not null default now()
);
create index on stock_request_items(request_id);
alter table stock_requests enable row level security;
alter table stock_request_items enable row level security;
create policy sr_all on stock_requests for all to authenticated
  using (public.user_can_access_branch(from_branch_id))
  with check (public.user_can_access_branch(from_branch_id));
create policy sri_all on stock_request_items for all to authenticated
  using (exists (select 1 from stock_requests r where r.id = stock_request_items.request_id and public.user_can_access_branch(r.from_branch_id)))
  with check (exists (select 1 from stock_requests r where r.id = stock_request_items.request_id and public.user_can_access_branch(r.from_branch_id)));
