-- P1: atomic direct purchase invoice with stock and/or one fixed asset per asset line.

alter table public.purchase_invoice_items
  add column if not exists line_type varchar(16) not null default 'stock'
    check (line_type in ('stock', 'fixed_asset')),
  add column if not exists fixed_asset_id uuid references public.fixed_assets(id) on delete set null;
alter table public.fixed_assets add column if not exists location text;
alter table public.purchase_invoices drop constraint if exists purchase_invoices_asal_check;

create or replace function public.create_direct_purchase_invoice(
  p_no_faktur text,
  p_no_faktur_pemasok text,
  p_supplier_id uuid,
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_tanggal date,
  p_jatuh_tempo date,
  p_keterangan text,
  p_surat_jalan text,
  p_lines jsonb,
  p_ppn numeric,
  p_credit_code text,
  p_payment_method text
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_invoice_id uuid := gen_random_uuid();
  v_entry_id uuid := gen_random_uuid();
  v_line jsonb;
  v_line_id uuid;
  v_asset_id uuid;
  v_total numeric := 0;
  v_stock_gross numeric := 0;
  v_asset_gross numeric := 0;
  v_ratio numeric;
  v_gross numeric;
  v_qty numeric;
  v_factor numeric;
  v_old_qty numeric;
  v_layer_qty numeric;
  v_category_name text;
  v_account_id uuid;
  v_debit numeric;
begin
  if p_branch_id is null or not public.user_can_access_branch(p_branch_id) then raise exception 'Cabang tidak dapat diakses'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Faktur harus memiliki baris'; end if;
  if p_warehouse_id is not null and not exists (
    select 1 from public.warehouses where id = p_warehouse_id and branch_id = p_branch_id and is_active = true
  ) then raise exception 'Gudang tidak valid untuk cabang'; end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_gross := coalesce((v_line->>'price')::numeric, 0) * case when v_line->>'kind' = 'stock' then coalesce((v_line->>'qty')::numeric, 0) else 1 end;
    if v_gross <= 0 then raise exception 'Nilai baris harus lebih dari nol'; end if;
    if v_line->>'kind' = 'stock' then
      if p_warehouse_id is null then raise exception 'Gudang wajib untuk barang stok'; end if;
      v_stock_gross := v_stock_gross + v_gross;
    elsif v_line->>'kind' = 'fixed_asset' then
      v_asset_gross := v_asset_gross + v_gross;
    else raise exception 'Jenis baris tidak valid';
    end if;
  end loop;
  v_total := v_stock_gross + v_asset_gross;
  if p_ppn < 0 or p_ppn > v_total then raise exception 'PPN tidak valid'; end if;
  v_ratio := (v_total - p_ppn) / v_total;

  insert into public.purchase_invoices (
    id, no_faktur, no_faktur_pemasok, po_id, supplier_id, branch_id, warehouse_id,
    surat_jalan, tanggal, jatuh_tempo, total, keterangan, created_by
  ) values (
    v_invoice_id, p_no_faktur, nullif(p_no_faktur_pemasok, ''), null, p_supplier_id,
    p_branch_id, p_warehouse_id, nullif(p_surat_jalan, ''), p_tanggal, p_jatuh_tempo,
    v_total, nullif(p_keterangan, ''), (select auth.uid())
  );

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_line_id := gen_random_uuid();
    v_gross := (v_line->>'price')::numeric * case when v_line->>'kind' = 'stock' then (v_line->>'qty')::numeric else 1 end;
    if v_line->>'kind' = 'stock' then
      v_qty := (v_line->>'qty')::numeric;
      v_factor := greatest(coalesce((v_line->>'factor')::numeric, 1), 0.000001);
      if not exists (select 1 from public.items where id = (v_line->>'item_id')::uuid and item_type = 'Persediaan') then
        raise exception 'Barang stok tidak valid';
      end if;
      insert into public.purchase_invoice_items (
        id, invoice_id, item_id, nama, qty, harga, satuan, faktor, exp_date, line_type
      ) values (
        v_line_id, v_invoice_id, (v_line->>'item_id')::uuid, v_line->>'name', v_qty,
        (v_line->>'price')::numeric, v_line->>'unit', v_factor,
        nullif(v_line->>'expiry_date', '')::date, 'stock'
      );

      select qty into v_old_qty from public.stock
      where warehouse_id = p_warehouse_id and item_id = (v_line->>'item_id')::uuid for update;
      v_old_qty := coalesce(v_old_qty, 0);
      v_qty := v_qty * v_factor;
      v_layer_qty := greatest(0, v_qty - least(greatest(-v_old_qty, 0), v_qty));
      insert into public.stock (warehouse_id, item_id, qty)
      values (p_warehouse_id, (v_line->>'item_id')::uuid, v_qty)
      on conflict (warehouse_id, item_id) do update set qty = public.stock.qty + excluded.qty, updated_at = now();
      if v_layer_qty > 0 then
        insert into public.stock_layers (
          warehouse_id, item_id, tanggal, qty_in, qty_left, unit_cost, source, source_ref, exp_date
        ) values (
          p_warehouse_id, (v_line->>'item_id')::uuid, p_tanggal, v_layer_qty, v_layer_qty,
          ((v_line->>'price')::numeric * v_ratio) / v_factor, 'faktur-langsung', p_no_faktur,
          nullif(v_line->>'expiry_date', '')::date
        );
      end if;
      insert into public.stock_moves (tanggal, warehouse_id, item_id, qty, unit_cost, source, source_ref)
      values (p_tanggal, p_warehouse_id, (v_line->>'item_id')::uuid, v_qty,
        ((v_line->>'price')::numeric * v_ratio) / v_factor, 'faktur-langsung', p_no_faktur);
    else
      select nama into v_category_name from public.asset_categories
      where id = (v_line->>'category_id')::uuid and is_active = true;
      if v_category_name is null or (v_line->>'useful_life_months')::integer <= 0 then raise exception 'Data aset tidak valid'; end if;
      v_asset_id := gen_random_uuid();
      if coalesce((v_line->>'residual_value')::numeric, 0) >= v_gross * v_ratio then raise exception 'Nilai sisa aset tidak valid'; end if;
      insert into public.fixed_assets (
        id, nama, kategori, category_id, tanggal_perolehan, harga_perolehan, nilai_sisa,
        umur_bulan, branch_id, acquisition_kind, acquisition_source_code, purchase_invoice_id, location
      ) values (
        v_asset_id, v_line->>'name', v_category_name, (v_line->>'category_id')::uuid,
        p_tanggal, v_gross * v_ratio, coalesce((v_line->>'residual_value')::numeric, 0),
        (v_line->>'useful_life_months')::integer, p_branch_id, 'purchase_invoice', p_credit_code,
        v_invoice_id, nullif(v_line->>'location', '')
      );
      insert into public.purchase_invoice_items (
        id, invoice_id, item_id, nama, qty, harga, satuan, faktor, line_type, fixed_asset_id
      ) values (v_line_id, v_invoice_id, null, v_line->>'name', 1, v_gross, 'unit', 1, 'fixed_asset', v_asset_id);
    end if;
  end loop;

  insert into public.journal_entries (id, no_jurnal, tanggal, deskripsi, source, source_ref, branch_id)
  values (v_entry_id, 'JRN-' || to_char(p_tanggal, 'YYYYMM') || '-' || upper(substr(replace(v_entry_id::text, '-', ''), 1, 8)),
    p_tanggal, 'Faktur pembelian langsung ' || p_no_faktur, 'purchase-invoice', p_no_faktur, p_branch_id);

  for v_account_id, v_debit in
    select ca.id, amount from (
      values ('1301'::text, v_stock_gross * v_ratio), ('1501', v_asset_gross * v_ratio), ('1105', p_ppn)
    ) x(code, amount) join public.coa_accounts ca on ca.code = x.code where amount > 0
  loop
    insert into public.journal_lines (entry_id, account_id, debit, credit) values (v_entry_id, v_account_id, v_debit, 0);
  end loop;
  select id into v_account_id from public.coa_accounts where code = p_credit_code and is_header is not true;
  if v_account_id is null then raise exception 'Akun sumber tidak valid'; end if;
  if p_credit_code <> '2101' and not exists (select 1 from public.cash_accounts where coa_code = p_credit_code and is_active = true) then
    raise exception 'Sumber harus Hutang Usaha atau rekening Kas/Bank aktif';
  end if;
  insert into public.journal_lines (entry_id, account_id, debit, credit) values (v_entry_id, v_account_id, 0, v_total);
  if p_credit_code <> '2101' then
    insert into public.purchase_invoice_payments (invoice_id, tanggal, amount, metode, catatan, created_by)
    values (v_invoice_id, p_tanggal, v_total, p_payment_method, 'Lunas saat pembelian langsung', (select auth.uid()));
  end if;
  return v_invoice_id;
end;
$$;

revoke all on function public.create_direct_purchase_invoice(text, text, uuid, uuid, uuid, date, date, text, text, jsonb, numeric, text, text) from public;
grant execute on function public.create_direct_purchase_invoice(text, text, uuid, uuid, uuid, date, date, text, text, jsonb, numeric, text, text) to authenticated;
