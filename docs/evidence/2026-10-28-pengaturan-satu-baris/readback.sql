-- READ-ONLY. Jalankan setelah apply.sql.
-- Harapan:
--   tier_settings: tier_settings_insert:INSERT (with_check is_admin), _read:SELECT, _write:UPDATE
--   company_settings: csettings_owner_write:ALL (is_hris_owner), csettings_select:SELECT (true);
--                     csettings_all TIDAK ada lagi
--   kedua migrasi tercatat; jumlah baris data sama dengan preflight.
select tablename, policyname, cmd, roles::text, qual, with_check
from pg_policies
where schemaname = 'public' and tablename in ('tier_settings', 'company_settings')
order by tablename, policyname;

select 'tier_settings rows' as cek, count(*)::text as nilai from public.tier_settings
union all select 'payroll_settings rows', count(*)::text from public.payroll_settings
union all select 'company_settings rows', count(*)::text from public.company_settings
union all select 'migrations recorded (20261029140000, 20261029140500)', coalesce(string_agg(version, ', ' order by version), '-')
  from supabase_migrations.schema_migrations where version in ('20261029140000', '20261029140500');
