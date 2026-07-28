-- Penerimaan barang: qty datang boleh beda dari qty PO (kurang/lebih kirim).
-- qty_terima null = baris belum pernah diterima; setelah PO Diterima selalu terisi.
-- ponytail: satu kolom, tanpa tabel goods-receipt terpisah — PO di sini 1x terima.

alter table purchase_order_items
  add column if not exists qty_terima numeric;
