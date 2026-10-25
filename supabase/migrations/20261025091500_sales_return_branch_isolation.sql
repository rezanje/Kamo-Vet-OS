-- Historic demo policies still permit reads of every return row. Match each
-- return to its visible sale under the caller's existing branch RLS.
do $$ begin
  if exists (
    select 1 from (values ('sales'), ('sales_returns'), ('sales_return_items')) expected(name)
    left join pg_class rel on rel.oid = to_regclass('public.' || expected.name)
    where rel.oid is null or not rel.relrowsecurity
  ) then
    raise exception 'RETURN_RLS_DISABLED: sales and return tables must enforce RLS';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sales'
      and policyname = 'operational_branch_isolation' and permissive = 'RESTRICTIVE'
      and cmd = 'ALL' and 'authenticated' = any(roles)
      and regexp_replace(qual, '\s+', '', 'g') in (
        'user_can_access_branch(branch_id)', 'public.user_can_access_branch(branch_id)'
      )
      and with_check = qual
  ) then
    raise exception 'SALES_BRANCH_POLICY_CHANGED: return isolation needs the exact sale branch guard';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sales_returns'
      and policyname = 'sr2_all' and permissive = 'PERMISSIVE'
      and cmd = 'ALL' and 'authenticated' = any(roles)
      and qual = 'true' and with_check = 'true'
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sales_return_items'
      and policyname = 'sri2_all' and permissive = 'PERMISSIVE'
      and cmd = 'ALL' and 'authenticated' = any(roles)
      and qual = 'true' and with_check = 'true'
  ) then
    raise exception 'RETURN_POLICY_BASELINE_CHANGED: review current authenticated return access';
  end if;
end $$;

create policy sales_returns_branch_scope on public.sales_returns
  as restrictive for all to authenticated
  using (exists (
    select 1 from public.sales s where s.id = sales_returns.sale_id
  ))
  with check (exists (
    select 1 from public.sales s where s.id = sales_returns.sale_id
  ));

create policy sales_return_items_branch_scope on public.sales_return_items
  as restrictive for all to authenticated
  using (exists (
    select 1 from public.sales_returns r where r.id = sales_return_items.return_id
  ))
  with check (exists (
    select 1 from public.sales_returns r where r.id = sales_return_items.return_id
  ));
