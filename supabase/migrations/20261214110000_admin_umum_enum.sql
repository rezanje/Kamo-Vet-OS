-- Peran baru "Admin Umum" (kode ADMIN_UMUM), Andri 26 Nov 2026: admin umum yang membantu pekerjaan finance; akses bawaan sama seperti ADMIN
-- (menu penuh, semua cabang) tetapi terpisah dari ADMIN supaya hak aksesnya bisa diatur sendiri lewat Pengaturan > Akses Grup.
-- Berkas 1 dari 2: HANYA nilai enum. Postgres tidak mengizinkan nilai enum baru dipakai di transaksi yang sama dengan penambahannya,
-- jadi seluruh isi peran ada di 20261214110100_admin_umum_role.sql (apply terpisah, sesudah ini ter-commit).
-- Aditif dan tak bisa dibalik dengan `drop value` (Postgres tidak punya); nilai yang tidak dipakai tidak berbahaya (tidak ada akun yang memegangnya).
alter type public.user_role add value if not exists 'ADMIN_UMUM';
