-- Audit batch untuk impor Accurate dan keluarga Varian.
create table import_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('master_accurate', 'group_components', 'initial_stock')),
  source_name text not null,
  source_hash text not null,
  branch_id uuid references branches(id),
  warehouse_id uuid references warehouses(id),
  as_of_date date,
  status text not null default 'previewed' check (status in ('previewed', 'posted', 'failed')),
  summary jsonb not null default '{}'::jsonb,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  posted_at timestamptz,
  unique (kind, source_hash)
);

create table import_run_rows (
  id bigint generated always as identity primary key,
  run_id uuid not null references import_runs(id) on delete cascade,
  source_row int not null,
  source_code text,
  status text not null check (status in ('valid', 'same', 'skipped', 'rejected', 'posted')),
  reason text,
  payload jsonb not null default '{}'::jsonb
);

create table item_variant_families (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category_id uuid references item_categories(id),
  created_at timestamptz not null default now()
);

create table item_variant_members (
  family_id uuid not null references item_variant_families(id) on delete cascade,
  item_id uuid not null references items(id) on delete cascade,
  label text not null,
  sort_order int not null default 0,
  primary key (family_id, item_id),
  unique (item_id)
);

create index import_runs_scope_idx on import_runs (branch_id, warehouse_id, created_at desc);
create index import_run_rows_run_idx on import_run_rows (run_id, source_row);
create index item_variant_members_family_idx on item_variant_members (family_id, sort_order);

alter table import_runs enable row level security;
alter table import_run_rows enable row level security;
alter table item_variant_families enable row level security;
alter table item_variant_members enable row level security;

create policy import_runs_select on import_runs for select to authenticated
  using ((branch_id is not null and public.user_can_access_branch(branch_id))
    or (branch_id is null and public.is_admin()));
create policy import_runs_write on import_runs for all to authenticated
  using (public.is_admin() and (branch_id is null or public.user_can_access_branch(branch_id)))
  with check (public.is_admin() and (branch_id is null or public.user_can_access_branch(branch_id)));

create policy import_run_rows_select on import_run_rows for select to authenticated
  using (exists (select 1 from import_runs r where r.id = run_id
    and ((r.branch_id is not null and public.user_can_access_branch(r.branch_id))
      or (r.branch_id is null and public.is_admin()))));
create policy import_run_rows_write on import_run_rows for all to authenticated
  using (public.is_admin() and exists (select 1 from import_runs r where r.id = run_id
    and (r.branch_id is null or public.user_can_access_branch(r.branch_id))))
  with check (public.is_admin() and exists (select 1 from import_runs r where r.id = run_id
    and (r.branch_id is null or public.user_can_access_branch(r.branch_id))));

-- Keluarga Varian adalah master lintas cabang; item di dalamnya tetap SKU mandiri.
-- auth.uid() menjaga pembacaan hanya untuk user login tanpa authenticated-wide true.
create policy variant_families_read on item_variant_families for select to authenticated
  using (auth.uid() is not null);
create policy variant_families_write on item_variant_families for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy variant_members_read on item_variant_members for select to authenticated
  using (auth.uid() is not null);
create policy variant_members_write on item_variant_members for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
