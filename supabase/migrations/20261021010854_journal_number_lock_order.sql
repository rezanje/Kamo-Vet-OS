-- Journal writers must take the target relation lock before the shared number
-- lock, matching INSERT ... VALUES and reconciliation's stable ledger snapshot.
-- ROW EXCLUSIVE permits ordinary concurrent writers; it does not serialize them.
do $$
declare
 target regprocedure;
 definition text;
 needle text;
begin
 foreach target in array array[
  'public.receive_purchase_order(uuid,text,text,integer,date,text,text,jsonb)'::regprocedure,
  'public.post_recurring_journal_period(uuid,text)'::regprocedure,
  'public.create_fixed_asset_purchase_internal(text,uuid,date,numeric,numeric,integer,uuid,text,text)'::regprocedure
 ] loop
  needle := case when target = 'public.create_fixed_asset_purchase_internal(text,uuid,date,numeric,numeric,integer,uuid,text,text)'::regprocedure
   then 'perform pg_advisory_xact_lock(hashtext(''vetos:journal:'' || v_prefix)::bigint);'
   else 'perform pg_advisory_xact_lock(hashtext(''vetos:journal:''||v_prefix)::bigint);' end;
  definition := pg_get_functiondef(target);
  if length(definition)-length(replace(definition,needle,'')) <> length(needle) then
   raise exception 'Journal number lock insertion point changed: %',target;
  end if;
  execute replace(definition,needle,'lock table public.journal_entries in row exclusive mode;'||chr(10)||' '||needle);
 end loop;
 target := 'public.sales_next_number(text,date)'::regprocedure;
 definition := pg_get_functiondef(target);
 needle := '  -- Shared lock namespace with existing atomic journal RPCs.';
 if length(definition)-length(replace(definition,needle,'')) <> length(needle) then
  raise exception 'Shared journal number insertion point changed: %',target;
 end if;
 execute replace(definition,needle,'  if p_kind=''JRN'' then lock table public.journal_entries in row exclusive mode; end if;'||chr(10)||needle);
end $$;
