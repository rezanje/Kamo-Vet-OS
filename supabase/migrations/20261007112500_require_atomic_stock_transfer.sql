-- Preserve the deployed FIFO body, owner, SECURITY INVOKER setting and ACL.
-- Legacy transfer/request-receipt callers must stop before their first stock
-- mutation; checked atomic definer RPCs execute this primitive as their owner.
do $$
declare v_oid regprocedure:='public.stock_out_fifo(uuid,uuid,numeric,text,text,date)'::regprocedure;
 v_definition text; v_position integer; v_marker constant text:=E'\nbegin\n';
begin
 if exists(select 1 from pg_proc where oid=v_oid and prosecdef) then
  raise exception 'Expected stock_out_fifo SECURITY INVOKER; aborting cutover';
 end if;
 v_definition:=pg_get_functiondef(v_oid);
 v_position:=strpos(v_definition,v_marker);
 if v_position=0 then raise exception 'FIFO body insertion point missing; aborting cutover'; end if;
 execute overlay(v_definition placing v_marker||$guard$  if current_user = 'authenticated' and p_source in ('terima-permintaan', 'transfer') then
    raise exception 'Pemindahan/penerimaan harus diproses lewat transaksi atomik. Muat ulang halaman lalu coba lagi.' using errcode = '55000';
  end if;
$guard$ from v_position for length(v_marker));
end $$;
