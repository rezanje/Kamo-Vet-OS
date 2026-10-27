-- R05/R01: preserve the exact performer filter on the existing item-sales report.
-- The private preset remains a URL only; opening it still runs report authorization.
do $$
declare
 guard_oid oid := to_regprocedure('public.guard_private_report_preset()');
 definition text;
 old_filter text := $old$and not (new.href ~ '^/laporan/hasil-opname([?]|$)' and part ~ '^(order|dasar|arah)=[^&]*$') then$old$;
 new_filter text := $new$and not (new.href ~ '^/laporan/hasil-opname([?]|$)' and part ~ '^(order|dasar|arah)=[^&]*$')
  and not (new.href ~ '^/laporan/penjualan-barang([?]|$)' and part ~ '^pelaksana_id=[^&]*$') then$new$;
begin
 if guard_oid is null or not exists (
  select 1 from pg_proc p where p.oid=guard_oid and not p.prosecdef
   and p.proconfig @> array['search_path=""']::text[]
 ) or not exists (
  select 1 from pg_trigger t where t.tgrelid='public.private_report_presets'::regclass
   and t.tgname='private_report_preset_guard' and t.tgfoid=guard_oid and not t.tgisinternal
 ) or has_function_privilege('anon',guard_oid,'EXECUTE')
   or has_function_privilege('authenticated',guard_oid,'EXECUTE')
   or has_function_privilege('service_role',guard_oid,'EXECUTE') then
  raise exception 'R05_PRIVATE_PRESET_GUARD_DRIFT';
 end if;
 definition:=pg_get_functiondef(guard_oid);
 if (length(definition)-length(replace(definition,old_filter,'')))/length(old_filter)<>1 then
  raise exception 'R05_PRIVATE_PRESET_VALIDATION_DRIFT';
 end if;
 execute replace(definition,old_filter,new_filter);
end $$;
