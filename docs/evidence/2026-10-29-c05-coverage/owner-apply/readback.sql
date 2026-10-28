-- C05 follow-up readback. READ-ONLY: run after apply. Every row must show ok = true.
select 'invoices.campaign_group varchar(60) + needs-code check + index' as check_name,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoices'
          and column_name = 'campaign_group' and data_type = 'character varying' and character_maximum_length = 60)
  and exists (select 1 from pg_constraint where conname = 'invoices_campaign_group_needs_code' and conrelid = 'public.invoices'::regclass)
  and to_regclass('public.invoices_campaign_group_idx') is not null as ok
union all
select 'usage counts distinct invoice groups',
  position('count(distinct coalesce(i.campaign_group, i.id::text))' in pg_get_functiondef('public.campaign_code_used(text)'::regprocedure)) > 0
union all
select 'guard: group key immutable, inherited on reissue, owner/day only, group shares one use',
  position('Grup pemakaian kode kampanye tidak boleh diubah' in d) > 0
  and position('new.campaign_group := src_group' in d) > 0
  and position('tidak cocok dengan pemilik atau tanggal hari ini' in d) > 0
  and position('if k.max_uses is not null and not v_group_live then' in d) > 0
from (select pg_get_functiondef('public.guard_campaign_code_use()'::regprocedure) d) x
union all
select 'clinic posting stores campaign_code and campaign_group in its atomic insert',
  position(E'nullif(p_invoice->>''campaign_code'',''''), nullif(p_invoice->>''campaign_group'','''')' in d) > 0
  and position('service_pricing_version, campaign_code, campaign_group' in d) > 0
from (select pg_get_functiondef('public.clinic_post_invoice(uuid,text,jsonb,jsonb)'::regprocedure) d) x
union all
select 'invoice guard trigger also fires on campaign_group updates, enabled',
  exists (select 1 from pg_trigger where tgname = 'c05_invoice_campaign_code' and tgrelid = 'public.invoices'::regclass
          and tgenabled = 'O' and pg_get_triggerdef(oid) like '%UPDATE OF campaign_code, voucher_code, campaign_group%')
  and exists (select 1 from pg_trigger where tgname = 'c05_sale_campaign_code' and tgrelid = 'public.sales'::regclass and tgenabled = 'O')
  and exists (select 1 from pg_trigger where tgname = 'c05_sale_campaign_code_finalize' and tgrelid = 'public.sales'::regclass and tgenabled = 'O')
union all
select 'ACLs unchanged (clinic posting for authenticated only; counters/guards not callable)',
  has_function_privilege('authenticated', 'public.clinic_post_invoice(uuid,text,jsonb,jsonb)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.clinic_post_invoice(uuid,text,jsonb,jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.clinic_post_invoice(uuid,text,jsonb,jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.campaign_code_used(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.guard_campaign_code_use()', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.campaign_code_usage()', 'EXECUTE')
union all
select 'info: invoices in a group payment = ' || count(*), true
from public.invoices where campaign_group is not null;
