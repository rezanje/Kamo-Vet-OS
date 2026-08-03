-- Data pemasok yang dibutuhkan bagian keuangan tapi selama ini tidak ada tempatnya:
-- NPWP untuk faktur pajak, termin untuk menghitung jatuh tempo, dan rekening tujuan
-- transfer. Tanpa ini ketiganya disimpan di catatan pribadi orang keuangan.

alter table suppliers
  add column npwp varchar(25),
  add column termin_hari int not null default 30 check (termin_hari >= 0),
  add column bank_nama varchar(60),
  add column bank_rekening varchar(40),
  add column bank_atas_nama varchar(100);

comment on column suppliers.termin_hari is
  'Tempo pembayaran bawaan pemasok ini, dipakai mengisi jatuh tempo faktur pembelian.';
