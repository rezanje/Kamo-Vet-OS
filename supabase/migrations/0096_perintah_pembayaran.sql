-- Perintah Pembayaran — persetujuan sebelum uang keluar ke pemasok.
--
-- Sekarang siapa pun yang bisa membuka layar hutang bisa langsung membayar faktur.
-- Tidak ada tahap "diajukan → disetujui → dibayar", jadi tidak ada jejak siapa yang
-- menyetujui pengeluaran dan tidak ada cara menahan pembayaran sampai kas siap.

create table payment_orders (
  id uuid primary key default gen_random_uuid(),
  no_pp varchar(30) not null unique,                   -- PP.YYYY.MM.NNNNN
  supplier_id uuid references suppliers(id) on delete set null,
  tanggal date not null default current_date,
  rencana_bayar date,
  total numeric(15,2) not null default 0 check (total >= 0),
  status varchar(10) not null default 'draft'
    check (status in ('draft', 'disetujui', 'dibayar', 'batal')),
  catatan text,
  created_by uuid references profiles(id) on delete set null,
  approved_by uuid references profiles(id) on delete set null,
  approved_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index on payment_orders(supplier_id);
create index on payment_orders(status);

create table payment_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references payment_orders(id) on delete cascade,
  invoice_id uuid not null references purchase_invoices(id) on delete restrict,
  jumlah numeric(15,2) not null check (jumlah > 0)
);
create index on payment_order_items(order_id);
create index on payment_order_items(invoice_id);

alter table payment_orders enable row level security;
alter table payment_order_items enable row level security;
create policy po_pay_all on payment_orders for all to authenticated using (true) with check (true);
create policy po_pay_item_all on payment_order_items for all to authenticated using (true) with check (true);

comment on table payment_orders is
  'Instruksi bayar yang menunggu persetujuan. Uang baru benar-benar keluar saat statusnya jadi dibayar.';

-- Pembayaran yang lahir dari perintah bayar tetap tercatat di tabel pembayaran faktur
-- yang sama, supaya sisa hutang dihitung dari satu sumber saja.
alter table purchase_invoice_payments
  add column payment_order_id uuid references payment_orders(id) on delete set null;
