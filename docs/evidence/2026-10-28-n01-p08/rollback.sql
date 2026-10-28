-- N01/P08 ROLLBACK — WRITES. Only after the app has been reverted (the new invoice form calls the new RPC).
-- One transaction. Restores the four patched function bodies exactly as main (md5-checked) and removes the
-- new objects. Refuses once any invoice<->receipt link or cascade cancellation exists: those are business
-- records; in that case fix forward with a new migration instead.
begin;
set local lock_timeout = '5s';
do $rollback$
declare definition text; h text; r record;
  invoice_block constant text := $old$  if exists (select 1 from public.purchase_invoices i where i.po_id = po.id and i.voided_at is null) then
    raise exception 'PO ini sudah punya faktur pembelian aktif. Batalkan fakturnya dulu, atau gunakan Retur Pembelian bila barang dikembalikan ke pemasok.';
  end if;$old$;
  invoice_block_new constant text := $new$  -- N01: only an active invoice linked to this receipt blocks; an active invoice without any
  -- receipt link (older invoices) keeps the PO-wide block.
  if exists (select 1 from public.purchase_invoice_receipts l join public.purchase_invoices i on i.id = l.invoice_id
             where l.goods_receipt_id = gr.id and i.voided_at is null) then
    raise exception 'Penerimaan ini sudah ditagih di faktur pembelian aktif %. Batalkan fakturnya dulu, atau gunakan Retur Pembelian bila barang dikembalikan ke pemasok.',
      (select string_agg(i.no_faktur, ', ' order by i.no_faktur) from public.purchase_invoice_receipts l join public.purchase_invoices i on i.id = l.invoice_id
       where l.goods_receipt_id = gr.id and i.voided_at is null);
  end if;
  if exists (select 1 from public.purchase_invoices i where i.po_id = po.id and i.voided_at is null
             and not exists (select 1 from public.purchase_invoice_receipts l where l.invoice_id = i.id)) then
    raise exception 'PO ini sudah punya faktur pembelian aktif. Batalkan fakturnya dulu, atau gunakan Retur Pembelian bila barang dikembalikan ke pemasok.';
  end if;$new$;
  layer_guard constant text := $new$  -- N01: an active invoice (of another receipt) may have repriced this receipt's layers.
  if exists (select 1 from public.purchase_invoice_layer_proofs pr join public.purchase_invoices i on i.id = pr.invoice_id
             where i.voided_at is null and pr.layer_id in (select (x->>'id')::uuid from jsonb_array_elements(layers) x)) then
    raise exception 'Nilai stok penerimaan ini sudah dipakai faktur pembelian aktif. Batalkan fakturnya dulu, atau gunakan Retur Pembelian bila barang dikembalikan ke pemasok.';
  end if;
$new$;
  billed_guard constant text := $new$  -- N01: active invoices of this PO must still be covered by what remains received.
  if exists (select 1 from public.purchase_order_items pi where pi.po_id = po.id
             and (select coalesce(sum(ii.qty * ii.faktor), 0) from public.purchase_invoice_items ii join public.purchase_invoices i on i.id = ii.invoice_id
                  where i.po_id = po.id and i.voided_at is null and ii.po_item_id = pi.id) > coalesce(pi.qty_terima, pi.qty) * pi.faktor) then
    raise exception 'Faktur pembelian aktif di PO ini menagih lebih banyak dari barang yang tersisa bila penerimaan ini dibatalkan. Batalkan atau koreksi fakturnya dulu.';
  end if;
$new$;
begin
  if current_user <> 'postgres' then raise exception 'Rollback must run as postgres (current role: %)', current_user; end if;
  if to_regclass('public.purchase_invoice_receipts') is not null and exists (select 1 from public.purchase_invoice_receipts) then
    raise exception 'N01_IN_USE: invoice-receipt links already exist; rollback refused, fix forward';
  end if;
  if to_regclass('public.purchase_advance_cascade_cancellations') is not null and exists (select 1 from public.purchase_advance_cascade_cancellations) then
    raise exception 'P08_IN_USE: a cascade cancellation already exists; rollback refused, fix forward';
  end if;

  definition := pg_get_functiondef('public.cancel_goods_receipt(uuid,text,text,date)'::regprocedure); h := md5(definition);
  if h <> '03b31359e9f7b0764993761c9074a411' then
    if h <> '665ae8b79fd6051032c827d984c8d641' then raise exception 'cancel_goods_receipt is neither applied nor main (md5 %)', h; end if;
    definition := replace(definition, invoice_block_new, invoice_block);
    definition := replace(definition, layer_guard, '');
    definition := replace(definition, billed_guard, '');
    execute definition;
    h := md5(pg_get_functiondef('public.cancel_goods_receipt(uuid,text,text,date)'::regprocedure));
    if h <> '03b31359e9f7b0764993761c9074a411' then raise exception 'cancel_goods_receipt not restored exactly (md5 %)', h; end if;
  end if;

  for r in select * from (values
    ('public.guard_purchase_advance_receipt()', 'e99841e188e4470563456bfdf89e162b', 'f1db6d1f5b115eb978de21b79c2cdd92',
      'public.goods_receipts where po_id = new.po_id)', 'public.goods_receipts where po_id = new.po_id and voided_at is null)'),
    ('public.revise_purchase_order(text,uuid,integer,text,jsonb,jsonb,text)', '1abc1231704fb392e3634065a1a4fa93', '7b10b6e7265dab80c707c2aa4789cc96',
      'public.goods_receipts where po_id=v_po.id)', 'public.goods_receipts where po_id=v_po.id and voided_at is null)'),
    ('public.revise_purchase_order_prices(text,uuid,integer,jsonb,text)', '2cd59070532a340c4e769deb243e9830', 'd09a46cf61d03bd584fced36f6c73386',
      'public.goods_receipts where po_id=po.id)', 'public.goods_receipts where po_id=po.id and voided_at is null)')
  ) v(sig, main_hash, applied_hash, original, patched) loop
    definition := pg_get_functiondef(r.sig::regprocedure); h := md5(definition);
    continue when h = r.main_hash;
    if h <> r.applied_hash then raise exception '% is neither applied nor main (md5 %)', r.sig, h; end if;
    execute replace(definition, r.patched, r.original);
    h := md5(pg_get_functiondef(r.sig::regprocedure));
    if h <> r.main_hash then raise exception '% not restored exactly (md5 %)', r.sig, h; end if;
  end loop;
end $rollback$;

drop function if exists public.cancel_purchase_advance_cascade(uuid, text, text, text);
drop function if exists public.preview_purchase_advance_cascade(uuid);
drop function if exists public.purchase_advance_cascade_plan(uuid);
drop function if exists public.purchase_advance_cascade_fingerprint(jsonb, numeric);
drop table if exists public.purchase_advance_cascade_cancellations;
drop function if exists public.guard_purchase_advance_cascade_immutable();
drop function if exists public.create_purchase_invoice_from_po_receipts(uuid, text, integer, text, date, date, text, jsonb, jsonb, jsonb, numeric, text, uuid, uuid[]);
drop trigger if exists purchase_invoice_receipt_active_sync on public.purchase_invoices;
drop function if exists public.sync_purchase_invoice_receipt_active();
drop table if exists public.purchase_invoice_receipts;
drop function if exists public.guard_purchase_invoice_receipt();
delete from supabase_migrations.schema_migrations where version in ('20261029110000', '20261029111000');
commit;
