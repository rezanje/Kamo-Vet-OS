-- Info pembelian & aturan jual di master barang — permintaan klien 2026-07-31.
-- items.min_stock sudah ada sejak 0001 tapi angkanya nganggur: tidak ada yang
-- membandingkannya dengan stok nyata. Kolom-kolom ini melengkapinya supaya
-- "barang menipis" bisa langsung jadi draft PO ke pemasok yang benar.
--
-- Catatan penting: buy_price TETAP cuma acuan PO. HPP tidak diambil dari sini —
-- HPP dihitung FIFO dari pembelian yang benar-benar masuk (stock_layers, 0058).

alter table items
  add column supplier_id uuid references suppliers(id) on delete set null,
  add column buy_unit varchar(20),                                  -- satuan saat memesan (box/dus)
  add column min_buy numeric(15,4) not null default 0,              -- minimum pesan ke pemasok
  add column min_sell_qty numeric(15,4) not null default 0,         -- minimum jual per transaksi
  add column default_discount numeric(5,2) not null default 0
    check (default_discount >= 0 and default_discount <= 100),
  add column substitute_item_id uuid references items(id) on delete set null;

create index on items(supplier_id);

comment on column items.buy_price is
  'Acuan harga saat membuat PO. BUKAN HPP — HPP dihitung FIFO dari penerimaan nyata.';
comment on column items.min_stock is
  'Batas bawah stok. Di bawah ini barang muncul di layar Barang Stok Minimum.';
