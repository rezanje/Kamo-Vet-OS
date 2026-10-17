-- Super Admin delegates branch monitoring and account creation independently.
create table public.role_capabilities (
 role public.user_role primary key,
 all_branches boolean not null default false,
 create_accounts boolean not null default false
);
alter table public.role_capabilities enable row level security;
create policy role_capabilities_read on public.role_capabilities for select to authenticated using (true);
create policy role_capabilities_owner on public.role_capabilities for all to authenticated
 using (exists(select 1 from public.profiles where id=auth.uid() and is_active and role='OWNER'))
 with check (exists(select 1 from public.profiles where id=auth.uid() and is_active and role='OWNER'));

create function public.has_role_capability(capability text) returns boolean
language sql security definer stable set search_path='' as $$
 select coalesce((select p.role='OWNER' or case capability
   when 'all_branches' then coalesce(c.all_branches,p.role in ('ADMIN','FINANCE'))
   when 'create_accounts' then coalesce(c.create_accounts,p.role='ADMIN')
   else false end
 from public.profiles p left join public.role_capabilities c on c.role=p.role
 where p.id=auth.uid() and p.is_active),false);
$$;
revoke all on function public.has_role_capability(text) from public,anon;
grant execute on function public.has_role_capability(text) to authenticated;

create or replace function public.user_can_access_branch(b uuid)
returns boolean language plpgsql security definer stable set search_path='' as $$
declare v_selected text;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active
   and (public.has_role_capability('all_branches') or exists(select 1 from public.user_branches u where u.user_id=p.id and u.branch_id=b))) then return false; end if;
 v_selected := nullif(nullif(current_setting('request.headers',true),'')::jsonb->>'x-kamo-operational-branch','');
 if v_selected is not null then
   if v_selected<>b::text or not exists(select 1 from public.branches where id=b and is_active) then return false; end if;
 end if;
 return true;
end $$;

-- Delegated creators may inspect account identities, but gain no update policy.
create policy profiles_account_creator_read on public.profiles for select to authenticated
 using (public.has_role_capability('create_accounts'));
create policy user_branches_account_creator_read on public.user_branches for select to authenticated
 using (public.has_role_capability('create_accounts'));
create policy employees_account_creator_read on public.employees for select to authenticated
 using (public.has_role_capability('create_accounts'));

create or replace function public.configure_employee_account(p_profile_id uuid,p_employee_id uuid,p_full_name text,p_role text,p_branch_ids uuid[]) returns void
language plpgsql security definer set search_path='' as $$
declare v_employee public.employees;
begin
 if not public.has_role_capability('create_accounts') then raise exception 'ACCOUNT_CREATOR_REQUIRED'; end if;
 -- Delegation never permits creating an administrator or escalating beyond the
 -- creator's own capabilities/branch grants. Super Admin can create any role.
 if not exists(select 1 from public.profiles where id=auth.uid() and is_active and role='OWNER') then
   if p_role in ('OWNER','ADMIN') or
     (coalesce((select all_branches from public.role_capabilities where role::text=p_role),p_role in ('ADMIN','FINANCE')) and not public.has_role_capability('all_branches')) or
     exists(select 1 from unnest(p_branch_ids) b where not public.user_can_access_branch(b)) then
     raise exception 'ACCOUNT_ROLE_NOT_ALLOWED';
   end if;
 end if;
 perform 1 from public.profiles where id=p_profile_id for update;
 if not found or exists(select 1 from public.employees where profile_id=p_profile_id)
   or exists(select 1 from public.user_branches where user_id=p_profile_id) then raise exception 'ACCOUNT_NOT_UNCONFIGURED'; end if;
 if p_profile_id=auth.uid() or p_role is null or p_role not in ('OWNER','ADMIN','FINANCE','STAFF','DOCTOR')
   or nullif(trim(p_full_name),'') is null or p_branch_ids is null or cardinality(p_branch_ids)>50
   or (p_role in ('STAFF','DOCTOR') and cardinality(p_branch_ids)=0)
   or exists(select 1 from unnest(p_branch_ids) b where b is null or not exists(select 1 from public.branches where id=b and is_active)) then
   raise exception 'ACCOUNT_INPUT_INVALID';
 end if;
 select * into v_employee from public.employees where id=p_employee_id for update;
 if not found or v_employee.status<>'Aktif' or v_employee.profile_id is not null then raise exception 'EMPLOYEE_NOT_AVAILABLE'; end if;
 update public.employees set profile_id=p_profile_id where id=p_employee_id;
 update public.profiles set full_name=trim(p_full_name),role=p_role::public.user_role,is_active=true where id=p_profile_id;
 insert into public.user_branches(user_id,branch_id,role)
 select p_profile_id,b,'SECONDARY'::public.branch_assignment_role from (select distinct unnest(p_branch_ids) b) ids;
end $$;

revoke all on function public.configure_employee_account(uuid,uuid,text,text,uuid[]) from public,anon;
grant execute on function public.configure_employee_account(uuid,uuid,text,text,uuid[]) to authenticated;
