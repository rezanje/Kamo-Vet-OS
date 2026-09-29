-- PostgREST may expose the JWT role only through request.jwt.claims.
-- auth.role() reads both supported claim formats; direct GUC checks do not.
-- Recreate only the affected clinic routines, retaining signatures and grants.
do $migration$
declare
  v_routine record;
  v_definition text;
  v_replaced integer := 0;
begin
  for v_routine in
    select p.oid, pg_get_functiondef(p.oid) as definition
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'clinic_private')
      and p.proname in (
        'clinic_change_inpatient_condition', 'clinic_edit_invoice',
        'clinic_issue_compound', 'clinic_issue_official_compound',
        'clinic_post_invoice', 'clinic_receive_invoice_payment',
        'clinic_save_initial_record', 'clinic_save_inpatient_log_with_status',
        'clinic_save_inpatient_log', 'clinic_void_compound',
        'clinic_void_reissue_invoice', 'publish_compound_formula',
        'set_compound_formula_active'
      )
      and p.prosrc like '%request.jwt.claim.role%'
    order by n.nspname, p.proname, p.oid
  loop
    v_definition := regexp_replace(
      v_routine.definition,
      $pattern$current_setting\('request\.jwt\.claim\.role',[[:space:]]*true\)$pattern$,
      'auth.role()', 'g'
    );
    if v_definition = v_routine.definition then
      raise exception 'Role check not replaced for %', v_routine.oid::regprocedure;
    end if;
    execute v_definition;
    v_replaced := v_replaced + 1;
  end loop;

  if v_replaced <> 14 then
    raise exception 'Expected 14 clinic routines, replaced %', v_replaced;
  end if;
end;
$migration$;
