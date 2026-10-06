-- Allow cashier-added medicine rows to use a real master UOM. The existing
-- posting RPC still resolves the factor from item_units, seals prescription
-- units, consumes base stock atomically and uses FIFO costs for the HPP journal.
-- Modify only this obsolete restriction, preserving later auth-claim repairs.
do $migration$
declare
 definition text;
 edit_definition text;
 edit_restriction text := 'if not found or v_factor<=0 or v_pi is null then';
 restriction text := $restriction$      if v_prescription_item_id is null and v_unit is distinct from v_base_unit then
        raise exception using errcode = 'P0001', message = 'UNIT_INVALID: baris manual hanya boleh memakai satuan dasar';
      end if;
$restriction$;
begin
 select pg_get_functiondef('public.clinic_post_invoice(uuid,text,jsonb,jsonb)'::regprocedure) into definition;
 if position(restriction in definition)=0 then
  raise exception 'Clinic invoice unit migration: expected base-only guard was not found; inspect the deployed RPC before applying.';
 end if;
 select pg_get_functiondef('public.clinic_edit_invoice(uuid,text,jsonb,jsonb)'::regprocedure) into edit_definition;
 if position(edit_restriction in edit_definition)=0 then
  raise exception 'Clinic invoice unit migration: expected edit guard was not found; inspect the deployed RPC before applying.';
 end if;
 execute replace(definition,restriction,'');
 execute replace(edit_definition,edit_restriction,'if not found or v_factor<=0 then');
end;
$migration$;

-- App deployment is safe before migration: the selector stays disabled until
-- this read-only capability exists and the unit-enabled posting RPC is installed.
create function public.clinic_manual_invoice_units_supported()
returns boolean language sql immutable security invoker
set search_path=pg_catalog,public
as $$ select true $$;
revoke all on function public.clinic_manual_invoice_units_supported()from public,anon;
grant execute on function public.clinic_manual_invoice_units_supported()to authenticated;
