-- Bounded repair for the reported obsolete OBAT hierarchy, 2026-10-09.
-- Requires a privileged maintenance connection. Every target must be unused;
-- the existing RPC checks all foreign keys under a row lock. Any mismatch aborts.
begin;
create temporary table repair_categories(id uuid primary key, name text, parent_id uuid) on commit drop;
insert into repair_categories values
('935e87f7-a413-4553-b2e5-de433515b0cd'::uuid, 'ALKES — OBAT', 'e5383dde-9d62-448f-8441-0cfa742bcd2e'::uuid),
('788a5112-cb3f-4f64-9977-b841ab86199e'::uuid, 'KAPSUL (CPLS)', 'e5383dde-9d62-448f-8441-0cfa742bcd2e'::uuid),
('e5383dde-9d62-448f-8441-0cfa742bcd2e'::uuid, 'OBAT', null::uuid),
('9e167b2e-a3c4-4195-b082-f9380b1aa08f'::uuid, 'OBAT ANTI JAMUR', 'e5383dde-9d62-448f-8441-0cfa742bcd2e'::uuid),
('5354405d-8769-434a-a881-4e6446e6216f'::uuid, 'OBAT ANTI KUTU & PARASIT', 'e5383dde-9d62-448f-8441-0cfa742bcd2e'::uuid),
('32b19ff0-284f-41eb-b2c4-5e30d1d4e2b8'::uuid, 'OBAT FLU, DEMAM & PENCERNAAN', 'e5383dde-9d62-448f-8441-0cfa742bcd2e'::uuid),
('04462e90-7c6a-497e-8015-64e3066b3a6f'::uuid, 'OBAT LAIN — OBAT', 'e5383dde-9d62-448f-8441-0cfa742bcd2e'::uuid),
('05fcb8ba-b42e-4f8f-92a6-fd302d8e55b2'::uuid, 'OBAT SALEP & TOPIKAL', 'e5383dde-9d62-448f-8441-0cfa742bcd2e'::uuid),
('f1ed152a-5c53-46fd-b50c-3f5b5dbfabb9'::uuid, 'OBAT SIRUP & ORAL', 'e5383dde-9d62-448f-8441-0cfa742bcd2e'::uuid),
('312c9990-a661-4dbd-ab61-074d15d70357'::uuid, 'OBAT TETES (OT)', 'e5383dde-9d62-448f-8441-0cfa742bcd2e'::uuid),
('6cdecee5-fe55-4359-9fd3-38f93dc08894'::uuid, 'OBAT VITAMIN & SUPLEMEN', 'e5383dde-9d62-448f-8441-0cfa742bcd2e'::uuid),
('a402568b-932d-4a3f-aaa2-c525fe3028eb'::uuid, 'PENGHARUM PASIR & PEMBERSIH — OBAT', 'e5383dde-9d62-448f-8441-0cfa742bcd2e'::uuid),
('40ea898c-6eb8-48c2-b5d1-783136b55e28'::uuid, 'TABLET', 'e5383dde-9d62-448f-8441-0cfa742bcd2e'::uuid),
('9bdfed79-cd43-4903-96d5-bb96c6d8bd88'::uuid, 'TERAPI FIP/FIV', 'e5383dde-9d62-448f-8441-0cfa742bcd2e'::uuid),
('856cb25f-01fb-4cef-90d5-565ea15e946a'::uuid, 'VAKSIN PROMO — OBAT', 'e5383dde-9d62-448f-8441-0cfa742bcd2e'::uuid);
select set_config('request.jwt.claim.sub', (select id::text from public.profiles where role='OWNER' order by id limit 1), true);
do $$
declare
  r record;
  before_items text;
  before_stock text;
  before_other_categories text;
begin
  perform 1 from public.item_categories c join repair_categories t using(id) order by c.id for update of c;
  if (select count(*) from public.item_categories c join repair_categories t on c.id=t.id and c.name=t.name and c.parent_id is not distinct from t.parent_id) <> 15 then
    raise exception 'Expected OBAT hierarchy changed; re-inspect before repairing';
  end if;
  if not exists(select 1 from public.item_categories where id='30e437c9-f9a6-476e-a28a-f7d40f6131c7' and name='OBAT & VITAMIN' and parent_id is null) then
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
select 15 as obsolete_categories_removed,
 (select count(*) from public.items i join public.item_categories c on c.id=i.category_id where c.id='30e437c9-f9a6-476e-a28a-f7d40f6131c7' or c.parent_id='30e437c9-f9a6-476e-a28a-f7d40f6131c7') as replacement_products,
 true as items_stock_and_other_categories_unchanged;
commit;
