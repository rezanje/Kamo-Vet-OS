-- PR #310 batch 2 (P03/J02/N01/K08/K14/C05/I09/M04) ROLLBACK — WRITES. Only on an explicit decision to step back
-- after apply.sql. Roll back batch 2 BEFORE batch 1, never the other way round.
--
-- Restores, exactly as saved by apply.sql on this database: the 16 replaced functions (definition and grants), the
-- trigger invoices.c05_invoice_campaign_code, the read policy of sale_payment_corrections, the items tindakan_kategori
-- check and the wholesale request kind check. Removes what batch 2 created: 12 functions, 4 tables, 3 columns, the new
-- indexes and triggers, the 2 activity log sources, the seeded "Pet Hotel (per hari)" service, the 10 history rows and
-- its backup table (the vetos_release schema too, when nothing else is in it). One transaction; any error = nothing
-- changed.
--
-- Refuses (PR310B2_ROLLBACK_HAS_DATA) once the new features hold real records — clinic payment corrections, wholesale
-- returns, group-visit companion invoices, POS corrections stamped with a shift status, a used or extra Pet Hotel
-- service. Those records would be lost; fix forward instead. Activity log rows already captured stay.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
do $rollback$
declare
  r record;
  g record;
  n bigint;
  cur text;
begin
  if current_user <> 'postgres' then
    raise exception 'PR310B2_ROLLBACK: must run as postgres';
  end if;
  if to_regclass('vetos_release.pr310_batch2_backup') is null then
    raise exception 'PR310B2_ROLLBACK: backup vetos_release.pr310_batch2_backup not found (apply.sql not run here?)';
  end if;
  if (select count(*) from vetos_release.pr310_batch2_backup where kind = 'function') <> 16
     or (select count(*) from vetos_release.pr310_batch2_backup where kind = 'acl') <> 16 then
    raise exception 'PR310B2_ROLLBACK: function backup incomplete';
  end if;

  -- 0. Refuse when the new features already hold business records.
  select (select count(*) from public.clinic_payment_corrections) + (select count(*) from public.clinic_payment_correction_requests)
       + (select count(*) from public.wholesale_returns) + (select count(*) from public.wholesale_return_items)
       + (select count(*) from public.wholesale_operation_requests where kind in ('return', 'return-void'))
       + (select count(*) from public.sales_invoices where returned_ar <> 0)
       + (select count(*) from public.invoices where campaign_carrier_id is not null)
       + (select count(*) from public.sale_payment_corrections where source_shift_status is not null)
       + (select count(*) from public.items i where i.tindakan_kategori = 'Pet Hotel'
            and not exists(select 1 from vetos_release.pr310_batch2_backup b where b.kind = 'seeded_item' and b.name = i.id::text))
    into n;
  if n > 0 then
    raise exception 'PR310B2_ROLLBACK_HAS_DATA: % record(s) already use batch 2 features; rollback would lose them', n;
  end if;

  -- 1. Replaced functions back to their pre-apply definitions (CREATE OR REPLACE keeps owner), then their grants.
  for r in select name, payload from vetos_release.pr310_batch2_backup where kind = 'function' loop
    execute r.payload;
  end loop;
  for r in select name, payload from vetos_release.pr310_batch2_backup where kind = 'acl' loop
    select proacl::text into cur from pg_proc where oid = r.name::regprocedure;
    continue when cur is not distinct from r.payload;
    for g in select distinct a.grantee from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
             where p.oid = r.name::regprocedure and a.grantee <> p.proowner loop
      execute format('revoke all on function %s from %s', r.name,
        case when g.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(g.grantee)) end);
    end loop;
    for g in select distinct a.grantee from pg_proc p, aclexplode(coalesce(r.payload::aclitem[], acldefault('f', p.proowner))) a
             where p.oid = r.name::regprocedure and a.grantee <> p.proowner and a.privilege_type = 'EXECUTE' loop
      execute format('grant execute on function %s to %s', r.name,
        case when g.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(g.grantee)) end);
    end loop;
  end loop;

  -- 2. Triggers on existing tables: J02/N01 ones dropped, C05 trigger recreated as saved.
  drop trigger if exists clinic_payment_corrected_invoice_guard on public.invoices;
  drop trigger if exists wholesale_returned_ar_guard on public.sales_invoices;
  drop trigger if exists wholesale_invoice_return_guard on public.sales_invoices;
  drop trigger if exists wholesale_return_journal_guard on public.journal_entries;
  drop trigger if exists wholesale_return_journal_line_guard on public.journal_lines;
  drop trigger if exists wholesale_return_stock_move_guard on public.stock_moves;
  drop trigger if exists wholesale_return_stock_layer_guard on public.stock_layers;
  drop trigger if exists c05_invoice_campaign_code on public.invoices;
  for r in select payload from vetos_release.pr310_batch2_backup where kind = 'trigger' and name = 'invoices.c05_invoice_campaign_code' loop
    execute r.payload;
  end loop;

  -- 3. New tables (their policies, triggers and indexes go with them), then new functions.
  drop table public.wholesale_return_items;
  drop table public.wholesale_returns;
  drop table public.clinic_payment_correction_requests;
  drop table public.clinic_payment_corrections;
  drop function clinic_private.assert_invoice_price_floor(uuid, numeric, numeric);
  drop function clinic_private.rupiah_text(numeric);
  drop function public.guard_clinic_payment_corrected_invoice();
  drop function public.correct_clinic_invoice_payment(uuid, uuid, integer, text, text, text);
  drop function public.guard_wholesale_return_record();
  drop function public.guard_wholesale_returned_ar();
  drop function public.guard_wholesale_invoice_with_return();
  drop function public.guard_wholesale_return_effect();
  drop function public.post_wholesale_return(text, uuid, date, uuid, text, jsonb);
  drop function public.void_wholesale_return(uuid, integer, text, text);
  drop function public.voucher_wajib_lewat_kampanye(text);
  drop function public.read_compound_parent_history(uuid, date, date, integer, integer);

  -- 4. New columns (the C05 partial index goes with its column) and the I09 index.
  alter table public.invoices drop column campaign_carrier_id;
  alter table public.sales_invoices drop column returned_ar;
  alter table public.sale_payment_corrections drop column source_shift_status;
  if not exists(select 1 from vetos_release.pr310_batch2_backup where kind = 'index' and name = 'clinic_compound_sales_sale_item_idx') then
    drop index if exists public.clinic_compound_sales_sale_item_idx;
  end if;

  -- 5. Checks: wholesale request kinds; seeded Pet Hotel service removed, then items check as saved.
  alter table public.wholesale_operation_requests drop constraint wholesale_operation_requests_kind_check;
  for r in select payload from vetos_release.pr310_batch2_backup
           where kind = 'constraint' and name like '%.wholesale_operation_requests_kind_check' loop
    execute format('alter table public.wholesale_operation_requests add constraint wholesale_operation_requests_kind_check %s', r.payload);
  end loop;
  begin
    -- Master rows are never deleted by the app (guard_master_lifecycle); this one is release scaffolding.
    alter table public.items disable trigger guard_master_lifecycle;
    delete from public.items i using vetos_release.pr310_batch2_backup b
     where b.kind = 'seeded_item' and b.name = i.id::text;
    alter table public.items enable trigger guard_master_lifecycle;
  exception when foreign_key_violation then
    raise exception 'PR310B2_ROLLBACK_HAS_DATA: layanan Pet Hotel sudah dipakai transaksi; rollback would lose them';
  end;
  alter table public.items drop constraint items_tindakan_kategori_check;
  for r in select name, payload from vetos_release.pr310_batch2_backup where kind = 'constraint' and name like 'items.%' loop
    execute format('alter table public.items add constraint %I %s', split_part(r.name, '.', 2), r.payload);
  end loop;

  -- 6. Read policy of POS payment corrections as saved.
  drop policy if exists sale_payment_corrections_finance_read on public.sale_payment_corrections;
  for r in select name, payload from vetos_release.pr310_batch2_backup where kind = 'policy' loop
    if not exists(select 1 from pg_policy where polrelid = 'public.sale_payment_corrections'::regclass and polname = r.name) then
      execute r.payload;
    end if;
  end loop;

  -- 7. Activity log sources that apply added.
  delete from public.activity_log_sources s
   where s.entity in ('wholesale_returns', 'wholesale_return_items')
     and not exists(select 1 from vetos_release.pr310_batch2_backup b where b.kind = 'source' and b.name = s.entity);

  -- 8. History and backup.
  delete from supabase_migrations.schema_migrations where version in ('20261101100000', '20261101110000', '20261101111000',
    '20261101130000', '20261101140000', '20261101141000', '20261101150000', '20261101151000', '20261101152000', '20261101160000');
  drop table vetos_release.pr310_batch2_backup;
  if not exists(select 1 from pg_class where relnamespace = 'vetos_release'::regnamespace) then
    drop schema vetos_release;
  end if;
end
$rollback$;
commit;
