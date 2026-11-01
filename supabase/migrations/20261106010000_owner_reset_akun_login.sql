-- U13: Super Admin (OWNER) dapat mengganti email login dan/atau mengatur ulang password akun karyawan.
-- Server aplikasi tidak memegang kunci admin Supabase, jadi perubahan dilakukan lewat fungsi
-- SECURITY DEFINER yang hanya lolos untuk OWNER aktif. Password disimpan sebagai hash bcrypt
-- (format yang sama dengan Supabase Auth); riwayat hanya mencatat SIAPA/KAPAN/APA yang diubah,
-- tidak pernah email lama/baru atau password.
create table public.user_login_resets (
 id uuid primary key default gen_random_uuid(),
 profile_id uuid not null references public.profiles(id) on delete restrict,
 actor_id uuid not null references public.profiles(id) on delete restrict,
 created_at timestamptz not null default now(),
 email_changed boolean not null,
 password_changed boolean not null,
 check (email_changed or password_changed)
);
create index user_login_resets_profile_time on public.user_login_resets(profile_id,created_at desc,id);
alter table public.user_login_resets enable row level security;
revoke all on public.user_login_resets from public,anon,authenticated,service_role;
grant select on public.user_login_resets to authenticated;
create policy user_login_resets_owner_read on public.user_login_resets for select to authenticated
 using(exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and p.role='OWNER'));

create function public.login_reset_actor_is_owner() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and is_active and role='OWNER');
$$;
revoke all on function public.login_reset_actor_is_owner() from public,anon,authenticated,service_role;

-- Email login saat ini, hanya untuk OWNER (dipakai mengisi formulir reset).
create function public.get_user_login_email(p_profile_id uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare v_email text;
begin
 if not public.login_reset_actor_is_owner() then
  raise exception using errcode='42501',message='LOGIN_RESET_DENIED: hanya Super Admin';
 end if;
 select email into v_email from auth.users where id=p_profile_id;
 return v_email;
end $$;
revoke all on function public.get_user_login_email(uuid) from public,anon,service_role;
grant execute on function public.get_user_login_email(uuid) to authenticated;

create function public.owner_reset_akun_login(p_profile_id uuid,p_email text,p_password text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user auth.users%rowtype;v_email text;v_email_changed boolean:=false;v_password_changed boolean:=false;
begin
 if auth.uid() is null or p_profile_id is null then
  raise exception using errcode='42501',message='LOGIN_RESET_DENIED: sesi atau akun tidak tersedia';end if;
 if not public.login_reset_actor_is_owner() then
  raise exception using errcode='42501',message='LOGIN_RESET_DENIED: hanya Super Admin';end if;
 if not exists(select 1 from public.profiles where id=p_profile_id) then
  raise exception using errcode='P0001',message='LOGIN_RESET_NOT_FOUND: akun tidak ditemukan';end if;
 select * into v_user from auth.users where id=p_profile_id for update;
 if not found then raise exception using errcode='P0001',message='LOGIN_RESET_NOT_FOUND: akun tidak ditemukan';end if;

 v_email:=lower(btrim(coalesce(p_email,'')));
 if v_email<>'' and v_email is distinct from lower(v_user.email) then
  if length(v_email)>254 or v_email !~ '^[a-z0-9._%+''-]+@[a-z0-9.-]+\.[a-z]{2,}$' then
   raise exception using errcode='P0001',message='LOGIN_RESET_EMAIL_INVALID: format email tidak valid';end if;
  if exists(select 1 from auth.users where lower(email)=v_email and id<>p_profile_id) then
   raise exception using errcode='P0001',message='LOGIN_RESET_EMAIL_TAKEN: email sudah dipakai akun lain';end if;
  update auth.users set email=v_email,email_confirmed_at=coalesce(email_confirmed_at,now()),
   email_change='',email_change_token_new='',email_change_token_current='',email_change_confirm_status=0,
   raw_user_meta_data=case when raw_user_meta_data ? 'email' then raw_user_meta_data||jsonb_build_object('email',v_email) else raw_user_meta_data end,
   updated_at=now() where id=p_profile_id;
  update auth.identities set identity_data=coalesce(identity_data,'{}'::jsonb)||jsonb_build_object('email',v_email,'email_verified',true),
   updated_at=now() where user_id=p_profile_id and provider='email';
  v_email_changed:=true;
 end if;

 if coalesce(p_password,'')<>'' then
  if length(p_password)<8 or length(p_password)>72 then
   raise exception using errcode='P0001',message='LOGIN_RESET_PASSWORD_INVALID: password 8-72 karakter';end if;
  update auth.users set encrypted_password=extensions.crypt(p_password,extensions.gen_salt('bf',10)),
   recovery_token='',updated_at=now() where id=p_profile_id;
  v_password_changed:=true;
 end if;

 if not (v_email_changed or v_password_changed) then
  raise exception using errcode='P0001',message='LOGIN_RESET_NOTHING: tidak ada perubahan';end if;

 -- Sesi lama ditutup supaya perangkat yang masih masuk dengan login lama harus masuk ulang.
 delete from auth.sessions where user_id=p_profile_id;
 delete from auth.refresh_tokens where user_id=p_profile_id::text;

 insert into public.user_login_resets(profile_id,actor_id,email_changed,password_changed)
 values(p_profile_id,auth.uid(),v_email_changed,v_password_changed);
 return jsonb_build_object('profile_id',p_profile_id,'email_changed',v_email_changed,'password_changed',v_password_changed);
end $$;
revoke all on function public.owner_reset_akun_login(uuid,text,text) from public,anon,service_role;
grant execute on function public.owner_reset_akun_login(uuid,text,text) to authenticated;
comment on table public.user_login_resets is 'U13 bukti reset login oleh Super Admin; tanpa email maupun password.';
