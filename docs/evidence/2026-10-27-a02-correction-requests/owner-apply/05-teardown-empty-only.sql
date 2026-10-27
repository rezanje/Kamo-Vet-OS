-- A02 TEARDOWN — WRITES. Only for an owner decision to remove A02 entirely BEFORE any real request exists.
-- Refuses (and changes nothing) if the request table holds any row or any request was ever recorded in the
-- activity log; then use 04-freeze-if-decided.sql and keep the data. Removes only objects the A02 migration created, plus its history row. One transaction.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.purchase_correction_requests in access exclusive mode;
do $$
begin
  if exists (select 1 from public.purchase_correction_requests) then
    raise exception 'A02 teardown refused: purchase_correction_requests has rows; freeze with 04 and keep the data';
  end if;
  if exists (select 1 from public.activity_log where row_entity = 'purchase_correction_requests') then
    raise exception 'A02 teardown refused: request activity history exists; freeze with 04 and keep the data';
  end if;
end $$;
drop trigger a01_activity_change on public.purchase_correction_requests;
drop trigger a01_activity_delete on public.purchase_correction_requests;
delete from public.activity_log_sources where entity = 'purchase_correction_requests';
drop function public.process_purchase_correction_request(uuid,text);
drop function public.create_purchase_correction_request(text,uuid,text,text);
drop table public.purchase_correction_requests;
drop function public.purchase_correction_request_visible(uuid,uuid);
drop function public.purchase_module_access();
delete from supabase_migrations.schema_migrations where version = '20261027153000';
commit;
