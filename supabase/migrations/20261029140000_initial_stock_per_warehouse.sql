-- Opening stock is decided per warehouse, not company-wide.
-- 1. Daily journals touching 1301 (sales HPP, purchases, opname) no longer block an
--    opening: only a legacy global/same-branch 'saldo-awal' inventory journal does,
--    because that is the only one that may already contain this opening's value.
-- 2. A warehouse that already received an Accurate opening cannot get a second one.
-- 3. Preparation skips (with a reason) items that already have stock history in the
--    target warehouse instead of letting one such item block the whole batch.
--    The preview item guard stays as the safety net for stock written after preparation.
create function pg_temp.patch_opening_scope(p_function regprocedure,p_old text,p_new text)
returns void language plpgsql as $patch$
declare definition text:=pg_get_functiondef(p_function);
begin
 if (length(definition)-length(replace(definition,p_old,'')))/length(p_old)<>1 then
  raise exception 'Opening scope anchor mismatch: % / %',p_function,left(p_old,100);
 end if;
 execute replace(definition,p_old,p_new);
end;
$patch$;

select pg_temp.patch_opening_scope('public.preview_accurate_inventory_accounting(uuid,uuid)'::regprocedure,
$old$ where (j.source='saldo-awal' or c.code='1301') and not exists(select 1 from public.accurate_inventory_accounting ai where ai.entry_id=j.id);$old$,
$new$ where j.source='saldo-awal' and (j.branch_id is null or j.branch_id=r.branch_id)
 and exists(select 1 from public.journal_lines gl join public.coa_accounts gc on gc.id=gl.account_id where gl.entry_id=j.id and gc.code='1301')
 and not exists(select 1 from public.accurate_inventory_accounting ai where ai.entry_id=j.id);$new$);

select pg_temp.patch_opening_scope('public.preview_accurate_inventory_accounting(uuid,uuid)'::regprocedure,
$old$'Barang sudah memiliki stok/layer/riwayat; impor awal baru diblokir');end if;$old$,
$new$'Barang sudah memiliki stok/layer/riwayat; impor awal baru diblokir');end if;
 if r.status='previewed' and exists(select 1 from public.stock_layers s where s.warehouse_id=r.warehouse_id
  and s.source='saldo-awal-accurate' and s.source_ref<>p_run_id::text) then
  blockers:=blockers||jsonb_build_array('Gudang ini sudah punya saldo awal; koreksi jumlahnya lewat Stok Opname');end if;$new$);

select pg_temp.patch_opening_scope('public.prepare_accurate_initial_stock(text,text,uuid,uuid,date,jsonb,text)'::regprocedure,
$old$ n int:=0; skipped int:=0; rejected int:=0; total_qty numeric:=0;$old$,
$new$ n int:=0; skipped int:=0; rejected int:=0; total_qty numeric:=0; has_history int:=0;$new$);

select pg_temp.patch_opening_scope('public.prepare_accurate_initial_stock(text,text,uuid,uuid,date,jsonb,text)'::regprocedure,
$old$   raise exception 'Status/baris impor tidak valid' using errcode='22023';end if;$old$,
$new$   raise exception 'Status/baris impor tidak valid' using errcode='22023';end if;
  if x->>'status'='valid' and (
   exists(select 1 from public.stock_moves s where s.warehouse_id=p_warehouse_id and s.item_id::text=payload->>'item_id')
   or exists(select 1 from public.stock_layers s where s.warehouse_id=p_warehouse_id and s.item_id::text=payload->>'item_id')
   or exists(select 1 from public.stock s where s.warehouse_id=p_warehouse_id and s.item_id::text=payload->>'item_id' and s.qty<>0)) then
   x:=x||jsonb_build_object('status','skipped','reason','Barang ini sudah punya stok/transaksi di gudang ini; masukkan lewat Stok Opname');
   has_history:=has_history+1;
  end if;$new$);

select pg_temp.patch_opening_scope('public.prepare_accurate_initial_stock(text,text,uuid,uuid,date,jsonb,text)'::regprocedure,
$old$ if n=0 or source_value<=0 or source_value>1000000000000 then$old$,
$new$ if n=0 and has_history>0 then
  raise exception 'Semua barang di file ini sudah punya stok/transaksi di gudang tujuan. Saldo awal gudang ini tidak bisa diimpor ulang; koreksi jumlahnya lewat Stok Opname.' using errcode='22023';end if;
 if n=0 or source_value<=0 or source_value>1000000000000 then$new$);
