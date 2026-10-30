-- Forward-only follow-up to installed 0408 (frozen 29b5060c source).
-- Product replacement keeps the exact ORIGINAL ordering attribution. A private
-- transaction permit is required; invoice/POS snapshots and direct writes keep
-- the original guard, and no caller can rewrite a saved performer snapshot.
do $patch$
declare d text;needle text:=' if tg_op=''UPDATE'' then';replacement text;
begin
 d:=pg_get_functiondef('public.guard_service_line_performers()'::regprocedure);
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Performer update anchor drift';end if;
 replacement:=needle||E'\n  if tg_table_name=''prescription_items'' and new.service_performers is not distinct from old.service_performers\n   and (to_jsonb(new)->>''medical_record_id'') is not distinct from (to_jsonb(old)->>''medical_record_id'')\n   and exists(select 1 from clinic_private.record_edit_permits p join public.medical_records m on m.visit_id=p.visit_id\n    where p.transaction_id=txid_current() and p.actor=auth.uid() and m.id=(to_jsonb(old)->>''medical_record_id'')::uuid) then return new;end if;';
 execute replace(d,needle,replacement);
end $patch$;
