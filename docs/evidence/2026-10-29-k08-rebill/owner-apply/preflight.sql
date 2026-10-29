-- K08 REBILL PREFLIGHT - READ ONLY. Nothing here writes (the whole file runs in a read-only
-- transaction that is rolled back). Run it before apply.sql.
--
-- Query 1 must show ok = true on every row (SUMMARY: 0 failed). Query A/B/C are informational lists
-- of production stays touched by the bug; they do NOT block apply and apply does NOT change them.
-- Each list needs a decision with the clinic/finance (see verification.md, "Data lama").
begin transaction read only;

-- ===== Query 1: is the database ready for apply.sql? =====
with fn as (
  select pg_get_functiondef(p.oid) as def, p.prosecdef, p.proconfig
  from pg_proc p where p.oid = to_regprocedure('public.clinic_change_inpatient_condition(uuid,text,text)')
), anchors(decl, fee) as (values (
  E'  v_discharged_at timestamptz;\nbegin\n',
  E'        v_days := greatest(1, ceil(extract(epoch from\n'
  || E'          (v_discharged_at - v_record.admitted_at)) / 86400)::integer);\n'
  || E'        delete from public.prescription_items\n'
  || E'        where medical_record_id=v_medical_record_id and item_id=v_tariff.id;\n'
  || E'        insert into public.prescription_items(\n'
  || E'          medical_record_id, item_id, nama_obat, qty, harga, satuan,\n'
  || E'          jenis, kategori, aturan_pakai\n'
  || E'        ) values (\n'
  || E'          v_medical_record_id, v_tariff.id, v_tariff.name, v_days,\n'
  || E'          coalesce(v_tariff.sell_price, 0), coalesce(v_tariff.unit, ''hari''),\n'
  || E'          ''jasa'', ''Rawat Inap'',\n'
  || E'          ''Otomatis dari lama rawat inap: '' || v_days || '' hari''\n'
  || E'        );\n'
)), checks(name, ok) as (values
  ('discharge RPC clinic_change_inpatient_condition(uuid,text,text) exists', exists(select 1 from fn)),
  ('K08 rebill patch not applied yet (marker K08_REBILL_PERIODS absent)',
    coalesce((select position('K08_REBILL_PERIODS' in def) = 0 from fn), false)),
  ('declaration anchor present exactly once',
    coalesce((select (length(def) - length(replace(def, a.decl, ''))) / length(a.decl) = 1 from fn, anchors a), false)),
  ('stay-fee anchor present exactly once (definition matches main)',
    coalesce((select (length(def) - length(replace(def, a.fee, ''))) / length(a.fee) = 1 from fn, anchors a), false)),
  ('discharge still refuses a visit with an active invoice (INVOICE_EXISTS guard)',
    coalesce((select position('INVOICE_EXISTS' in def) > 0 from fn), false)),
  ('SECURITY DEFINER with empty search_path',
    coalesce((select prosecdef and proconfig = array['search_path=""'] from fn), false)),
  ('executable by authenticated, not by anon',
    has_function_privilege('authenticated', 'public.clinic_change_inpatient_condition(uuid,text,text)', 'execute')
    and not has_function_privilege('anon', 'public.clinic_change_inpatient_condition(uuid,text,text)', 'execute')),
  ('columns used by the patch exist',
    (select count(*) from information_schema.columns where table_schema = 'public' and (
      (table_name = 'inpatient_records' and column_name in ('visit_id','admitted_at','discharged_at'))
      or (table_name = 'prescription_items' and column_name in ('medical_record_id','item_id','kategori','jenis','aturan_pakai','qty'))
      or (table_name = 'medical_records' and column_name in ('id','visit_id')))) = 11),
  ('migration history table present', to_regclass('supabase_migrations.schema_migrations') is not null)
)
select name, ok from checks
union all
select 'already applied (informational): history row 20261029152000 present',
  to_regclass('supabase_migrations.schema_migrations') is not null
  and exists(select 1 from supabase_migrations.schema_migrations where version = '20261029152000')
union all
select 'SUMMARY: ' || count(*) filter (where not ok) || ' failed', count(*) filter (where not ok) = 0 from checks;

-- ===== Query A: visits with more than one stay whose automatic stay fee is short (the bug) =====
-- expected_days = every discharged stay of the visit, each rounded up per started 24 hours.
-- auto_line_days = what the automatic "Rawat Inap" line currently bills. invoiced_stay_days = stay-fee
-- quantity on the visit's active invoice (if any). A row here = days that were never billed.
with stay as (
  select r.visit_id, r.admitted_at, r.discharged_at,
    case when r.discharged_at is not null then
      greatest(1, ceil(extract(epoch from (r.discharged_at - r.admitted_at)) / 86400)::integer) end as days
  from public.inpatient_records r
), per_visit as (
  select visit_id, count(*) as stays, count(*) filter (where discharged_at is not null) as discharged,
    coalesce(sum(days), 0) as expected_days,
    string_agg(to_char(admitted_at at time zone 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI') || ' s/d '
      || coalesce(to_char(discharged_at at time zone 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI'), 'masih dirawat')
      || ' = ' || coalesce(days::text, '-') || ' hari', '; ' order by admitted_at) as periods
  from stay group by visit_id having count(*) > 1
), auto as (
  select m.visit_id, count(*) as lines, sum(p.qty) as days
  from public.prescription_items p join public.medical_records m on m.id = p.medical_record_id
  where p.kategori = 'Rawat Inap' and p.jenis = 'jasa' and p.aturan_pakai like 'Otomatis dari lama rawat inap: %'
  group by m.visit_id
), inv as (
  select i.visit_id, i.invoice_no, i.paid_status,
    (select coalesce(sum(ii.qty), 0) from public.invoice_items ii
      join public.prescription_items p on p.id = ii.prescription_item_id
      where ii.invoice_id = i.id and p.kategori = 'Rawat Inap') as invoiced_stay_days
  from public.invoices i where i.voided_at is null
)
select 'A under-billed' as list, b.code as branch, v.id as visit_id, v.status as visit_status,
  s.stays, s.discharged, s.expected_days, coalesce(a.days, 0) as auto_line_days, coalesce(a.lines, 0) as auto_lines,
  inv.invoice_no, inv.paid_status, inv.invoiced_stay_days, s.periods
from per_visit s
join public.visits v on v.id = s.visit_id
left join public.branches b on b.id = v.branch_id
left join auto a on a.visit_id = s.visit_id
left join inv on inv.visit_id = s.visit_id
where coalesce(a.days, 0) < s.expected_days
order by v.created_at;

-- ===== Query B: visits with more than one automatic stay-fee line (double billing risk) =====
select 'B duplicate auto lines' as list, b.code as branch, m.visit_id, count(*) as auto_lines, sum(p.qty) as total_days,
  string_agg(p.nama_obat || ' x' || p.qty || ' @' || p.harga, '; ' order by p.created_at) as lines,
  (select i.invoice_no || ' (' || i.paid_status || ')' from public.invoices i
    where i.visit_id = m.visit_id and i.voided_at is null) as active_invoice
from public.prescription_items p
join public.medical_records m on m.id = p.medical_record_id
join public.visits v on v.id = m.visit_id
left join public.branches b on b.id = v.branch_id
where p.kategori = 'Rawat Inap' and p.jenis = 'jasa' and p.aturan_pakai like 'Otomatis dari lama rawat inap: %'
group by b.code, m.visit_id
having count(*) > 1
order by m.visit_id;

-- ===== Query C: open stays on a visit that already has an active invoice =====
-- These cannot be discharged (INVOICE_EXISTS) - typically a stay reopened ("Stabil"/"Kritis" after
-- "Sembuh") after the invoice was issued. Unchanged by apply.sql; needs a clinic/finance decision.
select 'C open stay with active invoice' as list, b.code as branch, r.visit_id, r.id as stay_id, r.condition_status,
  r.admitted_at at time zone 'Asia/Jakarta' as admitted_wib,
  (select max(l.changed_at) at time zone 'Asia/Jakarta' from public.inpatient_status_log l
    where l.inpatient_record_id = r.id and l.previous_status in ('sembuh','rip')) as reopened_wib,
  i.invoice_no, i.paid_status
from public.inpatient_records r
join public.invoices i on i.visit_id = r.visit_id and i.voided_at is null
join public.visits v on v.id = r.visit_id
left join public.branches b on b.id = v.branch_id
where r.discharged_at is null
order by r.admitted_at;

rollback;
