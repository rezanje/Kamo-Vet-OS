-- Apply all cost-layer changes for one PO invoice in one database transaction.
-- Partial-layer splits must not reduce existing stock unless the matching
-- higher-cost layer is inserted in the same transaction.
create or replace function public.reprice_purchase_invoice_layers(
  p_updates jsonb,
  p_inserts jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_update record;
begin
  if jsonb_typeof(coalesce(p_updates, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_inserts, '[]'::jsonb)) <> 'array' then
    raise exception 'Rencana penyesuaian lapisan stok tidak valid';
  end if;

  for v_update in
    select *
    from jsonb_to_recordset(coalesce(p_updates, '[]'::jsonb)) as u(
      id uuid,
      expected_qty_in numeric,
      expected_qty_left numeric,
      expected_unit_cost numeric,
      qty_in numeric,
      qty_left numeric,
      unit_cost numeric
    )
  loop
    update public.stock_layers as layer
    set qty_in = coalesce(v_update.qty_in, layer.qty_in),
        qty_left = coalesce(v_update.qty_left, layer.qty_left),
        unit_cost = coalesce(v_update.unit_cost, layer.unit_cost)
    where layer.id = v_update.id
      and layer.qty_in = v_update.expected_qty_in
      and layer.qty_left = v_update.expected_qty_left
      and layer.unit_cost = v_update.expected_unit_cost;

    if not found then
      raise exception 'Lapisan stok berubah saat penyesuaian faktur; coba ulangi' using errcode = '40001';
    end if;
  end loop;

  insert into public.stock_layers (
    warehouse_id, item_id, tanggal, qty_in, qty_left, unit_cost,
    source, source_ref, exp_date, batch_no
  )
  select i.warehouse_id, i.item_id, i.tanggal, i.qty_in, i.qty_left,
         i.unit_cost, i.source, i.source_ref, i.exp_date, i.batch_no
  from jsonb_to_recordset(coalesce(p_inserts, '[]'::jsonb)) as i(
    warehouse_id uuid,
    item_id uuid,
    tanggal date,
    qty_in numeric,
    qty_left numeric,
    unit_cost numeric,
    source varchar(24),
    source_ref varchar(40),
    exp_date date,
    batch_no varchar(80)
  );
end;
$$;

revoke all on function public.reprice_purchase_invoice_layers(jsonb, jsonb) from public, anon;
grant execute on function public.reprice_purchase_invoice_layers(jsonb, jsonb) to authenticated;

comment on function public.reprice_purchase_invoice_layers(jsonb, jsonb) is
  'Applies expected-state checked FIFO layer cost updates and partial splits atomically for purchase invoicing.';
