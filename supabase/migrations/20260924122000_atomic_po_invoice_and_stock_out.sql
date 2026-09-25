-- Keep PO invoice quantity checks, invoice rows, purchase cost layers, and the
-- accounting entry in one transaction. The PO row is the serialization point
-- for concurrent invoices against the same receipt.
create or replace function public.create_purchase_invoice_from_po(
  p_po_id uuid,
  p_no_faktur_prefix text,
  p_no_faktur_digits integer,
  p_no_faktur_pemasok text,
  p_tanggal date,
  p_jatuh_tempo date,
  p_keterangan text,
  p_items jsonb,
  p_layer_updates jsonb,
  p_layer_inserts jsonb,
  p_ppn numeric
)
returns table(invoice_id uuid, no_faktur varchar(30), no_jurnal varchar(24), total numeric)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_po public.purchase_orders%rowtype;
  v_input record;
  v_po_item public.purchase_order_items%rowtype;
  v_layer_update record;
  v_layer_insert record;
  v_stock record;
  v_account record;
  v_line record;
  v_constraint text;
  v_item_unit text;
  v_no_faktur varchar(30);
  v_no_jurnal varchar(24);
  v_prefix_jurnal text;
  v_invoice_id uuid := gen_random_uuid();
  v_entry_id uuid := gen_random_uuid();
  v_qty_base numeric;
  v_billed_base numeric;
  v_legacy_base numeric;
  v_accepted_base numeric;
  v_sku_count integer;
  v_item_count integer;
  v_distinct_item_count integer;
  v_seq bigint;
  v_total numeric := 0;
  v_po_total numeric := 0;
  v_ppn numeric;
  v_selisih numeric;
  v_lines jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sesi login diperlukan untuk membuat faktur.' using errcode = '42501';
  end if;
  if p_no_faktur_prefix is null or length(p_no_faktur_prefix) = 0
     or p_no_faktur_digits < 1 or p_no_faktur_digits > 8
     or length(p_no_faktur_prefix) + p_no_faktur_digits > 30 then
    raise exception 'Format nomor faktur tidak valid.';
  end if;
  if p_tanggal is null or p_jatuh_tempo is null then
    raise exception 'Tanggal faktur dan jatuh tempo wajib diisi.';
  end if;
  if jsonb_typeof(coalesce(p_items, 'null'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_layer_updates, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_layer_inserts, '[]'::jsonb)) <> 'array' then
    raise exception 'Rincian faktur atau rencana layer tidak valid.';
  end if;

  select * into v_po
  from public.purchase_orders
  where id = p_po_id
  for update;
  if not found then raise exception 'PO tidak ditemukan atau tidak dapat diakses.'; end if;
  if v_po.status <> 'Diterima' then raise exception 'Hanya PO berstatus Diterima yang bisa difakturkan.'; end if;

  select count(*), count(distinct i.po_item_id)
    into v_item_count, v_distinct_item_count
  from jsonb_to_recordset(p_items) as i(
    po_item_id uuid, qty numeric, harga numeric,
    expected_harga_po numeric, expected_faktor numeric
  );
  if v_item_count = 0 or v_item_count <> v_distinct_item_count then
    raise exception 'Pilih minimal satu baris PO dan jangan gandakan baris yang sama.';
  end if;

  -- A legacy line without an item cannot be assigned safely. Linked lines from
  -- another PO or with a mismatched SKU/factor must also stop new billing.
  if exists (
    select 1
    from public.purchase_invoices inv
    join public.purchase_invoice_items ii on ii.invoice_id = inv.id
    left join public.purchase_order_items poi on poi.id = ii.po_item_id
    where inv.po_id = p_po_id
      and (
        (ii.po_item_id is null and ii.item_id is null)
        or (ii.po_item_id is not null and (poi.po_id is distinct from p_po_id
          or ii.item_id is distinct from poi.item_id
          or ii.qty <= 0 or ii.faktor <= 0))
      )
  ) then
    raise exception 'Ada rincian faktur lama yang tidak dapat dipetakan dengan aman. Minta keuangan meninjau PO ini.';
  end if;

  -- Serialize configured invoice numbering across this RPC. The app passes the
  -- prefix/digit setting; the actual next sequence is chosen under the lock.
  perform pg_advisory_xact_lock(hashtext('vetos:purchase-invoice:' || p_no_faktur_prefix)::bigint);
  select coalesce(max(substring(inv.no_faktur from length(p_no_faktur_prefix) + 1 for p_no_faktur_digits)::bigint), 0) + 1
    into v_seq
  from public.purchase_invoices inv
  where left(inv.no_faktur, length(p_no_faktur_prefix)) = p_no_faktur_prefix
    and substring(inv.no_faktur from length(p_no_faktur_prefix) + 1 for p_no_faktur_digits) ~ '^[0-9]+$';

  loop
    v_no_faktur := p_no_faktur_prefix || lpad(v_seq::text, p_no_faktur_digits, '0');
    begin
      insert into public.purchase_invoices (
        id, no_faktur, no_faktur_pemasok, po_id, supplier_id,
        tanggal, jatuh_tempo, total, keterangan, created_by
      ) values (
        v_invoice_id, v_no_faktur, p_no_faktur_pemasok, p_po_id, v_po.supplier_id,
        p_tanggal, p_jatuh_tempo, 0, p_keterangan, auth.uid()
      );
      exit;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint <> 'purchase_invoices_no_faktur_key' then raise; end if;
      v_seq := v_seq + 1;
    end;
  end loop;

  -- Lock each selected PO line and recompute already-billed base units while
  -- holding the PO lock. A concurrent request therefore sees the first invoice.
  for v_input in
    select * from jsonb_to_recordset(p_items) as i(
      po_item_id uuid, qty numeric, harga numeric,
      expected_harga_po numeric, expected_faktor numeric
    ) order by po_item_id
  loop
    if v_input.po_item_id is null or v_input.qty is null or v_input.qty <= 0
       or v_input.harga is null or v_input.harga < 0 then
      raise exception 'Qty dan harga faktur tidak valid.';
    end if;

    select * into v_po_item
    from public.purchase_order_items
    where id = v_input.po_item_id and po_id = p_po_id
    for update;
    if not found then raise exception 'Baris faktur bukan bagian dari PO ini.'; end if;
    if v_po_item.item_id is null then raise exception 'Baris PO tidak terhubung ke master barang.'; end if;
    if v_po_item.faktor is null or v_po_item.faktor <= 0
       or v_po_item.harga_beli is distinct from v_input.expected_harga_po
       or v_po_item.faktor is distinct from v_input.expected_faktor then
      raise exception 'Harga atau satuan PO berubah. Muat ulang faktur lalu coba lagi.' using errcode = '40001';
    end if;

    select count(*) into v_sku_count
    from public.purchase_order_items
    where po_id = p_po_id and item_id = v_po_item.item_id;

    if v_sku_count > 1 and exists (
      select 1 from public.purchase_invoices inv
      join public.purchase_invoice_items ii on ii.invoice_id = inv.id
      where inv.po_id = p_po_id and ii.po_item_id is null and ii.item_id = v_po_item.item_id
    ) then
      raise exception 'Ada faktur lama untuk SKU yang muncul beberapa kali di PO. Minta keuangan meninjau faktur lama.';
    end if;

    select coalesce(sum(ii.qty * ii.faktor), 0) into v_billed_base
    from public.purchase_invoices inv
    join public.purchase_invoice_items ii on ii.invoice_id = inv.id
    where inv.po_id = p_po_id and ii.po_item_id = v_po_item.id;

    v_legacy_base := 0;
    if v_sku_count = 1 then
      select coalesce(sum(ii.qty * v_po_item.faktor), 0) into v_legacy_base
      from public.purchase_invoices inv
      join public.purchase_invoice_items ii on ii.invoice_id = inv.id
      where inv.po_id = p_po_id and ii.po_item_id is null and ii.item_id = v_po_item.item_id;
    end if;

    v_accepted_base := coalesce(v_po_item.qty_terima, v_po_item.qty) * v_po_item.faktor;
    v_qty_base := v_input.qty * v_po_item.faktor;
    if v_billed_base + v_legacy_base + v_qty_base > v_accepted_base + 0.000000001 then
      raise exception 'Qty faktur melebihi sisa baris PO setelah konversi satuan.' using errcode = '22003';
    end if;

    select unit into v_item_unit from public.items where id = v_po_item.item_id;
    insert into public.purchase_invoice_items (
      invoice_id, po_item_id, item_id, nama, qty, harga, satuan, faktor
    ) values (
      v_invoice_id, v_po_item.id, v_po_item.item_id, left(coalesce(nullif(v_po_item.nama, ''), '—'), 160),
      v_input.qty, v_input.harga,
      left(coalesce(nullif(v_po_item.satuan, ''), nullif(v_item_unit, ''), 'unit'), 20),
      v_po_item.faktor
    );

    v_total := v_total + v_input.qty * v_input.harga;
    v_po_total := v_po_total + v_input.qty * v_po_item.harga_beli;
  end loop;

  if v_total <= 0 then raise exception 'Nilai faktur nol.'; end if;
  v_ppn := coalesce(p_ppn, 0);
  if v_ppn < 0 or v_ppn > v_total then raise exception 'Nilai PPN faktur tidak valid.'; end if;
  update public.purchase_invoices set total = v_total where id = v_invoice_id;

  -- Use the same lock order as stock-in/out: aggregate item balances first,
  -- then FIFO layers. A stock-out that starts while an invoice splits a layer
  -- waits here and scans a fresh statement snapshot after the split commits.
  if jsonb_array_length(coalesce(p_layer_updates, '[]'::jsonb)) > 0
     or jsonb_array_length(coalesce(p_layer_inserts, '[]'::jsonb)) > 0 then
    if v_po.to_warehouse_id is null then
      raise exception 'Gudang tujuan PO tidak ditemukan untuk penyesuaian layer.';
    end if;
    for v_stock in
      select distinct ii.item_id
      from public.purchase_invoice_items ii
      join public.items item on item.id = ii.item_id
      where ii.invoice_id = v_invoice_id
        and (item.item_type is null or item.item_type = 'Persediaan')
      order by ii.item_id
    loop
      insert into public.stock(warehouse_id, item_id, qty)
      values (v_po.to_warehouse_id, v_stock.item_id, 0)
      on conflict (warehouse_id, item_id) do nothing;
      perform 1 from public.stock s
      where s.warehouse_id = v_po.to_warehouse_id and s.item_id = v_stock.item_id
      for update;
      if not found then raise exception 'Saldo stok tidak dapat dikunci sebelum penyesuaian layer.'; end if;
    end loop;
  end if;

  -- Apply caller's cost-layer plan only if every row is still in the expected
  -- state and belongs to this PO's received goods. Any error rolls everything back.
  for v_layer_update in
    select * from jsonb_to_recordset(coalesce(p_layer_updates, '[]'::jsonb)) as u(
      id uuid, expected_qty_in numeric, expected_qty_left numeric, expected_unit_cost numeric,
      qty_in numeric, qty_left numeric, unit_cost numeric
    ) order by id
  loop
    if coalesce(v_layer_update.qty_in, v_layer_update.expected_qty_in) <= 0
       or coalesce(v_layer_update.qty_left, v_layer_update.expected_qty_left) < 0
       or coalesce(v_layer_update.qty_left, v_layer_update.expected_qty_left)
          > coalesce(v_layer_update.qty_in, v_layer_update.expected_qty_in)
       or coalesce(v_layer_update.unit_cost, v_layer_update.expected_unit_cost) < 0 then
      raise exception 'Rencana biaya lapisan stok tidak valid.';
    end if;

    update public.stock_layers layer
    set qty_in = coalesce(v_layer_update.qty_in, layer.qty_in),
        qty_left = coalesce(v_layer_update.qty_left, layer.qty_left),
        unit_cost = coalesce(v_layer_update.unit_cost, layer.unit_cost)
    where layer.id = v_layer_update.id
      and layer.qty_in = v_layer_update.expected_qty_in
      and layer.qty_left = v_layer_update.expected_qty_left
      and layer.unit_cost = v_layer_update.expected_unit_cost
      and layer.warehouse_id = v_po.to_warehouse_id
      and layer.source = 'purchase'
      and layer.source_ref = coalesce(v_po.no_po, p_po_id::text)
      and exists (
        select 1 from public.purchase_invoice_items ii
        where ii.invoice_id = v_invoice_id and ii.item_id = layer.item_id
      );
    if not found then
      raise exception 'Lapisan stok berubah atau bukan berasal dari PO ini; muat ulang faktur.' using errcode = '40001';
    end if;
  end loop;

  for v_layer_insert in
    select * from jsonb_to_recordset(coalesce(p_layer_inserts, '[]'::jsonb)) as i(
      warehouse_id uuid, item_id uuid, tanggal date, qty_in numeric, qty_left numeric,
      unit_cost numeric, source varchar(24), source_ref varchar(40), exp_date date, batch_no varchar(80)
    )
  loop
    if v_po.to_warehouse_id is null
       or v_layer_insert.warehouse_id is distinct from v_po.to_warehouse_id
       or v_layer_insert.source <> 'purchase'
       or v_layer_insert.source_ref is distinct from coalesce(v_po.no_po, p_po_id::text)
       or v_layer_insert.qty_in is null or v_layer_insert.qty_in <= 0
       or v_layer_insert.qty_left is null or v_layer_insert.qty_left < 0
       or v_layer_insert.qty_left > v_layer_insert.qty_in
       or v_layer_insert.unit_cost is null or v_layer_insert.unit_cost < 0
       or not exists (
         select 1 from public.purchase_invoice_items ii
         where ii.invoice_id = v_invoice_id and ii.item_id = v_layer_insert.item_id
       ) then
      raise exception 'Lapisan stok baru tidak sesuai dengan faktur PO.';
    end if;
    insert into public.stock_layers (
      warehouse_id, item_id, tanggal, qty_in, qty_left, unit_cost,
      source, source_ref, exp_date, batch_no
    ) values (
      v_layer_insert.warehouse_id, v_layer_insert.item_id, v_layer_insert.tanggal,
      v_layer_insert.qty_in, v_layer_insert.qty_left, v_layer_insert.unit_cost,
      v_layer_insert.source, v_layer_insert.source_ref, v_layer_insert.exp_date, v_layer_insert.batch_no
    );
  end loop;

  -- Build the balanced invoice journal in this same transaction. Journal trigger
  -- still enforces the closed-period lock; missing/inactive/header accounts abort.
  v_selisih := v_total - v_ppn - v_po_total;
  for v_line in
    select * from (values
      ('2102'::text, v_po_total, 0::numeric),
      ('2101'::text, 0::numeric, v_total),
      ('1105'::text, v_ppn, 0::numeric),
      ('1301'::text, greatest(v_selisih, 0), greatest(-v_selisih, 0))
    ) as l(code, debit, credit)
    where debit > 0 or credit > 0
  loop
    select id, is_active, is_header into v_account
    from public.coa_accounts where code = v_line.code;
    if not found then raise exception 'Akun % tidak tersedia atau bukan akun detail aktif.', v_line.code; end if;
    if not v_account.is_active or v_account.is_header then
      raise exception 'Akun % tidak tersedia atau bukan akun detail aktif.', v_line.code;
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', v_account.id, 'debit', v_line.debit, 'credit', v_line.credit
    ));
  end loop;

  if (select coalesce(sum((x->>'debit')::numeric), 0) from jsonb_array_elements(v_lines) x)
     <> (select coalesce(sum((x->>'credit')::numeric), 0) from jsonb_array_elements(v_lines) x) then
    raise exception 'Jurnal faktur tidak seimbang.';
  end if;

  v_prefix_jurnal := 'JRN-' || to_char(p_tanggal, 'YYYYMM') || '-';
  perform pg_advisory_xact_lock(hashtext('vetos:journal:' || v_prefix_jurnal)::bigint);
  select coalesce(max(substring(entry.no_jurnal from length(v_prefix_jurnal) + 1 for 4)::bigint), 0) + 1
    into v_seq
  from public.journal_entries entry
  where left(entry.no_jurnal, length(v_prefix_jurnal)) = v_prefix_jurnal
    and substring(entry.no_jurnal from length(v_prefix_jurnal) + 1 for 4) ~ '^[0-9]{4}$';

  loop
    v_no_jurnal := v_prefix_jurnal || lpad(v_seq::text, 4, '0');
    begin
      insert into public.journal_entries (
        id, no_jurnal, tanggal, deskripsi, source, source_ref, branch_id
      ) values (
        v_entry_id, v_no_jurnal, p_tanggal,
        'Faktur pembelian ' || v_no_faktur || ' (' || coalesce(v_po.no_po, p_po_id::text) || ')',
        'purchase-invoice', v_no_faktur, v_po.branch_id
      );
      exit;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint <> 'journal_entries_no_jurnal_key' then raise; end if;
      v_seq := v_seq + 1;
    end;
  end loop;

  insert into public.journal_lines(entry_id, account_id, debit, credit)
  select v_entry_id, line.account_id, line.debit, line.credit
  from jsonb_to_recordset(v_lines) as line(account_id uuid, debit numeric, credit numeric);

  return query select v_invoice_id, v_no_faktur, v_no_jurnal, v_total;
end;
$$;

revoke all on function public.create_purchase_invoice_from_po(
  uuid, text, integer, text, date, date, text, jsonb, jsonb, jsonb, numeric
) from public, anon;
grant execute on function public.create_purchase_invoice_from_po(
  uuid, text, integer, text, date, date, text, jsonb, jsonb, jsonb, numeric
) to authenticated;

comment on function public.create_purchase_invoice_from_po(
  uuid, text, integer, text, date, date, text, jsonb, jsonb, jsonb, numeric
) is 'Creates a PO invoice, revalidates remaining received units under a PO lock, reprices FIFO layers, and posts its journal atomically.';

-- Stock-in takes the same aggregate-row lock before touching a layer. This keeps
-- simultaneous receipts and issues from losing balance updates or deadlocking.
create or replace function public.stock_in_fifo(
  p_warehouse_id uuid,
  p_item_id uuid,
  p_qty numeric,
  p_unit_cost numeric,
  p_source text,
  p_source_ref text,
  p_tanggal date default current_date,
  p_exp_date date default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item record;
  v_qty_before numeric;
  v_qty_layer numeric;
begin
  if p_qty is null or p_qty <= 0 or p_qty > 1000000000000000000
     or p_unit_cost is null or p_unit_cost < 0 or p_unit_cost > 1000000000000000000
     or p_source is null or length(p_source) = 0 or length(p_source) > 24
     or length(coalesce(p_source_ref, '')) > 40 then
    raise exception 'Data stok masuk tidak valid.';
  end if;

  select item_type into v_item from public.items where id = p_item_id;
  if not found then raise exception 'Barang tidak ditemukan.'; end if;
  if v_item.item_type is not null and v_item.item_type <> 'Persediaan' then return; end if;

  insert into public.stock(warehouse_id, item_id, qty)
  values (p_warehouse_id, p_item_id, 0)
  on conflict (warehouse_id, item_id) do nothing;
  select qty into v_qty_before from public.stock
  where warehouse_id = p_warehouse_id and item_id = p_item_id
  for update;
  if not found then raise exception 'Saldo stok tidak dapat dikunci.'; end if;

  -- Incoming units first close previously issued negative stock; only the
  -- remaining physical units become available FIFO/FEFO layers.
  v_qty_layer := p_qty - least(greatest(-v_qty_before, 0), p_qty);
  update public.stock
  set qty = qty + p_qty, updated_at = now()
  where warehouse_id = p_warehouse_id and item_id = p_item_id;

  if v_qty_layer > 0 then
    insert into public.stock_layers (
      warehouse_id, item_id, tanggal, qty_in, qty_left, unit_cost,
      source, source_ref, exp_date
    ) values (
      p_warehouse_id, p_item_id, coalesce(p_tanggal, current_date),
      v_qty_layer, v_qty_layer, p_unit_cost,
      p_source, p_source_ref, p_exp_date
    );
  end if;

  insert into public.stock_moves (
    tanggal, warehouse_id, item_id, qty, unit_cost, source, source_ref
  ) values (
    coalesce(p_tanggal, current_date), p_warehouse_id, p_item_id,
    p_qty, p_unit_cost, p_source, p_source_ref
  );
end;
$$;

revoke all on function public.stock_in_fifo(uuid, uuid, numeric, numeric, text, text, date, date) from public, anon;
grant execute on function public.stock_in_fifo(uuid, uuid, numeric, numeric, text, text, date, date) to authenticated;

comment on function public.stock_in_fifo(uuid, uuid, numeric, numeric, text, text, date, date) is
  'Adds aggregate stock, an available FIFO layer, and a stock-card movement atomically under the shared stock-row lock.';

-- Serialize FIFO layer consumption with PO invoice repricing. This preserves the
-- existing shortfall valuation behavior while preventing stale absolute writes
-- from restoring quantities to a layer concurrently split/repriced by invoicing.
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
begin
  if p_qty is null or p_qty <= 0 or p_qty > 1000000000000000000
     or p_source is null or length(p_source) = 0 or length(p_source) > 24
     or length(coalesce(p_source_ref, '')) > 40 then
    raise exception 'Data stok keluar tidak valid.';
  end if;

  select item_type, coalesce(buy_price, 0) as buy_price into v_item
  from public.items where id = p_item_id;
  if not found then raise exception 'Barang tidak ditemukan.'; end if;
  if v_item.item_type is not null and v_item.item_type <> 'Persediaan' then
    return query select 0::numeric, '[]'::jsonb, 0::numeric, 0::numeric;
    return;
  end if;

  -- Ensure an aggregate row exists, then lock it before any FIFO layer.
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
    v_left := v_left - v_take;
  end loop;

  v_shortfall := greatest(v_left, 0);
  if v_shortfall > 0 then v_cost := v_cost + v_shortfall * v_item.buy_price; end if;

  update public.stock
  set qty = qty - p_qty, updated_at = now()
  where id = v_stock_id;

  insert into public.stock_moves(
    tanggal, warehouse_id, item_id, qty, unit_cost, source, source_ref
  ) values (
    coalesce(p_tanggal, current_date), p_warehouse_id, p_item_id, -p_qty,
    v_cost / p_qty, p_source, p_source_ref
  );

  return query select v_cost, v_takes, v_shortfall, v_item.buy_price;
end;
$$;

revoke all on function public.stock_out_fifo(uuid, uuid, numeric, text, text, date) from public, anon;
grant execute on function public.stock_out_fifo(uuid, uuid, numeric, text, text, date) to authenticated;

comment on function public.stock_out_fifo(uuid, uuid, numeric, text, text, date) is
  'Consumes FIFO/FEFO layers and updates aggregate stock plus stock card atomically; serializes with purchase invoice layer repricing.';
