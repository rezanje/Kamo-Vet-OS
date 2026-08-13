-- Kelebihan kas tutup shift pindah ke Pendapatan Lain-lain — keputusan 2026-08-13.
--
-- Selama ini kas LEBIH dikreditkan ke 5901 Selisih Kas (akun BEBAN), jadi muncul di
-- Laba Rugi sebagai beban minus. Akibatnya laba bersih bisa lebih besar daripada
-- laba kotor — pembacanya mengira toko untung besar, padahal itu cuma kas lebih
-- yang belum jelas asalnya. Kas KURANG tetap di 5901 (atau jadi piutang kasir);
-- itu memang kerugian perusahaan.
insert into coa_accounts (code, name, type, normal_balance) values
  ('4303', 'Pendapatan Lain-lain', 'PENDAPATAN', 'K')
on conflict (code) do nothing;

comment on table coa_accounts is
  'Bagan akun. 4303 dipakai untuk kelebihan kas tutup shift — jangan dihapus.';
