-- PR76 is already deployed. These correction tables may be created afterwards.
-- Apply its existing reference-lock contract without rewriting any history or ACL.
do $$ declare r record; existing oid; begin
 if to_regprocedure('public.guard_trashed_master_reference()') is null then
  raise exception 'Master lifecycle reference guard must be installed first';
 end if;
 for r in
  with targets as (
   select c.oid,c.oid::regclass relation from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind in ('r','p') and c.relname in (
    'cash_transfer_revisions','cash_transfer_requests','stock_document_corrections',
    'stock_document_correction_requests','stock_document_issue_proofs',
    'monetary_opening_corrections','monetary_opening_requests','opening_balance_create_requests',
    'wholesale_invoice_corrections','wholesale_operation_requests','wholesale_payroll_epochs',
    'return_record_postings','return_record_corrections','return_record_requests',
    'fixed_asset_corrections','fixed_asset_value_requests')
  )
  select distinct t.relation,'master_ref_'||parent.relname||'_'||a.attname trigger_name,parent.relname kind,a.attname column_name
  from targets t join pg_constraint k on k.conrelid=t.oid and k.contype='f'
  join pg_class parent on parent.oid=k.confrelid
  join pg_attribute a on a.attrelid=t.oid and a.attnum=any(k.conkey)
  where k.confrelid=any(array['public.employees'::regclass,'public.items'::regclass,'public.brands'::regclass,'public.suppliers'::regclass,'public.supplier_categories'::regclass,'public.units'::regclass])
  union
  select t.relation,'master_ref_units_'||a.attname,'units_text',a.attname
  from targets t join pg_attribute a on a.attrelid=t.oid and a.attnum>0 and not a.attisdropped
  where a.attname in ('unit','satuan','buy_unit','base_unit') and a.atttypid in ('text'::regtype,'varchar'::regtype)
  union
  select t.relation,'master_snapshot_'||a.attname,case when a.atttypid='uuid'::regtype then 'any_uuid' else 'any_json' end,a.attname
  from targets t join pg_attribute a on a.attrelid=t.oid and a.attnum>0 and not a.attisdropped
  where ((a.atttypid='uuid'::regtype and a.attname<>'id') or a.atttypid in ('json'::regtype,'jsonb'::regtype))
   and not exists(select 1 from pg_constraint k where k.contype='f' and k.conrelid=t.oid and a.attnum=any(k.conkey))
 loop
  select tgfoid into existing from pg_trigger where tgrelid=r.relation and tgname=r.trigger_name;
  if found then
   if existing<>'public.guard_trashed_master_reference()'::regprocedure then
    raise exception 'Conflicting reference guard on %.%',r.relation,r.trigger_name;
   end if;
  else
   execute format('create trigger %I before insert or update on %s for each row execute function public.guard_trashed_master_reference(%L,%L)',r.trigger_name,r.relation,r.kind,r.column_name);
  end if;
 end loop;
end $$;
