-- Ingat keputusan OWNER/ADMIN saat nama cabang atau gudang dari file lama
-- berbeda sedikit dengan nama master VetOS. Kunci sumber disimpan terpisah
-- dari nama tampilan supaya unggahan berikutnya tidak perlu mengubah file.
create table public.initial_stock_scope_mappings (
  id uuid primary key default gen_random_uuid(),
  source_branch_key text not null,
  source_warehouse_key text not null,
  branch_id uuid not null references public.branches(id) on delete restrict,
  warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  confirmed_by uuid not null references public.profiles(id) on delete restrict,
  confirmed_at timestamptz not null default now(),
  unique (source_branch_key, source_warehouse_key)
);

create index initial_stock_scope_mappings_target_idx
  on public.initial_stock_scope_mappings (branch_id, warehouse_id);

alter table public.initial_stock_scope_mappings enable row level security;

create policy initial_stock_scope_mappings_read
  on public.initial_stock_scope_mappings for select to authenticated
  using (public.is_admin());

create policy initial_stock_scope_mappings_write
  on public.initial_stock_scope_mappings for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());
