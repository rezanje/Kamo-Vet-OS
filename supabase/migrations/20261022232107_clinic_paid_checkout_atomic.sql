-- K08: direct paid creation must commit checkout with its financial transaction.
-- Preserve the current definition (including later stock/auth fixes), signature,
-- SECURITY DEFINER/search_path and existing ACL. No new endpoint or permission.
do $migration$
declare
  signature regprocedure := 'public.clinic_post_invoice(uuid,text,jsonb,jsonb)'::regprocedure;
  definition text;
  anchor text := E'  return v_invoice_id;\nend;';
  replacement text := E'  -- K08_ATOMIC_PAID_CHECKOUT_BEGIN\n  -- The visit FOR UPDATE lock is still held; admission uses the same lock.\n  if v_paid_status = ''Lunas'' then\n    perform public.set_visit_service_state(p_visit_id, ''checkout'');\n  end if;\n  -- K08_ATOMIC_PAID_CHECKOUT_END\n  return v_invoice_id;\nend;';
begin
  definition := pg_get_functiondef(signature);
  if position('K08_ATOMIC_PAID_CHECKOUT_BEGIN' in definition) > 0 then
    raise exception 'K08 checkout patch is already present; verify migration history';
  end if;
  if (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'K08 checkout patch expected exactly one final return; inspect function before release';
  end if;
  execute replace(definition, anchor, replacement);
end;
$migration$;
