-- Pesanan penjualan bisa memilih satuan (permintaan Bu Nisa, meeting 14 Agustus).
--
-- Baris pesanan sudah menyimpan nama satuannya, tapi tidak faktornya. Tanpa faktor,
-- "2 dus isi 12" dikirim sebagai 2 pcs: stok salah potong dan modalnya ikut meleset.
alter table sales_order_items
  add column if not exists faktor numeric not null default 1 check (faktor > 0);
alter table sales_quotation_items
  add column if not exists faktor numeric not null default 1 check (faktor > 0);
alter table sales_delivery_items
  add column if not exists faktor numeric not null default 1 check (faktor > 0);
alter table sales_invoice_items
  add column if not exists faktor numeric not null default 1 check (faktor > 0);

comment on column sales_order_items.faktor is
  'Isi per satuan pilihan (1 dus = 12 pcs → 12). Stok selalu dipotong qty × faktor.';
