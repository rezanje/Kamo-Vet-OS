-- One DO statement makes all function patches atomic, including drift checks.
do $all_patches$
begin
-- purchase_advances.jumlah and the atomic journal support two decimal places.
-- Validate exact source precision instead of silently rounding or rejecting cents.
-- Keep the existing cap, locks, request receipt, authorization and ACL intact.
declare
  definition text := pg_get_functiondef('public.pay_purchase_advance_atomic(text,text,integer,uuid,uuid,date,numeric,text,uuid,text)'::regprocedure);
  anchor text := 'p_jumlah<>trunc(p_jumlah)';
  old_message text := 'Identitas atau nominal uang muka tidak valid; gunakan rupiah bulat';
begin
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor) <> 1
     or (length(definition)-length(replace(definition,old_message,'')))/length(old_message) <> 1 then
    raise exception 'Definisi uang muka tidak cocok; periksa migrasi sebelum mengubah presisi';
  end if;
  execute replace(replace(definition,anchor,'p_jumlah<>round(p_jumlah,2)'),old_message,
    'Identitas atau nominal uang muka tidak valid; gunakan maksimal 2 angka desimal');
end;


-- Total invoice payments keep their existing whole-rupiah rule. A cent-valued
-- advance may fund part of that amount; journal the exact advance/cash split.
declare
  target regprocedure := 'public.pay_purchase_invoice_atomic(text,uuid,date,numeric,text,text,uuid,uuid,uuid)'::regprocedure;
  definition text := pg_get_functiondef(target);
  anchor text := 'from_advance<>round(from_advance)';
begin
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor) <> 1
     or (length(definition)-length(replace(definition,'round(from_advance)','')))/length('round(from_advance)') <> 5 then
    raise exception 'Definisi alokasi uang muka tidak cocok; periksa migrasi';
  end if;
  definition := replace(definition,anchor,'from_advance<>round(from_advance,2)');
  definition := replace(definition,'Porsi uang muka harus rupiah bulat','Porsi uang muka maksimal 2 angka desimal');
  execute replace(definition,'round(from_advance)','from_advance');
end;


declare
  target regprocedure := 'public.cancel_purchase_payment(uuid,integer,text,text)'::regprocedure;
  definition text := pg_get_functiondef(target);
  anchor text;
begin
  foreach anchor in array array['dari_uang_muka<>round(dari_uang_muka)','debit<>round(debit)','credit<>round(credit)']
  loop
    if (length(definition)-length(replace(definition,anchor,'')))/length(anchor) <> 1 then
      raise exception 'Definisi reversal alokasi tidak cocok; periksa migrasi';
    end if;
    definition := replace(definition,anchor,left(anchor,length(anchor)-1)||',2)');
  end loop;
  execute definition;
end;


declare
  target regprocedure;
  definition text;
  anchor text;
  replacement text;
begin
  for target,anchor,replacement in select * from (values
    ('public.cancel_purchase_advance_atomic(uuid)'::regprocedure,
     'adv.jumlah<>trunc(adv.jumlah)','adv.jumlah<>round(adv.jumlah,2)'),
    ('public.purchase_advance_refund_proven(uuid)'::regprocedure,
     'a.jumlah=trunc(a.jumlah)','a.jumlah=round(a.jumlah,2)')
  ) as patches(target,anchor,replacement)
  loop
    definition := pg_get_functiondef(target);
    if (length(definition)-length(replace(definition,anchor,'')))/length(anchor) <> 1 then
      raise exception 'Definisi pembatalan uang muka tidak cocok; periksa migrasi sebelum mengubah presisi';
    end if;
    execute replace(definition,anchor,replacement);
  end loop;
end;


end;
$all_patches$;
