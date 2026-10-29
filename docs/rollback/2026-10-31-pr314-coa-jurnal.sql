-- Rollback PR #314 (I02/J02/P02). Release rollback only — each block is independent;
-- run only the block for the migration that must be undone, in one transaction.
-- No block deletes posted documents, stock, journals or receipts.
--
-- Compatibility with the OLD app version (before PR #314):
--   * 20261031113000 (I02) is the only migration the old app cannot live with:
--     it revokes direct writes on inventory_adjustments(_items), which the old
--     "Simpan Penyesuaian" path performs. Block A restores exactly those writes.
--     The new RPC, request table and journal guards are additive and stay.
--   * 20261031114000 (J02) and 20261031115000 (P02) do not affect the old app.

-- A. Undo the I02 write lock (old app can save adjustments again).
begin;
do $$ begin
 if to_regclass('public.inventory_adjustment_requests') is null then
  raise exception 'I02 migration not installed; nothing to roll back';end if;
end $$;
drop policy if exists invadj_read on public.inventory_adjustments;
drop policy if exists invadji_read on public.inventory_adjustment_items;
drop policy if exists invadj_all on public.inventory_adjustments;
drop policy if exists invadji_all on public.inventory_adjustment_items;
create policy invadj_all on public.inventory_adjustments for all to authenticated using (true) with check (true);
create policy invadji_all on public.inventory_adjustment_items for all to authenticated using (true) with check (true);
grant insert,update,delete on public.inventory_adjustments,public.inventory_adjustment_items to authenticated;
-- The old app writes its own 'penyesuaian' journals; the new guards only
-- protect journals created by the new RPC/opname receipts, so they can stay.
commit;

-- B. Undo the J02 journal guard extension (restore the previous definition).
begin;
create or replace function public.pos_sale_journal_protected(p_entry uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.pos_sale_postings where revenue_journal_id=p_entry or hpp_journal_id=p_entry)
 or exists(select 1 from public.journal_entries e where e.id=p_entry and e.source in('sale','sale-hpp','sale-online','sale-online-hpp','sale-void','sale-void-hpp'))
$$;
commit;

-- C. Undo the P02 goods receipt write lock (restore the original API grants).
begin;
grant insert,update,delete on public.goods_receipts,public.goods_receipt_items to authenticated,service_role;
commit;
