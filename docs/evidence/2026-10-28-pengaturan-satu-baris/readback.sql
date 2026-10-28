-- READ-ONLY. Jalankan setelah apply.sql.
-- Harapan: tier_settings_insert:INSERT ada dengan with_check memanggil is_admin(),
-- migrasi tercatat, jumlah baris data TIDAK berubah dibanding preflight.
select policyname, cmd, roles::text, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'tier_settings'
order by policyname;

select 'tier_settings rows' as cek, count(*)::text as nilai from public.tier_settings
union all select 'payroll_settings rows', count(*)::text from public.payroll_settings
union all select 'migration 20261029140000 recorded', exists(
  select 1 from supabase_migrations.schema_migrations where version = '20261029140000')::text;
