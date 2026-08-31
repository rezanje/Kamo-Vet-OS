-- Produk virtual Grup: resep master + snapshot komponen per baris penjualan.
-- Harga tetap berada di items/sale_items. Tabel ini hanya mengatur isi dan HPP.

alter table items drop constraint if exists items_item_type_check;
alter table items add constraint items_item_type_check
  check (item_type in ('Persediaan', 'Jasa', 'Non-Persediaan', 'Grup'));

create table item_group_components (
  id uuid primary key default gen_random_uuid(),
  group_item_id uuid not null references items(id) on delete cascade,
  component_item_id uuid not null references items(id) on delete restrict,
  qty numeric(15,4) not null check (qty > 0),
  unit varchar(20) not null,
  factor numeric(15,4) not null check (factor > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_item_id, component_item_id, unit),
  check (group_item_id <> component_item_id)
);

create index item_group_components_group_idx
  on item_group_components(group_item_id, sort_order);
create index item_group_components_component_idx
  on item_group_components(component_item_id);

create table sale_item_group_components (
  id uuid primary key default gen_random_uuid(),
  sale_item_id uuid not null references sale_items(id) on delete cascade,
  component_item_id uuid references items(id) on delete set null,
  component_code varchar(80),
  component_name varchar(160) not null,
  item_type varchar(16) not null
    check (item_type in ('Persediaan', 'Jasa', 'Non-Persediaan')),
  qty_per_group numeric(15,4) not null check (qty_per_group > 0),
  unit varchar(20) not null,
  factor numeric(15,4) not null check (factor > 0),
  total_base_qty numeric(15,4) not null check (total_base_qty > 0),
  hpp numeric(15,2) not null default 0 check (hpp >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index sale_item_group_components_sale_item_idx
  on sale_item_group_components(sale_item_id, sort_order);

-- Database ikut memvalidasi tipe dan faktor resmi. Server action tetap melakukan
-- validasi lebih awal supaya pesan ke admin lebih ramah.
create or replace function public.validate_item_group_component()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  group_type text;
  component_type text;
  component_base_unit text;
  official_factor numeric;
begin
  select item_type into group_type
  from public.items
  where id = new.group_item_id;

  select item_type, unit into component_type, component_base_unit
  from public.items
  where id = new.component_item_id and is_active = true;

  if group_type is distinct from 'Grup' then
    raise exception 'group_item_id bukan Grup';
  end if;
  if component_type is null or component_type = 'Grup' then
    raise exception 'komponen harus item aktif non-Grup';
  end if;

  if lower(new.unit) = lower(component_base_unit) then
    official_factor := 1;
  else
    select factor into official_factor
    from public.item_units
    where item_id = new.component_item_id
      and lower(unit) = lower(new.unit);
  end if;

  if official_factor is null or official_factor <> new.factor then
    raise exception 'satuan/faktor komponen tidak cocok master';
  end if;
  return new;
end;
$$;

create trigger item_group_components_validate
before insert or update on item_group_components
for each row execute function public.validate_item_group_component();

create or replace function public.touch_item_group_component()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger item_group_components_touch
before update on item_group_components
for each row execute function public.touch_item_group_component();

alter table item_group_components enable row level security;
alter table sale_item_group_components enable row level security;

revoke all on table item_group_components from anon, authenticated;
grant select, insert, update, delete on table item_group_components to authenticated;

create policy item_group_components_select on item_group_components
  for select to authenticated using (true);
create policy item_group_components_insert on item_group_components
  for insert to authenticated with check ((select public.is_admin()));
create policy item_group_components_update on item_group_components
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy item_group_components_delete on item_group_components
  for delete to authenticated using ((select public.is_admin()));

revoke all on table sale_item_group_components from anon, authenticated;
grant select, insert on table sale_item_group_components to authenticated;

create policy sale_item_group_components_select on sale_item_group_components
  for select to authenticated
  using (exists (
    select 1
    from public.sale_items si
    join public.sales s on s.id = si.sale_id
    where si.id = sale_item_group_components.sale_item_id
      and public.user_can_access_branch(s.branch_id)
  ));
create policy sale_item_group_components_insert on sale_item_group_components
  for insert to authenticated
  with check (exists (
    select 1
    from public.sale_items si
    join public.sales s on s.id = si.sale_id
    where si.id = sale_item_group_components.sale_item_id
      and public.user_can_access_branch(s.branch_id)
  ));

comment on table item_group_components is
  'Resep tetap produk Grup. Komponen dapat Persediaan, Jasa, atau Non-Persediaan; Grup bertingkat ditolak.';
comment on table sale_item_group_components is
  'Snapshot resep per sale_items untuk struk, audit, HPP, dan retur historis.';
