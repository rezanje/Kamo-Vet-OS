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
