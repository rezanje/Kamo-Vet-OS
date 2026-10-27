-- M05 ROLLBACK — WRITES. Only on a release decision, and only while NO batch has been posted.
-- Refuses (M05_ROLLBACK_REFUSED) as soon as any opening invoice exists: those are financial records
-- (invoices, payments, journal) and are never deleted by a rollback. One transaction; any error = no change.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $$ begin
  if current_user <> 'postgres' then raise exception 'M05 rollback must run as postgres (current role: %); nothing was changed', current_user; end if;
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261027180000') <> 1 then
    raise exception 'M05_ROLLBACK_NOT_APPLIED: history row 20261027180000 missing; nothing was changed'; end if;
end $$;
lock table public.opening_invoice_batches, public.purchase_invoices, public.sales_invoices in share row exclusive mode;
do $$ begin
  if exists(select 1 from public.opening_invoice_batches) or exists(select 1 from public.opening_invoice_lines)
   or exists(select 1 from public.purchase_invoices where opening_batch_id is not null)
   or exists(select 1 from public.sales_invoices where opening_batch_id is not null) then
    raise exception 'M05_ROLLBACK_REFUSED: opening invoices already posted; nothing was changed'; end if;
end $$;
drop trigger opening_invoice_guard on public.purchase_invoices;
drop trigger opening_invoice_guard on public.sales_invoices;
drop trigger opening_invoice_guard on public.purchase_invoice_items;
drop trigger opening_invoice_guard on public.sales_invoice_items;
drop trigger opening_invoice_journal_guard on public.journal_entries;
drop trigger opening_invoice_journal_lines_guard on public.journal_lines;
drop trigger opening_invoice_saldo_awal_guard on public.journal_lines;
drop function public.post_opening_invoices(jsonb, text, text);
drop function public.preview_opening_invoices(jsonb);
drop function public.opening_invoice_review(jsonb);
drop function public.guard_saldo_awal_opening_invoices();
drop function public.guard_opening_invoice_journal();
drop function public.guard_opening_invoice();
alter table public.purchase_invoices drop constraint purchase_invoices_asal_check;
alter table public.purchase_invoices add constraint purchase_invoices_asal_check check (po_id is not null or warehouse_id is not null);
alter table public.purchase_invoices drop column opening_batch_id;
alter table public.sales_invoices drop column opening_batch_id;
drop table public.opening_invoice_lines;
drop table public.opening_invoice_batches;
drop function public.opening_invoice_norm(text);
delete from supabase_migrations.schema_migrations where version = '20261027180000';
commit;
