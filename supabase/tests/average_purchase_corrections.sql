-- The runner prepends fictional invoice fixtures. Everything rolls back.
insert into coa_accounts(code,name,type,normal_balance,is_header) values('5101','Fictional inventory HPP','BEBAN','D',false) on conflict(code) do update set is_active=true,is_header=false;
create function pg_temp.assert_ok(ok boolean,message text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'Assertion failed: %',message;end if;end$$;
create function pg_temp.average_correction_fault() returns trigger language plpgsql as $$begin
 if new.request_key in ('average-price-fault','average-cancel-fault') then raise exception 'AVERAGE_FINAL_FAULT';end if;
 return new;
end$$;
create trigger average_price_final_fault before insert on purchase_operations for each row execute function pg_temp.average_correction_fault();
create trigger average_cancel_final_fault before insert on purchase_invoice_cancellation_requests for each row execute function pg_temp.average_correction_fault();
-- Simulate persisted invoices from a historical receipt path that allowed
-- covering negative stock. Only this temporary fixture clone relaxes that old
-- create-time guard; the production direct-invoice RPC remains unchanged.
do $$declare definition text;guard text:='if qty_before<0 then raise exception ''Stok negatif perlu direkonsiliasi sebelum pembelian langsung'';end if;';begin
 definition:=pg_get_functiondef('public.create_direct_purchase_invoice(text,jsonb)'::regprocedure);
 if (length(definition)-length(replace(definition,guard,'')))/length(guard)<>1 then raise exception 'Historical fixture guard anchor changed';end if;
 definition:=replace(definition,'public.create_direct_purchase_invoice(', 'pg_temp.historical_direct_purchase_invoice(');
 execute replace(definition,guard,'');
end$$;
create function pg_temp.correction_state(item uuid,invoice uuid) returns jsonb language sql as $$
 select jsonb_build_object(
  'stock',(select to_jsonb(s) from stock s where s.item_id=item),
  'layers',(select jsonb_agg(to_jsonb(l) order by l.id) from stock_layers l where l.item_id=item),
  'moves',(select jsonb_agg(to_jsonb(m) order by m.id) from stock_moves m where m.item_id=item),
  'invoice',(select to_jsonb(i) from purchase_invoices i where i.id=invoice),
  'journals',(select jsonb_agg(to_jsonb(e) order by e.id) from journal_entries e),
  'lines',(select jsonb_agg(to_jsonb(l) order by l.id) from journal_lines l)
 );
$$;
insert into items(id,code,name,unit,item_type) values
 ('ec400000-0000-4000-8000-000000000001','AVG-NEG-DIRECT1','Negative receipt variance','box','Persediaan'),
 ('ec400000-0000-4000-8000-000000000002','AVG-NEG-DIRECT2','Negative receipt same price','box','Persediaan');
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','ee000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select receive_purchase_order('ee500000-0000-4000-8000-000000000001','average-receipt','TB.AVG.',5,current_date,null,null,jsonb_build_array(jsonb_build_object('id','ee600000-0000-4000-8000-000000000001','qty_terima',4,'qty_rusak',0,'batches',jsonb_build_array(jsonb_build_object('qty',1,'exp_date',current_date+365),jsonb_build_object('qty',3,'exp_date',current_date+730)))));
select activate_moving_average();
-- Recognized average value has already diverged from physical layer value:
-- repricing adds only the invoice delta, never recomputes from all old layers.
savepoint average_diverged_physical;
select stock_in_fifo('ee200000-0000-4000-8000-000000000001','ee400000-0000-4000-8000-000000000001',10,20,'purchase','AVG.DIVERGED.LATER',current_date,current_date+900);
select stock_out_fifo('ee200000-0000-4000-8000-000000000001','ee400000-0000-4000-8000-000000000001',5,'manual','AVG.DIVERGED.ISSUE');
do $$declare first jsonb;begin
 first:=pg_temp.po_invoice('average-diverged');
 perform pg_temp.assert_ok((select qty=45 and abs(qty*average_cost-550)<0.00000001 from stock where item_id='ee400000-0000-4000-8000-000000000001'),'repricing adds only +10 to recognized 540, despite physical 550 before correction');
 perform cancel_purchase_invoice((first->>'invoice_id')::uuid,0,'average-diverged-cancel','Wrong invoice price');
 perform pg_temp.assert_ok((select qty=45 and abs(average_cost-12)<0.00000001 from stock where item_id='ee400000-0000-4000-8000-000000000001'),'inverse repricing restores recognized average rather than physical layer average');
end$$;
rollback to average_diverged_physical;
release average_diverged_physical;
do $$declare first jsonb;id uuid;begin
 -- Failure after the average adjustment must restore both valuation and physical layers.
 perform pg_temp.expect_error('select pg_temp.po_invoice(''average-price-fault'')','AVERAGE_FINAL_FAULT');
 perform pg_temp.assert_ok((select qty=40 and average_cost=10 from stock where item_id='ee400000-0000-4000-8000-000000000001'),'late invoice failure restores starting average');
 perform pg_temp.assert_ok(not exists(select 1 from stock_moves where source='purchase-reprice'),'late invoice failure removes valuation event');
 perform pg_temp.assert_ok((select sum(qty_left*unit_cost)=400 from stock_layers),'late invoice failure restores physical layer values');
 -- 40 units @10; invoice reprices only 5 to 12 (DPP 60). Total value 410.
 first:=pg_temp.po_invoice('average-po-price');id:=(first->>'invoice_id')::uuid;
 perform pg_temp.assert_ok((select qty=40 and average_cost=10.25 from stock where item_id='ee400000-0000-4000-8000-000000000001'),'partial PO invoice repricing adjusts average by exactly +10');
 perform pg_temp.assert_ok((select sum(valuation_adjustment)=10 from stock_moves where source='purchase-reprice' and source_ref=first->>'no_faktur'),'one source-linked invoice value adjustment');
 perform pg_temp.assert_ok(first=pg_temp.po_invoice('average-po-price'),'invoice retry returns original result');
 perform pg_temp.assert_ok((select count(*)=1 from stock_moves where source='purchase-reprice' and source_ref=first->>'no_faktur'),'invoice retry cannot adjust average twice');
 -- A later receipt is independent of the PO correction being cancelled.
 perform stock_in_fifo('ee200000-0000-4000-8000-000000000001','ee400000-0000-4000-8000-000000000001',10,20,'purchase','AVG.PO.LATER',current_date,current_date+900);
 perform pg_temp.expect_error(format('select cancel_purchase_invoice(%L,0,''average-cancel-fault'',''Wrong invoice price'')',id),'AVERAGE_FINAL_FAULT');
 perform pg_temp.assert_ok((select qty=50 and average_cost=12.2 from stock where item_id='ee400000-0000-4000-8000-000000000001'),'late cancellation failure restores average and later receipt value');
 perform pg_temp.assert_ok(not exists(select 1 from stock_moves where source='purchase-reprice-void'),'late cancellation failure removes inverse adjustment');
 perform cancel_purchase_invoice(id,0,'average-po-cancel','Wrong invoice price');
 perform pg_temp.assert_ok((select qty=50 and abs(average_cost-12)<0.00000001 from stock where item_id='ee400000-0000-4000-8000-000000000001'),'PO cancellation removes only +10 repricing and preserves later 200 receipt');
 perform pg_temp.assert_ok((select sum(valuation_adjustment)=-10 from stock_moves where source='purchase-reprice-void' and source_ref=first->>'no_faktur'),'PO cancellation records exact inverse valuation adjustment');
 perform cancel_purchase_invoice(id,0,'average-po-cancel','Wrong invoice price');
 perform pg_temp.assert_ok((select count(*)=1 from stock_moves where source='purchase-reprice-void' and source_ref=first->>'no_faktur'),'cancellation retry cannot adjust average twice');
 -- The standalone old repricer has no invoice identity or date; average mode fails closed.
 perform pg_temp.expect_error('select reprice_purchase_invoice_layers(''[]'',''[]'')','faktur resmi');
end$$;
-- Direct invoice cancellation removes the acquisition value, not today's average.
do $$declare first jsonb;id uuid;begin
 first:=create_direct_purchase_invoice('average-direct',pg_temp.direct_payload(222));id:=(first->>'invoice_id')::uuid;
 perform stock_in_fifo('ee200000-0000-4000-8000-000000000001','ee400000-0000-4000-8000-000000000001',10,40,'purchase','AVG.DIRECT.LATER',current_date,current_date+900);
 perform cancel_purchase_invoice(id,0,'average-direct-cancel','Wrong direct price');
 perform pg_temp.assert_ok((select qty=60 and abs(average_cost-(1000::numeric/60))<0.00000001 from stock where item_id='ee400000-0000-4000-8000-000000000001'),'direct cancellation removes its original 200 value and keeps later receipts');
end$$;
-- Snapshots created before new metadata columns remain verifiable without
-- weakening equality checks for every original stock-move field.
do $$declare first jsonb;begin
 first:=create_direct_purchase_invoice('average-legacy-proof',pg_temp.direct_payload(111));
 perform set_config('test.legacy_invoice',first->>'invoice_id',true);
end$$;
reset role;
update purchase_invoice_postings set stock_moves=(select jsonb_agg(x-'cost_method'-'valuation_adjustment' order by x->>'id') from jsonb_array_elements(stock_moves)x) where invoice_id=current_setting('test.legacy_invoice')::uuid;
-- Changing any original field in an old proof must still fail.
update purchase_invoice_postings set stock_moves=(select jsonb_agg(x||'{"source_ref":"TAMPERED"}'::jsonb order by x->>'id') from jsonb_array_elements(stock_moves)x) where invoice_id=current_setting('test.legacy_invoice')::uuid;
set local role authenticated;
select pg_temp.expect_error(format('select cancel_purchase_invoice(%L,0,''average-proof-tamper'',''Correct old invoice'')',current_setting('test.legacy_invoice')),'Riwayat stok sumber berubah');
reset role;
update purchase_invoice_postings proof set stock_moves=(select jsonb_agg(to_jsonb(m)-'cost_method'-'valuation_adjustment' order by m.id) from stock_moves m join purchase_invoices inv on inv.id=proof.invoice_id where m.source='faktur-langsung' and m.source_ref=inv.no_faktur) where proof.invoice_id=current_setting('test.legacy_invoice')::uuid;
set local role authenticated;
select cancel_purchase_invoice(current_setting('test.legacy_invoice')::uuid,0,'average-legacy-cancel','Correct old invoice');
-- Cancelling a receipt that covered an old deficit cannot restore the old
-- shortage merely by removing its smaller remaining physical layer. This must
-- fail even when equal prices produced no variance journal.
do $$declare item uuid;price numeric;result jsonb;before_state jsonb;payload jsonb;begin
 foreach price in array array[222::numeric,111::numeric] loop
  item:=case when price=222 then 'ec400000-0000-4000-8000-000000000001'::uuid else 'ec400000-0000-4000-8000-000000000002'::uuid end;
  perform stock_in_fifo('ee200000-0000-4000-8000-000000000001',item,1,100,'purchase','AVG.NEG.OPEN');
  perform stock_out_fifo('ee200000-0000-4000-8000-000000000001',item,2,'manual','AVG.NEG.ISSUE');
  payload:=jsonb_set(jsonb_set(pg_temp.direct_payload(price),'{items,0,item_id}',to_jsonb(item)),'{items,0,qty}','2');
  result:=pg_temp.historical_direct_purchase_invoice('average-negative-'||price,payload);
  perform stock_in_fifo('ee200000-0000-4000-8000-000000000001',item,3,300,'purchase','AVG.NEG.LATER');
  perform pg_temp.assert_ok((select qty=4 from stock where item_id=item),'later receipt makes aggregate sufficient for legacy cancellation');
  perform pg_temp.assert_ok((select sum(qty_left)=4 from stock_layers where item_id=item),'physical and aggregate initially agree');
  before_state:=pg_temp.correction_state(item,(result->>'invoice_id')::uuid);
  perform pg_temp.expect_error(format('select cancel_purchase_invoice(%L,0,%L,''Wrong old price'')',result->>'invoice_id','average-negative-cancel-'||price),'menutup stok negatif');
  perform pg_temp.assert_ok(before_state=pg_temp.correction_state(item,(result->>'invoice_id')::uuid),'negative-cover rejection preserves exact stock, layers, moves, invoice and journals');
 end loop;
end$$;
rollback;
