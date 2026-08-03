-- Uang muka dipotongkan di pembayaran FAKTUR, bukan pembayaran PO.
--
-- `po_payments` ternyata jalur mati: layar hutang membayar lewat
-- `purchase_invoice_payments` (hutang lahir dari faktur pemasok, migrasi 0056).
-- Kolom yang terlanjur ditambahkan di 0094 dipindah ke tabel yang benar-benar dipakai.

alter table po_payments drop column if exists advance_id;
alter table po_payments drop column if exists dari_uang_muka;

alter table purchase_invoice_payments
  add column advance_id uuid references purchase_advances(id) on delete set null,
  add column dari_uang_muka numeric(15,2) not null default 0 check (dari_uang_muka >= 0);

comment on column purchase_invoice_payments.dari_uang_muka is
  'Porsi pembayaran yang diambil dari uang muka, bukan dari kas. Sisanya keluar dari rekening.';
