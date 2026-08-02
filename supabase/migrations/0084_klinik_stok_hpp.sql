-- Obat klinik: sambungkan ke master barang supaya stok & HPP-nya bisa dihitung.
--
-- Temuan simulasi 2026-08-02: obat yang diresepkan dokter lalu dibayar pasien
-- TIDAK mengurangi stok dan TIDAK mencatat modal sama sekali. Seluruh tagihan
-- klinik masuk sebagai pendapatan tanpa beban pokok, dan stok obat tidak pernah
-- turun dari penjualan klinik.
--
-- Akar masalahnya di sini: prescription_items & invoice_items hanya menyimpan
-- NAMA obat sebagai teks. Tanpa item_id, sistem tidak tahu barang mana yang
-- harus dipotong. (Racikan selamat karena bahannya memang menyimpan item_id.)

alter table prescription_items add column item_id uuid references items(id) on delete set null;
alter table invoice_items      add column item_id uuid references items(id) on delete set null;

create index on prescription_items(item_id);
create index on invoice_items(item_id);

comment on column prescription_items.item_id is
  'Master barang. NULL = baris ketikan bebas / racikan — tidak memotong stok.';
comment on column invoice_items.item_id is
  'Master barang, dibawa dari resep. Dipakai memotong stok & menghitung HPP saat pembayaran.';

-- ── Modal per baris penjualan ──────────────────────────────────────────────
-- Retur penjualan selama ini menilai barang yang kembali memakai
-- items.buy_price (angka master yang bisa sudah basi), bukan modal barang yang
-- benar-benar keluar. Di simulasi: keluar Rp200.000, masuk lagi Rp210.000 —
-- persediaan bertambah Rp10.000 dari udara setiap retur.
--
-- Modal riil FIFO sudah dihitung saat penjualan; tinggal disimpan supaya retur
-- bisa memakai angka yang sama persis.
alter table sale_items    add column hpp numeric(15,2);
alter table invoice_items add column hpp numeric(15,2);

comment on column sale_items.hpp is
  'Modal FIFO baris ini saat terjual (total, bukan per satuan). Dipakai retur agar barang kembali dinilai sama dengan saat keluar. NULL = penjualan sebelum kolom ini ada.';
comment on column invoice_items.hpp is
  'Modal FIFO baris obat klinik saat dibayar. NULL = jasa atau baris tanpa master barang.';
