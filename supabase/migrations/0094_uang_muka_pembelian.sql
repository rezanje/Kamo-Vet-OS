-- Uang Muka Pembelian — DP ke pemasok sebelum barang datang.
--
-- Selama ini uang yang keluar duluan ke pemasok tidak punya tempat: dicatat sebagai
-- kas keluar biasa, jadi terlihat seperti beban padahal itu hak tagih. Saat fakturnya
-- datang, hutangnya pun tercatat penuh seolah belum dibayar sepeser pun.

insert into coa_accounts (code, name, type, normal_balance)
values ('1303', 'Uang Muka Pembelian', 'ASET', 'D')
on conflict (code) do nothing;

create table purchase_advances (
  id uuid primary key default gen_random_uuid(),
  no_um varchar(30) not null unique,                   -- UM.YYYY.MM.NNNNN
  supplier_id uuid references suppliers(id) on delete set null,
  po_id uuid references purchase_orders(id) on delete set null,   -- boleh belum ada PO
  tanggal date not null default current_date,
  jumlah numeric(15,2) not null check (jumlah > 0),
  -- Berapa yang sudah dipotongkan ke pembayaran hutang. Dipisah dari `jumlah` supaya
  -- uang muka bisa dipakai bertahap ke beberapa pembayaran.
  terpakai numeric(15,2) not null default 0 check (terpakai >= 0),
  metode varchar(16) not null default 'Transfer',
  account_id uuid references cash_accounts(id) on delete set null,
  catatan text,
  status varchar(8) not null default 'aktif' check (status in ('aktif', 'batal')),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (terpakai <= jumlah)
);
create index on purchase_advances(supplier_id);
create index on purchase_advances(po_id);

alter table purchase_advances enable row level security;
create policy pa_all on purchase_advances for all to authenticated using (true) with check (true);

comment on column purchase_advances.terpakai is
  'Bagian uang muka yang sudah dipotongkan ke pembayaran hutang. Sisa = jumlah - terpakai.';

-- Jejak uang muka yang dipakai di satu pembayaran, supaya pembatalan & audit bisa
-- menelusuri balik tanpa menebak dari nominal.
alter table po_payments add column advance_id uuid references purchase_advances(id) on delete set null;
alter table po_payments add column dari_uang_muka numeric(15,2) not null default 0 check (dari_uang_muka >= 0);
comment on column po_payments.dari_uang_muka is
  'Porsi pembayaran yang diambil dari uang muka, bukan dari kas. Sisanya keluar dari rekening.';
