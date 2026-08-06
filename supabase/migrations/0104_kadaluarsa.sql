-- Monitor Expired (gap menu Persediaan) — tanggal kadaluarsa per lapisan stok.
--
-- Tanggalnya menempel di LAPISAN stok, bukan di master barang: satu obat yang sama
-- bisa datang dua kali dengan masa kadaluarsa berbeda, dan yang perlu diawasi
-- adalah kiriman yang mana — bukan barangnya secara umum.
--
-- Kolom di dokumen penerimaan dipakai untuk jejak audit: kalau lapisan stoknya
-- sudah habis terpakai, dokumen tetap menyimpan tanggal yang dulu dicatat.

alter table stock_layers add column if not exists exp_date date;
alter table goods_receipt_items add column if not exists exp_date date;

-- Yang selalu ditanya layar monitor: barang yang MASIH ada stoknya dan punya
-- tanggal kadaluarsa, diurutkan dari yang paling dekat.
create index if not exists idx_stock_layers_exp
  on stock_layers (exp_date)
  where qty_left > 0 and exp_date is not null;

-- Penanda "barang ini punya masa simpan" di master barang. Ada di rancangan awal
-- (0001) tapi tidak pernah ikut terpasang di database yang berjalan; tanpa ini
-- kolom kadaluarsa di layar penerimaan tidak punya dasar untuk muncul.
alter table items add column if not exists track_expiry boolean not null default false;
