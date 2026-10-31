-- Independent post-reset checks (read-only). Output: one JSON object; every "ok" must be true.
with
 reset_tables as (select unnest(:'reset_tables'::text[]) t),
 counts as (select t,(xpath('/row/n/text()',query_to_xml(format('select count(*) n from public.%I',t),false,true,'')))[1]::text::bigint n from reset_tables),
 fk_orphans as (
  select c.conname, c.conrelid::regclass::text child,
   (xpath('/row/n/text()',query_to_xml(format('select count(*) n from %s ch where (%s) is not null and not exists(select 1 from %s p where (%s)=(%s))',
     c.conrelid::regclass, (select string_agg('ch.'||quote_ident(a.attname),',' order by k.o) from unnest(c.conkey) with ordinality k(n,o) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.n),
     c.confrelid::regclass, (select string_agg('p.'||quote_ident(a.attname),',' order by k.o) from unnest(c.confkey) with ordinality k(n,o) join pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.n),
     (select string_agg('ch.'||quote_ident(a.attname),',' order by k.o) from unnest(c.conkey) with ordinality k(n,o) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.n)),false,true,'')))[1]::text::bigint n
  from pg_constraint c join pg_namespace s on s.oid=c.connamespace where c.contype='f' and s.nspname in ('public','clinic_private','kamo_import'))
select jsonb_pretty(jsonb_build_object(
 'reset_tables_nonempty', (select coalesce(jsonb_object_agg(t,n),'{}') from counts where n<>0),
 'fk_orphans', (select coalesce(jsonb_object_agg(child||'.'||conname,n),'{}') from fk_orphans where n<>0),
 'journal', (select jsonb_build_object('entries',(select count(*) from public.journal_entries),'debit',coalesce(sum(debit),0),'credit',coalesce(sum(credit),0)) from public.journal_lines),
 'stock', jsonb_build_object('rows',(select count(*) from public.stock),'layers',(select count(*) from public.stock_layers),'moves',(select count(*) from public.stock_moves)),
 'cash_accounts_master', (select count(*) from public.cash_accounts),
 'open_shifts', (select count(*) from public.cashier_shifts),
 'customer_points_nonzero', (select count(*) from public.customers where points<>0 or total_spending<>0 or tier<>'New'),
 'staff_points', (select count(*) from public.staff_points)+(select count(*) from public.staff_points_ledger),
 'expense_attachments_left', (select count(*) from public.document_attachments where modul='pengeluaran'),
 'triggers_not_enabled', (select count(*) from pg_trigger g join pg_class c on c.oid=g.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','clinic_private','kamo_import') and not g.tgisinternal and g.tgenabled<>'O'),
 'tables_without_rls', (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity),
 'patched_guard_left', (select count(*) from pg_proc where prosrc like '%tg_table_name=any(array[''approval_requests''%'),
 'master_counts', jsonb_build_object('branches',(select count(*) from public.branches),'warehouses',(select count(*) from public.warehouses),'profiles',(select count(*) from public.profiles),
   'customers',(select count(*) from public.customers),'pets',(select count(*) from public.pets),'visits',(select count(*) from public.visits),'medical_records',(select count(*) from public.medical_records),
   'prescription_items',(select count(*) from public.prescription_items),'compounding_recipes',(select count(*) from public.compounding_recipes),'inpatient_records',(select count(*) from public.inpatient_records),
   'consents',(select count(*) from public.consents),'items',(select count(*) from public.items),'item_units',(select count(*) from public.item_units),'suppliers',(select count(*) from public.suppliers),
   'coa_accounts',(select count(*) from public.coa_accounts),'import_runs',(select count(*) from public.import_runs),'import_run_rows',(select count(*) from public.import_run_rows),
   'activity_log',(select count(*) from public.activity_log),'production_recipes',(select count(*) from public.production_recipes),'item_group_components',(select count(*) from public.item_group_components))
)) report
from (select 1) x;
