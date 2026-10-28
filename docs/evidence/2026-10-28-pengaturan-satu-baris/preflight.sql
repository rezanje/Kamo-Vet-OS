-- READ-ONLY. Jalankan sebelum apply.sql. Tidak mengubah apa pun.
-- Harapan saat ditulis (28 Okt 2026): payroll_settings 0 baris, tier_settings 0 baris,
-- policy tier_settings_insert belum ada, public.is_admin() ada.
select 'payroll_settings rows' as cek, count(*)::text as nilai from public.payroll_settings
union all select 'tier_settings rows', count(*)::text from public.tier_settings
union all select 'company_settings rows', count(*)::text from public.company_settings
union all select 'tier_settings policies', coalesce(string_agg(policyname || ':' || cmd, ', ' order by policyname), '-')
  from pg_policies where schemaname = 'public' and tablename = 'tier_settings'
union all select 'payroll_settings policies', coalesce(string_agg(policyname || ':' || cmd, ', ' order by policyname), '-')
  from pg_policies where schemaname = 'public' and tablename = 'payroll_settings'
union all select 'public.is_admin() exists', (to_regprocedure('public.is_admin()') is not null)::text
union all select 'tier_settings RLS enabled', relrowsecurity::text from pg_class where oid = 'public.tier_settings'::regclass
union all select 'migration 20261029140000 recorded', exists(
  select 1 from supabase_migrations.schema_migrations where version = '20261029140000')::text;
