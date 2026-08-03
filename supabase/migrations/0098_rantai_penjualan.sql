-- Rantai dokumen Penjualan ala Accurate:
-- Penawaran → Pesanan → Pengiriman → Faktur → Penerimaan, plus Uang Muka Penjualan.
--
-- Yang ada sekarang cuma kasir (langsung bayar di tempat) dan invoice klinik. Penjualan
-- ke klinik/reseller lain — yang pesan dulu, dikirim, ditagih, dibayar belakangan —
-- tidak punya dokumen sama sekali: pesanannya dicatat di WhatsApp, pengirimannya tidak
-- memotong stok pada waktunya, dan piutangnya baru ketahuan saat ditagih.

insert into coa_accounts (code, name, type, normal_balance)
values ('2103', 'Uang Muka Penjualan', 'LIABILITAS', 'K')
on conflict (code) do nothing;

-- ── Penawaran ──────────────────────────────────────────────────────────────────
create table sales_quotations (
  id uuid primary key default gen_random_uuid(),
  no_penawaran varchar(30) not null unique,            -- SQ.YYYY.MM.NNNNN
  customer_id uuid references customers(id) on delete set null,
  branch_id uuid references branches(id) on delete set null,
  tanggal date not null default current_date,
  berlaku_sampai date,
  total numeric(15,2) not null default 0,
  status varchar(10) not null default 'draft'
    check (status in ('draft', 'dikirim', 'diterima', 'ditolak')),
  catatan text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create table sales_quotation_items (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references sales_quotations(id) on delete cascade,
  item_id uuid references items(id) on delete set null,
  nama varchar(160) not null,
  satuan varchar(20),
  qty numeric not null check (qty > 0),
  harga numeric(15,2) not null default 0
);
create index on sales_quotation_items(quotation_id);

-- ── Pesanan ────────────────────────────────────────────────────────────────────
create table sales_orders (
  id uuid primary key default gen_random_uuid(),
  no_pesanan varchar(30) not null unique,              -- SO.YYYY.MM.NNNNN
  quotation_id uuid references sales_quotations(id) on delete set null,
  customer_id uuid references customers(id) on delete set null,
  branch_id uuid references branches(id) on delete set null,
  warehouse_id uuid references warehouses(id) on delete set null,
  tanggal date not null default current_date,
  rencana_kirim date,
  total numeric(15,2) not null default 0,
  status varchar(10) not null default 'draft'
    check (status in ('draft', 'diproses', 'selesai', 'batal')),
  catatan text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on sales_orders(customer_id);

create table sales_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references sales_orders(id) on delete cascade,
  item_id uuid references items(id) on delete set null,
  nama varchar(160) not null,
  satuan varchar(20),
  qty numeric not null check (qty > 0),
  harga numeric(15,2) not null default 0,
  -- Akumulasi, supaya sisa yang masih boleh dikirim/ditagih tidak perlu menjumlah
  -- ulang seluruh dokumen turunannya tiap kali layar dibuka.
  qty_kirim numeric not null default 0,
  qty_faktur numeric not null default 0
);
create index on sales_order_items(order_id);

-- ── Pengiriman ─────────────────────────────────────────────────────────────────
-- Barang keluar di sini, jadi HPP diakui di sini. Pendapatan menyusul di faktur.
create table sales_deliveries (
  id uuid primary key default gen_random_uuid(),
  no_kirim varchar(30) not null unique,                -- DO.YYYY.MM.NNNNN
  order_id uuid not null references sales_orders(id) on delete cascade,
  tanggal date not null default current_date,
  ekspedisi varchar(60),
  no_resi varchar(60),
  catatan text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on sales_deliveries(order_id);

create table sales_delivery_items (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references sales_deliveries(id) on delete cascade,
  order_item_id uuid references sales_order_items(id) on delete set null,
  item_id uuid references items(id) on delete set null,
  nama varchar(160) not null,
  satuan varchar(20),
  qty numeric not null check (qty > 0),
  hpp numeric(15,2)
);
create index on sales_delivery_items(delivery_id);

comment on column sales_delivery_items.hpp is
  'Modal FIFO baris ini saat barang keluar. NULL = baris tanpa master barang (jasa).';

-- ── Faktur penjualan ───────────────────────────────────────────────────────────
create table sales_invoices (
  id uuid primary key default gen_random_uuid(),
  no_faktur varchar(30) not null unique,               -- FJ.YYYY.MM.NNNNN
  order_id uuid references sales_orders(id) on delete set null,
  customer_id uuid references customers(id) on delete set null,
  branch_id uuid references branches(id) on delete set null,
  tanggal date not null default current_date,
  jatuh_tempo date not null default (current_date + 30),
  dpp numeric(15,2) not null default 0,
  ppn numeric(15,2) not null default 0,
  total numeric(15,2) not null default 0,
  status varchar(10) not null default 'berjalan'
    check (status in ('berjalan', 'lunas', 'batal')),
  catatan text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on sales_invoices(customer_id);
create index on sales_invoices(jatuh_tempo);

create table sales_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references sales_invoices(id) on delete cascade,
  order_item_id uuid references sales_order_items(id) on delete set null,
  item_id uuid references items(id) on delete set null,
  nama varchar(160) not null,
  satuan varchar(20),
  qty numeric not null check (qty > 0),
  harga numeric(15,2) not null default 0
);
create index on sales_invoice_items(invoice_id);

-- ── Uang muka pelanggan ────────────────────────────────────────────────────────
create table sales_advances (
  id uuid primary key default gen_random_uuid(),
  no_um varchar(30) not null unique,                   -- UJ.YYYY.MM.NNNNN
  customer_id uuid references customers(id) on delete set null,
  order_id uuid references sales_orders(id) on delete set null,
  tanggal date not null default current_date,
  jumlah numeric(15,2) not null check (jumlah > 0),
  terpakai numeric(15,2) not null default 0 check (terpakai >= 0),
  metode varchar(16) not null default 'Transfer',
  account_id uuid references cash_accounts(id) on delete set null,
  catatan text,
  status varchar(8) not null default 'aktif' check (status in ('aktif', 'batal')),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (terpakai <= jumlah)
);
create index on sales_advances(customer_id);

-- ── Penerimaan penjualan (pelunasan faktur) ────────────────────────────────────
create table sales_receipts (
  id uuid primary key default gen_random_uuid(),
  no_terima varchar(30) not null unique,               -- RC.YYYY.MM.NNNNN
  invoice_id uuid not null references sales_invoices(id) on delete cascade,
  tanggal date not null default current_date,
  jumlah numeric(15,2) not null check (jumlah > 0),
  dari_uang_muka numeric(15,2) not null default 0 check (dari_uang_muka >= 0),
  advance_id uuid references sales_advances(id) on delete set null,
  metode varchar(16) not null default 'Transfer',
  account_id uuid references cash_accounts(id) on delete set null,
  catatan text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on sales_receipts(invoice_id);

comment on column sales_receipts.dari_uang_muka is
  'Porsi pelunasan yang diambil dari uang muka pelanggan, bukan uang masuk baru.';

-- RLS: ikut pola dokumen pembelian — gate lewat cabang dokumennya kalau ada.
alter table sales_quotations       enable row level security;
alter table sales_quotation_items  enable row level security;
alter table sales_orders           enable row level security;
alter table sales_order_items      enable row level security;
alter table sales_deliveries       enable row level security;
alter table sales_delivery_items   enable row level security;
alter table sales_invoices         enable row level security;
alter table sales_invoice_items    enable row level security;
alter table sales_advances         enable row level security;
alter table sales_receipts         enable row level security;

create policy sq_all   on sales_quotations      for all to authenticated using (true) with check (true);
create policy sqi_all  on sales_quotation_items for all to authenticated using (true) with check (true);
create policy so_all   on sales_orders          for all to authenticated using (true) with check (true);
create policy soi_all  on sales_order_items     for all to authenticated using (true) with check (true);
create policy sd_all   on sales_deliveries      for all to authenticated using (true) with check (true);
create policy sdi_all  on sales_delivery_items  for all to authenticated using (true) with check (true);
create policy si_all   on sales_invoices        for all to authenticated using (true) with check (true);
create policy sii_all  on sales_invoice_items   for all to authenticated using (true) with check (true);
create policy sa_all   on sales_advances        for all to authenticated using (true) with check (true);
create policy src_all  on sales_receipts        for all to authenticated using (true) with check (true);
