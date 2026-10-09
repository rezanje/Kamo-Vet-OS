-- Standalone regression; empty disposable PostgreSQL database only.
\set ON_ERROR_STOP on
\ir item_category_delete.sql
alter table public.profiles add column is_active boolean default true;
create table public.stock(item_id uuid references public.items(id), qty numeric);
\ir ../migrations/20261009060000_remove_item_category.sql
begin;
insert into public.profiles(id,role,is_active) values
 ('10000000-0000-4000-8000-000000000001','OWNER',true),
 ('10000000-0000-4000-8000-000000000002','STAFF',true),
 ('10000000-0000-4000-8000-000000000003','ADMIN',false);
insert into public.item_categories(id,name,is_active) values
 ('20000000-0000-4000-8000-000000000001','SOURCE',true),
 ('20000000-0000-4000-8000-000000000002','TARGET',true),
 ('20000000-0000-4000-8000-000000000005','INACTIVE',false),
 ('20000000-0000-4000-8000-000000000006','RULE',true),
 ('20000000-0000-4000-8000-000000000007','EMPTY',true);
insert into public.item_categories(id,name,parent_id) values
 ('20000000-0000-4000-8000-000000000003','SOURCE CHILD','20000000-0000-4000-8000-000000000001'),
 ('20000000-0000-4000-8000-000000000004','TARGET CHILD','20000000-0000-4000-8000-000000000002');
insert into public.items(id,category_id) values
 ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001'),
 ('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003'),
 ('30000000-0000-4000-8000-000000000006','20000000-0000-4000-8000-000000000006');
insert into public.stock values ('30000000-0000-4000-8000-000000000001',7),('30000000-0000-4000-8000-000000000003',9);
insert into public.category_discounts(item_category_id) values ('20000000-0000-4000-8000-000000000006');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$ begin
 begin
  perform public.remove_item_category('20000000-0000-4000-8000-000000000007',null);
  raise exception 'STAFF unexpectedly allowed';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
do $$ begin
 begin
  perform public.remove_item_category('20000000-0000-4000-8000-000000000007',null);
  raise exception 'Inactive ADMIN unexpectedly allowed';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
do $$
declare target uuid; failed boolean;
begin
 -- Invalid targets must reject without moving products or children.
 foreach target in array array[
  '20000000-0000-4000-8000-000000000001'::uuid,
  '20000000-0000-4000-8000-000000000003'::uuid,
  '20000000-0000-4000-8000-000000000004'::uuid,
  '20000000-0000-4000-8000-000000000005'::uuid,
  '20000000-0000-4000-8000-000000000099'::uuid
 ] loop
  failed := false;
  begin
   perform public.remove_item_category('20000000-0000-4000-8000-000000000001',target);
  exception when raise_exception then failed := true; end;
  if not failed then raise exception 'Invalid target % unexpectedly accepted',target; end if;
 end loop;
 begin
  perform public.remove_item_category('20000000-0000-4000-8000-000000000001',null);
  raise exception 'Used category removed without replacement';
 exception when foreign_key_violation then null; end;
 begin
  perform public.remove_item_category('20000000-0000-4000-8000-000000000006','20000000-0000-4000-8000-000000000002');
  raise exception 'Category with discount rule removed';
 exception when foreign_key_violation then null; end;
 if not exists(select 1 from public.items where id='30000000-0000-4000-8000-000000000006' and category_id='20000000-0000-4000-8000-000000000006') then raise exception 'Blocked removal did not roll back item move'; end if;
 if (select count(*) from public.category_discounts)<>1 then raise exception 'Discount rule lost'; end if;
 perform public.remove_item_category('20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002');
 if exists(select 1 from public.item_categories where id='20000000-0000-4000-8000-000000000001') then raise exception 'Source parent remains'; end if;
 if not exists(select 1 from public.item_categories where id='20000000-0000-4000-8000-000000000003' and parent_id='20000000-0000-4000-8000-000000000002') then raise exception 'Child was not moved'; end if;
 if not exists(select 1 from public.items where id='30000000-0000-4000-8000-000000000001' and category_id='20000000-0000-4000-8000-000000000002') then raise exception 'Direct product was not moved'; end if;
 perform public.remove_item_category('20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000004');
 if not exists(select 1 from public.items where id='30000000-0000-4000-8000-000000000003' and category_id='20000000-0000-4000-8000-000000000004') then raise exception 'Leaf product was not moved'; end if;
 perform public.remove_item_category('20000000-0000-4000-8000-000000000007',null);
 if exists(select 1 from public.item_categories where id='20000000-0000-4000-8000-000000000007') then raise exception 'Empty category remains'; end if;
 if (select count(*) from public.items)<>3 then raise exception 'Products lost'; end if;
end $$;
reset role;
do $$ begin
 if (select count(*) from public.stock)<>2 or (select sum(qty) from public.stock)<>16 then raise exception 'Stock changed'; end if;
end $$;
rollback;
