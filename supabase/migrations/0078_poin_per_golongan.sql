-- Poin earning per golongan pelanggan — spec 2026-08-01 (permintaan Aldi).
--
-- Sebelumnya rumus poin dipatok di kode: Rp1.000 = 1 poin untuk SEMUA pelanggan,
-- jadi golongan Member/B2B tidak bisa dibedakan dari Umum selain lewat diskon.
--
-- Bentuk kolomnya sengaja "berapa rupiah untuk 1 poin", bukan pengali, karena
-- itu cara tim menyebutnya ("tiap Rp1.000 dapat 1 poin"). Makin kecil angkanya
-- makin royal golongan itu.

alter table customer_categories
  add column rupiah_per_poin integer not null default 1000
    check (rupiah_per_poin > 0);

comment on column customer_categories.rupiah_per_poin is
  'Belanja sebesar ini menghasilkan 1 poin. Default 1000 = perilaku lama (Rp1.000 = 1 poin).';

-- Golongan lama ikut default 1000, jadi tidak ada pelanggan yang tiba-tiba
-- kehilangan atau kelebihan poin setelah migrasi.
