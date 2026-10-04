-- Own-profile RLS includes is_active, while legacy is_admin() ignores activation.
-- Guard every profile update without changing existing read/update policies or
-- the separate profiles_prevent_self_role_change trigger.
create function public.guard_profile_account_administration() returns trigger
language plpgsql security definer set search_path = '' as $function$
declare
  v_database_role text := pg_catalog.current_setting('role', true);
  v_actor_id uuid := auth.uid();
  v_actor_role public.user_role;
  v_actor_active boolean;
begin
  -- Use the actual database SET ROLE, never request.jwt.claim.role or NEW.role.
  -- A direct postgres maintenance session is allowed only while it has not
  -- assumed the authenticated/anon role (including local test sessions).
  if v_database_role = 'service_role'
    or (session_user = 'service_role' and v_database_role = 'none')
    or (session_user = 'postgres' and v_database_role in ('none', 'postgres')) then
    return new;
  end if;

  -- Read authoritative stored state without recursive RLS, with a lock that observes a
  -- committed revocation after waiting and holds authorization until commit.
  select p.role, p.is_active into v_actor_role, v_actor_active
  from public.profiles p where p.id = v_actor_id for share;
  if not found or not v_actor_active then
    raise exception using errcode = '42501',
      message = 'PROFILE_ACCOUNT_AUTH: akun aktif diperlukan untuk mengubah profil';
  end if;

  if (new.role is distinct from old.role
    or new.is_active is distinct from old.is_active
    or old.id is distinct from v_actor_id)
    and v_actor_role not in ('OWNER', 'ADMIN') then
    raise exception using errcode = '42501',
      message = 'PROFILE_ACCOUNT_ADMIN: hanya OWNER/ADMIN aktif dapat mengelola akun';
  end if;
  return new;
end;
$function$;

create trigger profiles_account_admin_guard before update on public.profiles
  for each row execute function public.guard_profile_account_administration();
revoke all on function public.guard_profile_account_administration()
  from public, anon, authenticated, service_role;
