-- Fictional cross-branch returns, run only in disposable PostgreSQL.
begin;
insert into auth.users(id) values
 ('ec100000-0000-4000-8000-000000000001'),
 ('ec100000-0000-4000-8000-000000000002');
update public.profiles set role = 'OWNER' where id = 'ec100000-0000-4000-8000-000000000001';
insert into public.branches(id, code, name, type) values
 ('ec200000-0000-4000-8000-000000000001', 'RET-A', 'Fictional A', 'BOTH'),
 ('ec200000-0000-4000-8000-000000000002', 'RET-B', 'Fictional B', 'BOTH');
insert into public.user_branches(user_id, branch_id) values
 ('ec100000-0000-4000-8000-000000000002', 'ec200000-0000-4000-8000-000000000001');
insert into public.sales(id, branch_id, no_struk) values
 ('ec300000-0000-4000-8000-000000000001', 'ec200000-0000-4000-8000-000000000001', 'RET-A-SALE'),
 ('ec300000-0000-4000-8000-000000000002', 'ec200000-0000-4000-8000-000000000002', 'RET-B-SALE');
insert into public.sales_returns(id, sale_id, no_retur) values
 ('ec400000-0000-4000-8000-000000000001', 'ec300000-0000-4000-8000-000000000001', 'RET-A-DOC'),
 ('ec400000-0000-4000-8000-000000000002', 'ec300000-0000-4000-8000-000000000002', 'RET-B-DOC');
insert into public.sales_return_items(return_id, nama, qty) values
 ('ec400000-0000-4000-8000-000000000001', 'Fictional return A', 1),
 ('ec400000-0000-4000-8000-000000000002', 'Fictional return B', 1);

set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"ec100000-0000-4000-8000-000000000002"}', true);
do $$ begin
  if (select count(*) from public.sales where no_struk like 'RET-%') <> 1
     or (select count(*) from public.sales_returns where no_retur like 'RET-%') <> 1
     or (select count(*) from public.sales_return_items where nama like 'Fictional return%') <> 1
     or exists(select 1 from public.sales_returns where id = 'ec400000-0000-4000-8000-000000000002')
     or exists(select 1 from public.sales_return_items where return_id = 'ec400000-0000-4000-8000-000000000002') then
    raise exception 'One-branch role could read another branch return';
  end if;
  if has_table_privilege('authenticated', 'public.sales_returns', 'INSERT')
     or has_table_privilege('authenticated', 'public.sales_returns', 'UPDATE')
     or has_table_privilege('authenticated', 'public.sales_returns', 'DELETE')
     or has_table_privilege('authenticated', 'public.sales_return_items', 'INSERT')
     or has_table_privilege('authenticated', 'public.sales_return_items', 'UPDATE')
     or has_table_privilege('authenticated', 'public.sales_return_items', 'DELETE') then
    raise exception 'Direct return writer grants changed';
  end if;
end $$;

select set_config('request.jwt.claims', '{"role":"authenticated","sub":"ec100000-0000-4000-8000-000000000001"}', true);
do $$ begin
  if (select count(*) from public.sales_returns where no_retur like 'RET-%') <> 2
     or (select count(*) from public.sales_return_items where nama like 'Fictional return%') <> 2 then
    raise exception 'Owner all-branch return access changed';
  end if;
end $$;
select set_config('request.headers', '{"x-kamo-operational-branch":"ec200000-0000-4000-8000-000000000001"}', true);
do $$ begin
  if (select count(*) from public.sales_returns where no_retur like 'RET-%') <> 1
     or (select count(*) from public.sales_return_items where nama like 'Fictional return%') <> 1 then
    raise exception 'Owner selected-branch return access changed';
  end if;
end $$;
rollback;
