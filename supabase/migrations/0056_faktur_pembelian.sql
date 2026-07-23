-- Faktur Pembelian — hutang lahir dari faktur pemasok, bukan PO (ala Accurate, PRD §8.3)
-- (spec: docs/superpowers/specs/2026-07-24-faktur-pembelian-design.md)

-- Akun antara: barang diterima tapi belum difakturkan pemasok (GRNI).
insert into coa_accounts (code, name, type, normal_balance)
values ('2102', 'Hutang Belum Difakturkan', 'LIABILITAS', 'K')
on conflict (code) do nothing;

create table purchase_invoices (
  id uuid primary key default gen_random_uuid(),
  no_faktur varchar(30) not null unique,          -- FB.YYYY.MM.NNNNN (internal)
  no_faktur_pemasok varchar(60),                  -- nomor faktur dari pemasok
  po_id uuid not null references purchase_orders(id) on delete restrict,
  supplier_id uuid references suppliers(id) on delete set null,
  tanggal date not null default current_date,
  jatuh_tempo date not null default current_date + 30,
  total numeric not null default 0,
  keterangan text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on purchase_invoices(po_id);
create index on purchase_invoices(supplier_id);
create index on purchase_invoices(jatuh_tempo);

create table purchase_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references purchase_invoices(id) on delete cascade,
  item_id uuid references items(id) on delete set null,
  nama varchar(160) not null,
  qty numeric not null check (qty > 0),
  harga numeric not null default 0
);
create index on purchase_invoice_items(invoice_id);

create table purchase_invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references purchase_invoices(id) on delete cascade,
  tanggal date not null default current_date,
  amount numeric not null check (amount > 0),
  metode varchar(16) not null default 'Transfer',
  catatan text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on purchase_invoice_payments(invoice_id);

alter table purchase_invoices enable row level security;
alter table purchase_invoice_items enable row level security;
alter table purchase_invoice_payments enable row level security;

-- demo posture, ikut 0025/0032.
create policy pinv_all on purchase_invoices for all to authenticated using (true) with check (true);
create policy pinvi_all on purchase_invoice_items for all to authenticated using (true) with check (true);
create policy pinvp_all on purchase_invoice_payments for all to authenticated using (true) with check (true);
