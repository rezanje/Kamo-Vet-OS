-- U09: bounded existing-account edits. No existing RLS/capability/auth setting is changed.
create table public.user_account_edits (
 id uuid primary key default gen_random_uuid(),
 profile_id uuid not null references public.profiles(id) on delete restrict,
 actor_id uuid not null references public.profiles(id) on delete restrict,
 created_at timestamptz not null default now(),
 old_role public.user_role not null,new_role public.user_role not null,
 old_branch_ids uuid[] not null,new_branch_ids uuid[] not null,
 name_changed boolean not null,
 request_id uuid not null,request_hash text not null,result_version text not null,
 unique(actor_id,request_id)
);
create index user_account_edits_profile_time on public.user_account_edits(profile_id,created_at desc,id);
alter table public.user_account_edits enable row level security;
revoke all on public.user_account_edits from public,anon,authenticated,service_role;
grant select on public.user_account_edits to authenticated;

create function public.user_account_edit_allowed(p_profile_id uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare actor public.profiles;target public.profiles;actor_all boolean;target_all boolean;actor_create boolean;target_create boolean;
begin
 select * into actor from public.profiles where id=auth.uid();
 if not found or not actor.is_active or actor.role not in('OWNER','ADMIN') then return false;end if;
 if actor.role<>'OWNER' and exists(select 1 from public.role_modules where role=actor.role)
  and not exists(select 1 from public.role_modules where role=actor.role and module_id='pengaturan') then return false;end if;
 select * into target from public.profiles where id=p_profile_id;
 if not found then return false;end if;
 if actor.role='OWNER' then return true;end if;
 if target.role in('OWNER','ADMIN') and target.id<>actor.id then return false;end if;
 actor_all:=public.has_role_capability('all_branches');
 actor_create:=public.has_role_capability('create_accounts');
 select coalesce((select all_branches from public.role_capabilities where role=target.role),target.role in('OWNER','ADMIN','FINANCE')) into target_all;
 select coalesce((select create_accounts from public.role_capabilities where role=target.role),target.role in('OWNER','ADMIN')) into target_create;
 if (target_all and not actor_all) or (target_create and not actor_create) then return false;end if;
 if exists(select 1 from public.user_branches where user_id=target.id and not public.user_can_access_branch(branch_id)) then return false;end if;
 return true;
end $$;
revoke all on function public.user_account_edit_allowed(uuid) from public,anon,service_role;
grant execute on function public.user_account_edit_allowed(uuid) to authenticated;
create policy user_account_edits_read on public.user_account_edits for select to authenticated
 using(public.user_account_edit_allowed(profile_id));

-- Internal version binds all mutable account fields/grants and existing HRIS link.
create function public.user_account_edit_snapshot(p_profile_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare target public.profiles;ids uuid[];grants jsonb;employee_ids jsonb;body jsonb;
begin
 select * into target from public.profiles where id=p_profile_id;
 if not found then return null;end if;
 select coalesce(array_agg(branch_id order by branch_id),array[]::uuid[]),
  coalesce(jsonb_agg(jsonb_build_object('branch_id',branch_id,'role',role) order by branch_id),'[]')
 into ids,grants from public.user_branches where user_id=p_profile_id;
 select coalesce(jsonb_agg(id order by id),'[]') into employee_ids from public.employees where profile_id=p_profile_id;
 body:=jsonb_build_object('profile_id',target.id,'full_name',target.full_name,'role',target.role,'is_active',target.is_active,
  'branch_ids',ids,'grants',grants,'employee_ids',employee_ids);
 return (body-'grants'-'employee_ids')||jsonb_build_object('version',md5(body::text));
end $$;
revoke all on function public.user_account_edit_snapshot(uuid) from public,anon,authenticated,service_role;

create function public.get_user_account_for_edit(p_profile_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor public.profiles;snapshot jsonb;roles text[];candidate text;candidate_all boolean;candidate_create boolean;
begin
 if not public.user_account_edit_allowed(p_profile_id) then raise exception using errcode='42501',message='ACCOUNT_EDIT_DENIED: akun atau cabang tidak dapat dikelola';end if;
 select * into actor from public.profiles where id=auth.uid();
 snapshot:=public.user_account_edit_snapshot(p_profile_id);roles:=array[]::text[];
 if p_profile_id=actor.id then roles:=array[actor.role::text];
 else
  foreach candidate in array array['OWNER','ADMIN','FINANCE','DOCTOR','STAFF'] loop
   select coalesce((select all_branches from public.role_capabilities where role::text=candidate),candidate in('OWNER','ADMIN','FINANCE')) into candidate_all;
   select coalesce((select create_accounts from public.role_capabilities where role::text=candidate),candidate in('OWNER','ADMIN')) into candidate_create;
   if actor.role='OWNER' or (candidate not in('OWNER','ADMIN') and (not candidate_all or public.has_role_capability('all_branches')) and (not candidate_create or public.has_role_capability('create_accounts'))) then roles:=array_append(roles,candidate);end if;
  end loop;
 end if;
 return snapshot||jsonb_build_object('editable_roles',roles,'self',p_profile_id=actor.id);
end $$;
revoke all on function public.get_user_account_for_edit(uuid) from public,anon,service_role;
grant execute on function public.get_user_account_for_edit(uuid) to authenticated;

create function public.edit_user_account(p_profile_id uuid,p_full_name text,p_role text,p_branch_ids uuid[],p_expected_version text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles;target public.profiles;snapshot jsonb;result jsonb;old_ids uuid[];new_ids uuid[];candidate_all boolean;
 request_hash text;prior public.user_account_edits;new_version text;role_options jsonb;
begin
 if auth.uid() is null or p_profile_id is null or p_request_id is null then raise exception using errcode='42501',message='ACCOUNT_EDIT_DENIED: sesi atau akun tidak tersedia';end if;
 if nullif(btrim(p_full_name),'') is null or length(p_full_name)>200 or p_role is null or p_role not in('OWNER','ADMIN','FINANCE','DOCTOR','STAFF')
  or p_branch_ids is null or cardinality(p_branch_ids)>50 or array_position(p_branch_ids,null) is not null or nullif(p_expected_version,'') is null or length(p_expected_version)>200 then
  raise exception using errcode='P0001',message='ACCOUNT_EDIT_INVALID: periksa nama, role, cabang dan versi akun';end if;
 select coalesce(array_agg(distinct b order by b),array[]::uuid[]) into new_ids from unnest(p_branch_ids) b;
 request_hash:=md5(jsonb_build_object('target',p_profile_id,'name',btrim(p_full_name),'role',p_role,'branches',new_ids,'expected',p_expected_version)::text);
 -- Serialize manager decisions; lock grant writes before reading a complete version.
 -- Existing direct assign/unassign writes cannot appear midway through a replacement.
 perform pg_advisory_xact_lock(hashtextextended('u09-user-account-edit',0));
 lock table public.user_branches in share row exclusive mode;
 perform id from public.profiles where id in(auth.uid(),p_profile_id) order by id for update;
 if not public.user_account_edit_allowed(p_profile_id) then raise exception using errcode='42501',message='ACCOUNT_EDIT_DENIED: akun atau cabang tidak dapat dikelola';end if;
 select * into actor from public.profiles where id=auth.uid();
 select * into target from public.profiles where id=p_profile_id;
 select * into prior from public.user_account_edits where actor_id=actor.id and request_id=p_request_id;
 if found then
  if prior.profile_id<>p_profile_id or prior.request_hash<>request_hash then raise exception using errcode='P0001',message='ACCOUNT_IDEMPOTENCY_CONFLICT: permintaan sudah dipakai untuk perubahan berbeda';end if;
  return jsonb_build_object('profile_id',p_profile_id,'version',prior.result_version,'replayed',true);
 end if;
 snapshot:=public.user_account_edit_snapshot(p_profile_id);
 if snapshot->>'version'<>p_expected_version then raise exception using errcode='P0001',message='ACCOUNT_EDIT_CONFLICT: akun berubah; muat ulang sebelum menyimpan';end if;
 select coalesce(array_agg(branch_id order by branch_id),array[]::uuid[]) into old_ids from public.user_branches where user_id=p_profile_id;
 if actor.id=target.id and (p_role<>target.role::text or new_ids<>old_ids) then raise exception using errcode='P0001',message='ACCOUNT_EDIT_SELF: role dan cabang akun sendiri tidak dapat diubah di sini';end if;
 role_options:=public.get_user_account_for_edit(p_profile_id)->'editable_roles';
 if not role_options ? p_role then raise exception using errcode='42501',message='ACCOUNT_EDIT_DENIED: role melampaui kewenangan';end if;
 if p_role in('STAFF','DOCTOR') and cardinality(new_ids)=0 then raise exception using errcode='P0001',message='ACCOUNT_EDIT_INVALID: STAFF dan DOCTOR memerlukan penugasan cabang';end if;
 if exists(select 1 from unnest(new_ids) b where not exists(select 1 from public.branches where id=b and (is_active or b=any(old_ids)))) then
  raise exception using errcode='P0001',message='ACCOUNT_EDIT_INVALID: cabang baru harus aktif dan valid';end if;
 if actor.role<>'OWNER' and exists(select 1 from unnest(new_ids) b where not public.user_can_access_branch(b)) then
  raise exception using errcode='42501',message='ACCOUNT_EDIT_DENIED: cabang melampaui penugasan pengelola';end if;
 if target.is_active and target.role='OWNER' and p_role<>'OWNER'
  and not exists(select 1 from public.profiles where id<>target.id and is_active and role='OWNER') then
  raise exception using errcode='P0001',message='ACCOUNT_EDIT_LAST_ADMIN: Super Admin aktif terakhir harus dipertahankan';end if;
 if target.is_active and target.role in('OWNER','ADMIN') and p_role not in('OWNER','ADMIN')
  and not exists(select 1 from public.profiles where id<>target.id and is_active and role in('OWNER','ADMIN')) then
  raise exception using errcode='P0001',message='ACCOUNT_EDIT_LAST_ADMIN: pengelola aktif terakhir harus dipertahankan';end if;
 if target.full_name is distinct from btrim(p_full_name) or target.role::text<>p_role then
  update public.profiles set full_name=btrim(p_full_name),role=p_role::public.user_role where id=p_profile_id;
 end if;
 delete from public.user_branches where user_id=p_profile_id and not(branch_id=any(new_ids));
 insert into public.user_branches(user_id,branch_id,role)
 select p_profile_id,b,'SECONDARY'::public.branch_assignment_role from unnest(new_ids) b
 where not exists(select 1 from public.user_branches where user_id=p_profile_id and branch_id=b);
 new_version:=public.user_account_edit_snapshot(p_profile_id)->>'version';
 insert into public.user_account_edits(profile_id,actor_id,old_role,new_role,old_branch_ids,new_branch_ids,name_changed,request_id,request_hash,result_version)
 values(p_profile_id,actor.id,target.role,p_role::public.user_role,old_ids,new_ids,target.full_name is distinct from btrim(p_full_name),p_request_id,request_hash,new_version);
 return jsonb_build_object('profile_id',p_profile_id,'version',new_version,'replayed',false);
end $$;
revoke all on function public.edit_user_account(uuid,text,text,uuid[],text,uuid) from public,anon,service_role;
grant execute on function public.edit_user_account(uuid,text,text,uuid[],text,uuid) to authenticated;
comment on table public.user_account_edits is 'U09 immutable minimal account-change evidence/request identity; no names, email, credentials or HRIS payload. Existing profiles/user_branches A01 metadata auditing remains unchanged.';
