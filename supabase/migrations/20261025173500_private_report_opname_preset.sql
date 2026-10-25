-- R05: permit saving the existing hasil-opname report URL as a private preference.
-- No report rows, RLS policies, grants, or cross-account sharing are changed.
do $$
declare
 guard_oid oid := to_regprocedure('public.guard_private_report_preset()');
 definition text;
 old_path text := '|pembelian|kpi|promo)([?][^#[:space:]]*)?$';
 new_path text := '|pembelian|kpi|promo|hasil-opname)([?][^#[:space:]]*)?$';
 old_filters text := $old$if part<>'' and part !~ '^(dari|sampai|periode|cabang|cabang_id|gudang|dokter|q|masalah|rincian|kanal|jenis|horizon|preset|from|to|channel|branch|ambang|cari|kolom)=[^&]*$' then$old$;
 new_filters text := $new$if part<>'' and part !~ '^(dari|sampai|periode|cabang|cabang_id|gudang|dokter|q|masalah|rincian|kanal|jenis|horizon|preset|from|to|channel|branch|ambang|cari|kolom)=[^&]*$'
  and not (new.href ~ '^/laporan/hasil-opname([?]|$)' and part ~ '^(order|dasar|arah)=[^&]*$') then$new$;
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
  or (length(definition)-length(replace(definition,old_filters,'')))/length(old_filters)<>1 then
  raise exception 'R05_PRIVATE_PRESET_VALIDATION_DRIFT';
 end if;
 execute replace(replace(definition,old_path,new_path),old_filters,new_filters);
end $$;
