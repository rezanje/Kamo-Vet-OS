-- Bounded repair for the reported two reported empty ACCESORIS duplicates, 2026-10-09.
-- Requires a privileged maintenance connection. Every target must be unused;
-- the existing RPC checks all foreign keys under a row lock. Any mismatch aborts.
begin;
create temporary table repair_categories(id uuid primary key, name text, parent_id uuid) on commit drop;
insert into repair_categories values
('e1923cb7-bf32-452e-86a7-5205586a7b45'::uuid, 'AKSESORIS LAIN — ACCESORIS', 'f7029164-98dc-4175-bf05-5e27e2081e7b'::uuid),
('7eed1d71-32d7-4339-a026-a2259e3868bf'::uuid, 'COLLAR — ACCESORIS', 'f7029164-98dc-4175-bf05-5e27e2081e7b'::uuid);
select set_config('request.jwt.claim.sub', (select id::text from public.profiles where role='OWNER' order by id limit 1), true);
do $$
declare
  r record;
  before_items text;
  before_stock text;
  before_other_categories text;
begin
  perform 1 from public.item_categories c join repair_categories t using(id) order by c.id for update of c;
  if (select count(*) from public.item_categories c join repair_categories t on c.id=t.id and c.name=t.name and c.parent_id is not distinct from t.parent_id) <> 2 then
    raise exception 'Expected ACCESORIS duplicates changed; re-inspect before repairing';
  end if;
  if not exists(select 1 from public.item_categories where id='f7029164-98dc-4175-bf05-5e27e2081e7b' and name='ACCESORIS' and parent_id is null) then
    raise exception 'Replacement category missing';
  end if;
  select md5(string_agg(row_to_json(i)::text, '' order by i.id)) into before_items from public.items i;
  select md5(string_agg(row_to_json(s)::text, '' order by row_to_json(s)::text)) into before_stock from public.stock s;
  select md5(string_agg(row_to_json(c)::text, '' order by c.id)) into before_other_categories from public.item_categories c where not exists(select 1 from repair_categories t where t.id=c.id);
  for r in select id from repair_categories order by parent_id nulls last, id loop
    perform public.delete_unused_item_category(r.id);
  end loop;
  if exists(select 1 from public.item_categories c join repair_categories t using(id)) then raise exception 'Cleanup incomplete'; end if;
  if before_items is distinct from (select md5(string_agg(row_to_json(i)::text, '' order by i.id)) from public.items i)
    or before_stock is distinct from (select md5(string_agg(row_to_json(s)::text, '' order by row_to_json(s)::text)) from public.stock s)
    or before_other_categories is distinct from (select md5(string_agg(row_to_json(c)::text, '' order by c.id)) from public.item_categories c)
  then raise exception 'Unexpected change outside obsolete categories'; end if;
end $$;
select 2 as obsolete_categories_removed,
 (select count(*) from public.items i join public.item_categories c on c.id=i.category_id where c.id='f7029164-98dc-4175-bf05-5e27e2081e7b' or c.parent_id='f7029164-98dc-4175-bf05-5e27e2081e7b') as remaining_accessory_products,
 true as items_stock_and_other_categories_unchanged;
commit;
