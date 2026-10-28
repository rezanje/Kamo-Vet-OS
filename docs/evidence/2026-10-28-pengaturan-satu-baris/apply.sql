-- Isi sama persis dengan:
--   supabase/migrations/20261029140000_tier_settings_insert_policy.sql
--   supabase/migrations/20261029140500_company_settings_owner_write.sql
-- Idempoten: aman dijalankan ulang. Tidak menyisipkan atau mengubah baris data apa pun.
begin;

-- 1) Loyalitas: OWNER/ADMIN boleh MEMBUAT baris (sama dengan hak UPDATE yang sudah ada).
drop policy if exists tier_settings_insert on public.tier_settings;
create policy tier_settings_insert on public.tier_settings
  for insert to authenticated
  with check ((select public.is_admin()));

-- 2) Pajak/perusahaan: baca tetap semua akun login, tulis khusus OWNER aktif.
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

insert into supabase_migrations.schema_migrations(version, name, statements) values
('20261029140000', 'tier_settings_insert_policy', array[
  'drop policy if exists tier_settings_insert on public.tier_settings',
  'create policy tier_settings_insert on public.tier_settings for insert to authenticated with check ((select public.is_admin()))'
]),
('20261029140500', 'company_settings_owner_write', array[
  'drop policy if exists csettings_all on public.company_settings',
  'drop policy if exists csettings_select on public.company_settings',
  'drop policy if exists csettings_owner_write on public.company_settings',
  'create policy csettings_select on public.company_settings for select to authenticated using (true)',
  'create policy csettings_owner_write on public.company_settings for all to authenticated using ((select private.is_hris_owner())) with check ((select private.is_hris_owner()))'
])
on conflict (version) do nothing;

commit;
