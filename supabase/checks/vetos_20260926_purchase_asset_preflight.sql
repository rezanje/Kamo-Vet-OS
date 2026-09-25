-- READ ONLY. Postflight for project koaglxcyjqfmgfzxszkj after targeted
-- migrations 20260924120000, 122000, and 123000. Migration 121000 was
-- deliberately excluded; its reprice function is not called by the app.
-- Do not infer installation from supabase_migrations.schema_migrations alone:
-- September functions already exist in production without matching history.

with prerequisites(name) as (values
  ('asset_categories'), ('cash_accounts'), ('coa_accounts'), ('fixed_assets'),
  ('items'), ('journal_entries'), ('journal_lines'), ('purchase_invoice_items'),
  ('purchase_invoices'), ('purchase_order_items'), ('purchase_orders'),
  ('stock'), ('stock_layers'), ('stock_moves')
)
select 'table' as object_type, name, to_regclass('public.' || name)::text as actual
from prerequisites order by name;

with expected(table_name, column_name) as (values
  ('purchase_invoice_items','po_item_id'), ('purchase_invoice_items','invoice_id'),
  ('purchase_invoice_items','item_id'), ('purchase_invoice_items','qty'),
  ('purchase_invoice_items','faktor'), ('purchase_invoice_items','satuan'),
  ('purchase_order_items','id'), ('purchase_order_items','po_id'),
  ('purchase_order_items','item_id'), ('purchase_order_items','qty'),
  ('purchase_order_items','qty_terima'), ('purchase_order_items','faktor'),
  ('purchase_order_items','harga_beli'), ('purchase_order_items','satuan'),
  ('purchase_orders','id'), ('purchase_orders','status'),
  ('purchase_orders','to_warehouse_id'), ('purchase_orders','supplier_id'),
  ('purchase_invoices','id'), ('purchase_invoices','no_faktur'),
  ('purchase_invoices','po_id'), ('purchase_invoices','supplier_id'),
  ('purchase_invoices','tanggal'), ('purchase_invoices','jatuh_tempo'),
  ('purchase_invoices','total'), ('purchase_invoices','created_by'),
  ('stock_layers','id'), ('stock_layers','warehouse_id'),
  ('stock_layers','item_id'), ('stock_layers','qty_in'),
  ('stock_layers','qty_left'), ('stock_layers','unit_cost'),
  ('stock_layers','source'), ('stock_layers','source_ref'),
  ('stock_layers','exp_date'), ('stock_layers','batch_no'),
  ('stock_layers','tanggal'), ('stock_layers','created_at'),
  ('fixed_assets','id'), ('fixed_assets','nama'),
  ('fixed_assets','kategori'), ('fixed_assets','category_id'),
  ('fixed_assets','tanggal_perolehan'), ('fixed_assets','harga_perolehan'),
  ('fixed_assets','nilai_sisa'), ('fixed_assets','umur_bulan'),
  ('fixed_assets','branch_id'), ('asset_categories','id'),
  ('asset_categories','nama'), ('asset_categories','is_active'),
  ('coa_accounts','id'), ('coa_accounts','code'),
  ('coa_accounts','is_active'), ('coa_accounts','is_header'),
  ('cash_accounts','id'), ('cash_accounts','coa_code'),
  ('cash_accounts','is_active')
)
select 'missing_column' as finding, e.table_name, e.column_name
from expected e
left join information_schema.columns c
  on c.table_schema='public' and c.table_name=e.table_name and c.column_name=e.column_name
where c.column_name is null order by e.table_name, e.column_name;

with expected(signature) as (values
  ('public.create_purchase_invoice_from_po(uuid,text,integer,text,date,date,text,jsonb,jsonb,jsonb,numeric)'),
  ('public.stock_in_fifo(uuid,uuid,numeric,numeric,text,text,date,date)'),
  ('public.stock_out_fifo(uuid,uuid,numeric,text,text,date)'),
  ('public.create_fixed_asset_purchase(text,uuid,date,numeric,numeric,integer,uuid,text,text)')
)
select 'function' as object_type, signature, to_regprocedure(signature)::text as actual
from expected order by signature;

-- Expected absent in this rollout; check it separately to detect future drift.
select 'excluded_optional_function' as object_type,
       to_regprocedure('public.reprice_purchase_invoice_layers(jsonb,jsonb)')::text as actual;

select conrelid::regclass::text as relation, conname, contype,
       pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid in ('public.purchase_invoice_items'::regclass,
                   'public.purchase_order_items'::regclass,
                   'public.fixed_assets'::regclass)
order by relation, conname;
