-- Standalone regression fixture. Run only against an empty disposable database.
\set ON_ERROR_STOP on
create role authenticated;
create role anon;
create schema auth;
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table public.profiles(id uuid primary key, full_name text, role text);
create table public.customers(id uuid primary key, name text, points integer);
create table public.pets(id uuid primary key, customer_id uuid references public.customers, name text, status text);
create unique index pets_active_name on public.pets(customer_id, lower(btrim(name))) where status = 'Aktif';
create table public.visits(id integer primary key, pet_id uuid references public.pets, customer_id uuid references public.customers);
create table public.invoices(id integer primary key, visit_id integer references public.visits, total integer);
create function public.is_admin() returns boolean language sql security definer set search_path = '' as $$
 select exists(select 1 from public.profiles where id = auth.uid() and role in ('OWNER','ADMIN'));
$$;
grant usage on schema public, auth to authenticated;
grant select, update on public.pets to authenticated;
grant select on public.customers, public.profiles, public.visits, public.invoices to authenticated;
alter table public.pets enable row level security;
create policy pets_read on public.pets for select to authenticated using (true);
create policy pets_update on public.pets for update to authenticated using (true) with check (true);
insert into profiles values ('00000000-0000-0000-0000-000000000001','Admin','ADMIN'), ('00000000-0000-0000-0000-000000000002','Staff','KASIR');
insert into customers values ('10000000-0000-0000-0000-000000000001','Aldi',100), ('10000000-0000-0000-0000-000000000002','Andri',5);
insert into pets values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Mochi','Aktif');
insert into visits select n, '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001' from generate_series(1,10) n;
insert into invoices values (1,1,50000);
\ir ../migrations/20260914131111_pet_ownership_transfer.sql
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select public.transfer_pet_ownership('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');
do $$ begin
 assert (select customer_id = '10000000-0000-0000-0000-000000000002' from pets), 'Owner must change';
 assert (select count(*) = 10 from visits where pet_id = '20000000-0000-0000-0000-000000000001'), 'Keep ten medical visits';
 assert (select count(*) = 10 from visits where customer_id = '10000000-0000-0000-0000-000000000001'), 'Keep original billing customer';
 assert (select total = 50000 from invoices), 'Keep invoice';
 assert (select points = 100 from customers where name='Aldi'), 'Keep original loyalty';
 assert (select count(*) = 1 from pet_ownership_transfers), 'Exactly one history entry';
 assert (select from_name='Aldi' and to_name='Andri' and staff_name='Admin' from pet_ownership_transfers), 'Correct history';
 begin
   perform transfer_pet_ownership('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');
   raise exception 'Stale transfer accepted' using errcode='XX000';
 exception when raise_exception then null; end;
 begin
   perform transfer_pet_ownership('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002');
   raise exception 'Same owner accepted' using errcode='XX000';
 exception when raise_exception then null; end;
 begin
   delete from pet_ownership_transfers;
   raise exception 'History deletion accepted' using errcode='XX000';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$ begin
 begin
   perform transfer_pet_ownership('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001');
   raise exception 'Staff RPC accepted' using errcode='XX000';
 exception when raise_exception then null; end;
 begin
   update pets set customer_id='10000000-0000-0000-0000-000000000001';
   raise exception 'Staff direct update accepted' using errcode='XX000';
 exception when raise_exception then null; end;
 assert (select count(*)=0 from pet_ownership_transfers), 'History restricted to admins';
end $$;
reset role;
insert into pets values ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Mochi','Aktif');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$ begin
 begin
   perform transfer_pet_ownership('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001');
   raise exception 'Duplicate name accepted' using errcode='XX000';
 exception when unique_violation then null; end;
 assert (select count(*)=1 from pet_ownership_transfers), 'Failed transfer rolls back audit';
 assert (select customer_id='10000000-0000-0000-0000-000000000002' from pets where id='20000000-0000-0000-0000-000000000001'), 'Failed transfer keeps owner';
end $$;
select 'PASS: ownership, clinical/billing integrity, audit, stale submit, permissions and rollback' as result;
