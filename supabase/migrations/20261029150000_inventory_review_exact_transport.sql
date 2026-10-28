-- A reviewed preview travelled to the browser as JSON numbers, and JavaScript cuts
-- them to ~15 digits (16569.4200000000000001 becomes 16569.42). The posting RPC
-- then never saw the same evidence and refused every such batch ("Bukti berubah").
-- These wrappers carry the exact database text through the server action instead.
create function public.preview_accurate_inventory_accounting_text(p_run_id uuid,p_equity_account_id uuid)
returns text language sql security invoker set search_path='' as $$
 select public.preview_accurate_inventory_accounting(p_run_id,p_equity_account_id)::text
$$;
create function public.post_accurate_inventory_accounting_text(p_run_id uuid,p_equity_account_id uuid,p_expected text,p_reason text)
returns jsonb language sql security invoker set search_path='' as $$
 select public.post_accurate_inventory_accounting(p_run_id,p_equity_account_id,p_expected::jsonb,p_reason)
$$;
revoke all on function public.preview_accurate_inventory_accounting_text(uuid,uuid),
 public.post_accurate_inventory_accounting_text(uuid,uuid,text,text) from public,anon,service_role;
grant execute on function public.preview_accurate_inventory_accounting_text(uuid,uuid),
 public.post_accurate_inventory_accounting_text(uuid,uuid,text,text) to authenticated;
