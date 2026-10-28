-- N01: record which goods receipts a purchase invoice (from PO) covers.
--
-- * purchase_invoice_receipts(invoice_id, goods_receipt_id): written only by the invoice RPC below,
--   in the same transaction as the invoice. Readable with the same PO/branch visibility as receipts.
-- * A receipt belongs to at most one ACTIVE invoice: `active` mirrors purchase_invoices.voided_at
--   (kept by trigger) and a partial unique index enforces it in the database.
-- * create_purchase_invoice_from_po_receipts wraps the existing create_purchase_invoice_from_po
--   (unchanged) and stores the links atomically. The stock layers the invoice actually repriced must
--   belong to a selected receipt (or to a receipt already linked to another active invoice, i.e. the
--   remainder of a partly billed receipt), so a link never claims less than the invoice used.
-- * Old invoices have no links and are not backfilled; screens keep the "same PO" note for them.
-- * cancel_goods_receipt (P08, 20261028190000) is narrowed: an active invoice LINKED to that receipt
--   blocks; an active invoice WITHOUT links keeps the old PO-wide block. Two extra guards keep linked
--   invoices of other receipts consistent: the receipt's layers must not carry an active invoice's
--   repricing, and active invoices must still be covered by what remains received.
-- Provenance: cancel_goods_receipt must match main's exact md5 (pg_get_functiondef, same on the
-- hosted PG17.6 and local PG16/17) or this migration's own result; anything else aborts.

create table if not exists public.purchase_invoice_receipts (
  invoice_id uuid not null references public.purchase_invoices(id) on delete cascade,
  goods_receipt_id uuid not null references public.goods_receipts(id) on delete cascade,
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  primary key (invoice_id, goods_receipt_id)
);
create unique index if not exists purchase_invoice_receipts_one_active
  on public.purchase_invoice_receipts(goods_receipt_id) where active;
create index if not exists purchase_invoice_receipts_po on public.purchase_invoice_receipts(po_id);
alter table public.purchase_invoice_receipts enable row level security;
revoke all on public.purchase_invoice_receipts from public, anon, authenticated, service_role;
grant select on public.purchase_invoice_receipts to authenticated;
drop policy if exists purchase_invoice_receipts_read on public.purchase_invoice_receipts;
-- Same visibility as goods_receipts (gr_all): the parent PO must be visible to the reader.
create policy purchase_invoice_receipts_read on public.purchase_invoice_receipts for select to authenticated
  using (exists (select 1 from public.purchase_orders p where p.id = po_id
    and (p.branch_id is null or public.user_can_access_branch(p.branch_id))));

-- Consistency for every writer: same PO on both sides, receipt not cancelled when linked,
-- `active` always equals "invoice not voided"; only `active` may change afterwards.
create or replace function public.guard_purchase_invoice_receipt() returns trigger
language plpgsql set search_path = '' as $$
declare inv public.purchase_invoices%rowtype; gr public.goods_receipts%rowtype;
begin
  if tg_op = 'DELETE' then
    if current_user in ('authenticated', 'anon', 'service_role') then
      raise exception 'Tautan faktur-penerimaan tidak dapat dihapus' using errcode = '42501';
    end if;
    return old;
  end if;
  select * into inv from public.purchase_invoices where id = new.invoice_id;
  if tg_op = 'UPDATE' then
    if (new.invoice_id, new.goods_receipt_id, new.po_id, new.created_by, new.created_at)
       is distinct from (old.invoice_id, old.goods_receipt_id, old.po_id, old.created_by, old.created_at) then
      raise exception 'Tautan faktur-penerimaan tidak dapat diubah' using errcode = '42501';
    end if;
    new.active := inv.voided_at is null;
    return new;
  end if;
  select * into gr from public.goods_receipts where id = new.goods_receipt_id;
  if inv.id is null or gr.id is null or inv.po_id is null or inv.po_id is distinct from gr.po_id or new.po_id is distinct from gr.po_id then
    raise exception 'Penerimaan bukan milik PO faktur ini' using errcode = '22023';
  end if;
  if gr.voided_at is not null then
    raise exception 'Penerimaan % sudah dibatalkan dan tidak bisa ditagih', gr.no_terima using errcode = '22023';
  end if;
  new.active := inv.voided_at is null;
  return new;
end $$;
revoke all on function public.guard_purchase_invoice_receipt() from public, anon, authenticated, service_role;
drop trigger if exists purchase_invoice_receipt_guard on public.purchase_invoice_receipts;
create trigger purchase_invoice_receipt_guard before insert or update or delete on public.purchase_invoice_receipts
  for each row execute function public.guard_purchase_invoice_receipt();

-- Voiding (or any change of voided_at) re-evaluates the links of that invoice.
create or replace function public.sync_purchase_invoice_receipt_active() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.purchase_invoice_receipts l set active = (new.voided_at is null)
    where l.invoice_id = new.id and l.active is distinct from (new.voided_at is null);
  return new;
end $$;
revoke all on function public.sync_purchase_invoice_receipt_active() from public, anon, authenticated, service_role;
drop trigger if exists purchase_invoice_receipt_active_sync on public.purchase_invoices;
create trigger purchase_invoice_receipt_active_sync after update of voided_at on public.purchase_invoices
  for each row when (old.voided_at is distinct from new.voided_at)
  execute function public.sync_purchase_invoice_receipt_active();

create or replace function public.create_purchase_invoice_from_po_receipts(
  p_po_id uuid, p_no_faktur_prefix text, p_no_faktur_digits integer, p_no_faktur_pemasok text,
  p_tanggal date, p_jatuh_tempo date, p_keterangan text, p_items jsonb, p_layer_updates jsonb,
  p_layer_inserts jsonb, p_ppn numeric, p_request_key text, p_replaces_invoice_id uuid, p_receipt_ids uuid[]
) returns table(invoice_id uuid, no_faktur character varying, no_jurnal character varying, total numeric)
language plpgsql security definer set search_path = '' as $$
declare v_ids uuid[]; replay boolean; created record; v_invoice uuid; bad text; po public.purchase_orders%rowtype;
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' then
    raise exception 'Sesi login diperlukan' using errcode = '42501';
  end if;
  if p_receipt_ids is null or array_position(p_receipt_ids, null) is not null or cardinality(p_receipt_ids) > 500 then
    raise exception 'Daftar penerimaan faktur tidak valid. Muat ulang formulir' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct x order by x), '{}') into v_ids from unnest(p_receipt_ids) x;
  if cardinality(v_ids) <> cardinality(p_receipt_ids) then
    raise exception 'Penerimaan dipilih lebih dari sekali' using errcode = '22023';
  end if;
  -- Same lock order as receipt posting/cancellation and invoice posting: PO first, then receipts.
  select * into po from public.purchase_orders where id = p_po_id for update;
  perform 1 from public.goods_receipts g where g.id = any (v_ids) order by g.id for update;
  replay := exists (select 1 from public.purchase_operations o
    where o.actor_id = auth.uid() and o.kind = 'invoice' and o.request_key = p_request_key);
  if not replay then
    if exists (select 1 from unnest(v_ids) x left join public.goods_receipts g on g.id = x
               where g.id is null or g.po_id is distinct from p_po_id or g.voided_at is not null) then
      raise exception 'Penerimaan yang dipilih tidak ditemukan, bukan milik PO ini, atau sudah dibatalkan. Muat ulang' using errcode = '22023';
    end if;
    select string_agg(g.no_terima || ' (faktur ' || i.no_faktur || ')', ', ' order by g.no_terima) into bad
      from public.purchase_invoice_receipts l
      join public.goods_receipts g on g.id = l.goods_receipt_id
      join public.purchase_invoices i on i.id = l.invoice_id
      where l.goods_receipt_id = any (v_ids) and l.active;
    if bad is not null then
      raise exception 'Penerimaan sudah ditagih di faktur aktif lain: %', bad using errcode = '23505';
    end if;
    -- An active invoice without stored receipts (older invoice) may already cover any receipt of
    -- this PO; a new link would be a guess, so receipts of such a PO cannot be claimed.
    if cardinality(v_ids) > 0 and exists (select 1 from public.purchase_invoices i
        where i.po_id = p_po_id and i.voided_at is null
          and not exists (select 1 from public.purchase_invoice_receipts l where l.invoice_id = i.id)) then
      raise exception 'PO ini punya faktur lama aktif tanpa catatan penerimaan; penerimaannya tidak bisa dipilih. Simpan faktur tanpa memilih penerimaan' using errcode = '22023';
    end if;
  end if;

  select * into created from public.create_purchase_invoice_from_po(p_po_id, p_no_faktur_prefix, p_no_faktur_digits,
    p_no_faktur_pemasok, p_tanggal, p_jatuh_tempo, p_keterangan, p_items, p_layer_updates, p_layer_inserts, p_ppn,
    p_request_key, p_replaces_invoice_id);
  v_invoice := created.invoice_id;

  if replay then
    -- Lost response / double submit: same invoice, and the stored receipt choice must be the same.
    if (select coalesce(array_agg(l.goods_receipt_id order by l.goods_receipt_id), '{}')
        from public.purchase_invoice_receipts l where l.invoice_id = v_invoice) is distinct from v_ids then
      raise exception 'Kunci faktur sudah dipakai dengan pilihan penerimaan berbeda. Periksa hasil terakhir' using errcode = '22023';
    end if;
  else
    insert into public.purchase_invoice_receipts(invoice_id, goods_receipt_id, po_id, created_by)
      select v_invoice, x, p_po_id, auth.uid() from unnest(v_ids) x;
    -- Every receipt whose stock value this invoice repriced must be selected, unless it is the
    -- remainder of a receipt already linked to another active invoice. Receipt layers carry the
    -- receipt's own created_at/tanggal (the same proof cancel_goods_receipt relies on).
    select string_agg(distinct g.no_terima, ', ') into bad
      from public.purchase_invoice_layer_proofs pr
      join public.stock_layers l on l.id = pr.layer_id
      join public.goods_receipts g on g.po_id = p_po_id and g.voided_at is null
        and g.created_at = l.created_at and g.tanggal = l.tanggal
      where pr.invoice_id = v_invoice and pr.before_state is not null
        and l.source = 'purchase' and l.source_ref = po.no_po and l.warehouse_id = po.to_warehouse_id
        and not (g.id = any (v_ids))
        and not exists (select 1 from public.purchase_invoice_receipts o
          where o.goods_receipt_id = g.id and o.active and o.invoice_id <> v_invoice);
    if bad is not null then
      raise exception 'Faktur ini memakai nilai stok dari penerimaan % yang belum dipilih. Pilih penerimaan itu juga (stok ditagih mulai dari penerimaan terlama)', bad
        using errcode = '22023';
    end if;
  end if;
  return query select created.invoice_id, created.no_faktur::character varying, created.no_jurnal::character varying, created.total;
end $$;
revoke all on function public.create_purchase_invoice_from_po_receipts(uuid, text, integer, text, date, date, text, jsonb, jsonb, jsonb, numeric, text, uuid, uuid[])
  from public, anon, service_role;
grant execute on function public.create_purchase_invoice_from_po_receipts(uuid, text, integer, text, date, date, text, jsonb, jsonb, jsonb, numeric, text, uuid, uuid[])
  to authenticated;

do $upgrade$
declare definition text; h text; anchor text;
  main_hash constant text := '03b31359e9f7b0764993761c9074a411';
  applied_hash constant text := '665ae8b79fd6051032c827d984c8d641';
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
  layer_anchor constant text := $old$  if exists (select 1 from jsonb_array_elements(moves) x where not ((x->>'item_id')::uuid = any (v_items)) or (x->>'qty')::numeric <= 0)$old$;
  layer_guard constant text := $new$  -- N01: an active invoice (of another receipt) may have repriced this receipt's layers.
  if exists (select 1 from public.purchase_invoice_layer_proofs pr join public.purchase_invoices i on i.id = pr.invoice_id
             where i.voided_at is null and pr.layer_id in (select (x->>'id')::uuid from jsonb_array_elements(layers) x)) then
    raise exception 'Nilai stok penerimaan ini sudah dipakai faktur pembelian aktif. Batalkan fakturnya dulu, atau gunakan Retur Pembelian bila barang dikembalikan ke pemasok.';
  end if;
$new$;
  billed_anchor constant text := $old$  select bool_and(coalesce(qty_terima, 0) >= qty) into v_complete from public.purchase_order_items where po_id = po.id;$old$;
  billed_guard constant text := $new$  -- N01: active invoices of this PO must still be covered by what remains received.
  if exists (select 1 from public.purchase_order_items pi where pi.po_id = po.id
             and (select coalesce(sum(ii.qty * ii.faktor), 0) from public.purchase_invoice_items ii join public.purchase_invoices i on i.id = ii.invoice_id
                  where i.po_id = po.id and i.voided_at is null and ii.po_item_id = pi.id) > coalesce(pi.qty_terima, pi.qty) * pi.faktor) then
    raise exception 'Faktur pembelian aktif di PO ini menagih lebih banyak dari barang yang tersisa bila penerimaan ini dibatalkan. Batalkan atau koreksi fakturnya dulu.';
  end if;
$new$;
begin
  definition := pg_get_functiondef('public.cancel_goods_receipt(uuid,text,text,date)'::regprocedure);
  h := md5(definition);
  if h = applied_hash then return; end if;
  if h <> main_hash then raise exception 'cancel_goods_receipt differs from main (md5 %); stop and review', h; end if;
  foreach anchor in array array[invoice_block, layer_anchor, billed_anchor] loop
    if (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 then
      raise exception 'N01: anchor cancel_goods_receipt tidak unik/tidak ditemukan; migrasi dihentikan';
    end if;
  end loop;
  definition := replace(definition, invoice_block, invoice_block_new);
  definition := replace(definition, layer_anchor, layer_guard || layer_anchor);
  definition := replace(definition, billed_anchor, billed_guard || billed_anchor);
  execute definition;
  h := md5(pg_get_functiondef('public.cancel_goods_receipt(uuid,text,text,date)'::regprocedure));
  if h <> applied_hash then raise exception 'cancel_goods_receipt patch result unexpected (md5 %)', h; end if;
end $upgrade$;
