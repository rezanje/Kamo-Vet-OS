-- Jam kerja standar — dasar hitungan "telat" & "lembur" di laporan absensi.
--
-- Sebelumnya sistem cuma mencatat jam masuk & jam pulang apa adanya; tidak ada
-- acuan untuk menyebut seseorang telat. Angkanya ditaruh di pengaturan, BUKAN
-- dipatok di kode: jam kerja klinik dan petshop bisa berbeda dan pasti berubah.

alter table company_settings
  add column jam_masuk_standar  time not null default '08:00',
  add column jam_pulang_standar time not null default '17:00',
  add column toleransi_telat_menit int not null default 10 check (toleransi_telat_menit >= 0);

comment on column company_settings.jam_masuk_standar is
  'Jam masuk seharusnya. Absen setelah jam ini + toleransi dihitung telat.';
comment on column company_settings.jam_pulang_standar is
  'Jam pulang seharusnya. Absen pulang setelah jam ini dihitung lembur.';
comment on column company_settings.toleransi_telat_menit is
  'Kelonggaran sebelum dianggap telat. 0 = tidak ada toleransi.';
