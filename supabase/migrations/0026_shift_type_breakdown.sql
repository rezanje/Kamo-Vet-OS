-- Addendum §1: shift per tipe (klinik/petshop) + breakdown metode bayar saat closing.
alter table cashier_shifts
  add column shift_type text not null default 'petshop' check (shift_type in ('klinik','petshop')),
  add column closing_breakdown jsonb;          -- {"Tunai": 120000, "QRIS": 50000, ...} snapshot saat tutup

-- satu shift open per staff per shift_type (spec §1), gantikan index lama per cabang.
drop index if exists cashier_shifts_one_open;
create unique index cashier_shifts_one_open on cashier_shifts(opened_by, shift_type) where status = 'open';

alter table invoices add column shift_id uuid references cashier_shifts(id) on delete set null;
