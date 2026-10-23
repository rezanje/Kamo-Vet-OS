-- Reviewed rollback recipe only. Do not execute on a target without release approval.
-- Roll back the application to its parent build too: the old action owns checkout.
-- No financial/history rows are deleted or rewritten.
do $rollback$
declare
  definition text := pg_get_functiondef('public.clinic_post_invoice(uuid,text,jsonb,jsonb)'::regprocedure);
  addition text := E'  -- K08_ATOMIC_PAID_CHECKOUT_BEGIN\n  -- The visit FOR UPDATE lock is still held; admission uses the same lock.\n  if v_paid_status = ''Lunas'' then\n    perform public.set_visit_service_state(p_visit_id, ''checkout'');\n  end if;\n  -- K08_ATOMIC_PAID_CHECKOUT_END\n';
begin
  if (length(definition) - length(replace(definition, addition, ''))) / length(addition) <> 1 then
    raise exception 'K08 rollback expected exactly one unchanged patch; inspect function before release';
  end if;
  execute replace(definition, addition, '');
end;
$rollback$;
