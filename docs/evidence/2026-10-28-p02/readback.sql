-- P02 READBACK — READ ONLY. Run after apply.sql. Every row must show ok = true.
select 'table purchase_invoice_corrections' check_name, to_regclass('public.purchase_invoice_corrections') is not null ok
union all select 'table purchase_invoice_correction_layers', to_regclass('public.purchase_invoice_correction_layers') is not null
union all select 'RLS on both tables', (select bool_and(relrowsecurity) from pg_class where oid in ('public.purchase_invoice_corrections'::regclass,'public.purchase_invoice_correction_layers'::regclass))
union all select 'authenticated can only read history', has_table_privilege('authenticated','public.purchase_invoice_corrections','select') and not has_table_privilege('authenticated','public.purchase_invoice_corrections','insert') and not has_table_privilege('authenticated','public.purchase_invoice_correction_layers','select')
union all select 'preview RPC callable by authenticated', has_function_privilege('authenticated','public.preview_purchase_invoice_line_correction(uuid,numeric,numeric,date)','execute')
union all select 'commit RPC callable by authenticated', has_function_privilege('authenticated','public.correct_purchase_invoice_line(text,uuid,integer,numeric,numeric,date,text,jsonb)','execute')
union all select 'internal runner not callable', not has_function_privilege('authenticated','public.purchase_invoice_line_correction_run(uuid,numeric,numeric,date,text,text,jsonb,boolean)','execute')
union all select 'journal guard triggers', (select count(*) from pg_trigger where tgname in ('purchase_invoice_correction_journal_guard','purchase_invoice_correction_journal_lines_guard'))=2
union all select 'history policy limited to OWNER/FINANCE', (select pg_get_expr(polqual,polrelid) like '%OWNER%FINANCE%' from pg_policy where polname='purchase_invoice_corrections_read')
union all select 'no corrections recorded yet', (select count(*) from public.purchase_invoice_corrections)=0;
