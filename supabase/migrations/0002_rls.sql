-- VetOS Fase 1 — Row Level Security (PRD §13, §14 CRITICAL: branch data isolation)

-- SECURITY DEFINER so these bypass RLS on the tables they read (no recursion).
create function public.user_can_access_branch(b uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('OWNER','ADMIN','FINANCE')
  ) or exists (
    select 1 from public.user_branches
    where user_id = auth.uid() and branch_id = b
  );
$$;

create function public.is_admin()
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('OWNER','ADMIN')
  );
$$;

alter table branches        enable row level security;
alter table warehouses      enable row level security;
alter table profiles        enable row level security;
alter table user_branches   enable row level security;
alter table item_categories enable row level security;
alter table items           enable row level security;
alter table customers       enable row level security;
alter table pets            enable row level security;

-- branches: master ref, any authenticated user may read
create policy branches_read on branches for select to authenticated using (true);

-- warehouses: branch-scoped. THIS is the demoable "Staf Cabang A tak lihat Cabang B".
-- ponytail: the same user_can_access_branch() gate is reused on every transactional
-- table (stock_ledger, sales, journals, ...) as those modules land. one helper, one rule.
create policy warehouses_select on warehouses for select to authenticated
  using (public.user_can_access_branch(branch_id));
create policy warehouses_write on warehouses for all to authenticated
  using (public.user_can_access_branch(branch_id))
  with check (public.user_can_access_branch(branch_id));

-- profiles: read/update own row; OWNER/ADMIN read all
create policy profiles_select on profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy profiles_update on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- user_branches: see own assignments; admins manage all
create policy user_branches_select on user_branches for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy user_branches_admin_write on user_branches for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- global masters (PRD: customers/pets are cross-branch in CRM): authenticated read
create policy item_categories_read on item_categories for select to authenticated using (true);
create policy items_read           on items           for select to authenticated using (true);
create policy customers_read       on customers       for select to authenticated using (true);
create policy pets_read            on pets            for select to authenticated using (true);
