-- Q01 atomic quest progress: readback. READ-ONLY: run after apply.sql. Every row must show ok = true.
select 'internal effect function exists, carries the new-customer rule, has no caller checks, not callable by clients' as check_name,
  to_regprocedure('public.sale_staff_effects_apply(uuid)') is not null
  and position('quest_new_customer_claims' in pg_get_functiondef('public.sale_staff_effects_apply(uuid)'::regprocedure)) > 0
  and position('auth.' in pg_get_functiondef('public.sale_staff_effects_apply(uuid)'::regprocedure)) = 0
  and not has_function_privilege('authenticated', 'public.sale_staff_effects_apply(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.sale_staff_effects_apply(uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.sale_staff_effects_apply(uuid)', 'EXECUTE') as ok
union all
select 'client RPC keeps its caller checks, delegates, ACL unchanged (authenticated only)',
  position('public.sale_staff_effects_apply(' in pg_get_functiondef('public.apply_sale_staff_effects(uuid)'::regprocedure)) > 0
  and position('pos_sale_assert_actor' in pg_get_functiondef('public.apply_sale_staff_effects(uuid)'::regprocedure)) > 0
  and has_function_privilege('authenticated', 'public.apply_sale_staff_effects(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.apply_sale_staff_effects(uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.apply_sale_staff_effects(uuid)', 'EXECUTE')
union all
select 'finalizer trigger q01_staff_effects enabled, AFTER UPDATE OF payments_finalized_at, function private',
  exists (select 1 from pg_trigger t where t.tgrelid = 'public.sales'::regclass and t.tgname = 'q01_staff_effects'
            and t.tgenabled = 'O' and not t.tgisinternal
            and t.tgfoid = 'public.apply_sale_staff_effects_on_finalize()'::regprocedure
            and pg_get_triggerdef(t.oid) like '%AFTER UPDATE OF payments_finalized_at ON public.sales FOR EACH ROW%')
  and not has_function_privilege('authenticated', 'public.apply_sale_staff_effects_on_finalize()', 'EXECUTE')
union all
select 'claim trigger still enabled and fires before the staff effects trigger (name order)',
  (select array_agg(tgname::text order by tgname) from pg_trigger
    where tgrelid = 'public.sales'::regclass and tgname in ('q01_claim_new_customer', 'q01_staff_effects') and tgenabled = 'O')
  = array['q01_claim_new_customer', 'q01_staff_effects']
union all
select 'void path unchanged (reversal + claim release present)',
  to_regprocedure('public.reverse_sale_staff_effects(public.sales,uuid)') is not null
  and exists (select 1 from pg_trigger where tgrelid = 'public.sales'::regclass and tgname = 'q01_release_new_customer' and tgenabled = 'O')
  and position('reverse_sale_staff_effects' in pg_get_functiondef('public.cancel_posted_sale(uuid,integer,text,text)'::regprocedure)) > 0
union all
select 'info: Q01 claims whose quest progress was never recorded (history, not backfilled) = ' || count(*), true
from public.quest_new_customer_claims c
where not exists (select 1 from public.sale_staff_effects e where e.sale_id = c.sale_id);
