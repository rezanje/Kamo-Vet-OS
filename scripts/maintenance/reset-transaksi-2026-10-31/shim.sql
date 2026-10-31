create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create role authenticator noinherit; create role supabase_admin superuser; create role supabase_auth_admin; create role supabase_storage_admin; create role dashboard_user; create role pgbouncer;
create schema extensions; create extension pgcrypto schema extensions; create extension "uuid-ossp" schema extensions; create extension btree_gist schema public;
alter database postgres set search_path to "$user", public, extensions;
set search_path to "$user", public, extensions;
create schema auth; create schema storage; create schema vault;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}', created_at timestamptz default now(), updated_at timestamptz, last_sign_in_at timestamptz, phone text, banned_until timestamptz, deleted_at timestamptz, is_anonymous boolean default false, encrypted_password text, aud text, role text, instance_id uuid);
-- SINGLE SOURCE for every disposable harness: Supabase hosted auth.uid() exactly as in the catalog
-- (read-only 2026-10-29, project koaglxcyjqfmgfzxszkj): md5(pg_get_functiondef('auth.uid()')) =
-- ea3b41bf29e2ad573067939329aa088e, md5(prosrc) = cdef18c69c4f4cbbced2eaf81e628b49. Migration
-- 20261101120000 refuses any other definition. Apply after `create schema auth`, before migrations.
-- Like hosted: owned by a separate role (not the migration runner); ACL left at its default, i.e.
-- EXECUTE for PUBLIC. Harness-specific schema USAGE grants stay in each harness (no grant option).
do $hosted_auth$ begin
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin noinherit;
  end if;
end $hosted_auth$;
create function auth.uid() returns uuid language sql stable as $function$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$function$;
alter function auth.uid() owner to supabase_auth_admin;
create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role')$$;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.email() returns text language sql stable as $$select auth.jwt()->>'email'$$;
create table storage.buckets(id text primary key,name text,public boolean, owner uuid, created_at timestamptz default now(), updated_at timestamptz, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid, created_at timestamptz default now(), updated_at timestamptz, last_accessed_at timestamptz, metadata jsonb, path_tokens text[]);
create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;
create function storage.filename(name text) returns text language sql immutable as $$select (string_to_array(name,'/'))[array_length(string_to_array(name,'/'),1)]$$;
create publication supabase_realtime;
grant usage on schema public,auth,storage,extensions to authenticated,anon,service_role;
grant execute on all functions in schema auth to authenticated,anon,service_role;
alter default privileges in schema public grant all on tables to authenticated,service_role,anon;
alter default privileges in schema public grant all on sequences to authenticated,service_role,anon;
alter default privileges in schema public grant all on functions to authenticated,service_role,anon;
