-- A02 FREEZE — WRITES (two grants only). Run only on a rollback decision, then revert the A02 app commit.
-- Stops new requests and processing. Every stored request, follow-up note and activity-log row is kept and
-- stays readable (requesters see their own, Super Admin sees the queue). No business table is touched.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
revoke execute on function public.create_purchase_correction_request(text,uuid,text,text) from authenticated;
revoke execute on function public.process_purchase_correction_request(uuid,text) from authenticated;
commit;
-- To lift the freeze later, restore exactly the grants the migration made:
--   grant execute on function public.create_purchase_correction_request(text,uuid,text,text) to authenticated;
--   grant execute on function public.process_purchase_correction_request(uuid,text) to authenticated;
