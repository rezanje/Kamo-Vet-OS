-- Hanya kalau diputuskan mundur. Mengembalikan policy persis seperti sebelum apply.sql.
-- Baris data yang sudah dibuat/diubah lewat layar TIDAK disentuh (itu data pemilik).
-- Akibat rollback:
--   - simpan Pengaturan Loyalitas kembali gagal (dengan pesan error) bila barisnya belum ada;
--   - company_settings kembali bisa DITULIS oleh akun login mana pun lewat API (celah lama).
begin;
drop policy if exists tier_settings_insert on public.tier_settings;

drop policy if exists csettings_owner_write on public.company_settings;
drop policy if exists csettings_select on public.company_settings;
drop policy if exists csettings_all on public.company_settings;
create policy csettings_all on public.company_settings
  for all to authenticated using (true) with check (true);

delete from supabase_migrations.schema_migrations where version in ('20261029140000', '20261029140500');
commit;
