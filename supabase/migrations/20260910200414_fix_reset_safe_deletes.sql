-- The database safety guard rejects unfiltered DELETE statements, including
-- inside this owner-only reset. `ctid is not null` is an explicit filter that
-- still covers every physical row in each target table.
create or replace function public.reset_simulasi_barang_dan_stok(
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_item_count integer := 0;
  v_stock_row_count integer := 0;
  v_transaction_count integer := 0;
begin
  if v_actor_id is null or not exists (
    select 1 from public.profiles p
    where p.id = v_actor_id and p.role = 'OWNER'
  ) then
    raise exception 'Hanya OWNER yang boleh mereset simulasi' using errcode = '42501';
  end if;

  if btrim(coalesce(p_confirmation, '')) <> 'RESET SIMULASI TOTAL' then
    raise exception 'Frasa konfirmasi reset tidak cocok' using errcode = '22023';
  end if;

  select count(*) into v_item_count from public.items;
  select count(*) into v_stock_row_count from public.stock;
  select (
    (select count(*) from public.sales)
    + (select count(*) from public.purchase_orders)
    + (select count(*) from public.stock_transfers)
    + (select count(*) from public.inventory_adjustments)
    + (select count(*) from public.opname_orders)
    + (select count(*) from public.production_orders)
  ) into v_transaction_count;

  delete from public.payment_order_items where ctid is not null;
  delete from public.payment_orders where ctid is not null;
  delete from public.sales_returns where ctid is not null;
  delete from public.sales_advances where ctid is not null;
  delete from public.sales_invoices where ctid is not null;
  delete from public.sales_deliveries where ctid is not null;
  delete from public.sales_orders where ctid is not null;
  delete from public.sales_quotations where ctid is not null;

  delete from public.point_ledger p
  using public.sales s
  where p.ref = s.no_struk;
  delete from public.sales where ctid is not null;

  delete from public.purchase_returns where ctid is not null;
  delete from public.purchase_advances where ctid is not null;
  delete from public.purchase_invoices where ctid is not null;
  delete from public.goods_receipts where ctid is not null;
  delete from public.purchase_orders where ctid is not null;
  delete from public.stock_receipts where ctid is not null;
  delete from public.stock_requests where ctid is not null;
  delete from public.stock_transfers where ctid is not null;
  delete from public.inventory_adjustments where ctid is not null;
  delete from public.opname_results where ctid is not null;
  delete from public.opname_orders where ctid is not null;
  delete from public.production_orders where ctid is not null;
  delete from public.production_recipes where ctid is not null;
  delete from public.item_group_components where ctid is not null;

  delete from public.stock_moves where ctid is not null;
  delete from public.stock_layers where ctid is not null;
  delete from public.stock where ctid is not null;
  delete from public.import_runs where ctid is not null;
  delete from public.item_variant_families where ctid is not null;
  delete from public.items where ctid is not null;

  delete from public.journal_entries
  where source in (
    'sale', 'sale-hpp', 'sale-online', 'sale-online-hpp', 'sale-online-cair',
    'sales-delivery', 'sales-invoice', 'sales-receipt', 'sales-return', 'sales-return-hpp',
    'purchase', 'purchase-invoice', 'purchase-pay', 'purchase-return',
    'purchase-advance', 'purchase-advance-void', 'faktur-langsung',
    'transfer', 'opname', 'opname-selisih', 'penyesuaian', 'produksi'
  );

  -- Pelanggan sengaja tidak diubah. Reset ini hanya menyiapkan ulang
  -- barang, stok, dan transaksi simulasi; profil pelanggan tetap utuh.

  insert into public.simulation_reset_audits (
    actor_id, item_count, stock_row_count, transaction_count
  ) values (
    v_actor_id, v_item_count, v_stock_row_count, v_transaction_count
  );

  return jsonb_build_object(
    'items', v_item_count,
    'stock_rows', v_stock_row_count,
    'transactions', v_transaction_count
  );
end;
$$;

revoke all on function public.reset_simulasi_barang_dan_stok(text) from public;
grant execute on function public.reset_simulasi_barang_dan_stok(text) to authenticated;
