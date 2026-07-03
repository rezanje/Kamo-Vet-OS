-- Addendum §5: approval chain + dokumen penerimaan terpisah (rekonsiliasi dipesan vs diterima).
alter table stock_requests
  add column priority text not null default 'normal' check (priority in ('normal','tinggi')),
  add column requested_by uuid references profiles(id) on delete set null,
  add column approved_by uuid references profiles(id) on delete set null;
alter table stock_request_items add column catatan text;

create table stock_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_number varchar(24) unique not null,           -- TRM-YYMMDD-NNN
  stock_request_id uuid not null references stock_requests(id) on delete cascade,
  received_by uuid references profiles(id) on delete set null,
  received_at timestamptz not null default now(),
  attachment_url text
);
create index on stock_receipts(stock_request_id);

create table stock_receipt_items (
  id uuid primary key default gen_random_uuid(),
  stock_receipt_id uuid not null references stock_receipts(id) on delete cascade,
  item_id uuid references items(id) on delete set null,
  nama varchar(160) not null,
  qty_ordered numeric not null default 0,
  qty_received numeric not null default 0,
  condition text not null default 'baik' check (condition in ('baik','rusak','kurang')),
  notes text
);
create index on stock_receipt_items(stock_receipt_id);

alter table stock_receipts enable row level security;
alter table stock_receipt_items enable row level security;
-- ponytail: PROTOTYPE ONLY — ikut pola relax 0025 (kasir world lintas cabang demo).
create policy srec_all on stock_receipts for all to authenticated using (true) with check (true);
create policy sreci_all on stock_receipt_items for all to authenticated using (true) with check (true);
