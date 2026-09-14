-- Keep pet identity and all clinical/financial foreign keys unchanged.
begin;
create table public.pet_ownership_transfers (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id),
  from_customer_id uuid not null references public.customers(id),
  to_customer_id uuid not null references public.customers(id),
  from_name text not null,
  to_name text not null,
  transferred_by uuid not null references public.profiles(id),
  staff_name text not null,
  created_at timestamptz not null default now(),
  check (from_customer_id <> to_customer_id)
);
create index on public.pet_ownership_transfers(pet_id, created_at desc);
alter table public.pet_ownership_transfers enable row level security;
grant select on public.pet_ownership_transfers to authenticated;
revoke insert, update, delete on public.pet_ownership_transfers from anon, authenticated;
create policy transfer_history_read on public.pet_ownership_transfers
  for select to authenticated using (public.is_admin());

-- Only this trigger can append history. Covers direct updates as well as RPC.
create schema if not exists private;
create function private.record_pet_ownership_transfer()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.customer_id is not distinct from new.customer_id then return new; end if;
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Hanya owner/admin yang boleh memindahkan kepemilikan';
  end if;
  if old.status <> 'Aktif' or new.status <> 'Aktif' then
    raise exception 'Hanya anabul aktif yang dapat dipindahkan';
  end if;
  insert into public.pet_ownership_transfers
    (pet_id, from_customer_id, to_customer_id, from_name, to_name, transferred_by, staff_name)
  select old.id, old.customer_id, new.customer_id, a.name, b.name, auth.uid(), coalesce(p.full_name, 'Admin')
  from public.customers a, public.customers b, public.profiles p
  where a.id = old.customer_id and b.id = new.customer_id and p.id = auth.uid();
  if not found then raise exception 'Pemilik atau petugas tidak valid'; end if;
  return new;
end;
$$;
revoke all on function private.record_pet_ownership_transfer() from public, anon, authenticated;
create trigger pet_ownership_transfer_audit before update of customer_id on public.pets
  for each row execute function private.record_pet_ownership_transfer();

create function public.transfer_pet_ownership(p_pet_id uuid, p_from_customer_id uuid, p_to_customer_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare current_owner uuid;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Hanya owner/admin yang boleh memindahkan kepemilikan';
  end if;
  if p_from_customer_id is null or p_to_customer_id is null or p_from_customer_id = p_to_customer_id then
    raise exception 'Pilih pemilik tujuan yang berbeda';
  end if;
  select customer_id into current_owner from public.pets where id = p_pet_id for update;
  if not found then raise exception 'Anabul tidak ditemukan'; end if;
  if current_owner <> p_from_customer_id then
    raise exception 'Kepemilikan sudah berubah. Muat ulang halaman';
  end if;
  perform 1 from public.customers where id = p_to_customer_id;
  if not found then raise exception 'Pemilik tujuan tidak ditemukan'; end if;
  update public.pets set customer_id = p_to_customer_id where id = p_pet_id;
end;
$$;
revoke all on function public.transfer_pet_ownership(uuid, uuid, uuid) from public, anon;
grant execute on function public.transfer_pet_ownership(uuid, uuid, uuid) to authenticated;
commit;
