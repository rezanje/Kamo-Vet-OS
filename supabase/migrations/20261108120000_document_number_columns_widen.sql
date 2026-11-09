-- Widen the document-number columns that were sized 24 characters while their generators can produce more.
-- apply as ONE transaction (the Supabase CLI runs this file in one; there is no begin/commit in it).
--
-- Why: a new Purchase Order number is PO-YYYYMMDD-<branch code>-NNNN (create_purchase_order_atomic, migration
-- 20261023063921). That is 25 characters for the eight-character clinic branch codes (VET_CMGG, VET_GRLG, VET_PDRY,
-- VET_CIAW, VET_GRDA, VET_GRND, VET_SRKN), while purchase_orders.no_po is varchar(24): the insert failed with
-- "value too long for type character varying(24)" (22001). The function itself allows up to 30 characters.
-- The same sizing sits on the other numbers whose format is set in Pengaturan > Penomoran Dokumen (prefix up to
-- 30 characters plus up to 8 digits, plus the 4-character collision suffix of the app fallback).
--
-- Scope (ONLY these eight columns, varchar(24) -> varchar(64), a catalog-only change: no rewrite, no existing value
-- touched, unique constraints and indexes kept):
--   purchase_orders.no_po, sales.no_struk, invoices.invoice_no, point_ledger.ref, stock_requests.no_request,
--   stock_receipts.receipt_number, cash_entries.no_bukti, cash_transfers.no_transfer
-- Deliberately NOT widened: fixed-format or fixed-vocabulary columns (journal_entries.no_jurnal/source,
-- stock_moves.source, stock_layers.source, role_modules.module_id, ...) and the promo/voucher code columns, which carry
-- their own format constraint. No function, view, policy or trigger is touched; none of the eight columns has a
-- dependent view, rule or policy, and no function declares a fixed-size variable for them.
set local lock_timeout='5s';

do $widen$
declare
 w record;
 v_len integer;
 v_type text;
 v_idx_before text;
 v_idx_after text;
begin
 for w in select * from (values
   ('purchase_orders','no_po'),('sales','no_struk'),('invoices','invoice_no'),('point_ledger','ref'),
   ('stock_requests','no_request'),('stock_receipts','receipt_number'),('cash_entries','no_bukti'),('cash_transfers','no_transfer')
  ) x(tbl,col) loop
  select c.data_type,c.character_maximum_length into v_type,v_len
    from information_schema.columns c where c.table_schema='public' and c.table_name=w.tbl and c.column_name=w.col;
  if v_type is distinct from 'character varying' then
   raise exception 'WIDEN_COLUMN_MISSING_OR_NOT_VARCHAR %.%',w.tbl,w.col;
  end if;
  if v_len>=64 then continue; end if;
  if v_len<>24 then raise exception 'WIDEN_UNEXPECTED_LENGTH %.% %',w.tbl,w.col,v_len; end if;
  if exists(select 1 from pg_depend d join pg_rewrite r on r.oid=d.objid and d.classid='pg_rewrite'::regclass
             join pg_attribute a on a.attrelid=d.refobjid and a.attnum=d.refobjsubid
            where d.refobjid=format('public.%I',w.tbl)::regclass and a.attname=w.col) then
   raise exception 'WIDEN_DEPENDENT_VIEW_OR_RULE %.%',w.tbl,w.col;
  end if;
  select coalesce(string_agg(indexdef,'|' order by indexname),'') into v_idx_before from pg_indexes where schemaname='public' and tablename=w.tbl;
  execute format('alter table public.%I alter column %I type varchar(64)',w.tbl,w.col);
  select coalesce(string_agg(indexdef,'|' order by indexname),'') into v_idx_after from pg_indexes where schemaname='public' and tablename=w.tbl;
  if v_idx_before is distinct from v_idx_after then raise exception 'WIDEN_INDEX_DEFINITIONS_CHANGED %.%',w.tbl,w.col; end if;
  select c.character_maximum_length into v_len from information_schema.columns c
   where c.table_schema='public' and c.table_name=w.tbl and c.column_name=w.col;
  if v_len<>64 then raise exception 'WIDEN_NOT_APPLIED %.%',w.tbl,w.col; end if;
 end loop;
end
$widen$;
