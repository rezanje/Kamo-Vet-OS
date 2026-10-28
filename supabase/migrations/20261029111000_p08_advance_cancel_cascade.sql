-- P08: one-step cancel of a purchase advance (uang muka) that is already used, plus
-- "cancelled receipts must not freeze the PO".
--
-- * purchase_advance_cascade_plan(advance): the exact payments that will be reversed: every active
--   payment that used the advance, together with every payment that shares its journal (a payment
--   order is reversed as its whole group, exactly as cancel_purchase_payment does today).
-- * preview_purchase_advance_cascade(advance): OWNER-only read of that plan + a fingerprint.
-- * cancel_purchase_advance_cascade(advance, reason, request_key[, expected fingerprint]):
--   OWNER-only, one transaction: lock PO then advance (same order as cancel_purchase_advance_atomic),
--   run the existing cancel_purchase_payment for each payment that used it (oldest first; a group
--   already reversed with an earlier payment is skipped), then the existing
--   cancel_purchase_advance_atomic. Idempotent per (actor, request_key). No accounting is
--   re-implemented: every journal, advance balance and payment-order state comes from the existing RPCs.
-- * Receipt locks: guard_purchase_advance_receipt (new DP), revise_purchase_order (edit/void PO) and
--   revise_purchase_order_prices (price revision) only counted the existence of goods_receipts.
--   A receipt cancelled through cancel_goods_receipt (P08) has already reversed its stock, journal and
--   PO quantities, so it no longer freezes the PO: those checks now ignore voided receipts.
-- Provenance: each patched body must match main's exact md5 (pg_get_functiondef, same on the hosted
-- PG17.6 and local PG16/17) or this migration's own result; anything else aborts.

create table if not exists public.purchase_advance_cascade_cancellations (
  actor_id uuid not null references public.profiles(id),
  request_key text not null check (length(request_key) between 1 and 120),
  advance_id uuid not null references public.purchase_advances(id),
  payload jsonb not null,
  reason text not null check (length(btrim(reason)) between 3 and 1000),
  plan jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (actor_id, request_key)
);
create index if not exists purchase_advance_cascade_cancellations_advance on public.purchase_advance_cascade_cancellations(advance_id);
alter table public.purchase_advance_cascade_cancellations enable row level security;
revoke all on public.purchase_advance_cascade_cancellations from public, anon, authenticated, service_role;

create or replace function public.guard_purchase_advance_cascade_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'Bukti pembatalan uang muka tidak dapat diubah atau dihapus' using errcode = '42501'; end $$;
revoke all on function public.guard_purchase_advance_cascade_immutable() from public, anon, authenticated, service_role;
drop trigger if exists purchase_advance_cascade_immutable on public.purchase_advance_cascade_cancellations;
create trigger purchase_advance_cascade_immutable before update or delete on public.purchase_advance_cascade_cancellations
  for each row execute function public.guard_purchase_advance_cascade_immutable();
drop trigger if exists purchase_advance_cascade_no_truncate on public.purchase_advance_cascade_cancellations;
create trigger purchase_advance_cascade_no_truncate before truncate on public.purchase_advance_cascade_cancellations
  for each statement execute function public.guard_purchase_advance_cascade_immutable();

-- Internal: no grants. Rows ordered oldest first; `group_key` = journal (or the payment itself when
-- an old payment has no journal link; cancel_purchase_payment then refuses it with its own message).
create or replace function public.purchase_advance_cascade_plan(p_advance_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with used as (
    select p.id, coalesce(p.journal_id::text, p.id::text) group_key
    from public.purchase_invoice_payments p
    where p.advance_id = p_advance_id and p.dari_uang_muka > 0 and p.reversal_of is null and p.voided_at is null
  ), rows as (
    select p.*, coalesce(p.journal_id::text, p.id::text) group_key
    from public.purchase_invoice_payments p
    where p.reversal_of is null and p.voided_at is null
      and (p.id in (select id from used) or (p.journal_id is not null and p.journal_id::text in (select group_key from used)))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'payment_id', r.id, 'group_key', r.group_key, 'revision', r.revision, 'tanggal', r.tanggal,
      'amount', r.amount, 'dari_uang_muka', r.dari_uang_muka, 'uses_this_advance', r.advance_id is not distinct from p_advance_id,
      'advance_id', r.advance_id, 'no_um', a.no_um,
      'invoice_id', r.invoice_id, 'no_faktur', i.no_faktur, 'invoice_voided', i.voided_at is not null,
      'payment_order_id', r.payment_order_id, 'no_pp', o.no_pp)
    order by r.created_at, r.id), '[]'::jsonb)
  from rows r
  join public.purchase_invoices i on i.id = r.invoice_id
  left join public.payment_orders o on o.id = r.payment_order_id
  left join public.purchase_advances a on a.id = r.advance_id;
$$;
revoke all on function public.purchase_advance_cascade_plan(uuid) from public, anon, authenticated, service_role;

create or replace function public.purchase_advance_cascade_fingerprint(p_plan jsonb, p_terpakai numeric) returns text
language sql immutable set search_path = '' as $$
  select md5(coalesce((select string_agg((x->>'payment_id') || ':' || (x->>'revision'), ',' order by x->>'payment_id')
    from jsonb_array_elements(p_plan) x), '') || '|' || coalesce(p_terpakai::text, ''));
$$;
revoke all on function public.purchase_advance_cascade_fingerprint(jsonb, numeric) from public, anon, authenticated, service_role;

create or replace function public.preview_purchase_advance_cascade(p_advance_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare adv public.purchase_advances%rowtype; plan jsonb;
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid() and role = 'OWNER' and is_active) then
    raise exception 'Pembatalan uang muka beserta pembayarannya hanya oleh Super Admin (OWNER)' using errcode = '42501';
  end if;
  perform public.purchase_advance_access(null);
  select * into adv from public.purchase_advances where id = p_advance_id;
  if not found then raise exception 'Uang muka tidak ditemukan' using errcode = '22023'; end if;
  if adv.po_id is not null and not exists (select 1 from public.purchase_orders where id = adv.po_id
     and (branch_id is null or public.user_can_access_branch(branch_id))) then
    raise exception 'Cabang uang muka tidak dapat diakses' using errcode = '42501';
  end if;
  plan := public.purchase_advance_cascade_plan(adv.id);
  return jsonb_build_object('advance_id', adv.id, 'no_um', adv.no_um, 'status', adv.status, 'jumlah', adv.jumlah,
    'terpakai', adv.terpakai, 'payments', plan, 'fingerprint', public.purchase_advance_cascade_fingerprint(plan, adv.terpakai));
end $$;
revoke all on function public.preview_purchase_advance_cascade(uuid) from public, anon, service_role;
grant execute on function public.preview_purchase_advance_cascade(uuid) to authenticated;

create or replace function public.cancel_purchase_advance_cascade(
  p_advance_id uuid, p_reason text, p_request_key text, p_expected_fingerprint text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  adv public.purchase_advances%rowtype; prior public.purchase_advance_cascade_cancellations%rowtype;
  v_reason text := btrim(coalesce(p_reason, '')); v_po uuid; payload jsonb; plan jsonb; pay record;
  reversed jsonb := '[]'::jsonb; advance_result jsonb; result jsonb; v_revision integer;
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' then
    raise exception 'Sesi login diperlukan' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'OWNER' and is_active) then
    raise exception 'Pembatalan uang muka beserta pembayarannya hanya oleh Super Admin (OWNER)' using errcode = '42501';
  end if;
  if p_advance_id is null or p_request_key is null or p_request_key <> btrim(p_request_key) or length(p_request_key) not between 1 and 120 then
    raise exception 'Identitas pembatalan tidak valid. Muat ulang halaman' using errcode = '22023';
  end if;
  if length(v_reason) not between 3 and 1000 then
    raise exception 'Alasan pembatalan wajib diisi (3 sampai 1.000 karakter)' using errcode = '22023';
  end if;
  payload := jsonb_build_object('advance_id', p_advance_id, 'reason', v_reason);
  perform pg_advisory_xact_lock(hashtextextended('vetos:purchase-advance-cascade:' || auth.uid()::text || ':' || p_request_key, 0));
  select * into prior from public.purchase_advance_cascade_cancellations where actor_id = auth.uid() and request_key = p_request_key;
  if found then
    if prior.payload is distinct from payload then
      raise exception 'Kunci pembatalan sudah dipakai dengan rincian berbeda. Muat ulang halaman' using errcode = '22023';
    end if;
    return prior.result;
  end if;

  select a.po_id into v_po from public.purchase_advances a where a.id = p_advance_id;
  if not found then raise exception 'Uang muka tidak ditemukan' using errcode = '22023'; end if;
  if v_po is not null then perform 1 from public.purchase_orders where id = v_po for update; end if;
  select * into adv from public.purchase_advances where id = p_advance_id for update;
  if adv.po_id is distinct from v_po then raise exception 'Sumber uang muka berubah; muat ulang' using errcode = '55000'; end if;
  perform public.purchase_advance_access(null);
  if adv.status <> 'aktif' then raise exception 'Uang muka ini sudah dibatalkan; periksa daftar' using errcode = '55000'; end if;

  plan := public.purchase_advance_cascade_plan(adv.id);
  if p_expected_fingerprint is not null and p_expected_fingerprint is distinct from public.purchase_advance_cascade_fingerprint(plan, adv.terpakai) then
    raise exception 'Pembayaran yang memakai uang muka ini berubah sejak pratinjau. Muat ulang dan periksa lagi' using errcode = '40001';
  end if;

  -- Oldest first. A payment inside a payment order is reversed with its whole group by
  -- cancel_purchase_payment; later rows of that group are then already voided and skipped.
  for pay in select (x.v->>'payment_id')::uuid id from jsonb_array_elements(plan) with ordinality x(v, n)
             where (x.v->>'uses_this_advance')::boolean order by x.n loop
    select p.revision into v_revision from public.purchase_invoice_payments p
      where p.id = pay.id and p.voided_at is null and p.reversal_of is null;
    continue when not found;
    reversed := reversed || jsonb_build_array(public.cancel_purchase_payment(pay.id, v_revision,
      'umc:' || md5(p_request_key) || ':' || pay.id::text, v_reason));
  end loop;

  if (select terpakai from public.purchase_advances where id = adv.id) <> 0 then
    raise exception 'Alokasi uang muka belum kembali nol setelah pembalikan; rekonsiliasi diperlukan' using errcode = '55000';
  end if;
  advance_result := public.cancel_purchase_advance_atomic(adv.id);
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'OWNER' and is_active) then
    raise exception 'Pembatalan uang muka beserta pembayarannya hanya oleh Super Admin (OWNER)' using errcode = '42501';
  end if;
  result := jsonb_build_object('advance_id', adv.id, 'no_um', adv.no_um, 'journal_id', advance_result->>'journal_id',
    'advance', advance_result, 'payments', reversed, 'payment_count', jsonb_array_length(reversed));
  insert into public.purchase_advance_cascade_cancellations(actor_id, request_key, advance_id, payload, reason, plan, result)
    values (auth.uid(), p_request_key, adv.id, payload, v_reason, plan, result);
  return result;
end $$;
revoke all on function public.cancel_purchase_advance_cascade(uuid, text, text, text) from public, anon, service_role;
grant execute on function public.cancel_purchase_advance_cascade(uuid, text, text, text) to authenticated;

-- Cancelled receipts no longer freeze the PO (new DP, PO edit/void, PO price revision).
do $upgrade$
declare definition text; h text; r record;
begin
  for r in select * from (values
    ('public.guard_purchase_advance_receipt()', 'e99841e188e4470563456bfdf89e162b', 'f1db6d1f5b115eb978de21b79c2cdd92',
      'public.goods_receipts where po_id = new.po_id)', 'public.goods_receipts where po_id = new.po_id and voided_at is null)'),
    ('public.revise_purchase_order(text,uuid,integer,text,jsonb,jsonb,text)', '1abc1231704fb392e3634065a1a4fa93', '7b10b6e7265dab80c707c2aa4789cc96',
      'public.goods_receipts where po_id=v_po.id)', 'public.goods_receipts where po_id=v_po.id and voided_at is null)'),
    ('public.revise_purchase_order_prices(text,uuid,integer,jsonb,text)', '2cd59070532a340c4e769deb243e9830', 'd09a46cf61d03bd584fced36f6c73386',
      'public.goods_receipts where po_id=po.id)', 'public.goods_receipts where po_id=po.id and voided_at is null)')
  ) v(sig, main_hash, applied_hash, anchor, replacement) loop
    definition := pg_get_functiondef(r.sig::regprocedure);
    h := md5(definition);
    continue when h = r.applied_hash;
    if h <> r.main_hash then raise exception '% differs from main (md5 %); stop and review', r.sig, h; end if;
    if (length(definition) - length(replace(definition, r.anchor, ''))) / length(r.anchor) <> 1 then
      raise exception 'P08: anchor % tidak unik/tidak ditemukan; migrasi dihentikan', r.sig;
    end if;
    execute replace(definition, r.anchor, r.replacement);
    h := md5(pg_get_functiondef(r.sig::regprocedure));
    if h <> r.applied_hash then raise exception '% patch result unexpected (md5 %)', r.sig, h; end if;
  end loop;
end $upgrade$;
