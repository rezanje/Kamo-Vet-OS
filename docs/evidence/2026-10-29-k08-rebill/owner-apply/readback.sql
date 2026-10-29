-- K08 REBILL READBACK - READ ONLY. Run after apply.sql; every row must show ok = true (SUMMARY: 0 failed).
begin transaction read only;
with fn as (
  select pg_get_functiondef(p.oid) as def, p.prosecdef, p.proconfig
  from pg_proc p where p.oid = to_regprocedure('public.clinic_change_inpatient_condition(uuid,text,text)')
), checks(name, ok) as (values
  ('discharge RPC exists', exists(select 1 from fn)),
  ('K08 rebill block present exactly once',
    coalesce((select (length(def) - length(replace(def, 'K08_REBILL_PERIODS_BEGIN', ''))) / length('K08_REBILL_PERIODS_BEGIN') = 1
      and position('K08_REBILL_PERIODS_END' in def) > 0 from fn), false)),
  ('fee sums every discharged stay of the visit',
    coalesce((select position('where r.visit_id = v_record.visit_id and r.discharged_at is not null' in def) > 0 from fn), false)),
  ('earlier automatic lines of the visit are replaced, not kept',
    coalesce((select position('p.aturan_pakai like ''Otomatis dari lama rawat inap: %''' in def) > 0 from fn), false)),
  ('old single-stay fee formula gone',
    coalesce((select position('(v_discharged_at - v_record.admitted_at)) / 86400' in def) = 0 from fn), false)),
  ('INVOICE_EXISTS guard kept (no discharge while the visit has an active invoice)',
    coalesce((select position('INVOICE_EXISTS' in def) > 0 from fn), false)),
  ('forced-discharge consent guard kept',
    coalesce((select position('CONSENT_REQUIRED: tandatangani form Pulang Paksa' in def) > 0 from fn), false)),
  ('SECURITY DEFINER with empty search_path kept',
    coalesce((select prosecdef and proconfig = array['search_path=""'] from fn), false)),
  ('executable by authenticated, not by anon',
    has_function_privilege('authenticated', 'public.clinic_change_inpatient_condition(uuid,text,text)', 'execute')
    and not has_function_privilege('anon', 'public.clinic_change_inpatient_condition(uuid,text,text)', 'execute')),
  ('migration history row 20261029152000 present',
    to_regclass('supabase_migrations.schema_migrations') is not null
    and exists(select 1 from supabase_migrations.schema_migrations where version = '20261029152000'))
)
select name, ok from checks
union all
select 'SUMMARY: ' || count(*) filter (where not ok) || ' failed', count(*) filter (where not ok) = 0 from checks;
rollback;
