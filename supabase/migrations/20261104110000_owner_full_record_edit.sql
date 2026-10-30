-- Forward-only extension of installed 0408; also compatible after 0410.
-- No dependency on the unapplied cashier 0409 or attribution 0410 migrations.
-- OWNER is a clinical superuser; every existing branch/module, active-profile,
-- queued/unbilled, revision, compound, stock and provenance guard stays intact.
-- Do not reopen the disabled legacy RPC or direct table writes.
do $patch$
declare
 eligibility text;
 editor text;
 role_anchor text := 'p.role=''DOCTOR'' and p.is_active';
 actor_anchor text := 'is_active and role=''DOCTOR'')';
 message_anchor text := 'ACCESS_DENIED: hanya dokter dapat mengubah rekam medis';
begin
 eligibility := pg_get_functiondef('public.clinic_can_correct_record(uuid)'::regprocedure);
 editor := pg_get_functiondef('public.clinic_edit_queued_record(uuid,uuid,integer,jsonb,jsonb,text,text)'::regprocedure);
 -- Precheck every exact anchor before compiling either replacement.
 if (length(eligibility)-length(replace(eligibility,role_anchor,'')))/length(role_anchor) <> 1 then
  raise exception 'OWNER clinical eligibility role anchor drift';
 end if;
 if (length(editor)-length(replace(editor,actor_anchor,'')))/length(actor_anchor) <> 1 then
  raise exception 'OWNER clinical editor role anchor drift';
 end if;
 if (length(editor)-length(replace(editor,message_anchor,'')))/length(message_anchor) <> 1 then
  raise exception 'OWNER clinical editor message anchor drift';
 end if;
 eligibility := replace(eligibility,role_anchor,'p.role in (''OWNER'',''DOCTOR'') and p.is_active');
 editor := replace(editor,actor_anchor,'is_active and role in (''OWNER'',''DOCTOR''))');
 editor := replace(editor,message_anchor,'ACCESS_DENIED: hanya owner atau dokter dapat mengubah rekam medis');
 execute eligibility;
 execute editor;
end $patch$;
