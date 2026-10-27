-- C05 + Q01 preflight. READ-ONLY: safe to run any time. Every row must show ok = true
-- (rows marked "info" are just numbers to read). Stop if any check row is false.
select 'anchor: apply_sale_staff_effects total_sales_amount line present once (or already patched)' as check_name,
  (position('quest_new_customer_claims' in pg_get_functiondef('public.apply_sale_staff_effects(uuid)'::regprocedure)) > 0
   or (length(d) - length(replace(d, a, ''))) / length(a) = 1) as ok
from (select pg_get_functiondef('public.apply_sale_staff_effects(uuid)'::regprocedure) d,
             E'  if q.target_kind=''total_sales_amount'' then amount:=s.total-coalesce(s.merchant_fee_total,0);' a) x
union all
select 'anchor: clinic_post_invoice invoice insert present once (or already patched)',
  (position('campaign_code' in d) > 0
   or ((length(d) - length(replace(d, c, ''))) / length(c) = 1
       and (length(d) - length(replace(d, v, ''))) / length(v) = 1))
from (select pg_get_functiondef('public.clinic_post_invoice(uuid,text,jsonb,jsonb)'::regprocedure) d,
             'paid_status, metode_bayar, paid_at, shift_id, voucher_code, salesperson_id, service_pricing_version' c,
             E'v_shift.id, v_voucher, v_salesperson_id, nullif(p_invoice->>''service_pricing_version'','''')::smallint' v) x
union all
select 'quest target kinds are the expected set (or already include new_customer)',
  pg_get_constraintdef(oid) in (
    $$CHECK ((target_kind = ANY (ARRAY['product_qty'::text, 'category_qty'::text, 'total_sales_amount'::text])))$$,
    $$CHECK ((target_kind = ANY (ARRAY['product_qty'::text, 'category_qty'::text, 'total_sales_amount'::text, 'new_customer'::text])))$$)
from pg_constraint where conname = 'staff_quest_definitions_target_kind_check'
union all
select 'no voucher code would break the campaign code format later (info: upper-case only)',
  not exists (select 1 from public.vouchers where code <> upper(code))
union all
select 'sales.campaign_code / invoices.campaign_code not yet used by something else',
  not exists (select 1 from information_schema.columns where table_schema = 'public'
    and table_name in ('sales','invoices') and column_name = 'campaign_code'
    and (character_maximum_length is distinct from 24 or data_type <> 'character varying'))
union all
select 'info: customers with a usable phone identity = ' || count(*) filter (where length(regexp_replace(phone, '[^0-9]', '', 'g')) >= 8), true
from public.customers;
