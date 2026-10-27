-- H02–H06 PREFLIGHT — READ ONLY. Run as one query in the Supabase SQL editor. Nothing here writes.
-- Every row must show ok = true and the SUMMARY row "0 failed". Run on the target project BEFORE apply.sql.
with post_invoice as (
  select pg_get_functiondef('public.clinic_post_invoice(uuid,text,jsonb,jsonb)'::regprocedure) as def
), anchors(name, anchor) as (values
  ('clinic_post_invoice insert column anchor', E'service_performers, bmhp_components, salesperson_id\n    ) values'),
  ('clinic_post_invoice values anchor', E'v_bmhp, nullif(v_line.value->>''salesperson_id'','''')::uuid\n    ) returning')
), checks(check_name, ok, detail) as (
  -- clinic_post_invoice must still be the reviewed definition (exactly one anchor each), or already patched by H05.
  select a.name, (length(p.def) - length(replace(p.def, a.anchor, ''))) / length(a.anchor) = 1 or position('package_item_id' in p.def) > 0,
    'expect exactly one anchor (or already applied)'
  from anchors a cross join post_invoice p
  union all select 'HRIS access helpers present (20261027030000)',
    to_regprocedure('private.is_hris_owner()') is not null and to_regprocedure('private.can_read_hris_money()') is not null, 'required for H02 RLS'
  union all select 'item_group_components present', to_regclass('public.item_group_components') is not null, 'H05 validates the package recipe'
  union all select 'inpatient doctor visit columns present',
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='inpatient_daily_logs' and column_name='visit_doctor_id'), 'H06 source'
  union all select 'invoice_items.service_source_line_id present',
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='invoice_items' and column_name='service_source_line_id'), 'H05 inheritance on correction/reissue'
  union all select 'commission_rules.sumber values fit the new list',
    not exists(select 1 from public.commission_rules where sumber not in ('semua','kasir','klinik','reseller','visit_ranap')), 'new check constraint must validate'
  union all select 'no view depends on commission_rules.sumber',
    not exists(select 1 from pg_depend d join pg_rewrite r on r.oid = d.objid
      where d.refobjid = 'public.commission_rules'::regclass
        and d.refobjsubid = (select attnum from pg_attribute where attrelid='public.commission_rules'::regclass and attname='sumber')),
    'column is widened to varchar(16)'
  union all select 'salary_components values fit the new checks',
    not exists(select 1 from public.salary_components where nominal < 0), 'existing rows stay fixed components'
)
select check_name, ok, detail from checks
union all select 'SUMMARY', bool_and(ok), count(*) filter (where not ok) || ' failed' from checks;
