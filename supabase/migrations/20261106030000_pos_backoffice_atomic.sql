-- Backoffice /pos/transaksi (non quantity-pool receipts): FIFO stock issue, per-line
-- HPP and payment/HPP finalization in ONE transaction.
--
-- Before: the server action called sale_stock_out_fifo once per line (each its own
-- committed HTTP request) and only then finalize_pos_sale. A request that died in
-- between left a pending sale with real stock_moves, consumed FIFO layers and a
-- reduced stock.qty, but no HPP journal; the explicit failure path deleted the header
-- after stock had already gone out, and nothing reversed those moves
-- (docs/2026-11-01-insiden-tutup-shift-tertahan.md, PR #397).
--
-- This composes the SAME original writers in one transaction, like the kasir path's
-- cashier_post_stock_atomic and quantity_pool_post_backoffice_atomic. Any failure,
-- including a finalizer rejection, rolls back every earlier stock issue and HPP.
--
-- Behaviour intentionally identical to the old per-line backoffice path:
--  * only lines whose master item is 'Persediaan' issue stock. Jasa, Non-Persediaan
--    and Grup lines never did (stockOut skipped non-stock items, and backoffice does
--    not stage Grup component snapshots), so their staged HPP stays as inserted;
--  * each stock line's HPP = its own actual FIFO cost (replacing the staged 0);
--  * no price-floor rejection: backoffice keeps its warning-only HPP policy (P03);
--  * promo, service-performer and pricing columns are not touched here;
--  * a cart without stock lines (services only) still finalizes.
-- Differences: issues run in canonical item order (cart order within one SKU, so
-- per-line FIFO cost is unchanged) and each move records its source line identity.
--
-- SECURITY INVOKER adds no data privilege: stock issue and finalization call the
-- original SECURITY DEFINER RPCs (each asserts the actor, branch, shift and period
-- itself), and the HPP update stays subject to the caller's original grants/RLS.
-- No original function, policy or grant is replaced.

create function public.pos_backoffice_post_atomic(p_sale_id uuid, p_warehouse_id uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
 s public.sales%rowtype;
 l record;
 cost numeric;
 issued integer := 0;
 result jsonb;
 dated date := (now() at time zone 'Asia/Jakarta')::date;
begin
 select * into s from public.sales where id = p_sale_id for update;
 if not found or s.channel is not null or s.payment_plan is null or s.payments_finalized_at is not null
  or s.voided_at is not null or nullif(btrim(s.no_struk), '') is null then
  raise exception 'Transaksi back office belum siap difinalkan' using errcode = '55000';
 end if;
 if not exists(select 1 from public.warehouses where id = p_warehouse_id and branch_id = s.branch_id and is_active) then
  raise exception 'Gudang tidak sesuai cabang transaksi' using errcode = '42501';
 end if;
 -- A receipt already touched by the old per-line writer, or by an earlier committed
 -- call, is never issued a second time; it needs reconciliation, not another FIFO issue.
 if exists(select 1 from public.stock_moves where source_ref = s.no_struk and source in('sale','sale-group')) then
  raise exception 'Stok transaksi sudah pernah diproses; periksa hasil sebelum mengulang' using errcode = '55000';
 end if;
 perform 1 from public.sale_items where sale_id = s.id order by id for update;
 if not found then raise exception 'Rincian transaksi kosong' using errcode = '22023'; end if;

 -- Canonical item order prevents cross-sale stock lock inversion. Within one SKU
 -- the cart (source_position) order is kept, so FIFO layers are consumed by the same
 -- lines as the old sequential path. A failure on any line rolls back them all.
 for l in
  select i.id, i.item_id, i.qty, i.faktor from public.sale_items i
  join public.items m on m.id = i.item_id
  where i.sale_id = s.id and m.item_type = 'Persediaan'
  order by i.item_id, i.source_position nulls last, i.created_at, i.id
 loop
  if l.qty is null or l.qty <= 0 or l.qty::text in('NaN','Infinity','-Infinity')
   or l.faktor is null or l.faktor <= 0 or l.faktor::text in('NaN','Infinity','-Infinity') then
   raise exception 'Rincian stok transaksi tidak valid' using errcode = '22023';
  end if;
  select x.cost into strict cost from public.sale_stock_out_fifo(
   p_warehouse_id, l.item_id, l.qty * l.faktor, 'sale', s.no_struk, dated, l.id) x;
  if cost is null or cost < 0 then raise exception 'HPP transaksi tidak tersedia' using errcode = '55000'; end if;
  update public.sale_items set hpp = cost where id = l.id and sale_id = s.id;
  if not found then raise exception 'HPP baris transaksi tidak dapat disimpan' using errcode = '55000'; end if;
  issued := issued + 1;
 end loop;

 -- Payment allocation, points and both journals commit together with the stock.
 result := public.finalize_pos_sale(s.id);
 if result->>'finalized' is distinct from 'true' or result->>'sale_id' is distinct from s.id::text then
  raise exception 'Pembukuan transaksi belum selesai' using errcode = '55000';
 end if;
 return result || jsonb_build_object('checked', true, 'stock_events', issued);
end $$;
revoke all on function public.pos_backoffice_post_atomic(uuid, uuid) from public, anon, service_role;
grant execute on function public.pos_backoffice_post_atomic(uuid, uuid) to authenticated;
