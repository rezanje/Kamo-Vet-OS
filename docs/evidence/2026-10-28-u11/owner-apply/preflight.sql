-- U11 PREFLIGHT — READ ONLY. Semua baris harus ok = true.
with checks(check_name, ok) as (
  select 'tabel branches ada', to_regclass('public.branches') is not null
  union all select 'enum branch_type berisi 6 jenis yang dipakai form', (select count(*) from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='branch_type' and e.enumlabel in ('PETSHOP','KLINIK','BOTH','DC','ONLINE','OFFICE')) = 6
  union all select 'nama fungsi create_branch masih bebas', to_regprocedure('public.create_branch(text,text,text,boolean)') is null
  union all select 'branches belum punya policy INSERT (pembuatan hanya lewat RPC)', not exists(select 1 from pg_policies where schemaname='public' and tablename='branches' and cmd in ('INSERT','ALL'))
  union all select 'U11 belum tercatat di riwayat migrasi', not exists(select 1 from supabase_migrations.schema_migrations where version='20261028131000')
)
select check_name, ok from checks
union all select 'SUMMARY: ' || count(*) filter (where not ok) || ' failed', bool_and(ok) from checks;
