-- Kondisi barang pada retur penjualan.
--
-- Sebelum ini SEMUA barang yang diretur masuk kembali ke stok jualan, termasuk
-- barang yang diretur JUSTRU KARENA sudah kadaluarsa — dan masuknya tanpa
-- tanggal kadaluarsa sama sekali, sehingga barang basi itu berdiri sebagai stok
-- normal dan tidak akan pernah muncul di Monitor Kadaluarsa.
--
-- Ditemukan dari laporan tim 2026-08-12 (retur Royal Canin "Barang expired").
--
-- Nilainya varchar, bukan boolean, supaya nanti bisa ditambah kondisi lain tanpa
-- migrasi lagi — pola yang sama dengan stock_request_items.kondisi (migrasi 0014).
-- Default 'baik' wajib: seluruh baris retur lama memang barang yang kembali dijual.
alter table sales_return_items
  add column if not exists kondisi varchar(20) not null default 'baik';

-- Kadaluarsa barang yang kembali TIDAK bisa dipulihkan otomatis: sale_items dan
-- stock_moves tidak menyimpan exp_date lapisan yang dulu terpakai. Jadi diisi
-- manual di form retur, dan hanya relevan untuk barang berkondisi baik.
alter table sales_return_items
  add column if not exists exp_date date;

-- Jurnal retur barang rusak memakai 5902 Selisih Persediaan (akun sudah ada sejak
-- migrasi 0054, dipakai koreksi stok opname) — nilainya jadi kerugian, bukan
-- menambah persediaan.
