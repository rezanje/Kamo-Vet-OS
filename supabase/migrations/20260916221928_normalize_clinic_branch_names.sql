-- Samakan nama cabang klinik agar pilihan cabang konsisten di seluruh aplikasi.
-- Hanya label tampilan yang berubah; kode cabang dan relasi transaksi tetap sama.
update public.branches
set name = case code
  when 'VET_CIAW' then 'Kamo Pets Clinic Ciawi'
  when 'VET_CMGG' then 'Kamo Pets Clinic Cimanggu'
  when 'VET_CMS' then 'Kamo Pets Clinic Ciomas'
  when 'VET_GRDA' then 'Kamo Pets Clinic Garuda'
  when 'VET_GRLG' then 'Kamo Pets Clinic Gerlong'
  when 'VET_PDRY' then 'Kamo Pets Clinic Panduraya'
  when 'VET_SRKN' then 'Kamo Pets Clinic Surken'
  when 'VET_TKI' then 'Kamo Pets Clinic TKI'
  else name
end
where code in (
  'VET_CIAW', 'VET_CMGG', 'VET_CMS', 'VET_GRDA',
  'VET_GRLG', 'VET_PDRY', 'VET_SRKN', 'VET_TKI'
);
