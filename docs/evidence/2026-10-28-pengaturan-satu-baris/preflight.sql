-- READ-ONLY. Jalankan sebelum apply.sql. Tidak mengubah apa pun.
-- Harapan saat ditulis (28 Okt 2026): payroll_settings 0 baris, tier_settings 0 baris,
-- company_settings 1 baris; policy tier hanya SELECT+UPDATE; policy company_settings hanya
-- csettings_all:ALL (true); is_admin() dan private.is_hris_owner() ada; kedua migrasi belum tercatat.
select 'payroll_settings rows' as cek, count(*)::text as nilai from public.payroll_settings
union all select 'tier_settings rows', count(*)::text from public.tier_settings
union all select 'company_settings rows', count(*)::text from public.company_settings
union all select 'tier_settings policies', coalesce(string_agg(policyname || ':' || cmd, ', ' order by policyname), '-')
  from pg_policies where schemaname = 'public' and tablename = 'tier_settings'
union all select 'company_settings policies', coalesce(string_agg(policyname || ':' || cmd || ':' || coalesce(qual, '-'), ', ' order by policyname), '-')
  from pg_policies where schemaname = 'public' and tablename = 'company_settings'
union all select 'payroll_settings policies', coalesce(string_agg(policyname || ':' || cmd, ', ' order by policyname), '-')
  from pg_policies where schemaname = 'public' and tablename = 'payroll_settings'
union all select 'public.is_admin() exists', (to_regprocedure('public.is_admin()') is not null)::text
union all select 'private.is_hris_owner() exists', (to_regprocedure('private.is_hris_owner()') is not null)::text
union all select 'active OWNER accounts', count(*)::text from public.profiles where role = 'OWNER' and is_active
union all select 'tier_settings RLS enabled', relrowsecurity::text from pg_class where oid = 'public.tier_settings'::regclass
union all select 'company_settings RLS enabled', relrowsecurity::text from pg_class where oid = 'public.company_settings'::regclass
union all select 'migrations recorded (20261029140000, 20261029140500)', coalesce(string_agg(version, ', ' order by version), '-')
  from supabase_migrations.schema_migrations where version in ('20261029140000', '20261029140500');
