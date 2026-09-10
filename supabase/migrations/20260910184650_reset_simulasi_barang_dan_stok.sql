-- Reset simulasi total, khusus OWNER.
-- Sengaja TIDAK menyentuh akun, cabang, gudang, user, pelanggan, hewan,
-- rekam medis, pengaturan, kategori, satuan, merek, atau pemasok.

create table if not exists public.simulation_reset_audits (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id) on delete restrict,
  item_count integer not null default 0,
  stock_row_count integer not null default 0,
  transaction_count integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.simulation_reset_audits enable row level security;
revoke all on table public.simulation_reset_audits from anon, authenticated;
grant select on table public.simulation_reset_audits to authenticated;

drop policy if exists simulation_reset_audits_owner_read on public.simulation_reset_audits;
create policy simulation_reset_audits_owner_read
  on public.simulation_reset_audits for select to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'OWNER'
  ));

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

  -- Hitung dampak sebelum menghapus, lalu simpan jejak yang tetap ada setelah reset.
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

  -- Jalur pembayaran dan penjualan: hapus dokumen turunan dulu agar dokumen
  -- induk dapat dibersihkan tanpa memutus akun, pelanggan, atau rekam medis.
  delete from public.payment_order_items;
  delete from public.payment_orders;
  delete from public.sales_returns;
  delete from public.sales_advances;
  delete from public.sales_invoices;
  delete from public.sales_deliveries;
  delete from public.sales_orders;
  delete from public.sales_quotations;

  -- Poin yang memang lahir dari struk POS ikut dibersihkan; poin dari klinik
  -- atau pengaturan lain tetap dipertahankan.
  delete from public.point_ledger p
  using public.sales s
  where p.ref = s.no_struk;
  delete from public.sales;

  -- Jalur pembelian dan stok.
  delete from public.purchase_returns;
  delete from public.purchase_advances;
  delete from public.purchase_invoices;
  delete from public.goods_receipts;
  delete from public.purchase_orders;
  delete from public.stock_receipts;
  delete from public.stock_requests;
  delete from public.stock_transfers;
  delete from public.inventory_adjustments;
  delete from public.opname_results;
  delete from public.opname_orders;
  delete from public.production_orders;
  delete from public.production_recipes;
  delete from public.item_group_components;

  -- Semua jejak stok dan batch impor dimulai dari nol. Keputusan pencocokan
  -- cabang/gudang sengaja tidak dihapus agar upload berikutnya tidak perlu diatur ulang.
  delete from public.stock_moves;
  delete from public.stock_layers;
  delete from public.stock;
  delete from public.import_runs;
  delete from public.item_variant_families;
  delete from public.items;

  -- Hilangkan jurnal yang sumbernya murni dari transaksi yang baru direset.
  -- Jurnal manual, kas/bank, payroll, pajak, aset, dan saldo awal keuangan tidak disentuh.
  delete from public.journal_entries
  where source in (
    'sale', 'sale-hpp', 'sale-online', 'sale-online-hpp', 'sale-online-cair',
    'sales-delivery', 'sales-invoice', 'sales-receipt', 'sales-return', 'sales-return-hpp',
    'purchase', 'purchase-invoice', 'purchase-pay', 'purchase-return',
    'purchase-advance', 'purchase-advance-void', 'faktur-langsung',
    'transfer', 'opname', 'opname-selisih', 'penyesuaian', 'produksi'
  );

  -- Nilai pelanggan diselaraskan kembali dari riwayat yang masih dipertahankan.
  update public.customers c
  set points = coalesce((
    select sum(p.delta) from public.point_ledger p where p.customer_id = c.id
  ), 0);

  update public.customers c
  set total_spending = coalesce((
    select sum(i.total)
    from public.invoices i
    join public.visits v on v.id = i.visit_id
    where v.customer_id = c.id
      and i.paid_status = 'Lunas'
      and i.voided_at is null
  ), 0);

  update public.customers c
  set tier = case
    when c.total_spending >= s.platinum_min then 'Platinum'
    when c.total_spending >= s.gold_min then 'Gold'
    when c.total_spending >= s.silver_min then 'Silver'
    when c.total_spending >= s.bronze_min then 'Bronze'
    else 'New'
  end
  from public.tier_settings s
  where s.id = 1;

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
