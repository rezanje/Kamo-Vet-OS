-- Core account-write action policy: original business routines are preserved
-- with explicit post-sorted-lock conjuncts and composite permission dependencies.
-- SECURITY DEFINER account writers deliberately retain their original privileges.
-- TRUNCATE bypasses RLS and row auditing; CASCADE must not erase identities or
-- employee links either. Trusted Auth provisioning uses INSERT, not TRUNCATE.
revoke truncate on public.user_branches,public.profiles,public.employees from public,anon,authenticated;
create policy people_account_branch_insert_rpc on public.user_branches
 as restrictive for insert to authenticated with check(false);
create policy people_account_branch_update_rpc on public.user_branches
 as restrictive for update to authenticated using(false) with check(false);
create policy people_account_branch_delete_rpc on public.user_branches
 as restrictive for delete to authenticated using(false);

-- UPDATE/DELETE RLS filtering otherwise reports a misleading successful zero rows.
create function public.guard_direct_user_branch_write() returns trigger
language plpgsql set search_path='' as $$
begin
 if current_user in ('authenticated','anon') then
  raise exception using errcode='42501',message='PEOPLE_ACCOUNT_RPC_REQUIRED: gunakan perubahan akun terbatasi';
 end if;
 return null;
end $$;
revoke all on function public.guard_direct_user_branch_write() from public,anon,authenticated,service_role;
create trigger people_account_branch_direct_write before update or delete on public.user_branches
for each statement execute function public.guard_direct_user_branch_write();

-- A transaction-scoped, non-GUC permit carries branch metadata into the original
-- editor's INSERT before its final version/audit snapshot. No app can mint it.
create schema people_actions_private;
revoke all on schema people_actions_private from public,anon,authenticated,service_role;
create table people_actions_private.branch_assignment_permits(
 transaction_id bigint not null,actor_id uuid not null,target_id uuid not null,
 branch_id uuid not null,assignment_role public.branch_assignment_role not null,
 primary key(transaction_id,actor_id,target_id,branch_id)
);
revoke all on people_actions_private.branch_assignment_permits from public,anon,authenticated,service_role;
create function people_actions_private.apply_assignment_metadata() returns trigger
language plpgsql security definer set search_path='' as $$
declare selected_role public.branch_assignment_role;
begin
 select assignment_role into selected_role from people_actions_private.branch_assignment_permits
 where transaction_id=txid_current() and actor_id=auth.uid() and target_id=new.user_id and branch_id=new.branch_id;
 if found then new.role:=selected_role; end if;
 return new;
end $$;
revoke all on function people_actions_private.apply_assignment_metadata() from public,anon,authenticated,service_role;
create trigger people_assignment_metadata before insert on public.user_branches
for each row execute function people_actions_private.apply_assignment_metadata();

-- ONE lock protocol for every account writer, consistent with the ORIGINAL
-- set_employee_primary_branches (actor Profile FOR SHARE -> Employee FOR UPDATE)
-- and the original lifecycle (Employee -> actor Profile SHARE, compatible):
--   1 actor Profile FOR SHARE (blocking; nothing else held yet)
--   2 COMPLETE Employee set FOR UPDATE, sorted
--   3 existing U09 serialization + user_branches grant table lock
--   4 target Profile FOR UPDATE NOWAIT, last, never waited for.
-- A blocking Profile wait after holding an Employee can close a cycle with any
-- Profile-SHARE-then-Employee writer, so step 4 fails closed (40001, retry)
-- instead of waiting. The actor stays SHARE-locked (blocks concurrent actor
-- role/active changes); it is upgraded only for self-targeted calls.
-- A link committed while waiting changes the employee set: refuse/retry.
create function people_actions_private.lock_accounts(p_profile_id uuid,p_employee_id uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare employee_ids uuid[];
begin
 perform id from public.profiles where id=auth.uid() for share;
 select coalesce(array_agg(id order by id),array[]::uuid[]) into employee_ids
 from public.employees where id=p_employee_id or profile_id in(auth.uid(),p_profile_id);
 perform id from public.employees where id=any(employee_ids) order by id for update;
 perform pg_advisory_xact_lock(hashtextextended('u09-user-account-edit',0));
 lock table public.user_branches in share row exclusive mode;
 begin
  perform id from public.profiles where id=p_profile_id for update nowait;
 exception when lock_not_available then
  raise exception using errcode='40001',message='PEOPLE_ACCOUNT_BUSY: akun sedang dipakai proses lain, ulangi';
 end;
 if exists(select 1 from public.employees where
   (id=p_employee_id or profile_id in(auth.uid(),p_profile_id)) and not(id=any(employee_ids))) then
  raise exception using errcode='40001',message='PEOPLE_ACCOUNT_LINK_CHANGED: retry with current employee links';
 end if;
end $$;
revoke all on function people_actions_private.lock_accounts(uuid,uuid) from public,anon,authenticated,service_role;

-- Alternate cabang consumer uses the same bounded original editor, not raw DML.
-- Employee rows precede the existing U09 -> grant table -> sorted profiles order.
create function public.set_user_branch_assignment(p_profile_id uuid,p_branch_id uuid,p_assignment_role text,p_remove boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare snapshot jsonb; ids uuid[]; result jsonb;
begin
 if auth.uid() is null or p_profile_id is null or p_branch_id is null or p_remove is null
    or p_assignment_role is null or p_assignment_role not in('PRIMARY','SECONDARY') then
  raise exception using errcode='42501',message='ACCOUNT_EDIT_DENIED: input akun tidak tersedia';
 end if;
 perform people_actions_private.lock_accounts(p_profile_id);
 snapshot:=public.get_user_account_for_edit(p_profile_id);
 select coalesce(array_agg(value::uuid order by value::uuid),array[]::uuid[]) into ids
 from jsonb_array_elements_text(snapshot->'branch_ids') value;
 if p_remove then
  ids:=array_remove(ids,p_branch_id);
 elsif not p_branch_id=any(ids) then
  ids:=array_append(ids,p_branch_id);
 end if;
 if not p_remove then
  insert into people_actions_private.branch_assignment_permits values(txid_current(),auth.uid(),p_profile_id,p_branch_id,p_assignment_role::public.branch_assignment_role);
  -- Existing metadata changes are A01-audited, and remain in this transaction:
  -- any subsequent intrinsic editor rejection rolls them back as well.
  update public.user_branches set role=p_assignment_role::public.branch_assignment_role
  where user_id=p_profile_id and branch_id=p_branch_id and role::text<>p_assignment_role;
  snapshot:=public.get_user_account_for_edit(p_profile_id);
 end if;
 result:=public.edit_user_account(p_profile_id,snapshot->>'full_name',snapshot->>'role',ids,snapshot->>'version',gen_random_uuid());
 delete from people_actions_private.branch_assignment_permits
 where transaction_id=txid_current() and actor_id=auth.uid() and target_id=p_profile_id;
 return result;
end $$;
revoke all on function public.set_user_branch_assignment(uuid,uuid,text,boolean) from public,anon,service_role;
grant execute on function public.set_user_branch_assignment(uuid,uuid,text,boolean) to authenticated;

-- Preserve U09 business implementation, request hashing, replay and audit.
-- Narrow guards and the shared Employee-first lock protocol are the only changes.
do $patch$
declare body text; anchor text := ' perform id from public.profiles where id in(auth.uid(),p_profile_id) order by id for update;';
 original_locks text := E' perform pg_advisory_xact_lock(hashtextextended(''u09-user-account-edit'',0));\n lock table public.user_branches in share row exclusive mode;\n perform id from public.profiles where id in(auth.uid(),p_profile_id) order by id for update;';
begin
 body:=pg_get_functiondef('public.edit_user_account(uuid,text,text,uuid[],text,uuid)'::regprocedure);
 if position(anchor in body)=0 then raise exception 'PEOPLE_ACCOUNT_LOCK_ANCHOR_MISSING'; end if;
 body:=replace(body,anchor,anchor || E'
 perform public.require_role_action(''people.simpanEditPengguna'');
 if new_ids is distinct from (select coalesce(array_agg(branch_id order by branch_id),array[]::uuid[]) from public.user_branches where user_id=p_profile_id) then perform public.require_role_action(''people.account_branch_direct_assign''); end if;');
 if position(original_locks in body)=0 then raise exception 'PEOPLE_ACCOUNT_PROTOCOL_ANCHOR_MISSING'; end if;
 body:=replace(body,original_locks,' perform people_actions_private.lock_accounts(p_profile_id);');
 execute body;
end $patch$;
-- Account identity DML: platform Auth provisioning executes as its trusted
-- definer owner; ordinary authenticated callers may only change their own name.
create function public.guard_direct_people_identity() returns trigger
language plpgsql set search_path='' as $$
begin
 if current_user not in ('authenticated','anon') then
  if tg_op='DELETE' then return old; else return new; end if;
 end if;
 if tg_table_name='profiles' then
  if tg_op<>'UPDATE' then raise exception 'PEOPLE_ACCOUNT_RPC_REQUIRED'; end if;
  if new.id is distinct from old.id or new.role is distinct from old.role
    or new.is_active is distinct from old.is_active
    or (new.full_name is distinct from old.full_name and old.id is distinct from auth.uid()) then
   raise exception 'PEOPLE_ACCOUNT_RPC_REQUIRED';
  end if;
 elsif (tg_op='INSERT' and new.profile_id is not null)
    or (tg_op='UPDATE' and new.profile_id is distinct from old.profile_id) then
  raise exception 'PEOPLE_ACCOUNT_RPC_REQUIRED';
 end if;
 return new;
end $$;
revoke all on function public.guard_direct_people_identity() from public,anon,authenticated,service_role;
create trigger people_profiles_direct_identity before insert or update or delete on public.profiles
 for each row execute function public.guard_direct_people_identity();
create trigger people_employee_direct_link before insert or update on public.employees
 for each row execute function public.guard_direct_people_identity();

-- New-account completion is a composite operation: create + HRIS link + any
-- branch grants. Existing-account edit and alternate branch mutation likewise
-- require the branch permission when they actually change grants/metadata.
create function public.preflight_employee_account(p_employee_id uuid,p_role text,p_branch_ids uuid[])
returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.require_role_action('people.buatPengguna');
 perform public.require_role_action('people.tautkanPengguna');
 if cardinality(p_branch_ids)>0 then perform public.require_role_action('people.account_branch_direct_assign'); end if;
 if not public.has_role_capability('create_accounts') then raise exception 'ACCOUNT_CREATOR_REQUIRED'; end if;
 if p_role is null or p_role not in('OWNER','ADMIN','FINANCE','DOCTOR','STAFF') or p_branch_ids is null
  or cardinality(p_branch_ids)>50 or (p_role in('DOCTOR','STAFF') and cardinality(p_branch_ids)=0)
  or exists(select 1 from unnest(p_branch_ids) b where b is null or not exists(select 1 from public.branches where id=b and is_active)) then raise exception 'ACCOUNT_INPUT_INVALID'; end if;
 if not exists(select 1 from public.profiles where id=auth.uid() and is_active and role='OWNER') and (
  p_role in('OWNER','ADMIN')
  or (coalesce((select all_branches from public.role_capabilities where role::text=p_role),p_role in('OWNER','ADMIN','FINANCE')) and not public.has_role_capability('all_branches'))
  or (coalesce((select create_accounts from public.role_capabilities where role::text=p_role),p_role in('OWNER','ADMIN')) and not public.has_role_capability('create_accounts'))
  or exists(select 1 from unnest(p_branch_ids) b where not public.user_can_access_branch(b))) then raise exception 'ACCOUNT_ROLE_NOT_ALLOWED'; end if;
 if not exists(select 1 from public.employees where id=p_employee_id and status='Aktif' and profile_id is null) then raise exception 'EMPLOYEE_NOT_AVAILABLE'; end if;
end $$;
revoke all on function public.preflight_employee_account(uuid,text,uuid[]) from public,anon,service_role;
grant execute on function public.preflight_employee_account(uuid,text,uuid[]) to authenticated;

do $patch$
declare body text; signature text; gate text;
 locks text;
begin
 foreach signature in array array['public.configure_employee_account(uuid,uuid,text,text,uuid[])','public.link_employee_account(uuid,uuid)','public.set_user_branch_assignment(uuid,uuid,text,boolean)'] loop
  body:=pg_get_functiondef(signature::regprocedure);
  if signature like '%configure_employee%' then
   locks:=E' perform people_actions_private.lock_accounts(p_profile_id,p_employee_id);\n';
   gate:=E' perform public.preflight_employee_account(p_employee_id,p_role,p_branch_ids);\n if not exists(select 1 from public.profiles where id=p_profile_id and role=''STAFF'') then raise exception ''ACCOUNT_NOT_UNCONFIGURED''; end if;\n if exists(select 1 from public.profiles where id=p_profile_id and not is_active) then perform public.require_role_action(''people.togglePengguna''); end if;\n';
  elsif signature like '%link_employee%' then
   locks:=E' perform people_actions_private.lock_accounts(p_profile_id,p_employee_id);\n';
   gate:=E' perform public.require_role_action(''people.tautkanPengguna'');\n if not public.user_account_edit_allowed(p_profile_id) then raise exception ''ACCOUNT_EDIT_DENIED''; end if;\n';
  else
   locks:=E' perform people_actions_private.lock_accounts(p_profile_id);\n';
   gate:=E' perform public.require_role_action(''people.account_branch_direct_assign'');\n perform public.require_role_action(''people.simpanEditPengguna'');\n';
  end if;
  if position(E'begin\n' in body)=0 then raise exception 'PEOPLE_ACCOUNT_BEGIN_ANCHOR_MISSING'; end if;
  -- Employees and the full sorted profile set precede policy fencing. Original
  -- later row-lock statements reacquire held rows, never a new employee wait.
  body:=replace(body,E'begin\n',E'begin\n'||locks||gate);
  execute body;
 end loop;
end $patch$;
create function public.set_user_account_active(p_profile_id uuid,p_active boolean)
returns void language plpgsql security definer set search_path='' as $$
declare target public.profiles;
begin
 perform people_actions_private.lock_accounts(p_profile_id);
 perform public.require_role_action('people.togglePengguna');
 if p_active is null or p_profile_id=auth.uid() or not public.user_account_edit_allowed(p_profile_id) then raise exception 'ACCOUNT_EDIT_DENIED'; end if;
 select * into target from public.profiles where id=p_profile_id;
 if not p_active and target.is_active and target.role='OWNER' and not exists(select 1 from public.profiles where id<>target.id and role='OWNER' and is_active) then raise exception 'ACCOUNT_EDIT_LAST_ADMIN'; end if;
 if not p_active and target.is_active and target.role in('OWNER','ADMIN') and not exists(select 1 from public.profiles where id<>target.id and role in('OWNER','ADMIN') and is_active) then raise exception 'ACCOUNT_EDIT_LAST_ADMIN'; end if;
 update public.profiles set is_active=p_active where id=p_profile_id and is_active is distinct from p_active;
end $$;
revoke all on function public.set_user_account_active(uuid,boolean) from public,anon,service_role;
grant execute on function public.set_user_account_active(uuid,boolean) to authenticated;
update role_settings_private.action_catalog set enforced=true where id in('people.simpanEditPengguna','people.account_branch_direct_assign','people.buatPengguna','people.tautkanPengguna','people.togglePengguna');
