-- I07: preserve sold conversion definitions across direct writes, master edit and import.
-- History includes cancelled/reissued documents; never remove old proof to unlock units.
create function public.item_has_sale_history(p_item uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 return exists(select 1 from public.sale_items l join public.sales s on s.id=l.sale_id
     where l.item_id=p_item and (s.payments_finalized_at is not null or s.checkout_key is null))
   or exists(select 1 from public.sale_item_group_components c join public.sale_items l on l.id=c.sale_item_id
     join public.sales s on s.id=l.sale_id where c.component_item_id=p_item
       and (s.payments_finalized_at is not null or s.checkout_key is null))
   or exists(select 1 from public.invoice_items where item_id=p_item)
   or exists(select 1 from public.sales_invoice_items where item_id=p_item);
end $$;
revoke all on function public.item_has_sale_history(uuid) from public,anon,authenticated,service_role;

create function public.guard_sold_item_units() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and new.item_id=old.item_id and new.unit=old.unit and new.factor=old.factor then return new;end if;
 -- Posting resolves units under a parent FOR SHARE lock. Use the same parent
 -- before checking history, so a completed earlier sale is visible after waiting.
 perform 1 from public.items where id=old.item_id for update;
 if public.item_has_sale_history(old.item_id) then
  raise exception using errcode='P0001',message='SKU sudah memiliki penjualan. Konversi satuan historis tidak boleh diubah atau dihapus; buat SKU baru untuk isi kemasan berbeda. Harga tetap boleh diperbarui.';
 end if;
 if tg_op='DELETE' then return old;end if;
 return new;
end $$;
revoke all on function public.guard_sold_item_units() from public,anon,authenticated,service_role;
create trigger guard_sold_item_units before update or delete on public.item_units
 for each row execute function public.guard_sold_item_units();

create function public.guard_sold_item_base_unit() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.unit is not distinct from old.unit then return new;end if;
 perform 1 from public.items where id=old.id for update;
 if public.item_has_sale_history(old.id) then
  raise exception using errcode='P0001',message='SKU sudah memiliki penjualan. Satuan dasar historis tidak boleh diubah; buat SKU baru untuk isi kemasan berbeda.';
 end if;
 return new;
end $$;
revoke all on function public.guard_sold_item_base_unit() from public,anon,authenticated,service_role;
create trigger guard_sold_item_base_unit before update of unit on public.items
 for each row execute function public.guard_sold_item_base_unit();

-- Same OWNER/ADMIN master scope as the existing edit/import actions, invoker RLS.
-- Retained rows are updated in place so a harmless price edit never deletes proof.
create function public.replace_item_unit_configuration(p_item_id uuid,p_base_unit text,p_units jsonb)
returns void language plpgsql set search_path='' as $$
begin
 if coalesce(auth.role(),'')<>'authenticated' or not exists(select 1 from public.profiles
   where id=auth.uid() and is_active and role in('OWNER','ADMIN')) then
  raise exception 'Hanya OWNER/ADMIN aktif yang boleh mengubah satuan SKU' using errcode='42501';
 end if;
 if p_base_unit is null or btrim(p_base_unit)='' or length(p_base_unit)>20 or jsonb_typeof(p_units) is distinct from 'array' then
  raise exception 'Konfigurasi satuan tidak valid';
 end if;
 if exists(select 1 from jsonb_to_recordset(p_units) r(unit text,factor numeric,sell_price numeric,buy_price numeric)
   where r.unit is null or btrim(r.unit)='' or length(r.unit)>20 or lower(r.unit)=lower(p_base_unit)
     or r.factor is null or r.factor<=0 or r.factor::text in('NaN','Infinity','-Infinity')
     or r.sell_price is null or r.sell_price<0 or r.sell_price::text in('NaN','Infinity','-Infinity')
     or r.buy_price is null or r.buy_price<0 or r.buy_price::text in('NaN','Infinity','-Infinity'))
   or (select count(*) from jsonb_array_elements(p_units))<>(select count(distinct lower(r.unit)) from jsonb_to_recordset(p_units) r(unit text)) then
  raise exception 'Isi, harga, atau nama satuan tidak valid atau dobel';
 end if;
 perform 1 from public.items where id=p_item_id for update;
 if not found then raise exception 'SKU tidak ditemukan atau tidak dapat diakses';end if;
 update public.items set unit=p_base_unit where id=p_item_id and unit is distinct from p_base_unit;
 delete from public.item_units u where u.item_id=p_item_id
   and not exists(select 1 from jsonb_to_recordset(p_units) r(unit text) where r.unit=u.unit);
 insert into public.item_units(item_id,unit,factor,sell_price,buy_price)
 select p_item_id,r.unit,r.factor,r.sell_price,r.buy_price
 from jsonb_to_recordset(p_units) r(unit text,factor numeric,sell_price numeric,buy_price numeric)
 on conflict(item_id,unit) do update set factor=excluded.factor,sell_price=excluded.sell_price,buy_price=excluded.buy_price;
end $$;
revoke all on function public.replace_item_unit_configuration(uuid,text,jsonb) from public,anon,service_role;
grant execute on function public.replace_item_unit_configuration(uuid,text,jsonb) to authenticated;

-- POS writes pending lines before finalization in separate requests. Serialize
-- finalization against unit edits too; a pending old-factor cart must be reviewed
-- when an unsold master changed first, rather than becoming inconsistent history.
create function public.guard_pos_finalization_units() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if old.payments_finalized_at is not null or new.payments_finalized_at is null then return new;end if;
 perform 1 from public.items i where i.id in (
  select l.item_id from public.sale_items l where l.sale_id=new.id and l.item_id is not null
  union select c.component_item_id from public.sale_item_group_components c
    join public.sale_items l on l.id=c.sale_item_id where l.sale_id=new.id
 ) order by i.id for share;
 if exists(select 1 from public.sale_items l join public.items i on i.id=l.item_id
   left join public.item_units u on u.item_id=i.id and u.unit=l.satuan
   where l.sale_id=new.id and l.faktor is distinct from case
     when coalesce(nullif(l.satuan,''),coalesce(nullif(i.unit,''),'pcs'))=coalesce(nullif(i.unit,''),'pcs') then 1 else u.factor end)
   or exists(select 1 from public.sale_item_group_components c join public.sale_items l on l.id=c.sale_item_id
     join public.items i on i.id=c.component_item_id left join public.item_units u on u.item_id=i.id and u.unit=c.unit
     where l.sale_id=new.id and c.factor is distinct from case
       when coalesce(nullif(c.unit,''),coalesce(nullif(i.unit,''),'pcs'))=coalesce(nullif(i.unit,''),'pcs') then 1 else u.factor end) then
  raise exception 'Konversi satuan berubah sebelum pembayaran selesai. Muat ulang barang dan satuannya sebelum mencoba lagi.';
 end if;
 return new;
end $$;
revoke all on function public.guard_pos_finalization_units() from public,anon,authenticated,service_role;
create trigger guard_pos_finalization_units before update of payments_finalized_at on public.sales
 for each row execute function public.guard_pos_finalization_units();
