-- PR #310 (K08 + A01 + Q01) ROLLBACK — WRITES. Only on an explicit decision to step back after apply.sql.
-- Restores the two patched functions exactly as they were on this database before apply (saved by apply.sql),
-- removes the Q01 recovery function and index, the A01 triggers and source rows that apply added (pre-existing
-- triggers are recreated exactly as saved, pre-existing source rows stay), the three history rows, and its backup table (the vetos_release schema too, when nothing else is in it). One transaction; any error = nothing changed.
-- Activity log rows already captured stay (history, not behaviour). Application code tolerates the rollback:
-- Q01 recovery calls are logged and skipped.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
do $rollback$
declare
  r record;
  tbl text;
  trg text;
  new_sources constant text[] := array['campaign_codes','payslip_templates','payslip_template_components','employee_payslip_templates',
    'employee_base_salaries','service_commission_policies','branch_grooming_rules','opening_invoice_batches','opening_invoice_lines',
    'recurring_journal_sources','clinic_refund_items','clinic_record_addenda','inpatient_rx_evidence','inpatient_rx_evidence_settings',
    'purchase_invoice_receipts','quest_new_customer_claims'];
begin
  if current_user <> 'postgres' then
    raise exception 'PR310_ROLLBACK: must run as postgres';
  end if;
  if to_regclass('vetos_release.pr310_backup') is null then
    raise exception 'PR310_ROLLBACK: backup vetos_release.pr310_backup not found (apply.sql not run here?)';
  end if;
  if (select count(*) from vetos_release.pr310_backup where kind = 'function') <> 2 then
    raise exception 'PR310_ROLLBACK: function backup incomplete';
  end if;
  -- 1. Functions back to their pre-apply definitions (CREATE OR REPLACE keeps owner and grants).
  for r in select name, payload from vetos_release.pr310_backup where kind = 'function' loop
    execute r.payload;
  end loop;
  -- 2. Q01 recovery objects.
  drop function if exists public.apply_pending_sale_staff_effects();
  drop index if exists public.sales_staff_effects_pending_idx;
  -- 3. A01 triggers back to their pre-apply state.
  foreach tbl in array new_sources || array['clinic_refund_requests','clinic_refunds','clinic_history_reads'] loop
    foreach trg in array array['a01_activity_change','a01_activity_delete'] loop
      -- Added by apply: dropped. Pre-existing (A01 may have widened it): recreated exactly as saved.
      execute format('drop trigger if exists %I on public.%I', trg, tbl);
      for r in select payload from vetos_release.pr310_backup where kind = 'trigger' and name = tbl || '.' || trg loop
        execute r.payload;
      end loop;
    end loop;
  end loop;
  -- 4. A01 source rows that apply added.
  delete from public.activity_log_sources s
   where s.entity = any(new_sources)
     and not exists(select 1 from vetos_release.pr310_backup b where b.kind = 'source' and b.name = s.entity);
  -- 5. History and backup.
  delete from supabase_migrations.schema_migrations where version in ('20261030110000','20261030111000','20261030112000');
  drop table vetos_release.pr310_backup;
  if not exists(select 1 from pg_class where relnamespace = 'vetos_release'::regnamespace) then
    drop schema vetos_release;
  end if;
end
$rollback$;
commit;
