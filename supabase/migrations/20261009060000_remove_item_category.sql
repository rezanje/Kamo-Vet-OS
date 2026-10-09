-- Move products/subcategories only to an explicit destination, then remove the
-- source atomically. Existing FK checks protect discounts, commissions, etc.
create or replace function public.remove_item_category(p_category_id uuid, p_replacement_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.item_categories%rowtype;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role in ('OWNER','ADMIN') and is_active) then
    raise exception 'Hanya OWNER/ADMIN aktif yang boleh menghapus kategori barang' using errcode='42501';
  end if;
  if p_replacement_id is null then
    perform public.delete_unused_item_category(p_category_id);
    return;
  end if;
  if p_replacement_id=p_category_id then
    raise exception 'Kategori pengganti harus berbeda dari kategori yang dihapus';
  end if;
  -- Deterministic locking prevents opposite merges from locking in reverse order.
  perform 1 from public.item_categories where id in (p_category_id,p_replacement_id) order by id for update;
  if not exists(select 1 from public.item_categories where id=p_category_id) then
    raise exception 'Kategori yang akan dihapus tidak ditemukan' using errcode='P0002';
  end if;
  select * into v_target from public.item_categories where id=p_replacement_id;
  if not found or not v_target.is_active then
    raise exception 'Pilih kategori pengganti yang aktif';
  end if;
  if exists(
    with recursive ancestors as (
      select id,parent_id,is_active from public.item_categories where id=p_replacement_id
      union
      select c.id,c.parent_id,c.is_active from public.item_categories c join ancestors a on a.parent_id=c.id
    ) select 1 from ancestors where id=p_category_id or not is_active
  ) then
    raise exception 'Kategori pengganti tidak boleh berada di bawah kategori yang dihapus atau induk nonaktif';
  end if;
  if exists(select 1 from public.item_categories where parent_id=p_category_id) and v_target.parent_id is not null then
    raise exception 'Kategori yang punya subkategori harus dipindahkan ke kategori induk';
  end if;
  update public.items set category_id=p_replacement_id where category_id=p_category_id;
  update public.item_categories set parent_id=p_replacement_id where parent_id=p_category_id;
  -- Any remaining business-rule reference aborts this whole transaction,
  -- including the product and subcategory moves above.
  perform public.delete_unused_item_category(p_category_id);
end;
$$;
revoke all on function public.remove_item_category(uuid,uuid) from public,anon;
grant execute on function public.remove_item_category(uuid,uuid) to authenticated;
