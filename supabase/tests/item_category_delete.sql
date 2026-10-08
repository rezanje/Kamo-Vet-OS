-- Standalone regression fixture. Run only against an empty disposable database.
\set ON_ERROR_STOP on
create role authenticated;
create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table public.profiles(id uuid primary key, role text);
create table public.item_categories(id uuid primary key default gen_random_uuid(), name text unique, parent_id uuid references public.item_categories(id) on delete restrict, is_active boolean default true);
create table public.items(id uuid primary key default gen_random_uuid(), category_id uuid references public.item_categories(id) on delete set null);
create table public.category_discounts(id uuid primary key default gen_random_uuid(), item_category_id uuid references public.item_categories(id) on delete cascade);
create table public.commission_rules(id uuid primary key default gen_random_uuid(), category_id uuid references public.item_categories(id) on delete cascade);
create table public.sales_targets(id uuid primary key default gen_random_uuid(), category_id uuid references public.item_categories(id) on delete cascade);
create table public.item_variant_families(id uuid primary key default gen_random_uuid(), category_id uuid references public.item_categories(id));
alter table public.item_categories enable row level security;
create policy item_categories_read on public.item_categories for select to authenticated using(true);
grant usage on schema public, auth to authenticated;
grant all on all tables in schema public to authenticated;

\ir ../migrations/20261008090000_delete_unused_item_category.sql
begin;
insert into public.profiles(id, role) values
 ('10000000-0000-4000-8000-000000000001', 'OWNER'),
 ('10000000-0000-4000-8000-000000000002', 'STAFF')
on conflict (id) do update set role = excluded.role;
insert into public.item_categories(id, name) values
 ('20000000-0000-4000-8000-000000000001', 'DELETE TEST EMPTY'),
 ('20000000-0000-4000-8000-000000000002', 'DELETE TEST USED'),
 ('20000000-0000-4000-8000-000000000003', 'DELETE TEST PARENT');
insert into public.item_categories(id, name, parent_id) values
 ('20000000-0000-4000-8000-000000000004', 'DELETE TEST CHILD', '20000000-0000-4000-8000-000000000003');
-- A new FK also must be protected, including SET NULL/CASCADE references.
create table public.category_delete_test_refs(
 category_id uuid references public.item_categories(id) on delete cascade
);
insert into public.category_delete_test_refs values ('20000000-0000-4000-8000-000000000002');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
set local role authenticated;
do $$ begin
 begin
  perform public.delete_unused_item_category('20000000-0000-4000-8000-000000000001');
  raise exception 'STAFF deletion unexpectedly succeeded';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
set local role authenticated;
do $$ begin
 begin
  perform public.delete_unused_item_category('20000000-0000-4000-8000-000000000002');
  raise exception 'Referenced category deletion unexpectedly succeeded';
 exception when foreign_key_violation then null;
 end;
 begin
  perform public.delete_unused_item_category('20000000-0000-4000-8000-000000000003');
  raise exception 'Parent category deletion unexpectedly succeeded';
 exception when foreign_key_violation then null;
 end;
 perform public.delete_unused_item_category('20000000-0000-4000-8000-000000000001');
 if exists(select 1 from public.item_categories where id = '20000000-0000-4000-8000-000000000001') then
  raise exception 'Unused category was not deleted';
 end if;
 begin
  perform public.delete_unused_item_category('20000000-0000-4000-8000-000000000001');
  raise exception 'Missing category deletion unexpectedly succeeded';
 exception when no_data_found then null;
 end;
end $$;
reset role;
-- The failed delete must not have cascaded into hidden referencing rows.
do $$ begin
 if (select count(*) from public.category_delete_test_refs) <> 1 then
  raise exception 'Referenced data was deleted';
 end if;
end $$;
rollback;
