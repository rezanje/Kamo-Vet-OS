-- Sambungkan rantai dokumen penjualan (migrasi 0098) ke aturan komisi.
--
-- Sebelum ini `commission_rules.sumber` cuma mengenal kasir & klinik, jadi faktur
-- penjualan ke reseller/klinik lain tidak pernah masuk komisi maupun realisasi target.
-- Kolomnya varchar(6), 'reseller' 8 huruf — makanya ikut dilebarkan.

alter table commission_rules
  drop constraint if exists commission_rules_sumber_check;

alter table commission_rules
  alter column sumber type varchar(10);

alter table commission_rules
  add constraint commission_rules_sumber_check
    check (sumber in ('semua', 'kasir', 'klinik', 'reseller'));

comment on column commission_rules.sumber is
  'kasir = struk POS & penjualan online; klinik = tagihan kunjungan yang sudah lunas; '
  'reseller = faktur penjualan B2B (rantai dokumen); semua = ketiganya.';
