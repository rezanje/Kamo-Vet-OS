-- Pengaturan loyalitas (tier_settings) adalah tabel satu baris (id = 1).
-- Di produksi barisnya hilang, dan layar Pengaturan → Tier hanya bisa UPDATE:
-- update atas baris yang tidak ada lolos tanpa error padahal tidak menyimpan apa pun.
-- Layar sekarang memakai upsert; INSERT ... ON CONFLICT selalu butuh policy INSERT,
-- jadi hak tulisnya disamakan dengan policy UPDATE yang sudah ada (OWNER/ADMIN).
-- Tidak ada angka bisnis yang ditanam di sini: baris dibuat dari isian layar.
drop policy if exists tier_settings_insert on public.tier_settings;
create policy tier_settings_insert on public.tier_settings
  for insert to authenticated
  with check ((select public.is_admin()));
