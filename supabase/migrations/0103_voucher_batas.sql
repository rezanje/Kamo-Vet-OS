-- Pagar voucher: batas potongan, minimal belanja, dan boleh/tidaknya digabung promo.
--
-- Sebelum ini voucher cuma punya kode, jenis, nilai, dan masa berlaku. Diskon
-- persen tanpa plafon memotong sebesar apa pun tagihannya — voucher 10% yang
-- dipakai di transaksi Rp 5 juta langsung menghapus Rp 500 ribu, dan tidak ada
-- satu pun aturan yang menahannya.

alter table vouchers
  add column if not exists max_potongan numeric,                    -- null = tanpa plafon
  add column if not exists min_belanja numeric not null default 0,
  add column if not exists boleh_gabung_promo boolean not null default true;

-- Nilai negatif pada dua kolom ini bukan "longgar", tapi bikin perhitungan kasir
-- ngawur: plafon negatif menghapus potongan, minimal belanja negatif tidak berarti apa-apa.
alter table vouchers
  drop constraint if exists vouchers_batas_wajar;
alter table vouchers
  add constraint vouchers_batas_wajar
    check (
      (max_potongan is null or max_potongan > 0)
      and min_belanja >= 0
    );

comment on column vouchers.max_potongan is
  'Plafon potongan dalam rupiah. Terutama untuk voucher persen; null = tanpa batas.';
comment on column vouchers.min_belanja is
  'Belanja minimum (setelah diskon item) sebelum voucher boleh dipakai. 0 = bebas.';
comment on column vouchers.boleh_gabung_promo is
  'false = voucher ditolak kalau keranjang sudah kena promo potong otomatis. '
  'Promo yang menang, karena potongannya sudah terlihat di layar sebelum kasir mengetik voucher.';
