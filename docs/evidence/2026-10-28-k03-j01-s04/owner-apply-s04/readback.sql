-- S04 READBACK — READ ONLY. Semua baris harus ok = true.
-- Sebelum apply, file ini berhenti dengan galat "relation ... does not exist" (tabel belum ada) — itu wajar.
with checks(check_name, ok) as (
  select 'tabel service_commission_policies ada, RLS aktif & dipaksa',
    (select relrowsecurity and relforcerowsecurity from pg_class where oid=to_regclass('public.service_commission_policies'))
  union all select 'policy baca & tulis ada',
    (select count(*) from pg_policies where schemaname='public' and tablename='service_commission_policies'
      and policyname in ('service_commission_policies_read','service_commission_policies_insert')) = 2
  union all select 'authenticated boleh SELECT/INSERT (kolom terbatas, tanpa created_by), tidak UPDATE/DELETE; anon tidak boleh baca',
    has_table_privilege('authenticated','public.service_commission_policies','select')
    and has_column_privilege('authenticated','public.service_commission_policies','mode','insert')
    and not has_column_privilege('authenticated','public.service_commission_policies','created_by','insert')
    and not has_table_privilege('authenticated','public.service_commission_policies','update')
    and not has_table_privilege('authenticated','public.service_commission_policies','delete')
    and not has_table_privilege('anon','public.service_commission_policies','select')
  union all select 'kebijakan pemilik tercatat: semua cabang, mulai 2026-11-01, personal_rules',
    exists(select 1 from public.service_commission_policies p join public.profiles o on o.id=p.created_by and o.role='OWNER'
      where p.branch_id is null and p.effective_from=date '2026-11-01' and p.mode='personal_rules'
        and p.doctor_share_pct is null and p.staff_share_pct is null)
  union all select 'tidak ada kebijakan lain yang menimpa (tanggal >= 2026-11-01, semua cabang, dibuat sesudahnya)',
    not exists(select 1 from public.service_commission_policies a where a.branch_id is null and a.effective_from >= date '2026-11-01'
      and a.mode <> 'personal_rules')
  union all select 'S04 tercatat di riwayat migrasi', exists(select 1 from supabase_migrations.schema_migrations where version='20261026002000')
)
select check_name, coalesce(ok,false) as ok from checks
union all select 'SUMMARY: ' || count(*) filter (where not coalesce(ok,false)) || ' failed', bool_and(coalesce(ok,false)) from checks;
