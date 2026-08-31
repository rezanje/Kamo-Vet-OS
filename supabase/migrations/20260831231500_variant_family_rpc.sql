-- Replace keluarga Varian beserta seluruh anggotanya dalam satu transaksi.
create or replace function public.replace_item_variant_family(
  p_family_id uuid,
  p_name text,
  p_category_id uuid,
  p_members jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_family_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Hanya OWNER/ADMIN yang boleh mengubah Keluarga Varian'
      using errcode = '42501';
  end if;
  if nullif(btrim(p_name), '') is null then
    raise exception 'Nama Keluarga Varian wajib diisi';
  end if;
  if jsonb_typeof(p_members) is distinct from 'array' then
    raise exception 'Anggota Keluarga Varian tidak valid';
  end if;
  if (select count(*) from jsonb_to_recordset(p_members) as x(item_id uuid, label text, sort_order integer)) < 2 then
    raise exception 'Keluarga Varian minimal dua SKU';
  end if;
  if (select count(*) from jsonb_to_recordset(p_members) as x(item_id uuid, label text, sort_order integer))
     <> (select count(distinct x.item_id) from jsonb_to_recordset(p_members) as x(item_id uuid, label text, sort_order integer)) then
    raise exception 'SKU hanya boleh sekali';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_members) as x(item_id uuid, label text, sort_order integer)
    left join public.items i on i.id = x.item_id
    where i.id is null or i.is_active is not true or i.item_type = 'Grup' or nullif(btrim(x.label), '') is null
  ) then
    raise exception 'Anggota Varian harus SKU aktif non-Grup dengan label';
  end if;

  if p_family_id is null then
    insert into public.item_variant_families (name, category_id)
    values (btrim(p_name), p_category_id)
    returning id into v_family_id;
  else
    update public.item_variant_families
    set name = btrim(p_name), category_id = p_category_id
    where id = p_family_id
    returning id into v_family_id;
    if v_family_id is null then
      raise exception 'Keluarga Varian tidak ditemukan';
    end if;
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_members) as x(item_id uuid, label text, sort_order integer)
    join public.item_variant_members m on m.item_id = x.item_id and m.family_id <> v_family_id
  ) then
    raise exception 'SKU sudah menjadi anggota Keluarga Varian lain';
  end if;

  delete from public.item_variant_members where family_id = v_family_id;
  insert into public.item_variant_members (family_id, item_id, label, sort_order)
  select v_family_id, x.item_id, btrim(x.label), coalesce(x.sort_order, 0)
  from jsonb_to_recordset(p_members) as x(item_id uuid, label text, sort_order integer);
  return v_family_id;
end;
$$;

revoke all on function public.replace_item_variant_family(uuid, text, uuid, jsonb) from public;
grant execute on function public.replace_item_variant_family(uuid, text, uuid, jsonb) to authenticated;
