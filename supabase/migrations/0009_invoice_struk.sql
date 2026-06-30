-- Klinik: nomor invoice, metode bayar, PPN (untuk struk thermal + invoice A4)

alter table invoices
  add column invoice_no   varchar(24) unique,
  add column metode_bayar varchar(16),               -- Tunai / QRIS / Transfer / Debit
  add column tax          numeric not null default 0; -- PPN 11% dari (subtotal - discount)
