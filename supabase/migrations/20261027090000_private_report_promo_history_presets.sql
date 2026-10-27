-- R05: let the private preset guard accept two report controls the app already saves:
-- the selected promotion on /laporan/promo and the as-of date on the historical
-- inventory valuation report. Still a private URL only: no report rows, RLS policies,
-- grants, or cross-account sharing are changed; opening a preset re-runs report access.
do $$
declare
 guard_oid oid := to_regprocedure('public.guard_private_report_preset()');
 definition text;
 old_path text := '|pembelian|kpi|promo|hasil-opname)([?][^#[:space:]]*)?$';
 new_path text := '|pembelian|kpi|promo|hasil-opname|nilai-persediaan/historis)([?][^#[:space:]]*)?$';
 old_filter text := $old$and not (new.href ~ '^/laporan/penjualan-barang([?]|$)' and part ~ '^pelaksana_id=[^&]*$') then$old$;
 new_filter text := $new$and not (new.href ~ '^/laporan/penjualan-barang([?]|$)' and part ~ '^pelaksana_id=[^&]*$')
  and not (new.href ~ '^/laporan/promo([?]|$)' and part ~ '^promo_id=[^&]*$')
  and not (new.href ~ '^/laporan/nilai-persediaan/historis([?]|$)' and part ~ '^tanggal=[^&]*$') then$new$;
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
 if (length(definition)-length(replace(definition,old_path,'')))/length(old_path)<>1
  or (length(definition)-length(replace(definition,old_filter,'')))/length(old_filter)<>1 then
  raise exception 'R05_PRIVATE_PRESET_VALIDATION_DRIFT';
 end if;
 execute replace(replace(definition,old_path,new_path),old_filter,new_filter);
end $$;
