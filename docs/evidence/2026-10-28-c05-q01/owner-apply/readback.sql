-- C05 + Q01 readback. READ-ONLY: run after apply. Every row must show ok = true.
select 'Q01 claim table exists, RLS on, no client grants' as check_name,
  coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.quest_new_customer_claims')), false)
  and not has_table_privilege('authenticated', 'public.quest_new_customer_claims', 'SELECT')
  and not has_table_privilege('anon', 'public.quest_new_customer_claims', 'SELECT') as ok
union all
select 'Q01 triggers (claim on finalize, release on void, import mark immutable)',
  (select count(*) from pg_trigger where tgname in ('q01_claim_new_customer', 'q01_release_new_customer',
     'q01_customer_imported_at') and tgenabled = 'O') = 3
  and exists (select 1 from information_schema.columns where table_schema = 'public'
     and table_name = 'customers' and column_name = 'imported_at')
union all
select 'Q01 quest effect function reads claims; ACL unchanged (authenticated only)',
  position('quest_new_customer_claims' in pg_get_functiondef('public.apply_sale_staff_effects(uuid)'::regprocedure)) > 0
  and has_function_privilege('authenticated', 'public.apply_sale_staff_effects(uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.apply_sale_staff_effects(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.apply_sale_staff_effects(uuid)', 'EXECUTE')
union all
select 'Q01 quest target new_customer allowed',
  pg_get_constraintdef((select oid from pg_constraint where conname = 'staff_quest_definitions_target_kind_check')) like '%new_customer%'
union all
select 'C05 campaign_codes exists with RLS + 4 policies',
  coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.campaign_codes')), false)
  and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'campaign_codes') = 4
union all
select 'C05 columns on sales and invoices',
  (select count(*) from information_schema.columns where table_schema = 'public'
    and table_name in ('sales', 'invoices') and column_name = 'campaign_code') = 2
union all
select 'C05 triggers (use guard on sales/invoices, cap re-check at payment, collision on codes/vouchers)',
  (select count(*) from pg_trigger where tgname in ('c05_sale_campaign_code', 'c05_invoice_campaign_code',
     'c05_sale_campaign_code_finalize', 'c05_campaign_code_collision', 'c05_voucher_code_collision') and tgenabled = 'O') = 5
union all
select 'C05 trigger functions not callable by clients',
  not has_function_privilege('authenticated', 'public.guard_campaign_code_use()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.guard_campaign_code_finalize()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.campaign_code_used(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.guard_campaign_code_collision()', 'EXECUTE')
union all
select 'C05 clinic posting stores campaign_code; ACL unchanged',
  position('campaign_code' in pg_get_functiondef('public.clinic_post_invoice(uuid,text,jsonb,jsonb)'::regprocedure)) > 0
  and has_function_privilege('authenticated', 'public.clinic_post_invoice(uuid,text,jsonb,jsonb)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.clinic_post_invoice(uuid,text,jsonb,jsonb)', 'EXECUTE')
union all
select 'C05 usage report: managers only',
  has_function_privilege('authenticated', 'public.campaign_code_usage()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.campaign_code_usage()', 'EXECUTE');
