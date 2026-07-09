-- Pisah obat vs jasa secara eksplisit (invoice split gaya referensi) — sebelumnya
-- dipisah pakai heuristik nama. 'obat' | 'jasa'.

alter table invoice_items
  add column jenis varchar(8) not null default 'obat';

alter table prescription_items
  add column jenis varchar(8) not null default 'obat';
