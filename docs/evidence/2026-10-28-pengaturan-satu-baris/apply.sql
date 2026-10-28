-- Isi sama persis dengan supabase/migrations/20261029140000_tier_settings_insert_policy.sql.
-- Idempoten: aman dijalankan ulang. Tidak menyisipkan baris data apa pun.
begin;

drop policy if exists tier_settings_insert on public.tier_settings;
create policy tier_settings_insert on public.tier_settings
  for insert to authenticated
  with check ((select public.is_admin()));

insert into supabase_migrations.schema_migrations(version, name, statements)
values ('20261029140000', 'tier_settings_insert_policy', array[
  'drop policy if exists tier_settings_insert on public.tier_settings',
  'create policy tier_settings_insert on public.tier_settings for insert to authenticated with check ((select public.is_admin()))'
])
on conflict (version) do nothing;

commit;
