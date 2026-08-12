-- Voucher & promo di kasir klinik — kesepakatan dengan Aldi 2026-08-12.
--
-- Mesinnya persis punya petshop (promos + vouchers), yang kurang cuma jejak
-- "invoice ini pakai voucher apa". Tanpa kolom ini, potongan voucher melebur
-- ke `discount` dan tidak bisa dipertanggungjawabkan saat audit promo.
alter table invoices add column if not exists voucher_code varchar(24);

comment on column invoices.voucher_code is
  'Kode voucher yang dipakai. Untuk rombongan, kode yang sama menempel di tiap '
  'nota hewan — potongannya dibagi proporsional sesuai porsi tagihan.';
