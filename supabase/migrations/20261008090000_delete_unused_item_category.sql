-- Keep direct DELETE unavailable. Only OWNER/ADMIN may remove an unused category.
-- Check every FK before DELETE so ON DELETE SET NULL/CASCADE cannot lose references.
create or replace function public.delete_unused_item_category(p_category_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reference record;
  v_used boolean;
begin
  if not exists (
    select 1 from public.profiles where id = auth.uid() and role in ('OWNER', 'ADMIN')
  ) then
    raise exception 'Hanya OWNER/ADMIN yang boleh menghapus kategori barang'
      using errcode = '42501';
  end if;

  -- Blocks concurrent FK inserts while checking usage and deleting this row.
  perform 1 from public.item_categories where id = p_category_id for update;
  if not found then
    raise exception 'Kategori tidak ditemukan' using errcode = 'P0002';
  end if;

  for v_reference in
    select c.conrelid::regclass as relation, a.attname as column_name
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'public.item_categories'::regclass
  loop
    execute format('select exists (select 1 from %s where %I = $1)',
      v_reference.relation, v_reference.column_name)
      into v_used using p_category_id;
    if v_used then
      raise exception 'Kategori masih dipakai barang, subkategori, atau aturan lain. Nonaktifkan kategori jika tidak ingin dipakai lagi.'
        using errcode = '23503';
    end if;
  end loop;

  delete from public.item_categories where id = p_category_id;
end;
$$;
revoke all on function public.delete_unused_item_category(uuid) from public, anon;
grant execute on function public.delete_unused_item_category(uuid) to authenticated;
