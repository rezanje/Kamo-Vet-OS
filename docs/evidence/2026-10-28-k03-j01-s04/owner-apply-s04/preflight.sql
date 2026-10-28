-- S04 PREFLIGHT — READ ONLY. Semua baris harus ok = true. Jangan salin keluaran production ke repo/PR.
with checks(check_name, ok) as (
  select 'tabel service_commission_policies belum ada', to_regclass('public.service_commission_policies') is null
  union all select 'nama index service_commission_policies_scope_date masih bebas', to_regclass('public.service_commission_policies_scope_date') is null
  union all select 'S04 belum tercatat di riwayat migrasi', not exists(select 1 from supabase_migrations.schema_migrations where version='20261026002000')
  union all select 'tabel branches dan profiles ada (FK & RLS migrasi)', to_regclass('public.branches') is not null and to_regclass('public.profiles') is not null
  union all select 'kolom profiles.role & profiles.is_active ada',
    (select count(*) from information_schema.columns where table_schema='public' and table_name='profiles' and column_name in ('id','role','is_active')) = 3
  union all select 'fungsi auth.uid() dan gen_random_uuid() tersedia',
    to_regprocedure('auth.uid()') is not null and to_regprocedure('gen_random_uuid()') is not null
  union all select 'role anon/authenticated/service_role ada',
    (select count(*) from pg_roles where rolname in ('anon','authenticated','service_role')) = 3
  union all select 'tepat satu OWNER aktif (dipakai sebagai pencatat baris kebijakan)',
    (select count(*) from public.profiles where role='OWNER' and is_active) = 1
)
select check_name, coalesce(ok,false) as ok from checks
union all select 'SUMMARY: ' || count(*) filter (where not coalesce(ok,false)) || ' failed', bool_and(coalesce(ok,false)) from checks;
