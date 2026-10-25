-- Cashier stock issues and the actual FIFO price floor share one transaction.
-- All component snapshots must already be staged on the pending sale.
create function public.cashier_post_stock_atomic(p_sale_id uuid, p_warehouse_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 s public.sales%rowtype;
 line record;
 event record;
 cost numeric;
 gross numeric;
 manual numeric;
 item_discount numeric;
 after_items numeric := 0;
 net_total numeric;
 dated date := (now() at time zone 'Asia/Jakarta')::date;
 issued integer := 0;
 finalized jsonb;
begin
 select * into s from public.sales where id = p_sale_id for update;
 if not found or s.channel is not null or s.shift_id is null or s.payment_plan is null
  or s.payments_finalized_at is not null or s.voided_at is not null or s.no_struk is null then
  raise exception 'Transaksi kasir belum siap untuk stok atomik' using errcode = '55000';
 end if;
 perform public.pos_sale_assert_actor(s);
 if not exists(select 1 from public.warehouses where id = p_warehouse_id and branch_id = s.branch_id and is_active) then
  raise exception 'Gudang kasir tidak sesuai cabang aktif' using errcode = '42501';
 end if;
 if exists(select 1 from public.stock_moves where source_ref = s.no_struk and source in('sale','sale-group')) then
  raise exception 'Stok transaksi sudah pernah diproses; periksa hasil sebelum mengulang' using errcode = '55000';
 end if;
 perform 1 from public.sale_items where sale_id = s.id order by id for update;
 if not found then raise exception 'Rincian kasir kosong' using errcode = '22023'; end if;
 perform 1 from public.sale_item_group_components c join public.sale_items i on i.id = c.sale_item_id
  where i.sale_id = s.id order by c.id for update of c;

 -- Compute the same item-discount precedence as lib/pos-calc before issuing
 -- any stock. Services remain eligible for a zero net price.
 for line in select i.*, m.item_type from public.sale_items i
  left join public.items m on m.id = i.item_id where i.sale_id = s.id order by i.id loop
  if line.qty is null or line.qty <= 0 or line.qty::text in('NaN','Infinity','-Infinity')
   or line.faktor is null or line.faktor <= 0 or line.faktor::text in('NaN','Infinity','-Infinity')
   or line.harga is null or line.harga < 0 or line.harga::text in('NaN','Infinity','-Infinity')
   or (line.item_id is not null and line.item_type is null) then
   raise exception 'Rincian kasir tidak valid' using errcode = '22023';
  end if;
  if line.item_type = 'Grup' and not exists(select 1 from public.sale_item_group_components where sale_item_id = line.id) then
   raise exception 'Snapshot komponen Grup belum lengkap' using errcode = '22023';
  end if;
  gross := line.qty * line.harga;
  manual := case when line.item_discount_type = 'percent' then round(gross * coalesce(line.item_discount_value,0) / 100,0)
   else coalesce(line.item_discount_value,0) end;
  item_discount := least(greatest(case when manual > 0 then manual else coalesce(line.promo_discount,0) end,0),gross);
  after_items := after_items + gross - item_discount;
 end loop;
 net_total := s.total - coalesce(s.merchant_fee_total,0);
 if net_total is null or net_total::text in('NaN','Infinity','-Infinity') or net_total < 0
  or net_total > after_items or round((select sum(qty*harga) from public.sale_items where sale_id=s.id),2) is distinct from round(s.subtotal,2) then
  raise exception 'Harga neto kasir tidak konsisten dengan rincian' using errcode = '22023';
 end if;

 -- Canonical item order prevents cross-sale stock lock inversion; within one
 -- SKU, staged line creation order matches the cashier's cart cost quote.
 -- A failed later line rolls back all earlier FIFO issues and snapshots.
 for event in
  select i.id as sale_line_id, i.item_id, i.qty*i.faktor as qty_base,
   'sale'::text as source, null::uuid as component_id, i.created_at as line_created_at
  from public.sale_items i join public.items m on m.id=i.item_id
  where i.sale_id=s.id and m.item_type='Persediaan'
  union all
  select c.sale_item_id, c.component_item_id, c.total_base_qty,
   'sale-group'::text, c.id, i.created_at
  from public.sale_item_group_components c join public.sale_items i on i.id=c.sale_item_id
  join public.items m on m.id=i.item_id
  where i.sale_id=s.id and m.item_type='Grup' and c.item_type='Persediaan'
  order by item_id, line_created_at, sale_line_id, component_id nulls first
 loop
  if event.item_id is null or event.qty_base is null or event.qty_base <= 0 then
   raise exception 'Komponen stok kasir tidak valid' using errcode = '22023';
  end if;
  select x.cost into strict cost from public.sale_stock_out_fifo(
   p_warehouse_id,event.item_id,event.qty_base,event.source,s.no_struk,dated,event.sale_line_id) x;
  if cost is null or cost < 0 then raise exception 'HPP kasir tidak tersedia' using errcode='55000'; end if;
  if event.component_id is not null then
   update public.sale_item_group_components set hpp=cost where id=event.component_id;
  end if;
  update public.sale_items set hpp=coalesce(hpp,0)+cost where id=event.sale_line_id;
  issued := issued + 1;
 end loop;

 for line in select i.*, m.item_type from public.sale_items i
  left join public.items m on m.id=i.item_id where i.sale_id=s.id and m.item_type='Persediaan' order by i.id loop
  gross := line.qty * line.harga;
  manual := case when line.item_discount_type = 'percent' then round(gross * coalesce(line.item_discount_value,0) / 100,0)
   else coalesce(line.item_discount_value,0) end;
  item_discount := least(greatest(case when manual > 0 then manual else coalesce(line.promo_discount,0) end,0),gross);
  if after_items <= 0 or (gross-item_discount)*net_total/after_items <= 0 then
   raise exception 'Harga neto Persediaan nol; penjualan ditolak' using errcode='55000';
  end if;
  if line.hpp is null or (gross-item_discount)*net_total/after_items < line.hpp then
   raise exception 'Harga neto Persediaan di bawah HPP FIFO; penjualan ditolak' using errcode='55000';
  end if;
 end loop;
 if issued = 0 then raise exception 'Tidak ada pergerakan stok kasir untuk difinalkan' using errcode='22023'; end if;
 -- The stock issue, actual FIFO guard, payment, points and HPP journal must
 -- commit together. A failed finalizer rolls back every earlier stock event.
 finalized := public.finalize_pos_sale(s.id);
 if finalized->>'finalized' is distinct from 'true' then
  raise exception 'Finalisasi kasir gagal' using errcode='55000';
 end if;
 return finalized || jsonb_build_object('stock_events',issued,'checked',true);
end $$;
revoke all on function public.cashier_post_stock_atomic(uuid,uuid) from public,anon,service_role;
grant execute on function public.cashier_post_stock_atomic(uuid,uuid) to authenticated;
