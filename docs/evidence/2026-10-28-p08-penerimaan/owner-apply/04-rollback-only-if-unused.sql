-- P08 PEMBATALAN PENERIMAAN — ROLLBACK, WRITES. Only on an explicit rollback decision.
-- Refuses (and changes nothing) once any receipt was cancelled: that history must stay. In that case run
-- 05-freeze-if-used.sql instead, which only stops new cancellations.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $$
declare body text;
begin
  if current_user <> 'postgres' then
    raise exception 'P08 rollback must run as postgres (current role: %); nothing was changed', current_user;
  end if;
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261028190000') <> 1 then
    raise exception 'P08_NOT_APPLIED: history row missing; nothing was changed';
  end if;
  if exists (select 1 from public.purchase_receipt_cancellations) or exists (select 1 from public.goods_receipts where voided_at is not null)
     or exists (select 1 from public.stock_moves where source = 'purchase-receipt-void')
     or exists (select 1 from public.journal_entries where source = 'purchase-receipt-void') then
    raise exception 'P08_IN_USE: a receipt was already cancelled; rollback refused. Use 05-freeze-if-used.sql';
  end if;
  select pg_get_functiondef('public.inventory_record_valuation()'::regprocedure) into body;
  if position($q$new.source in('purchase-invoice-void','purchase-receipt-void')$q$ in body) = 0 then
    raise exception 'P08_DRIFT: inventory_record_valuation changed after apply; nothing was changed';
  end if;
  execute replace(body, $q$new.source in('purchase-invoice-void','purchase-receipt-void')$q$, $q$new.source='purchase-invoice-void'$q$);
  select pg_get_functiondef('public.inventory_effective_unit_cost(uuid,uuid)'::regprocedure) into body;
  if position(' and not public.stock_move_cost_was_reversed(m.id)' in body) = 0 then
    raise exception 'P08_DRIFT: inventory_effective_unit_cost changed after apply; nothing was changed';
  end if;
  execute replace(body, ' and not public.stock_move_cost_was_reversed(m.id)', '');
  select pg_get_functiondef('public.stock_out_fifo(uuid,uuid,numeric,text,text,date)'::regprocedure) into body;
  if position(' and not public.stock_move_cost_was_reversed(id)' in body) = 0 then
    raise exception 'P08_DRIFT: stock_out_fifo changed after apply; nothing was changed';
  end if;
  execute replace(body, ' and not public.stock_move_cost_was_reversed(id)', '');
end $$;
-- Original body from 20261021020000_negative_stock_hpp.sql (invoice proofs only).
create or replace function public.stock_layer_cost_was_reversed(p_layer_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.purchase_invoice_layer_proofs proof
    join public.purchase_invoices invoice on invoice.id = proof.invoice_id
    where proof.layer_id = p_layer_id and proof.before_state is null
      and invoice.voided_at is not null
  );
$$;
drop function public.stock_move_cost_was_reversed(uuid);
drop function public.cancel_goods_receipt(uuid, text, text, date);
drop trigger purchase_receipt_void_move_guard on public.stock_moves;
drop trigger purchase_receipt_void_journal_guard on public.journal_entries;
drop trigger purchase_receipt_void_journal_lines_guard on public.journal_lines;
drop function public.guard_purchase_receipt_void_effect();
drop trigger goods_receipt_void_guard on public.goods_receipts;
drop trigger goods_receipt_item_void_guard on public.goods_receipt_items;
drop function public.guard_goods_receipt_void();
drop table public.purchase_receipt_cancellations;
drop function public.guard_purchase_receipt_cancellation_immutable();
alter table public.goods_receipts drop column voided_at, drop column voided_on, drop column voided_by, drop column void_reason, drop column reversal_journal_id;
delete from supabase_migrations.schema_migrations where version = '20261028190000';
commit;
