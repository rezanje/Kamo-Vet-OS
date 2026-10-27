-- P08 (sebagian): Super Admin (OWNER aktif) membatalkan penerimaan barang yang sudah diposting.
--
-- Aman hanya bila:
-- - PO belum punya faktur pembelian aktif (faktur terikat ke PO, bukan per penerimaan),
--   belum punya retur pembelian, dan sisanya belum ditutup (tutup sisa P07);
-- - barang penerimaan ini masih utuh di gudang. Aturannya sama dengan pembatalan faktur
--   (cancel_purchase_invoice): lapisan stok sumber belum berubah dan tidak ada barang keluar
--   untuk SKU yang sama di gudang itu sejak dokumen diposting.
-- Jika tidak aman, ditolak dengan pesan yang mengarahkan ke Retur Pembelian.
--
-- Efek dalam satu transaksi: stok dikurangi lewat mutasi 'purchase-receipt-void', lapisan
-- stok sumber dinolkan, jurnal persediaan/GRNI dibalik, qty terima/rusak PO dibuka lagi,
-- dokumen asli tetap tersimpan dengan status dibatalkan + jejak audit yang tidak bisa diubah.
-- Tidak ada pengeditan bebas baris yang sudah diposting. Idempoten: aman dijalankan ulang.

alter table public.goods_receipts
  add column if not exists voided_at timestamptz,
  add column if not exists voided_on date,
  add column if not exists voided_by uuid references public.profiles(id),
  add column if not exists void_reason text,
  add column if not exists reversal_journal_id uuid references public.journal_entries(id);

create table if not exists public.purchase_receipt_cancellations (
  receipt_id uuid primary key references public.goods_receipts(id),
  po_id uuid not null references public.purchase_orders(id),
  branch_id uuid references public.branches(id),
  warehouse_id uuid references public.warehouses(id),
  actor_id uuid not null references public.profiles(id),
  request_key text not null check (length(request_key) between 1 and 120),
  payload jsonb not null,
  reason text not null check (length(btrim(reason)) between 3 and 1000),
  tanggal date not null,
  source_journal_id uuid references public.journal_entries(id),
  reversal_journal_id uuid references public.journal_entries(id),
  -- Potret saat pembatalan: baris PO sebelum/sesudah, mutasi dan lapisan sumber yang dibalik.
  lines jsonb not null,
  stock_moves jsonb not null,
  layers jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (actor_id, request_key)
);
alter table public.purchase_receipt_cancellations enable row level security;
revoke all on public.purchase_receipt_cancellations from public, anon, authenticated, service_role;
-- Bukti bisnis terbaca lewat visibilitas PO/cabang yang sama; kunci permintaan tidak dibuka.
grant select (receipt_id, po_id, branch_id, warehouse_id, actor_id, reason, tanggal, source_journal_id, reversal_journal_id, lines, stock_moves, layers, created_at)
  on public.purchase_receipt_cancellations to authenticated;
drop policy if exists purchase_receipt_cancellation_read on public.purchase_receipt_cancellations;
create policy purchase_receipt_cancellation_read on public.purchase_receipt_cancellations for select to authenticated
  using (exists (select 1 from public.purchase_orders po where po.id = po_id)
    and (branch_id is null or public.user_can_access_branch(branch_id)));

create or replace function public.guard_purchase_receipt_cancellation_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'Bukti pembatalan penerimaan tidak dapat diubah atau dihapus' using errcode = '42501'; end $$;
revoke all on function public.guard_purchase_receipt_cancellation_immutable() from public, anon, authenticated, service_role;
drop trigger if exists purchase_receipt_cancellation_immutable on public.purchase_receipt_cancellations;
create trigger purchase_receipt_cancellation_immutable before update or delete on public.purchase_receipt_cancellations
  for each row execute function public.guard_purchase_receipt_cancellation_immutable();
drop trigger if exists purchase_receipt_cancellation_no_truncate on public.purchase_receipt_cancellations;
create trigger purchase_receipt_cancellation_no_truncate before truncate on public.purchase_receipt_cancellations
  for each statement execute function public.guard_purchase_receipt_cancellation_immutable();

-- Status batal hanya lewat RPC resmi; dokumen yang sudah dibatalkan tidak bisa diubah/dihapus langsung.
create or replace function public.guard_goods_receipt_void() returns trigger
language plpgsql set search_path = '' as $$
declare parent_voided boolean;
begin
  if current_user not in ('authenticated', 'anon', 'service_role') then return coalesce(new, old); end if;
  if tg_table_name = 'goods_receipts' then
    if tg_op = 'INSERT' then
      if new.voided_at is not null or new.voided_on is not null or new.voided_by is not null
         or new.void_reason is not null or new.reversal_journal_id is not null then
        raise exception 'Status batal penerimaan hanya lewat pembatalan resmi' using errcode = '42501';
      end if;
      return new;
    end if;
    if old.voided_at is not null then
      raise exception 'Penerimaan yang sudah dibatalkan tidak dapat diubah atau dihapus' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and (new.voided_at, new.voided_on, new.voided_by, new.void_reason, new.reversal_journal_id)
       is distinct from (old.voided_at, old.voided_on, old.voided_by, old.void_reason, old.reversal_journal_id) then
      raise exception 'Status batal penerimaan hanya lewat pembatalan resmi' using errcode = '42501';
    end if;
    return coalesce(new, old);
  end if;
  select exists (select 1 from public.goods_receipts g where g.id in (new.receipt_id, old.receipt_id) and g.voided_at is not null)
    into parent_voided;
  if parent_voided then
    raise exception 'Rincian penerimaan yang sudah dibatalkan tidak dapat diubah' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
revoke all on function public.guard_goods_receipt_void() from public, anon, authenticated, service_role;
drop trigger if exists goods_receipt_void_guard on public.goods_receipts;
create trigger goods_receipt_void_guard before insert or update or delete on public.goods_receipts
  for each row execute function public.guard_goods_receipt_void();
drop trigger if exists goods_receipt_item_void_guard on public.goods_receipt_items;
create trigger goods_receipt_item_void_guard before insert or update or delete on public.goods_receipt_items
  for each row execute function public.guard_goods_receipt_void();

-- Mutasi stok dan jurnal pembalik penerimaan hanya ditulis oleh RPC.
create or replace function public.guard_purchase_receipt_void_effect() returns trigger
language plpgsql set search_path = '' as $$
declare protected boolean;
begin
  if current_user in ('authenticated', 'anon', 'service_role') then
    if tg_table_name = 'journal_lines' then
      select exists (select 1 from public.journal_entries e where e.id in (new.entry_id, old.entry_id) and e.source = 'purchase-receipt-void')
        into protected;
    else
      protected := coalesce(new.source = 'purchase-receipt-void', false) or coalesce(old.source = 'purchase-receipt-void', false);
    end if;
    if protected then raise exception 'Riwayat pembatalan penerimaan dilindungi' using errcode = '42501'; end if;
  end if;
  return coalesce(new, old);
end $$;
revoke all on function public.guard_purchase_receipt_void_effect() from public, anon, authenticated, service_role;
drop trigger if exists purchase_receipt_void_move_guard on public.stock_moves;
create trigger purchase_receipt_void_move_guard before insert or update or delete on public.stock_moves
  for each row execute function public.guard_purchase_receipt_void_effect();
drop trigger if exists purchase_receipt_void_journal_guard on public.journal_entries;
create trigger purchase_receipt_void_journal_guard before insert or update or delete on public.journal_entries
  for each row execute function public.guard_purchase_receipt_void_effect();
drop trigger if exists purchase_receipt_void_journal_lines_guard on public.journal_lines;
create trigger purchase_receipt_void_journal_lines_guard before insert or update or delete on public.journal_lines
  for each row execute function public.guard_purchase_receipt_void_effect();

-- Moving average: mutasi pembalik penerimaan mengeluarkan nilai pada harga asal,
-- persis seperti pembatalan faktur langsung (bukan pada rata-rata berjalan).
do $$
declare body text;
begin
  select pg_get_functiondef('public.inventory_record_valuation()'::regprocedure) into body;
  if position('purchase-receipt-void' in body) = 0 then
    if position($q$new.source='purchase-invoice-void'$q$ in body) = 0 then
      raise exception 'P08: anchor inventory_record_valuation tidak ditemukan; migrasi dihentikan';
    end if;
    body := replace(body, $q$new.source='purchase-invoice-void'$q$, $q$new.source in('purchase-invoice-void','purchase-receipt-void')$q$);
    execute body;
  end if;
end $$;

-- Harga dari penerimaan yang dibatalkan bukan lagi bukti harga pokok (fallback HPP), sama seperti
-- lapisan faktur langsung yang dibatalkan.
create or replace function public.stock_layer_cost_was_reversed(p_layer_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.purchase_invoice_layer_proofs proof
    join public.purchase_invoices invoice on invoice.id = proof.invoice_id
    where proof.layer_id = p_layer_id and proof.before_state is null
      and invoice.voided_at is not null
  ) or exists (
    select 1 from public.purchase_receipt_cancellations c
    where c.layers @> jsonb_build_array(jsonb_build_object('id', p_layer_id))
  );
$$;
revoke all on function public.stock_layer_cost_was_reversed(uuid) from public, anon;
grant execute on function public.stock_layer_cost_was_reversed(uuid) to authenticated;

create or replace function public.stock_move_cost_was_reversed(p_move_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.purchase_receipt_cancellations c
    where c.stock_moves @> jsonb_build_array(jsonb_build_object('id', p_move_id))
  );
$$;
revoke all on function public.stock_move_cost_was_reversed(uuid) from public, anon;
grant execute on function public.stock_move_cost_was_reversed(uuid) to authenticated;

do $$
declare body text; anchor text;
begin
  select pg_get_functiondef('public.inventory_effective_unit_cost(uuid,uuid)'::regprocedure) into body;
  if position('stock_move_cost_was_reversed' in body) = 0 then
    anchor := $q$and m.source not in('sale-void','purchase-invoice-void')$q$;
    if (length(body) - length(replace(body, anchor, ''))) / length(anchor) <> 1 then
      raise exception 'P08: anchor inventory_effective_unit_cost tidak ditemukan; migrasi dihentikan';
    end if;
    execute replace(body, anchor, anchor || ' and not public.stock_move_cost_was_reversed(m.id)');
  end if;
  select pg_get_functiondef('public.stock_out_fifo(uuid,uuid,numeric,text,text,date)'::regprocedure) into body;
  if position('stock_move_cost_was_reversed' in body) = 0 then
    anchor := $q$and source not in ('sale-void', 'purchase-invoice-void')$q$;
    if (length(body) - length(replace(body, anchor, ''))) / length(anchor) <> 1 then
      raise exception 'P08: anchor stock_out_fifo tidak ditemukan; migrasi dihentikan';
    end if;
    execute replace(body, anchor, anchor || ' and not public.stock_move_cost_was_reversed(id)');
  end if;
end $$;

create or replace function public.cancel_goods_receipt(
  p_receipt_id uuid, p_request_key text, p_reason text,
  p_tanggal date default (now() at time zone 'Asia/Jakarta')::date
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  gr public.goods_receipts%rowtype; po public.purchase_orders%rowtype;
  prior public.purchase_receipt_cancellations%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  today date := (now() at time zone 'Asia/Jakarta')::date;
  payload jsonb; result jsonb; v_po uuid; v_ref text; v_wh uuid; v_wh_branch uuid; r record;
  v_items uuid[]; moves jsonb; layers jsonb; before_lines jsonb; after_lines jsonb;
  v_total numeric; v_source_journal uuid; v_journal_count integer; v_reversal uuid; jlines jsonb;
  v_complete boolean; v_unit_cost numeric;
  consumed constant text := 'Barang dari penerimaan ini sudah terpakai atau keluar dari gudang, jadi penerimaan tidak bisa dibatalkan. Gunakan Retur Pembelian untuk barang yang dikembalikan ke pemasok.';
  unclear constant text := 'Bukti stok atau jurnal penerimaan ini tidak cocok dengan dokumennya, jadi tidak bisa dibatalkan otomatis. Gunakan Retur Pembelian atau minta rekonsiliasi.';
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid() and role = 'OWNER' and is_active) then
    raise exception 'Pembatalan penerimaan barang hanya oleh Super Admin (OWNER)' using errcode = '42501';
  end if;
  if p_request_key is null or p_request_key <> btrim(p_request_key) or length(p_request_key) not between 1 and 120 then
    raise exception 'Identitas pembatalan tidak valid. Muat ulang halaman' using errcode = '22023';
  end if;
  if length(v_reason) not between 3 and 1000 then
    raise exception 'Alasan pembatalan wajib diisi (3 sampai 1.000 karakter)' using errcode = '22023';
  end if;
  if p_tanggal is null or not isfinite(p_tanggal) or p_tanggal > today then
    raise exception 'Tanggal pembatalan tidak valid atau di masa depan' using errcode = '22023';
  end if;
  payload := jsonb_build_object('receipt_id', p_receipt_id, 'reason', v_reason, 'tanggal', p_tanggal);
  perform pg_advisory_xact_lock(hashtextextended('purchase-receipt-cancel:' || auth.uid()::text || ':' || p_request_key, 0));

  select g.po_id into v_po from public.goods_receipts g where g.id = p_receipt_id;
  if not found then raise exception 'Penerimaan barang tidak ditemukan'; end if;
  -- Urutan kunci sama dengan penerimaan/faktur: PO dulu, lalu dokumen dan baris PO.
  select * into po from public.purchase_orders where id = v_po for update;
  select * into gr from public.goods_receipts where id = p_receipt_id for update;
  perform public.purchase_assert_access('receipt', po.branch_id);

  select * into prior from public.purchase_receipt_cancellations where actor_id = auth.uid() and request_key = p_request_key;
  if found then
    if prior.payload is distinct from payload then
      raise exception 'Kunci pembatalan sudah dipakai dengan rincian berbeda. Muat ulang halaman' using errcode = '22023';
    end if;
    return prior.result;
  end if;
  if gr.voided_at is not null then
    -- Klik ganda / tab lain: tidak ada efek kedua, kembalikan hasil yang sudah tercatat.
    select c.result into result from public.purchase_receipt_cancellations c where c.receipt_id = gr.id;
    return coalesce(result, jsonb_build_object('receipt_id', gr.id, 'no_terima', gr.no_terima)) || jsonb_build_object('already_cancelled', true);
  end if;

  if po.status = 'Batal' then raise exception 'PO sudah dibatalkan; penerimaan tidak bisa dibatalkan dari sini. Gunakan Retur Pembelian.'; end if;
  if exists (select 1 from public.purchase_order_receipt_closures c where c.po_id = po.id) then
    raise exception 'Sisa PO ini sudah ditutup, jadi penerimaannya tidak bisa dibatalkan. Gunakan Retur Pembelian untuk barang yang dikembalikan.';
  end if;
  if exists (select 1 from public.purchase_invoices i where i.po_id = po.id and i.voided_at is null) then
    raise exception 'PO ini sudah punya faktur pembelian aktif. Batalkan fakturnya dulu, atau gunakan Retur Pembelian bila barang dikembalikan ke pemasok.';
  end if;
  if exists (select 1 from public.purchase_returns rt where rt.po_id = po.id) then
    raise exception 'PO ini sudah punya retur pembelian, jadi penerimaannya tidak bisa dibatalkan. Lanjutkan lewat Retur Pembelian.';
  end if;
  if p_tanggal < gr.tanggal then raise exception 'Tanggal pembatalan tidak boleh sebelum tanggal penerimaan' using errcode = '22023'; end if;
  -- Periode akuntansi/persediaan dokumen asal dan tanggal pembatalan harus masih terbuka.
  perform public.inventory_assert_open_date(gr.tanggal);
  perform public.inventory_assert_open_date(p_tanggal);

  v_wh := po.to_warehouse_id;
  v_ref := coalesce(po.no_po, po.id::text);
  select w.branch_id into v_wh_branch from public.warehouses w where w.id = v_wh;
  if not found then raise exception '%', unclear; end if;
  perform public.purchase_assert_access('receipt', v_wh_branch);
  -- Mutasi/lapisan penerimaan memakai nomor PO dan waktu transaksi dokumen sebagai jejak.
  if exists (select 1 from public.goods_receipts g where g.po_id = po.id and g.id <> gr.id and g.created_at = gr.created_at) then
    raise exception '%', unclear;
  end if;
  if exists (select 1 from public.goods_receipt_items gi where gi.receipt_id = gr.id
             and (gi.qty_terima > 0 or gi.qty_rusak > 0) and (gi.po_item_id is null or gi.item_id is null)) then
    raise exception '%', unclear;
  end if;

  perform 1 from public.purchase_order_items where po_id = po.id order by id for update;
  select array_agg(distinct gi.item_id order by gi.item_id) into v_items
    from public.goods_receipt_items gi where gi.receipt_id = gr.id and gi.qty_terima > 0;
  v_items := coalesce(v_items, '{}');
  -- Kunci saldo agregat sebelum lapisan, sama seperti mutasi stok lain.
  for r in select unnest(v_items) item_id order by 1 loop
    perform 1 from public.stock where warehouse_id = v_wh and item_id = r.item_id for update;
  end loop;

  select coalesce(jsonb_agg(to_jsonb(m) order by m.item_id, m.id), '[]') into moves
    from public.stock_moves m
    where m.warehouse_id = v_wh and m.source = 'purchase' and m.source_ref = v_ref
      and m.created_at = gr.created_at and m.tanggal = gr.tanggal;
  perform 1 from public.stock_layers l
    where l.warehouse_id = v_wh and l.source = 'purchase' and l.source_ref = v_ref
      and l.created_at = gr.created_at and l.tanggal = gr.tanggal
    order by l.id for update;
  select coalesce(jsonb_agg(to_jsonb(l) order by l.item_id, l.id), '[]') into layers
    from public.stock_layers l
    where l.warehouse_id = v_wh and l.source = 'purchase' and l.source_ref = v_ref
      and l.created_at = gr.created_at and l.tanggal = gr.tanggal;
  if exists (select 1 from jsonb_array_elements(moves) x where not ((x->>'item_id')::uuid = any (v_items)) or (x->>'qty')::numeric <= 0)
     or exists (select 1 from jsonb_array_elements(layers) x where not ((x->>'item_id')::uuid = any (v_items))) then
    raise exception '%', unclear;
  end if;

  for r in
    select gi.item_id, sum(gi.qty_terima * pi.faktor) expected,
      bool_and(coalesce(i.item_type, 'Persediaan') = 'Persediaan') stocked,
      coalesce((select sum((x->>'qty')::numeric) from jsonb_array_elements(moves) x where (x->>'item_id')::uuid = gi.item_id), 0) moved,
      coalesce((select sum((x->>'qty_in')::numeric) from jsonb_array_elements(layers) x where (x->>'item_id')::uuid = gi.item_id), 0) layered,
      coalesce((select bool_and((x->>'qty_left')::numeric = (x->>'qty_in')::numeric) from jsonb_array_elements(layers) x where (x->>'item_id')::uuid = gi.item_id), true) untouched
    from public.goods_receipt_items gi
    join public.purchase_order_items pi on pi.id = gi.po_item_id
    join public.items i on i.id = gi.item_id
    where gi.receipt_id = gr.id and gi.qty_terima > 0
    group by gi.item_id
  loop
    -- Barang non-stok (mis. jasa) tidak pernah membuat mutasi; selain itu jumlah harus persis.
    if r.moved <> r.expected and not (r.moved = 0 and not r.stocked) then raise exception '%', unclear; end if;
    -- Lapisan lebih kecil dari mutasi = penerimaan menutup stok minus (sudah terpakai).
    if r.moved > 0 and (r.layered <> r.moved or not r.untouched) then raise exception '%', consumed; end if;
  end loop;
  -- Sama dengan pembatalan faktur: ada barang keluar untuk SKU ini setelah dokumen diposting.
  if exists (select 1 from public.stock_moves m where m.warehouse_id = v_wh and m.item_id = any (v_items)
             and m.qty < 0 and m.created_at >= gr.created_at
             and m.source not in ('purchase-receipt-void', 'purchase-invoice-void')) then
    raise exception '%', consumed;
  end if;

  -- Jurnal sumber: Persediaan (1301) / Barang diterima belum difaktur (2102) senilai dokumen.
  select coalesce(sum(gi.qty_terima * gi.harga), 0) into v_total from public.goods_receipt_items gi where gi.receipt_id = gr.id;
  -- Sama dengan pembatalan faktur: kunci jurnal (setelah stok/lapisan) sebelum membaca jurnal sumber.
  lock table public.journal_entries in share row exclusive mode;
  select count(*), min(e.id::text)::uuid into v_journal_count, v_source_journal
    from public.journal_entries e where e.source = 'purchase' and e.source_ref = gr.no_terima;
  if v_total > 0 then
    if v_journal_count <> 1 or exists (select 1 from public.journal_entries e where e.id = v_source_journal and e.voided_at is not null) then
      raise exception '%', unclear;
    end if;
    select jsonb_agg(jsonb_build_object('code', a.code, 'debit', l.credit, 'credit', l.debit) order by l.id) into jlines
      from public.journal_lines l join public.coa_accounts a on a.id = l.account_id where l.entry_id = v_source_journal;
    if (select count(*) from public.journal_lines l where l.entry_id = v_source_journal) <> 2
       or not exists (select 1 from public.journal_lines l join public.coa_accounts a on a.id = l.account_id
                      where l.entry_id = v_source_journal and a.code = '1301' and l.debit = v_total and l.credit = 0)
       or not exists (select 1 from public.journal_lines l join public.coa_accounts a on a.id = l.account_id
                      where l.entry_id = v_source_journal and a.code = '2102' and l.credit = v_total and l.debit = 0) then
      raise exception '%', unclear;
    end if;
    v_reversal := public.clinic_write_journal(p_tanggal, 'Pembatalan penerimaan ' || gr.no_terima || ': ' || v_reason,
      'purchase-receipt-void', gr.no_terima, po.branch_id, jlines);
    if v_reversal is null then raise exception '%', unclear; end if;
  elsif v_journal_count <> 0 then
    raise exception '%', unclear;
  end if;

  -- Balik stok: lapisan sumber dinolkan, saldo dikurangi, mutasi pembalik pada harga asal.
  update public.stock_layers l set qty_left = 0
    where l.id in (select (x->>'id')::uuid from jsonb_array_elements(layers) x);
  for r in
    select (x->>'item_id')::uuid item_id, sum((x->>'qty')::numeric) qty, sum((x->>'qty')::numeric * (x->>'unit_cost')::numeric) val
    from jsonb_array_elements(moves) x group by 1 order by 1
  loop
    update public.stock set qty = qty - r.qty, updated_at = now()
      where warehouse_id = v_wh and item_id = r.item_id and qty >= r.qty;
    if not found then raise exception '%', consumed; end if;
    v_unit_cost := r.val / r.qty;
    insert into public.stock_moves (tanggal, warehouse_id, item_id, qty, unit_cost, source, source_ref)
      values (p_tanggal, v_wh, r.item_id, -r.qty, v_unit_cost, 'purchase-receipt-void', gr.no_terima);
  end loop;

  -- Buka lagi sisa PO yang ditunggu (qty terima dan qty rusak dokumen ini).
  select jsonb_agg(jsonb_build_object('id', pi.id, 'qty', pi.qty, 'qty_terima', pi.qty_terima, 'qty_rusak', pi.qty_rusak) order by pi.id)
    into before_lines from public.purchase_order_items pi where pi.po_id = po.id;
  for r in select gi.po_item_id, sum(gi.qty_terima) qt, sum(gi.qty_rusak) qr
           from public.goods_receipt_items gi where gi.receipt_id = gr.id and (gi.qty_terima > 0 or gi.qty_rusak > 0)
           group by gi.po_item_id order by gi.po_item_id loop
    update public.purchase_order_items set qty_terima = qty_terima - r.qt, qty_rusak = qty_rusak - r.qr
      where id = r.po_item_id and po_id = po.id and coalesce(qty_terima, 0) >= r.qt and qty_rusak >= r.qr;
    if not found then raise exception '%', unclear; end if;
  end loop;
  select bool_and(coalesce(qty_terima, 0) >= qty) into v_complete from public.purchase_order_items where po_id = po.id;
  update public.purchase_orders set status = case when v_complete then 'Diterima'::public.po_status else 'Dipesan'::public.po_status end
    where id = po.id;
  select jsonb_agg(jsonb_build_object('id', pi.id, 'qty', pi.qty, 'qty_terima', pi.qty_terima, 'qty_rusak', pi.qty_rusak) order by pi.id)
    into after_lines from public.purchase_order_items pi where pi.po_id = po.id;

  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'OWNER' and is_active) then
    raise exception 'Pembatalan penerimaan barang hanya oleh Super Admin (OWNER)' using errcode = '42501';
  end if;
  update public.goods_receipts set voided_at = now(), voided_on = p_tanggal, voided_by = auth.uid(),
    void_reason = v_reason, reversal_journal_id = v_reversal where id = gr.id;
  result := jsonb_build_object('receipt_id', gr.id, 'no_terima', gr.no_terima, 'po_id', po.id, 'no_po', po.no_po,
    'reversal_journal_id', v_reversal, 'no_jurnal', (select no_jurnal from public.journal_entries where id = v_reversal),
    'tanggal', p_tanggal, 'total', v_total, 'po_complete', coalesce(v_complete, false));
  insert into public.purchase_receipt_cancellations (receipt_id, po_id, branch_id, warehouse_id, actor_id, request_key, payload,
    reason, tanggal, source_journal_id, reversal_journal_id, lines, stock_moves, layers, result)
  values (gr.id, po.id, po.branch_id, v_wh, auth.uid(), p_request_key, payload, v_reason, p_tanggal, v_source_journal, v_reversal,
    jsonb_build_object('before', before_lines, 'after', after_lines), moves, layers, result);
  return result;
end $$;
revoke all on function public.cancel_goods_receipt(uuid, text, text, date) from public, anon, service_role;
grant execute on function public.cancel_goods_receipt(uuid, text, text, date) to authenticated;
