-- Nilai potongan promo otomatis per baris struk.
--
-- Sebelum ini promo dihitung saat checkout lalu dilebur ke kolom `discount`, dan
-- promo_id tidak pernah ikut disimpan. Akibatnya tidak ada cara menjawab
-- "program promo mana yang paling banyak menghabiskan uang" — pertanyaan yang
-- diminta Kamo Group (daftar laporan 24 Agustus 2026).
--
-- Nol untuk baris lama: struk sebelum migrasi ini memang tidak menyimpan nilainya,
-- dan laporan promo menyebutkan batas itu apa adanya.
alter table sale_items add column if not exists promo_discount numeric not null default 0;

comment on column sale_items.promo_discount is
  'Potongan promo otomatis yang benar-benar terpakai di baris ini (0 kalau diskon manual kasir menang). Diisi sejak 25 Agu 2026.';
