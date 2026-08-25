-- Identitas pajak perusahaan & pelanggan (S10).
--
-- Faktur pajak wajib memuat identitas KEDUA pihak. Sampai sekarang tidak ada satu pun
-- tempat menyimpan NPWP perusahaan sendiri maupun NPWP pelanggan, jadi berkas apa pun
-- yang dibuat untuk pelaporan pasti ditolak. Kolomnya disiapkan di sini; isinya
-- menunggu klien — dan layar pajak menyebutkan dengan jelas apa yang masih kosong.

alter table company_settings add column if not exists nama_perusahaan varchar(120);
alter table company_settings add column if not exists npwp varchar(30);
alter table company_settings add column if not exists alamat text;

comment on column company_settings.npwp is
  'NPWP perusahaan. Dipakai berkas pajak dan (nanti) kop dokumen cetak.';

alter table customers add column if not exists npwp varchar(30);

comment on column customers.npwp is
  'NPWP pelanggan — wajib untuk faktur pajak ke pembeli ber-NPWP. Kosong = dianggap pembeli non-NPWP.';
