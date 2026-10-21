-- Uses the fictional pos_merchant_fees setup (runner prepends it); rolls back.
-- Regression: 9 available @ 12,080 + 11 missing must cost 241,600, not 108,720.
insert into warehouses(id,branch_id,code,name,type) values
 ('eb300000-0000-4000-8000-000000000001','e2200000-0000-4000-8000-000000000001','HPPDC','HPP distribution centre','RETAIL');
update items set buy_price=12080 where id='e5500000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);

create function pg_temp.hpp_sale(ref text,qty numeric,expected numeric) returns void
language plpgsql as $$
declare doc uuid; issued record; line uuid:=gen_random_uuid();
begin
 doc:=pg_temp.fee_sale(ref,'[{"method":"Tunai","amount":1000000}]',0,1000000,1000000,'Tunai');
 select * into issued from public.sale_stock_out_fifo(
  'e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',
  qty,'sale',ref,p_sale_line_id=>line);
 perform pg_temp.assert_ok(issued.cost=expected,ref||': full quantity HPP, actual='||issued.cost);
 insert into sale_items(id,sale_id,item_id,nama,qty,harga,satuan,faktor,hpp)
 values(line,doc,'e5500000-0000-4000-8000-000000000002','HPP stock',qty,1000000/qty,'pcs',1,issued.cost);
 perform public.finalize_pos_sale(doc);
 perform pg_temp.assert_ok(pg_temp.balance(ref,'sale-hpp','5101')=expected,ref||': profit/loss HPP debit');
 perform pg_temp.assert_ok(pg_temp.balance(ref,'sale-hpp','1301')=-expected,ref||': inventory credit');
 perform pg_temp.assert_ok((select -m.qty*m.unit_cost=expected from public.stock_moves m where m.source_ref=ref and m.source='sale'),ref||': stock card agrees with journal');
end $$;

-- Zero stock still uses a known master price.
select pg_temp.hpp_sale('HPP.ZERO.KNOWN',1,12080);
reset role;
update items set buy_price=0 where id='e5500000-0000-4000-8000-000000000002';
select stock_in_fifo('eb300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',100,12080,'purchase','HPP.PURCHASE');
select stock_transfer_fifo_exact('eb300000-0000-4000-8000-000000000001','e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',10,'transfer','HPP.TRANSFER',current_date);
select pg_temp.assert_ok((select qty=9 from stock where warehouse_id='e3300000-0000-4000-8000-000000000001' and item_id='e5500000-0000-4000-8000-000000000002'),'transfer closes the first negative unit');
set local role authenticated;
select pg_temp.hpp_sale('HPP.OVERSOLD',20,241600);
select pg_temp.assert_ok((select qty=-11 from stock where warehouse_id='e3300000-0000-4000-8000-000000000001' and item_id='e5500000-0000-4000-8000-000000000002'),'ending balance -11');
select pg_temp.assert_ok((select unit_cost=12080 and fifo_shortfall=11 and jsonb_array_length(fifo_takes)=1 from stock_moves where source_ref='HPP.OVERSOLD'),'unit cost does not dilute; physical FIFO provenance remains accurate');
select pg_temp.hpp_sale('HPP.EXHAUSTED',2,24160);
-- A receipt that only closes a deficit has no layer; it must still supply a cost.
reset role;
select stock_in_fifo('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',1,15000,'purchase','HPP.COVER',current_date+1);
-- Backdated lookups must not borrow the future receipt price.
set local role authenticated;
select pg_temp.hpp_sale('HPP.NO.FUTURE',1,12080);

-- No master price and no cost history: fail before retaining any stock mutation.
reset role;
insert into items(id,code,name,unit,item_type,buy_price) values
 ('eb500000-0000-4000-8000-000000000001','HPPUNKNOWN','Unknown cost stock','pcs','Persediaan',0);
set local role authenticated;
do $$ declare failed boolean:=false; doc uuid; begin
 doc:=pg_temp.fee_sale('HPP.UNKNOWN','[{"method":"Tunai","amount":1000000}]',0,1000000,1000000,'Tunai');
 begin
  perform sale_stock_out_fifo('e3300000-0000-4000-8000-000000000001','eb500000-0000-4000-8000-000000000001',1,'sale','HPP.UNKNOWN');
 exception when others then
  if sqlerrm not like '%Harga pokok%belum tersedia%' then raise; end if;
  failed:=true;
 end;
 perform pg_temp.assert_ok(failed,'unknown cost must be rejected with actionable message');
end $$;
select pg_temp.assert_ok(not exists(select 1 from stock_moves where source_ref='HPP.UNKNOWN'),'rejected issue has no stock movement');
select pg_temp.assert_ok(not exists(select 1 from stock where item_id='eb500000-0000-4000-8000-000000000001'),'rejected issue rolls back aggregate row');

-- A failure after partial consumption must restore both physical stock and FIFO.
reset role;
select stock_in_fifo('e3300000-0000-4000-8000-000000000001','eb500000-0000-4000-8000-000000000001',1,0,'manual','HPP.UNPRICED.LAYER');
set local role authenticated;
do $$ declare failed boolean:=false; begin
 begin
  perform sale_stock_out_fifo('e3300000-0000-4000-8000-000000000001','eb500000-0000-4000-8000-000000000001',2,'sale','HPP.UNKNOWN');
 exception when others then
  if sqlerrm not like '%Harga pokok%belum tersedia%' then raise; end if;
  failed:=true;
 end;
 perform pg_temp.assert_ok(failed,'unpriced partial issue rejected');
end $$;
select pg_temp.assert_ok((select qty=1 from stock where warehouse_id='e3300000-0000-4000-8000-000000000001' and item_id='eb500000-0000-4000-8000-000000000001'),'failed partial issue preserves stock');
select pg_temp.assert_ok((select qty_left=1 from stock_layers where source_ref='HPP.UNPRICED.LAYER'),'failed partial issue restores consumed FIFO');
do $$ declare failed boolean:=false; begin
 begin
  perform sale_stock_out_fifo('e3300000-0000-4000-8000-000000000001','eb500000-0000-4000-8000-000000000001',1,'sale','HPP.UNKNOWN');
 exception when others then
  if sqlerrm not like '%Harga pokok%belum tersedia%' then raise; end if;
  failed:=true;
 end;
 perform pg_temp.assert_ok(failed,'zero-cost physical stock must not bypass the unknown-HPP guard');
end $$;
reset role;
update items set buy_price=13000 where id='eb500000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ declare issued record; doc uuid; begin
 select id into doc from sales where no_struk='HPP.UNKNOWN';
 select * into issued from sale_stock_out_fifo('e3300000-0000-4000-8000-000000000001','eb500000-0000-4000-8000-000000000001',1,'sale','HPP.UNKNOWN');
 perform pg_temp.assert_ok(issued.cost=13000 and issued.shortfall=0,'filling master price makes unpriced physical stock sellable with correct HPP');
 insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp)
 values(doc,'eb500000-0000-4000-8000-000000000001','Previously unpriced',1,1000000,'pcs',1,issued.cost);
 perform finalize_pos_sale(doc);
 perform pg_temp.assert_ok(pg_temp.balance('HPP.UNKNOWN','sale-hpp','5101')=13000,'previously unpriced stock posts known HPP');
end $$;

-- Receipt entirely used to cover a deficit: price survives without a FIFO layer.
reset role;
insert into items(id,code,name,unit,item_type,buy_price) values
 ('eb500000-0000-4000-8000-000000000002','HPPDEFICIT','Deficit-only receipt','pcs','Persediaan',0),
 ('eb500000-0000-4000-8000-000000000003','HPPMIX','Mixed FIFO costs','pcs','Persediaan',99999);
insert into stock(warehouse_id,item_id,qty) values('e3300000-0000-4000-8000-000000000001','eb500000-0000-4000-8000-000000000002',-5);
select stock_in_fifo('e3300000-0000-4000-8000-000000000001','eb500000-0000-4000-8000-000000000002',2,15000,'purchase','HPP.DEFICIT.RECEIPT');
select pg_temp.assert_ok(not exists(select 1 from stock_layers where item_id='eb500000-0000-4000-8000-000000000002'),'deficit receipt creates no ghost stock');
do $$ declare issued record; begin
 select * into issued from stock_out_fifo('e3300000-0000-4000-8000-000000000001','eb500000-0000-4000-8000-000000000002',1,'manual','HPP.DEFICIT.ISSUE');
 perform pg_temp.assert_ok(issued.cost=15000 and issued.harga_beli=15000 and issued.shortfall=1,'incoming movement supplies known price without a layer');
end $$;

-- Actual FIFO units retain different costs; only the shortage extends the last
-- consumed price. The master price must not override those transaction costs.
select stock_in_fifo('e3300000-0000-4000-8000-000000000001','eb500000-0000-4000-8000-000000000003',2,10000,'purchase','HPP.MIX.FIRST',current_date-2);
select stock_in_fifo('e3300000-0000-4000-8000-000000000001','eb500000-0000-4000-8000-000000000003',3,12000,'purchase','HPP.MIX.SECOND',current_date-1);
do $$ declare issued record; begin
 select * into issued from stock_out_fifo('e3300000-0000-4000-8000-000000000001','eb500000-0000-4000-8000-000000000003',7,'manual','HPP.MIX.ISSUE');
 perform pg_temp.assert_ok(issued.cost=80000 and issued.harga_beli=12000 and issued.shortfall=2,'mixed FIFO 2x10000 + 3x12000 + shortage 2x12000');
 perform pg_temp.assert_ok(jsonb_array_length(issued.takes)=2,'shortage does not fabricate a physical layer');
end $$;

-- Cancellation retains depleted physical records and inbound moves. Neither
-- canceled direct costs nor canceled repricing split costs may become fallback.
insert into items(id,code,name,unit,item_type,buy_price) values
 ('eb500000-0000-4000-8000-000000000004','HPPVOIDHISTORY','Reversed price evidence','pcs','Persediaan',9000);
insert into purchase_invoices(id,no_faktur,branch_id,warehouse_id,voided_at) values
 ('eb600000-0000-4000-8000-000000000001','HPP.VOID.DIRECT','e2200000-0000-4000-8000-000000000001','e3300000-0000-4000-8000-000000000001',now()),
 ('eb600000-0000-4000-8000-000000000002','HPP.VOID.SPLIT','e2200000-0000-4000-8000-000000000001','e3300000-0000-4000-8000-000000000001',now());
insert into stock_layers(id,warehouse_id,item_id,qty_in,qty_left,unit_cost,source,source_ref) values
 ('eb700000-0000-4000-8000-000000000001','e3300000-0000-4000-8000-000000000001','eb500000-0000-4000-8000-000000000004',1,0,50000,'faktur-langsung','HPP.VOID.DIRECT'),
 ('eb700000-0000-4000-8000-000000000002','e3300000-0000-4000-8000-000000000001','eb500000-0000-4000-8000-000000000004',1,0,60000,'purchase','HPP.VOID.PO');
insert into purchase_invoice_layer_proofs(invoice_id,layer_id,before_state,after_state,allocated) values
 ('eb600000-0000-4000-8000-000000000002','eb700000-0000-4000-8000-000000000002',null,'{}',true);
insert into stock_moves(warehouse_id,item_id,qty,unit_cost,source,source_ref) values
 ('e3300000-0000-4000-8000-000000000001','eb500000-0000-4000-8000-000000000004',1,50000,'faktur-langsung','HPP.VOID.DIRECT');
set local role authenticated;
do $$ declare issued record; begin
 select * into issued from stock_out_fifo('e3300000-0000-4000-8000-000000000001','eb500000-0000-4000-8000-000000000004',1,'manual','HPP.VOID.EVIDENCE');
 perform pg_temp.assert_ok(issued.cost=9000,'reversed direct and split cost evidence does not override master');
end $$;
rollback;
