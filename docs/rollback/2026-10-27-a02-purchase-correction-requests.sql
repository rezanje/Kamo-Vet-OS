-- Reviewed operational rollback only; NOT executed on any target.
-- A02 purchase correction requests (migration 20261027153000_purchase_correction_requests.sql).
--
-- Step 1 (default): freeze. Stop new requests and processing, keep every stored request,
-- its follow-up note and the immutable activity log. Reading stays as before, so the queue
-- and source documents still show what was asked and what was done.
begin;
revoke execute on function public.create_purchase_correction_request(text,uuid,text,text) from authenticated;
revoke execute on function public.process_purchase_correction_request(uuid,text) from authenticated;
commit;

-- Step 2 (only when step 1 is not enough AND no real request exists): full removal.
-- Refuses to run when any request row exists; export and get owner approval first instead.
-- begin;
-- do $$ begin
--   if exists (select 1 from public.purchase_correction_requests) then
--     raise exception 'purchase_correction_requests has rows; export and get owner approval before removal';
--   end if;
-- end $$;
-- drop trigger a01_activity_change on public.purchase_correction_requests;
-- drop trigger a01_activity_delete on public.purchase_correction_requests;
-- delete from public.activity_log_sources where entity = 'purchase_correction_requests';
-- drop function public.process_purchase_correction_request(uuid,text);
-- drop function public.create_purchase_correction_request(text,uuid,text,text);
-- drop table public.purchase_correction_requests;
-- drop function public.purchase_correction_request_visible(uuid,uuid);
-- drop function public.purchase_module_access();
-- commit;
--
-- After either step, revert/hide the A02 app commit so pages do not offer the form
-- (without the RPCs they already fail closed with "belum tersimpan" messages).
