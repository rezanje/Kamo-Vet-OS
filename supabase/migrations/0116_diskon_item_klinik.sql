-- Diskon persen per item di rincian tagihan klinik (permintaan Pak Aldi,
-- meeting 14 Agustus). Sebelumnya diskon klinik hanya bisa nominal untuk SATU
-- tagihan penuh, jadi "obat ini saja yang didiskon 10%" harus dihitung manual
-- lalu diketik sebagai potongan gelondongan — tidak terlacak per barang.
alter table invoice_items
  add column if not exists diskon_persen numeric not null default 0
  check (diskon_persen >= 0 and diskon_persen <= 100);

comment on column invoice_items.diskon_persen is
  'Diskon per baris dalam persen. Nilai baris = qty × harga × (100 - diskon_persen)%.';
