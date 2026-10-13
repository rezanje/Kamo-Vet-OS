-- Retain catalog consent metadata for newly saved inpatient actions. Existing
-- prescription rows, prices, stock rules and transaction identifiers stay intact.
do $migration$
declare
  definition text;
  old_columns text := $columns$      harga, aturan_pakai, jenis
$columns$;
  new_columns text := $columns$      harga, aturan_pakai, jenis, kategori
$columns$;
  old_values text := $values$      v_row->>'aturan_pakai', v_row->>'jenis'
$values$;
  new_values text := $values$      v_row->>'aturan_pakai', v_row->>'jenis', v_row->>'kategori'
$values$;
begin
  select pg_get_functiondef('public.clinic_save_inpatient_log(uuid,uuid,jsonb,jsonb,jsonb,text)'::regprocedure)
    into definition;
  if position(old_columns in definition)=0 or position(old_values in definition)=0 then
    raise exception 'Inpatient action category migration: expected prescription insert was not found; inspect the deployed RPC before applying.';
  end if;
  execute replace(replace(definition,old_columns,new_columns),old_values,new_values);
end;
$migration$;
