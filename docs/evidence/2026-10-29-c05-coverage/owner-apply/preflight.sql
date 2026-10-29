-- C05 follow-up (group payment + back-office) preflight. READ-ONLY: safe to run any time.
-- Every row must show ok = true (rows starting with "info" are numbers to read). Stop if any row is false.
with f as (
  select pg_get_functiondef('public.campaign_code_used(text)'::regprocedure) used_def,
         pg_get_functiondef('public.guard_campaign_code_use()'::regprocedure) guard_def,
         pg_get_functiondef('public.clinic_post_invoice(uuid,text,jsonb,jsonb)'::regprocedure) post_def
), anchors(fn, a) as (
  values
  ('used',  '+ (select count(*) from public.invoices i where i.campaign_code = p_code and i.voided_at is null)'),
  ('guard', 'src_id uuid; src_code text; src_voucher text;'),
  ('guard', E'    if new.campaign_code is distinct from old.campaign_code then\n'),
  ('guard', E'    select i.campaign_code, i.voucher_code into src_code, src_voucher\n'),
  ('guard', E'    if new.campaign_code is null then new.campaign_code := src_code; end if;\n'),
  ('guard', E'  if k.max_uses is not null then\n    v_used := public.campaign_code_used(k.code);\n'),
  ('post',  'paid_status, metode_bayar, paid_at, shift_id, voucher_code, salesperson_id, service_pricing_version, campaign_code'),
  ('post',  E'nullif(p_invoice->>''campaign_code'','''')')
)
select 'C05 base step is applied (campaign_codes table, sales/invoices.campaign_code)' as check_name,
  to_regclass('public.campaign_codes') is not null
  and (select count(*) from information_schema.columns where table_schema = 'public'
       and table_name in ('sales', 'invoices') and column_name = 'campaign_code') = 2 as ok
union all
select 'anchor ' || row_number() over () || ' (' || a.fn || ') present exactly once (or function already patched)',
  case a.fn
    when 'used'  then position('campaign_group' in f.used_def) > 0
                      or (length(f.used_def) - length(replace(f.used_def, a.a, ''))) / length(a.a) = 1
    when 'guard' then position('campaign_group' in f.guard_def) > 0
                      or (length(f.guard_def) - length(replace(f.guard_def, a.a, ''))) / length(a.a) = 1
    else              position('campaign_group' in f.post_def) > 0
                      or (length(f.post_def) - length(replace(f.post_def, a.a, ''))) / length(a.a) = 1
  end
from anchors a cross join f
union all
select 'invoices.campaign_group not yet used by something else',
  not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoices'
    and column_name = 'campaign_group' and (data_type <> 'character varying' or character_maximum_length is distinct from 60))
union all
select 'constraint/index names free (or ours)',
  not exists (select 1 from pg_constraint where conname = 'invoices_campaign_group_needs_code'
              and pg_get_constraintdef(oid) <> 'CHECK (((campaign_group IS NULL) OR (campaign_code IS NOT NULL)))')
  and coalesce((select indrelid = 'public.invoices'::regclass from pg_index where indexrelid = to_regclass('public.invoices_campaign_group_idx')), true)
union all
select 'info: live invoices already carrying a campaign code = ' || count(*) || ' (stay counted one per invoice)', true
from public.invoices where campaign_code is not null and voided_at is null;
