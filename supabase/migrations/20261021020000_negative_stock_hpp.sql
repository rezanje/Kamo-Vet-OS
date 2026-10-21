-- A stock shortage still has a cost. Do not dilute an issue's unit cost by
-- valuing only its physical FIFO units when the item's master price is zero.
-- The proof table is private. Expose only this predicate, not its contents, so
-- the SECURITY INVOKER FIFO primitive also works for ordinary inventory callers.
create function public.stock_layer_cost_was_reversed(p_layer_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.purchase_invoice_layer_proofs proof
    join public.purchase_invoices invoice on invoice.id = proof.invoice_id
    where proof.layer_id = p_layer_id and proof.before_state is null
      and invoice.voided_at is not null
  );
$$;
revoke all on function public.stock_layer_cost_was_reversed(uuid) from public, anon;
grant execute on function public.stock_layer_cost_was_reversed(uuid) to authenticated;

create or replace function public.stock_out_fifo(
  p_warehouse_id uuid,
  p_item_id uuid,
  p_qty numeric,
  p_source text,
  p_source_ref text,
  p_tanggal date default current_date
)
returns table(cost numeric, takes jsonb, shortfall numeric, harga_beli numeric)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item record;
  v_layer record;
  v_left numeric;
  v_take numeric;
  v_cost numeric := 0;
  v_shortfall numeric := 0;
  v_takes jsonb := '[]'::jsonb;
  v_stock_id uuid;
  v_fallback_cost numeric;
  v_unpriced_qty numeric := 0;
begin
  -- Retain the atomic transfer boundary introduced before the sale snapshot RPC.
  if current_user = 'authenticated' and p_source in ('terima-permintaan', 'transfer') then
    raise exception 'Pemindahan/penerimaan harus diproses lewat transaksi atomik. Muat ulang halaman lalu coba lagi.' using errcode = '55000';
  end if;
  if p_qty is null or p_qty <= 0 or p_qty > 1000000000000000000
     or p_source is null or length(p_source) = 0 or length(p_source) > 24
     or length(coalesce(p_source_ref, '')) > 40 then
    raise exception 'Data stok keluar tidak valid.';
  end if;

  select item_type, name, coalesce(buy_price, 0) as buy_price into v_item
  from public.items where id = p_item_id;
  if not found then raise exception 'Barang tidak ditemukan.'; end if;
  if v_item.item_type is not null and v_item.item_type <> 'Persediaan' then
    return query select 0::numeric, '[]'::jsonb, 0::numeric, 0::numeric;
    return;
  end if;

  -- Keep the aggregate-before-layer lock order used by receipts and repricing.
  insert into public.stock(warehouse_id, item_id, qty)
  values (p_warehouse_id, p_item_id, 0)
  on conflict (warehouse_id, item_id) do nothing;
  select id into v_stock_id from public.stock
  where warehouse_id = p_warehouse_id and item_id = p_item_id
  for update;
  if not found then raise exception 'Saldo stok tidak dapat dikunci.'; end if;

  v_left := p_qty;
  for v_layer in
    select id, qty_left, unit_cost, exp_date
    from public.stock_layers
    where warehouse_id = p_warehouse_id and item_id = p_item_id and qty_left > 0
    order by exp_date nulls last, tanggal, created_at, id
    for update
  loop
    exit when v_left <= 0;
    v_take := least(v_layer.qty_left, v_left);
    if v_take <= 0 then continue; end if;
    update public.stock_layers set qty_left = qty_left - v_take where id = v_layer.id;
    v_takes := v_takes || jsonb_build_array(jsonb_build_object(
      'id', v_layer.id, 'qty', v_take, 'unit_cost', v_layer.unit_cost, 'exp_date', v_layer.exp_date
    ));
    v_cost := v_cost + v_take * v_layer.unit_cost;
    -- Extend the last known consumed unit cost to the missing units, rather
    -- than averaging a partial FIFO cost over the full requested quantity.
    if v_layer.unit_cost > 0 then v_fallback_cost := v_layer.unit_cost; end if;
    if v_layer.unit_cost = 0 and p_source in ('sale', 'sale-group', 'sale-online') then
      v_unpriced_qty := v_unpriced_qty + v_take;
    end if;
    v_left := v_left - v_take;
  end loop;

  v_shortfall := greatest(v_left, 0);
  if v_shortfall > 0 or v_unpriced_qty > 0 then
    if v_fallback_cost is null then
      -- Exhausted layers retain their cost. Incoming moves also retain a cost
      -- when a receipt only closes negative stock and creates no usable layer.
      -- Never reuse outgoing moves: older diluted costs are not price evidence.
      select known.unit_cost into v_fallback_cost
      from (
        select unit_cost, tanggal, created_at, 0 as priority, id, source, source_ref
        from public.stock_layers
        where warehouse_id = p_warehouse_id and item_id = p_item_id
          and unit_cost > 0 and tanggal <= coalesce(p_tanggal, current_date)
          and not public.stock_layer_cost_was_reversed(id)
        union all
        select unit_cost, tanggal, created_at, 1 as priority, id, source, source_ref
        from public.stock_moves
        where warehouse_id = p_warehouse_id and item_id = p_item_id
          and qty > 0 and unit_cost > 0 and tanggal <= coalesce(p_tanggal, current_date)
          and source not in ('sale-void', 'purchase-invoice-void')
      ) known
      where not exists (
        select 1 from public.purchase_invoices invoice
        where known.source = 'faktur-langsung' and invoice.no_faktur = known.source_ref
          and invoice.voided_at is not null
      )
      order by known.tanggal desc, known.created_at desc, known.priority, known.id desc
      limit 1;
    end if;
    v_fallback_cost := coalesce(v_fallback_cost, nullif(greatest(v_item.buy_price, 0), 0));
    if v_fallback_cost is null and p_source in ('sale', 'sale-group', 'sale-online') then
      -- Raising rolls back consumed layers and the newly inserted aggregate
      -- row, as well as the sale RPC's work. Never post a zero-cost shortage.
      raise exception 'Harga pokok barang % belum tersedia. Isi harga beli barang sebelum penjualan.', v_item.name;
    end if;
    -- Keep original physical takes, including their zero price, for audit.
    -- Their estimated value is carried by the movement and sale HPP. Existing
    -- cancellation checks require reconciliation before reversing such estimates.
    v_cost := v_cost + (v_shortfall + v_unpriced_qty) * coalesce(v_fallback_cost, 0);
  end if;

  update public.stock
  set qty = qty - p_qty, updated_at = now()
  where id = v_stock_id;

  insert into public.stock_moves(
    tanggal, warehouse_id, item_id, qty, unit_cost, source, source_ref, fifo_takes, fifo_shortfall
  ) values (
    coalesce(p_tanggal, current_date), p_warehouse_id, p_item_id, -p_qty,
    v_cost / p_qty, p_source, p_source_ref,
    case when p_source in ('sale', 'sale-group', 'sale-online') then v_takes end,
    case when p_source in ('sale', 'sale-group', 'sale-online') then v_shortfall end
  );

  -- Transfer callers use this field to value units without a physical layer.
  return query select v_cost, v_takes, v_shortfall, coalesce(v_fallback_cost, v_item.buy_price);
end;
$$;

revoke all on function public.stock_out_fifo(uuid, uuid, numeric, text, text, date) from public, anon;
grant execute on function public.stock_out_fifo(uuid, uuid, numeric, text, text, date) to authenticated;

comment on function public.stock_out_fifo(uuid, uuid, numeric, text, text, date) is
  'Atomic FIFO/FEFO issue: unpriced sales units and shortages use last consumed/valid known warehouse cost, then master buy price; sales without a known cost are rejected.';
