-- Permintaan barang ikut satuan berjenjang (pcs/box/botol/sak) — spec 2026-07-30.
-- Pola sama dgn purchase_order_items (0063): qty disimpan DALAM SATUAN YANG DIPILIH
-- supaya dokumen cocok dgn yang diminta toko; faktor dipakai saat konversi ke stok
-- (qty_stok = qty × faktor). Baris lama faktor 1 = qty sudah dalam satuan dasar.
alter table stock_request_items
  add column if not exists satuan varchar(20),
  add column if not exists faktor numeric(15,4) not null default 1;

alter table stock_receipt_items
  add column if not exists satuan varchar(20),
  add column if not exists faktor numeric(15,4) not null default 1;
