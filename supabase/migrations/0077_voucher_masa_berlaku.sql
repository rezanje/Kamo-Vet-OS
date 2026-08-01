-- Kode voucher: masa berlaku + jejak pembuat — spec 2026-08-01.
--
-- Tabel vouchers lahir di 0023 dan sudah dipakai kasir (kode divalidasi &
-- dipotong di checkout), tapi belum pernah punya layar pengelola — jadi kodenya
-- hanya bisa dibuat lewat database. Menu barunya di /crm/voucher.
--
-- Masa berlaku ikut ditambahkan sekalian: kode diskon tanpa tanggal berakhir
-- berlaku selamanya begitu bocor ke luar. Pola kolomnya sengaja disamakan dengan
-- promos (0035) supaya aturan "aktif hari ini" dibaca dengan cara yang sama.

alter table vouchers
  add column valid_from  date,
  add column valid_until date;

comment on column vouchers.valid_from is
  'Mulai berlaku. NULL = tanpa batas awal. Sama pola dengan promos.valid_from.';
comment on column vouchers.valid_until is
  'Berlaku sampai tanggal ini (inklusif). NULL = tanpa batas akhir.';

-- Kode lama tidak diberi tanggal: mengarang batas akhir untuk voucher yang
-- mungkin sedang beredar bisa menolak pelanggan yang sedang di depan kasir.
