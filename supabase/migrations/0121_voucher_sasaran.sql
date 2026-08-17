-- Voucher bisa diikat ke pelanggan tertentu atau golongan pelanggan
-- (permintaan Pak Aldi, meeting 14 Agustus).
--
-- Latar belakangnya: pelanggan klinik mau digiring ke petshop dengan voucher yang
-- menempel di ORANGNYA — supaya tidak bisa ditiru seperti voucher kertas dan tidak
-- bocor ke orang lain. Sampai sekarang voucher berlaku untuk siapa pun yang tahu
-- kodenya.
alter table vouchers
  add column if not exists customer_id uuid references customers(id) on delete cascade,
  add column if not exists category_id uuid references customer_categories(id) on delete cascade;

create index if not exists vouchers_customer_idx on vouchers(customer_id);
create index if not exists vouchers_category_idx on vouchers(category_id);

comment on column vouchers.customer_id is
  'Voucher khusus satu pelanggan. Kosong = siapa pun boleh pakai (selama syarat lain terpenuhi).';
comment on column vouchers.category_id is
  'Voucher khusus satu golongan pelanggan. Kosong = semua golongan.';
