-- Reviewed recipe only; target execution needs parent release approval.
-- Pause master unit edits/imports and roll back app with this migration as one release.
-- Removes protection; never use merely to force an otherwise rejected24-to28 edit.
begin;
drop trigger guard_pos_finalization_units on public.sales;
drop trigger guard_sold_item_base_unit on public.items;
drop trigger guard_sold_item_units on public.item_units;
drop function public.guard_pos_finalization_units();
drop function public.guard_sold_item_base_unit();
drop function public.guard_sold_item_units();
drop function public.replace_item_unit_configuration(uuid,text,jsonb);
drop function public.item_has_sale_history(uuid);
commit;
