-- The reviewed Accurate bridge remains the sole inventory opening journal.
-- Integrate its existing review/equity decision with prospective HPP closing;
-- never add an accounting side effect to the private physical stock writer.
create function pg_temp.patch_accurate_average(p_function regprocedure,p_old text,p_new text)
returns void language plpgsql as $patch$
declare definition text:=pg_get_functiondef(p_function);
begin
 if (length(definition)-length(replace(definition,p_old,'')))/length(p_old)<>1 then
  raise exception 'Accurate average integration anchor mismatch: % / %',p_function,left(p_old,100);
 end if;
 execute replace(definition,p_old,p_new);
end;
$patch$;

select pg_temp.patch_accurate_average('public.preview_accurate_inventory_accounting(uuid,uuid)'::regprocedure,
$old$x record; qty numeric; cost numeric; valid_payload boolean:=true; closed date;$old$,
$new$x record; qty numeric; cost numeric; valid_payload boolean:=true; closed date; inventory_closed date;$new$);
select pg_temp.patch_accurate_average('public.preview_accurate_inventory_accounting(uuid,uuid)'::regprocedure,
$old$ if r.as_of_date<=closed then blockers:=blockers||jsonb_build_array('Periode akuntansi sudah ditutup');end if;$old$,
$new$ if r.as_of_date<=closed then blockers:=blockers||jsonb_build_array('Periode akuntansi sudah ditutup');end if;
 select closed_through into inventory_closed from public.inventory_costing_settings where id;
 if r.as_of_date<=inventory_closed then
  blockers:=blockers||jsonb_build_array('Periode persediaan sudah ditutup; gunakan tanggal setelah closing HPP');
 end if;$new$);
select pg_temp.patch_accurate_average('public.preview_accurate_inventory_accounting(uuid,uuid)'::regprocedure,
$old$'summary',r.summary,'closed_until',closed)$old$,
$new$'summary',r.summary,'closed_until',closed,'inventory_closed_through',inventory_closed)$new$);

-- Acquire the same global shared lock as stock writers BEFORE relation/tuple
-- locks. Activation and HPP closing hold its exclusive form before touching
-- stock; reversing that order could deadlock while importing existing batches.
select pg_temp.patch_accurate_average('public.post_accurate_inventory_accounting(uuid,uuid,jsonb,text)'::regprocedure,
$old$ -- Same lock order as PR70 global opening. Serialize duplicate detection with all journal writers.$old$,
$new$ perform pg_advisory_xact_lock_shared(1962072401::bigint);
 -- Same lock order as PR70 global opening. Serialize duplicate detection with all journal writers.$new$);
select pg_temp.patch_accurate_average('public.post_accurate_inventory_accounting(uuid,uuid,jsonb,text)'::regprocedure,
$old$ perform public.accurate_initial_stock_internal(p_run_id);$old$,
$new$ perform public.inventory_assert_open_date((p->>'as_of')::date);
 perform public.accurate_initial_stock_internal(p_run_id);$new$);
