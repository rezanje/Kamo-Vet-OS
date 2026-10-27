-- P02 PREFLIGHT — READ ONLY. Nothing here writes. Every row must show ok = true.
select 'function cancel_purchase_invoice exists' check_name, to_regprocedure('public.cancel_purchase_invoice(uuid,integer,text,text,date)') is not null ok
union all select 'function clinic_write_journal exists', to_regprocedure('public.clinic_write_journal(date,text,text,text,uuid,jsonb)') is not null
union all select 'function inventory_apply_cost_adjustment exists', to_regprocedure('public.inventory_apply_cost_adjustment(uuid,uuid,numeric,date,text,text)') is not null
union all select 'function purchase_invoice_scope exists', to_regprocedure('public.purchase_invoice_scope(uuid,uuid,uuid)') is not null
union all select 'table purchase_invoice_layer_proofs exists', to_regclass('public.purchase_invoice_layer_proofs') is not null
union all select 'P02 not yet applied (table absent)', to_regclass('public.purchase_invoice_corrections') is null
union all select 'accounts 1301/5101/1105/2101 active detail', (select count(*) from public.coa_accounts where code in ('1301','5101','1105','2101') and is_active and not is_header)=4
union all select 'journal source name unused', not exists(select 1 from public.journal_entries where source='purchase-inv-correction')
union all select 'stock source name unused', not exists(select 1 from public.stock_moves where source='purchase-correction') and not exists(select 1 from public.stock_layers where source='purchase-correction');

-- Info only: costing method in use (fifo and moving_average are both supported).
select method, closed_through from public.inventory_costing_settings where id;
