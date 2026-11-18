-- Peran baru "Admin Online" (kode ADMIN_ONLINE), Andri 17-18 Nov 2026: hanya boleh memasukkan penjualan marketplace (Impor Shopee).
-- Berkas 1 dari 2: HANYA nilai enum. Postgres tidak mengizinkan nilai enum baru dipakai di transaksi yang sama dengan penambahannya,
-- jadi seluruh isi peran ada di 20261126100100_admin_online_role.sql (apply terpisah, sesudah ini ter-commit).
-- Aditif dan tak bisa dibalik dengan `drop value` (Postgres tidak punya); nilai yang tidak dipakai tidak berbahaya (tidak ada akun yang memegangnya).
alter type public.user_role add value if not exists 'ADMIN_ONLINE';
