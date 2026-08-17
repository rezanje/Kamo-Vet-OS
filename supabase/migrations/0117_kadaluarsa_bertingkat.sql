-- Satu barang, beberapa tanggal kadaluarsa dalam satu penerimaan
-- (permintaan Pak Faisal, meeting 14 Agustus).
--
-- Lapisan stoknya sendiri sudah bisa menyimpan tanggal berbeda (migrasi 0104),
-- yang belum: dokumen penerimaan cuma punya SATU kolom exp_date per baris, jadi
-- jejak "10 botol ini datang 6 tanggal Nov + 4 tanggal Jan" tidak tersimpan.
alter table goods_receipt_items
  add column if not exists batches jsonb;

comment on column goods_receipt_items.batches is
  'Rincian jumlah per tanggal kadaluarsa: [{"qty":6,"expDate":"2026-11-30"},…]. '
  'Kosong = satu tanggal saja (kolom exp_date).';
