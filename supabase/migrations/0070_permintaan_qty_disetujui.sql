-- Penyesuaian dari sisi gudang pengirim: qty yang disetujui boleh beda dari yang
-- diminta (stok DC cuma 6 dari 10 yang diminta) — spec 2026-07-30.
-- null = belum lewat persetujuan berjenjang / disetujui apa adanya.
alter table stock_request_items
  add column if not exists qty_disetujui numeric;
