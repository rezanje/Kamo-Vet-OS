-- Q01 atomic quest progress: preflight. READ-ONLY (SELECT only): safe to run any time.
-- Every row must show ok = true. Rows starting with "info:" only report numbers and are always true.
-- Stop if any check row is false.
with fn as (
  select pg_get_functiondef('public.apply_sale_staff_effects(uuid)'::regprocedure) d,
         'CREATE OR REPLACE FUNCTION public.apply_sale_staff_effects(p_sale_id uuid)' h,
         E' if not found or auth.uid() is null or auth.role() is distinct from ''authenticated'' or s.cashier_id is distinct from auth.uid() then raise exception ''Penjualan tidak dapat diakses'' using errcode=''42501'';end if;\n'
           || E' perform public.pos_sale_assert_actor(s);\n' a,
         to_regprocedure('public.sale_staff_effects_apply(uuid)') is not null already
)
select 'Q01 new-customer quest already applied (claim table, claim trigger, patched effect function)' as check_name,
  to_regclass('public.quest_new_customer_claims') is not null
  and exists (select 1 from pg_trigger where tgrelid = 'public.sales'::regclass and tgname = 'q01_claim_new_customer')
  and (already or position('quest_new_customer_claims' in d) > 0) as ok
from fn
union all
select 'anchor: effect function header and caller-check lines present exactly once (or already applied)',
  already or ((length(d) - length(replace(d, h, ''))) / length(h) = 1
              and (length(d) - length(replace(d, a, ''))) / length(a) = 1
              and position('auth.' in replace(d, a, '')) = 0)
from fn
union all
select 'already applied: client RPC delegates to the internal function (or not applied yet)',
  not already or position('public.sale_staff_effects_apply(' in d) > 0
from fn
union all
select 'no foreign object named q01_staff_effects / sale_staff_effects_apply (or already applied)',
  (select coalesce(bool_and(tgfoid = coalesce(to_regprocedure('public.apply_sale_staff_effects_on_finalize()')::oid, 0)), true)
     from pg_trigger where tgrelid = 'public.sales'::regclass and tgname = 'q01_staff_effects')
union all
select 'info: Q01 claims whose quest progress was never recorded = '
  || case when to_regclass('public.quest_new_customer_claims') is null then 'n/a (Q01 not applied)'
     else (xpath('/row/n/text()', query_to_xml(
       'select count(*) as n from public.quest_new_customer_claims c
         where not exists (select 1 from public.sale_staff_effects e where e.sale_id = c.sale_id)', false, true, '')))[1]::text end,
  true
union all
select 'info: those receipts (first 50) = '
  || case when to_regclass('public.quest_new_customer_claims') is null then 'n/a'
     else coalesce((xpath('/row/r/text()', query_to_xml(
       'select string_agg(s.no_struk || '' @ '' || to_char(c.claimed_at at time zone ''Asia/Jakarta'', ''YYYY-MM-DD HH24:MI''), '', '' order by c.claimed_at) as r
          from (select * from public.quest_new_customer_claims c
                 where not exists (select 1 from public.sale_staff_effects e where e.sale_id = c.sale_id)
                 order by c.claimed_at limit 50) c join public.sales s on s.id = c.sale_id', false, true, '')))[1]::text, '-') end,
  true
union all
select 'info: paid POS receipts (last 30 days, not void) without staff effects: kasir = '
  || count(*) filter (where s.shift_id is not null) || ', back office (/pos/transaksi, no shift) = '
  || count(*) filter (where s.shift_id is null),
  true
from public.sales s
where s.channel is null and s.quest_effects_tracked and s.voided_at is null
  and s.payments_finalized_at >= now() - interval '30 days'
  and not exists (select 1 from public.sale_staff_effects e where e.sale_id = s.id)
union all
select 'info: receipts still waiting for payment (they get staff effects when paid after apply) = ' || count(*),
  true
from public.sales s
where s.channel is null and s.quest_effects_tracked and s.voided_at is null
  and s.payment_plan is not null and s.payments_finalized_at is null;
