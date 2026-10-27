-- P08 PEMBATALAN PENERIMAAN — FREEZE, WRITES. Stops new cancellations; every stored cancellation and its
-- reversal (stock, journal, audit row) stays as it is. Undo by granting execute back to authenticated.
begin;
do $$ begin
  if current_user <> 'postgres' then
    raise exception 'P08 freeze must run as postgres (current role: %); nothing was changed', current_user;
  end if;
end $$;
revoke execute on function public.cancel_goods_receipt(uuid, text, text, date) from authenticated;
commit;
