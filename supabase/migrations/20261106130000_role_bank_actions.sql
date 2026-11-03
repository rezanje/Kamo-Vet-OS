-- Called only AFTER the action/epoch/current-actor fence. No profile waits here.
-- Scope comes from the actor-owned persisted request and affected documents, never
-- from caller header flags. Epoch SHARE pins module/capability config until commit;
-- grant/document/account SHARE NOWAIT pins the remaining scope inputs, fail-closed.
create function role_settings_private.require_bank_request_scope(p_domain text,p_key text)
returns void language plpgsql volatile security definer set search_path='' as $$
declare v_role public.user_role; v_transfer public.cash_transfer_requests%rowtype;
 v_rec public.bank_reconciliation_requests%rowtype; v_ids uuid[]; v_accounts uuid[];
begin
 select role into v_role from public.profiles where id=auth.uid() and is_active;
 if v_role is null or (v_role<>'OWNER' and exists(select 1 from public.role_modules where role=v_role)
  and not exists(select 1 from public.role_modules where role=v_role and module_id='kas-bank')) then
  raise exception 'BANK_SCOPE_DENIED: module' using errcode='42501';
 end if;
 perform 1 from public.user_branches where user_id=auth.uid() order by branch_id for share nowait;
 if p_domain='cash_transfer' then
  select * into v_transfer from public.cash_transfer_requests where actor_id=auth.uid() and request_key=p_key;
  if not found then return; end if;
  v_ids:=array[v_transfer.transfer_id,(v_transfer.result->>'replacement_transfer_id')::uuid];
  perform 1 from public.cash_transfers where id=any(v_ids) order by id for share nowait;
  select array_agg(a) into v_accounts from (
   select from_account_id a from public.cash_transfers where id=any(v_ids)
   union select to_account_id from public.cash_transfers where id=any(v_ids)) s;
  perform 1 from public.cash_accounts where id=any(v_accounts) order by id for share nowait;
  perform public.internal_transfer_scope(v_transfer.transfer_id);
  if v_ids[2] is not null then perform public.internal_transfer_scope(v_ids[2]); end if;
 elsif p_domain='bank_reconciliation' then
  if not public.has_role_capability('all_branches') then
   raise exception 'BANK_SCOPE_DENIED: all_branches' using errcode='42501';
  end if;
  select * into v_rec from public.bank_reconciliation_requests where actor_id=auth.uid() and request_key=p_key;
  if not found then return; end if;
  perform 1 from public.bank_reconciliations where id=v_rec.reconciliation_id for share nowait;
  -- An edit replaces the account in place: retain the original account from the
  -- immutable matching revision as well as the persisted current document account.
  select array_agg(a) into v_accounts from (
   select cash_account_id a from public.bank_reconciliations where id=v_rec.reconciliation_id
   union select (before_value->>'cash_account_id')::uuid from public.bank_reconciliation_revisions
    where reconciliation_id=v_rec.reconciliation_id and after_value->>'revision'=v_rec.result->>'revision') s;
  perform 1 from public.cash_accounts where id=any(v_accounts) order by id for share nowait;
  if not exists(select 1 from public.bank_reconciliations r join public.cash_accounts a on a.id=r.cash_account_id
   where r.id=v_rec.reconciliation_id) or exists(select 1 from public.cash_accounts
   where id=any(v_accounts) and branch_id is not null and not public.user_can_access_branch(branch_id)) then
   raise exception 'BANK_SCOPE_DENIED: account branch' using errcode='42501';
  end if;
 else raise exception 'BANK_SCOPE_DENIED: domain' using errcode='42501';
 end if;
end $$;
revoke all on function role_settings_private.require_bank_request_scope(text,text) from public,anon,authenticated,service_role;

-- Additional authorization conjunct only; original financial bodies and ceilings stay intact.
-- Deliberately fence at EACH exit, after the LAST original actor FOR SHARE. Never
-- prepend the foundation profile-table fence ahead of an original actor row wait.
-- Writes before a denied final check are in the same RPC transaction and roll back.
do $$
declare signature text; prefix text; definition text; old_body text; body text; anchor text; replacement text;
begin
 for signature,prefix in values
 ('public.mutate_cash_transfer(text,text,uuid,integer,jsonb,text)','bank.cash_transfer.'),
 ('public.mutate_bank_reconciliation(text,text,uuid,integer,jsonb,text)','bank.bank_reconciliation.') loop
  select pg_get_functiondef(signature::regprocedure),prosrc into definition,old_body from pg_proc where oid=signature::regprocedure;
  body:=old_body;
  foreach anchor in array array[' return prior.result;',' return result;'] loop
   if (length(body)-length(replace(body,anchor,'')))/length(anchor)<>1 then raise exception 'Bank action anchor drift: % %',signature,anchor;end if;
   replacement:=' perform public.require_role_action('''||prefix||'''||p_action);'||chr(10)||' perform role_settings_private.require_bank_request_scope('''||case when prefix='bank.cash_transfer.' then 'cash_transfer' else 'bank_reconciliation' end||''',p_request_key);'||chr(10)||anchor;
   body:=replace(body,anchor,replacement);
  end loop;
  execute replace(definition,old_body,body);
 end loop;
 for signature,prefix,anchor in values
 ('public.get_cash_transfer_result(text)','bank.cash_transfer.recover',' if prior.actor_id is null then return null;end if;'),
 ('public.get_bank_reconciliation_result(text)','bank.bank_reconciliation.recover',' if not found then return null;end if;') loop
  select pg_get_functiondef(signature::regprocedure),prosrc into definition,old_body from pg_proc where oid=signature::regprocedure;
  body:=old_body;
  if (length(body)-length(replace(body,anchor,'')))/length(anchor)<>1 then raise exception 'Bank recovery anchor drift: %',signature;end if;
  body:=replace(body,anchor,' if '||case when prefix='bank.cash_transfer.recover' then 'prior.actor_id is null' else 'not found' end||' then perform public.require_role_action('''||prefix||'''); perform role_settings_private.require_bank_request_scope('''||case when prefix='bank.cash_transfer.recover' then 'cash_transfer' else 'bank_reconciliation' end||''',p_request_key); return null;end if;');
  anchor:=case when prefix='bank.cash_transfer.recover' then ' return prior.result;' else ' return request.result;' end;
  if (length(body)-length(replace(body,anchor,'')))/length(anchor)<>1 then raise exception 'Bank recovery return drift: %',signature;end if;
  body:=replace(body,anchor,' perform public.require_role_action('''||prefix||''');'||chr(10)||' perform role_settings_private.require_bank_request_scope('''||case when prefix='bank.cash_transfer.recover' then 'cash_transfer' else 'bank_reconciliation' end||''',p_request_key);'||chr(10)||anchor);
  execute replace(definition,old_body,body);
 end loop;
end $$;
-- These tables already require original public RPCs. Close TRUNCATE too; do not
-- alter shared ledger permissions, readers, or unrelated financial domains.
revoke insert,update,delete,truncate on public.cash_transfers,public.cash_transfer_requests,public.cash_transfer_revisions,
 public.bank_reconciliations,public.bank_reconciliation_requests,public.bank_reconciliation_revisions from public,anon,authenticated,service_role;
-- TRUNCATE has no row triggers and cannot preserve ANY bank journal. Unlike
-- shared INSERT/UPDATE/DELETE permissions, it is never a domain-scoped writer.
revoke truncate on public.journal_entries,public.journal_lines from public,anon,authenticated,service_role;
-- Only the eight end-to-end proven mutation/recovery keys; shared reads stay unsupported.
update role_settings_private.action_catalog set enforced=true where id in (
 'bank.cash_transfer.create','bank.cash_transfer.edit','bank.cash_transfer.void','bank.cash_transfer.recover',
 'bank.bank_reconciliation.create','bank.bank_reconciliation.edit','bank.bank_reconciliation.void','bank.bank_reconciliation.recover');
