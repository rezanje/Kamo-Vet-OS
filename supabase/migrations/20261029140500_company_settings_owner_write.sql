-- Pengaturan perusahaan (company_settings: Mode PKP, tarif PPN, identitas pajak, jam kerja
-- standar) sejak 0057 memakai satu policy `for all ... using (true)`: akun login mana pun
-- bisa mengubah Mode PKP/PPN langsung lewat API. Penulisan sekarang khusus OWNER aktif.
-- Pembacaan tidak berubah: semua akun login tetap bisa membaca (kasir, klinik, faktur,
-- rekap pajak, laporan absensi membutuhkannya). Tidak ada data yang diubah.
drop policy if exists csettings_all on public.company_settings;
drop policy if exists csettings_select on public.company_settings;
drop policy if exists csettings_owner_write on public.company_settings;

create policy csettings_select on public.company_settings
  for select to authenticated
  using (true);

create policy csettings_owner_write on public.company_settings
  for all to authenticated
  using ((select private.is_hris_owner()))
  with check ((select private.is_hris_owner()));
