-- P02 ROLLBACK — WRITES. Only after an explicit owner decision, and only while NO correction was saved
-- (after a real correction its journals/stock layers must stay; roll forward instead).
-- Undo the app first (the correction page then only shows an error). One transaction.
begin;
do $guard$ begin
 if to_regclass('public.purchase_invoice_corrections') is not null and exists(select 1 from public.purchase_invoice_corrections) then
  raise exception 'P02 rollback refused: corrections exist; roll forward instead';
 end if;
end $guard$;
drop function if exists public.correct_purchase_invoice_line(text,uuid,integer,numeric,numeric,date,text,jsonb);
drop function if exists public.preview_purchase_invoice_line_correction(uuid,numeric,numeric,date);
drop function if exists public.purchase_invoice_line_correction_run(uuid,numeric,numeric,date,text,text,jsonb,boolean);
drop trigger if exists purchase_invoice_correction_journal_guard on public.journal_entries;
drop trigger if exists purchase_invoice_correction_journal_lines_guard on public.journal_lines;
drop function if exists public.guard_purchase_invoice_correction_journal();
drop table if exists public.purchase_invoice_correction_layers;
drop table if exists public.purchase_invoice_corrections;
commit;
