-- H05: clinic invoice lines that come from a package carry their package origin.
-- A tagged line is a package component: commission/omzet count it under the package
-- (qty = package qty), never as a normal SKU sale. Retail already sells a package as
-- one "Grup" line with its components in sale_item_group_components, so POS is unchanged.
-- Untagged lines (all historic lines) behave exactly as before. No stock/HPP/GL change.

alter table public.invoice_items
  add column if not exists package_item_id uuid references public.items(id) on delete restrict,
  add column if not exists package_qty numeric(15,4);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'invoice_items_package_origin_pair') then
    alter table public.invoice_items add constraint invoice_items_package_origin_pair
      check ((package_item_id is null and package_qty is null) or (package_item_id is not null and package_qty > 0));
  end if;
end $$;
create index if not exists invoice_items_package_item_idx on public.invoice_items(package_item_id)
  where package_item_id is not null;
comment on column public.invoice_items.package_item_id is
  'H05: paket (barang Grup) asal baris komponen ini. Null = penjualan SKU biasa.';
comment on column public.invoice_items.package_qty is
  'H05: jumlah paket yang dijual untuk asal ini; aturan komisi paket menghitung qty ini.';

-- Server-side guard: the package must be an active Grup whose recipe contains the line SKU.
-- Corrections and reissues inherit the exact source line tag, like the line seller.
create or replace function public.guard_clinic_line_package() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_source public.invoice_items%rowtype;
begin
  if tg_op = 'UPDATE' then
    if new.package_item_id is distinct from old.package_item_id or new.package_qty is distinct from old.package_qty then
      raise exception using errcode = 'P0001', message = 'CARE_INVALID: asal paket baris tersimpan tidak dapat ditulis ulang';
    end if;
    return new;
  end if;
  if new.package_item_id is null and new.service_source_line_id is not null then
    select * into v_source from public.invoice_items where id = new.service_source_line_id for share;
    if found and v_source.package_item_id is not null and v_source.item_id is not distinct from new.item_id then
      new.package_item_id := v_source.package_item_id;
      new.package_qty := v_source.package_qty;
    end if;
  end if;
  if new.package_item_id is null then
    new.package_qty := null;
    return new;
  end if;
  if new.package_qty is null or new.package_qty <= 0 then
    raise exception using errcode = 'P0001', message = 'CARE_INVALID: jumlah paket wajib lebih dari 0';
  end if;
  if new.item_id is null then
    raise exception using errcode = 'P0001', message = 'CARE_INVALID: komponen paket harus barang dari master';
  end if;
  perform 1 from public.items g
    join public.item_group_components c on c.group_item_id = g.id and c.component_item_id = new.item_id
    where g.id = new.package_item_id and g.item_type = 'Grup';
  if not found then
    raise exception using errcode = 'P0001', message = 'CARE_INVALID: barang ini bukan komponen paket yang dipilih';
  end if;
  return new;
end $$;
revoke all on function public.guard_clinic_line_package() from public, anon, authenticated, service_role;
drop trigger if exists clinic_line_package on public.invoice_items;
create trigger clinic_line_package before insert or update on public.invoice_items
  for each row execute function public.guard_clinic_line_package();

-- Keep the atomic RPC signature/ACL; only carry the two optional line fields through.
-- Fail closed if the definition drifted from the reviewed text.
do $patch$
declare p record; definition text; signature regprocedure;
begin
  signature := to_regprocedure('public.clinic_post_invoice(uuid,text,jsonb,jsonb)');
  if signature is null then raise exception 'H05 missing required RPC clinic_post_invoice'; end if;
  definition := pg_get_functiondef(signature);
  if position('package_item_id' in definition) > 0 then return; end if; -- already applied
  for p in select * from (values
    (E'service_performers, bmhp_components, salesperson_id\n    ) values',
     E'service_performers, bmhp_components, salesperson_id, package_item_id, package_qty\n    ) values'),
    (E'v_bmhp, nullif(v_line.value->>''salesperson_id'','''')::uuid\n    ) returning',
     E'v_bmhp, nullif(v_line.value->>''salesperson_id'','''')::uuid,\n      nullif(v_line.value->>''package_item_id'','''')::uuid, nullif(v_line.value->>''package_qty'','''')::numeric\n    ) returning')
  ) as patches(old_text, new_text) loop
    if (length(definition) - length(replace(definition, p.old_text, ''))) / length(p.old_text) <> 1 then
      raise exception 'H05 expected exactly one anchor in clinic_post_invoice: %', left(p.old_text, 60);
    end if;
    definition := replace(definition, p.old_text, p.new_text);
  end loop;
  execute definition;
end $patch$;
