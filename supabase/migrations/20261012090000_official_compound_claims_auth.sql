-- Modern PostgREST sets request.jwt.claims rather than the legacy per-claim GUC.
-- Replace only the session-role reader; preserve the deployed body, owner and ACL.
do $migration$
declare
  v_oid regprocedure := 'public.clinic_issue_official_compound(uuid,uuid,uuid,text,text)'::regprocedure;
  v_definition text;
  v_legacy constant text := $legacy$coalesce(current_setting('request.jwt.claim.role', true), '')$legacy$;
begin
  v_definition := pg_get_functiondef(v_oid);
  if strpos(v_definition, v_legacy) = 0 then
    if strpos(v_definition, 'coalesce(auth.role(), '''')') > 0 then
      return; -- Already applied; no function or permission changes.
    end if;
    raise exception 'Official compound session-role guard not recognized; aborting migration';
  end if;
  execute replace(v_definition, v_legacy, 'coalesce(auth.role(), '''')');
end;
$migration$;
