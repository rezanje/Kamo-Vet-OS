-- Runner prepends fictional POS setup; no production data or external URLs.
alter table profiles disable trigger user;
update profiles set role='OWNER' where id='e1100000-0000-4000-8000-000000000001';
alter table profiles enable trigger user;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select stock_in_fifo('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',2,10000,'purchase','AVG.FIRST',current_date-2);
select stock_in_fifo('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',2,20000,'purchase','AVG.SECOND',current_date-1);
set local role authenticated;
select activate_moving_average();
select pg_temp.assert_ok((select average_cost=15000 from stock where warehouse_id='e3300000-0000-4000-8000-000000000001' and item_id='e5500000-0000-4000-8000-000000000002'),'activation preserves opening layer value');
reset role;
do $$ declare issued record;begin
 select * into issued from stock_out_fifo('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',1,'manual','AVG.ISSUE');
 perform pg_temp.assert_ok(issued.cost=15000,'issue uses moving average, not first physical price');
 perform pg_temp.assert_ok((issued.takes->0->>'unit_cost')::numeric=10000,'physical acquisition price remains auditable');
end $$;
select stock_in_fifo('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',2,30000,'purchase','AVG.THIRD');
select pg_temp.assert_ok((select qty=5 and average_cost=21000 from stock where warehouse_id='e3300000-0000-4000-8000-000000000001' and item_id='e5500000-0000-4000-8000-000000000002'),'receipt recomputes weighted average using remaining stock');

-- A transfer carries issue valuation, not physical layer acquisition price.
insert into warehouses(id,branch_id,code,name,type) values('ec300000-0000-4000-8000-000000000001','e2200000-0000-4000-8000-000000000001','AVGDEST','Average destination','RETAIL');
select stock_transfer_fifo_exact('e3300000-0000-4000-8000-000000000001','ec300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',1,'transfer','AVG.TRANSFER',current_date);
select pg_temp.assert_ok((select qty=1 and average_cost=21000 from stock where warehouse_id='ec300000-0000-4000-8000-000000000001' and item_id='e5500000-0000-4000-8000-000000000002'),'destination receives source average cost');
select pg_temp.assert_ok((select sum(qty*unit_cost)=0 from stock_moves where source_ref='AVG.TRANSFER'),'transfer values balance across warehouses');
set local role authenticated;
select pg_temp.reject($q$update stock set qty=999 where warehouse_id='e3300000-0000-4000-8000-000000000001' and item_id='e5500000-0000-4000-8000-000000000002'$q$,'raw stock writes cannot bypass average ledger');
select pg_temp.reject($q$update stock_layers set qty_left=999 where source_ref='AVG.FIRST'$q$,'raw layer writes cannot bypass average ledger');
-- Official invoker RPC remains usable under ordinary authenticated authority.
select stock_in_fifo('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',1,21000,'manual','AVG.AUTH.IN');
select stock_out_fifo('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',1,'manual','AVG.AUTH.OUT');
reset role;

-- Signed negative inventory is valued without negative-weight division. Receipt
-- variance adjusts current-period HPP; previous issue snapshots stay unchanged.
insert into items(id,code,name,unit,item_type) values('ec500000-0000-4000-8000-000000000001','AVGNEG','Negative average','pcs','Persediaan');
select stock_in_fifo('e3300000-0000-4000-8000-000000000001','ec500000-0000-4000-8000-000000000001',2,10000,'purchase','AVG.NEG.IN');
select stock_out_fifo('e3300000-0000-4000-8000-000000000001','ec500000-0000-4000-8000-000000000001',5,'manual','AVG.NEG.OUT');
select pg_temp.assert_ok((select qty=-3 and average_cost=10000 from stock where item_id='ec500000-0000-4000-8000-000000000001'),'negative sale keeps known average');
select stock_in_fifo('e3300000-0000-4000-8000-000000000001','ec500000-0000-4000-8000-000000000001',1,15000,'purchase','AVG.NEG.COVER');
select pg_temp.assert_ok((select qty=-2 and average_cost=15000 from stock where item_id='ec500000-0000-4000-8000-000000000001'),'partial negative receipt uses incoming known price');
select pg_temp.assert_ok((select count(*)=0 from stock_layers where item_id='ec500000-0000-4000-8000-000000000001' and qty_left>0),'deficit receipt creates no ghost layers');
select pg_temp.assert_ok((select unit_cost=10000 from stock_moves where source_ref='AVG.NEG.OUT'),'receipt does not rewrite old issue HPP');
select pg_temp.assert_ok((select variance=15000 from inventory_cost_events where source_ref='AVG.NEG.COVER'),'negative revaluation variance recorded');
select pg_temp.assert_ok((select sum(l.debit)=15000 and sum(l.credit)=15000 from journal_lines l join journal_entries e on e.id=l.entry_id where e.source='inventory-variance' and e.source_ref=(select id::text from stock_moves where source_ref='AVG.NEG.COVER')),'negative variance posts balanced HPP/inventory journal');
set local role authenticated;
select pg_temp.reject($q$delete from journal_entries where source='inventory-variance'$q$,'variance journal cannot be deleted independently from its cost event');
select pg_temp.reject($q$update journal_entries set source='manual' where source='inventory-variance'$q$,'variance source cannot be disguised as editable manual journal');
select pg_temp.reject($q$update journal_lines set debit=0 where entry_id in(select id from journal_entries where source='inventory-variance')$q$,'variance journal lines are immutable');
reset role;
select stock_in_fifo('e3300000-0000-4000-8000-000000000001','ec500000-0000-4000-8000-000000000001',4,20000,'purchase','AVG.NEG.POSITIVE');
select pg_temp.assert_ok((select qty=2 and average_cost=20000 from stock where item_id='ec500000-0000-4000-8000-000000000001'),'crossing to positive adopts receipt average');

-- Simulate an activation before the previous month only in fictional fixtures.
-- Event dates test the real as-of algorithm with subsequent-month movements.
update inventory_costing_settings set activated_at=date_trunc('month',current_date)-interval '1 month' where id;
insert into items(id,code,name,unit,item_type) values('ec500000-0000-4000-8000-000000000002','AVGCLOSE','Month snapshot','pcs','Persediaan');
select stock_in_fifo('e3300000-0000-4000-8000-000000000001','ec500000-0000-4000-8000-000000000002',10,100,'purchase','AVG.CLOSE.OPEN',(date_trunc('month',current_date)-interval '1 month')::date);
select stock_out_fifo('e3300000-0000-4000-8000-000000000001','ec500000-0000-4000-8000-000000000002',2,'manual','AVG.CLOSE.OUT',(date_trunc('month',current_date)-interval '1 month'+interval '2 days')::date);
select stock_in_fifo('e3300000-0000-4000-8000-000000000001','ec500000-0000-4000-8000-000000000002',10,200,'purchase','AVG.NEXT.MONTH',date_trunc('month',current_date)::date);
set local role authenticated;
select close_inventory_month((date_trunc('month',current_date)-interval '1 month')::date);
select pg_temp.assert_ok((select qty=8 and average_cost=100 and value=800 from inventory_month_values where item_id='ec500000-0000-4000-8000-000000000002'),'close reads period-ending event instead of current stock');
select pg_temp.assert_ok((select qty=18 and abs(average_cost-155.555555555556)<0.000000001 from stock where item_id='ec500000-0000-4000-8000-000000000002'),'closing does not overwrite next-month average');
select close_inventory_month((date_trunc('month',current_date)-interval '1 month')::date);
select pg_temp.assert_ok((select count(*)=1 from inventory_month_closes),'closing retry is idempotent');
select pg_temp.reject($q$select total_value from inventory_month_closes$q$,'direct readers cannot obtain global cross-branch monetary totals');
select pg_temp.reject($q$select stock_in_fifo('e3300000-0000-4000-8000-000000000001','ec500000-0000-4000-8000-000000000002',1,500,'purchase','AVG.CLOSED.BAD',(date_trunc('month',current_date)-interval '1 month')::date)$q$,'closed-period receipts rejected');
select pg_temp.reject($q$select close_inventory_month(date_trunc('month',current_date)::date)$q$,'cannot close incomplete current month');
select stock_out_fifo('e3300000-0000-4000-8000-000000000001','ec500000-0000-4000-8000-000000000002',1,'manual','AVG.OLD.BATCH.CURRENT.SALE');
select pg_temp.assert_ok((select qty_left=7 from stock_layers where source_ref='AVG.CLOSE.OPEN'),'current sale may consume a pre-close physical layer');
select pg_temp.assert_ok((select qty=8 and value=800 from inventory_month_values where item_id='ec500000-0000-4000-8000-000000000002'),'closed snapshot remains immutable after current sale');
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000002',true);
select pg_temp.reject($q$select close_inventory_month((date_trunc('month',current_date)-interval '1 month')::date)$q$,'non-finance actor cannot close');
rollback;
