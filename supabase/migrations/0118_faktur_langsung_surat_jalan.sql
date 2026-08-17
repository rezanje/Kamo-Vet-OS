-- Pembelian langsung tanpa PO: nomor & lampiran surat jalan (permintaan Bu Nisa,
-- meeting 14 Agustus).
--
-- Pembelian lewat PO menyimpan surat jalan di dokumen penerimaannya. Pembelian
-- langsung tidak punya dokumen penerimaan, jadi surat jalannya tidak punya tempat
-- sama sekali — padahal justru pembelian dadakan yang paling sering dipersoalkan
-- saat pencocokan dengan pemasok.
alter table purchase_invoices
  add column if not exists surat_jalan varchar(60);

comment on column purchase_invoices.surat_jalan is
  'Nomor surat jalan pemasok untuk pembelian langsung. Berkasnya disimpan di document_attachments (modul "pembelian").';
