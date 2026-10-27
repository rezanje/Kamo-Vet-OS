-- P08 goods receipt cancellation. Fictional fixtures on an owned throwaway PostgreSQL; everything rolls back.
begin;
insert into auth.users(id) values('f8000000-0000-4000-8000-000000000001'),('f8000000-0000-4000-8000-000000000002');
update profiles set role='OWNER',is_active=true where id='f8000000-0000-4000-8000-000000000001';
update profiles set role='ADMIN',is_active=true where id='f8000000-0000-4000-8000-000000000002';
insert into branches(id,code,name,type) values('f8100000-0000-4000-8000-000000000001','P08-FIC','P08 fiction','KLINIK');
insert into warehouses(id,branch_id,code,name,type) values('f8200000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000001','P08-WH','P08 warehouse','VET');
insert into suppliers(id,nama) values('f8300000-0000-4000-8000-000000000001','P08 fiction supplier');
insert into items(id,code,name,unit,item_type) values
 ('f8400000-0000-4000-8000-000000000001','P08-A','P08 safe goods','pcs','Persediaan'),
 ('f8400000-0000-4000-8000-000000000002','P08-D','P08 invoiced goods','pcs','Persediaan'),
 ('f8400000-0000-4000-8000-000000000003','P08-E','P08 consumed goods','pcs','Persediaan'),
 ('f8400000-0000-4000-8000-000000000004','P08-S','P08 service','pcs','Jasa');
insert into item_units(item_id,unit,factor) values
 ('f8400000-0000-4000-8000-000000000001','box',10),('f8400000-0000-4000-8000-000000000002','box',10),('f8400000-0000-4000-8000-000000000003','box',10);
insert into purchase_orders(id,no_po,supplier_id,branch_id,to_warehouse_id,status) values
 ('f8500000-0000-4000-8000-000000000001','PO.P08.A','f8300000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000001','f8200000-0000-4000-8000-000000000001','Dipesan'),
 ('f8500000-0000-4000-8000-000000000002','PO.P08.D','f8300000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000001','f8200000-0000-4000-8000-000000000001','Dipesan'),
 ('f8500000-0000-4000-8000-000000000003','PO.P08.E','f8300000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000001','f8200000-0000-4000-8000-000000000001','Dipesan');
insert into purchase_order_items(id,po_id,item_id,nama,qty,harga_beli,satuan,faktor) values
 ('f8600000-0000-4000-8000-000000000001','f8500000-0000-4000-8000-000000000001','f8400000-0000-4000-8000-000000000001','P08 safe goods',4,100,'box',10),
 ('f8600000-0000-4000-8000-000000000004','f8500000-0000-4000-8000-000000000001','f8400000-0000-4000-8000-000000000004','P08 service',1,50,null,1),
 ('f8600000-0000-4000-8000-000000000002','f8500000-0000-4000-8000-000000000002','f8400000-0000-4000-8000-000000000002','P08 invoiced goods',2,100,'box',10),
 ('f8600000-0000-4000-8000-000000000003','f8500000-0000-4000-8000-000000000003','f8400000-0000-4000-8000-000000000003','P08 consumed goods',2,100,'box',10);
insert into coa_accounts(code,name,type,normal_balance) values('1301','Fiction stock','ASET','D') on conflict(code) do update set is_active=true,is_header=false;
update coa_accounts set is_active=true,is_header=false where code in('1301','2102');
update accounting_locks set closed_until=null;
create table p08_results(name text primary key,result jsonb);
grant all on p08_results to authenticated;
create function pg_temp.expect_error(command text,fragment text) returns void language plpgsql as $$
begin
 begin execute command;
 exception when others then
  if position(fragment in sqlerrm)=0 then raise exception 'Expected error containing "%", got: %',fragment,sqlerrm;end if;
  return;
 end;
 raise exception 'Expected failure containing "%" but the command succeeded',fragment;
end$$;
create function pg_temp.ok(cond boolean,message text) returns void language plpgsql as $$
begin if cond is distinct from true then raise exception 'Assertion failed: %',message;end if;end$$;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','f8000000-0000-4000-8000-000000000001',true);
-- @AVERAGE_ACTIVATION@

-- Post three fictional receipts through the production RPC.
insert into p08_results select 'A',receive_purchase_order('f8500000-0000-4000-8000-000000000001','p08-receipt-a','TB.P08.',5,current_date,'SJ-A',null,
 '[{"id":"f8600000-0000-4000-8000-000000000001","qty_terima":2,"qty_rusak":1,"batches":[{"qty":1,"exp_date":"2027-01-01"},{"qty":1,"exp_date":"2028-01-01"}]},{"id":"f8600000-0000-4000-8000-000000000004","qty_terima":1}]');
insert into p08_results select 'D',receive_purchase_order('f8500000-0000-4000-8000-000000000002','p08-receipt-d','TB.P08.',5,current_date,null,null,'[{"id":"f8600000-0000-4000-8000-000000000002","qty_terima":2}]');
insert into p08_results select 'E',receive_purchase_order('f8500000-0000-4000-8000-000000000003','p08-receipt-e','TB.P08.',5,current_date,null,null,'[{"id":"f8600000-0000-4000-8000-000000000003","qty_terima":2}]');
select pg_temp.ok((select qty from stock where item_id='f8400000-0000-4000-8000-000000000001')=20,'receipt A posted 20 base units');

-- 1. Non-owner refused, nothing changes; direct status writes refused.
select set_config('request.jwt.claim.sub','f8000000-0000-4000-8000-000000000002',true);
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L)',(select result->>'receipt_id' from p08_results where name='A'),'p08-admin','Salah input'),'hanya oleh Super Admin');
select pg_temp.expect_error(format('update goods_receipts set voided_at=now(),void_reason=%L where id=%L','manual',(select result->>'receipt_id' from p08_results where name='A')),'pembatalan resmi');
do $$begin
 insert into stock_moves(tanggal,warehouse_id,item_id,qty,unit_cost,source,source_ref) values(current_date,'f8200000-0000-4000-8000-000000000001','f8400000-0000-4000-8000-000000000001',-1,10,'purchase-receipt-void','FAKE');
 raise exception 'Forged receipt-void stock move accepted';
exception when insufficient_privilege then null;
end$$;
do $$begin
 insert into journal_entries(no_jurnal,tanggal,deskripsi,source,source_ref) values('JRN-FAKE-P08',current_date,'Fake','purchase-receipt-void','FAKE');
 raise exception 'Forged receipt-void journal accepted';
exception when insufficient_privilege then null;
end$$;
select pg_temp.ok((select voided_at is null from goods_receipts where id=(select (result->>'receipt_id')::uuid from p08_results where name='A')),'non-owner left receipt active');
select pg_temp.ok((select qty from stock where item_id='f8400000-0000-4000-8000-000000000001')=20,'non-owner changed stock');

-- 2. Owner safe cancel reverses stock, layers, journal and reopens PO quantities.
select set_config('request.jwt.claim.sub','f8000000-0000-4000-8000-000000000001',true);
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L)',(select result->>'receipt_id' from p08_results where name='A'),'p08-short','x'),'Alasan pembatalan wajib');
insert into p08_results select 'cancel-A',cancel_goods_receipt((select (result->>'receipt_id')::uuid from p08_results where name='A'),'p08-cancel-a','Salah input jumlah',current_date);
do $$declare rid uuid:=(select (result->>'receipt_id')::uuid from p08_results where name='A');res jsonb:=(select result from p08_results where name='cancel-A');begin
 perform pg_temp.ok((select qty from stock where item_id='f8400000-0000-4000-8000-000000000001')=0,'stock reversed to zero');
 perform pg_temp.ok(not exists(select 1 from stock_layers where item_id='f8400000-0000-4000-8000-000000000001' and qty_left<>0),'source layers zeroed');
 perform pg_temp.ok((select count(*) from stock_layers where item_id='f8400000-0000-4000-8000-000000000001')=2,'layers kept as history');
 perform pg_temp.ok((select count(*)=1 and sum(qty)=-20 and min(unit_cost)=10 and min(source_ref)=(res->>'no_terima') from stock_moves where item_id='f8400000-0000-4000-8000-000000000001' and source='purchase-receipt-void'),'one reversing move at original cost');
 perform pg_temp.ok(not exists(select 1 from stock_moves where item_id='f8400000-0000-4000-8000-000000000004'),'service line never touched stock');
 perform pg_temp.ok((select method from inventory_costing_settings where id)<>'moving_average'
  or (select value_delta=-200 and value_after=0 from inventory_cost_events where source='purchase-receipt-void' and item_id='f8400000-0000-4000-8000-000000000001'),'average value removed at original cost');
 perform pg_temp.ok((select count(*) from journal_entries where source='purchase-receipt-void')=1,'one reversal journal');
 perform pg_temp.ok((select sum(l.credit) from journal_lines l join coa_accounts a on a.id=l.account_id where l.entry_id=(res->>'reversal_journal_id')::uuid and a.code='1301')=250
  and (select sum(l.debit) from journal_lines l join coa_accounts a on a.id=l.account_id where l.entry_id=(res->>'reversal_journal_id')::uuid and a.code='2102')=250,'reversal credits inventory and debits GRNI 250');
 perform pg_temp.ok((select sum(l.debit-l.credit) from journal_lines l join journal_entries e on e.id=l.entry_id join coa_accounts a on a.id=l.account_id
  where a.code in('1301','2102') and e.source_ref=(res->>'no_terima'))=0,'receipt and reversal net to zero');
 perform pg_temp.ok((select coalesce(qty_terima,0)=0 and qty_rusak=0 from purchase_order_items where id='f8600000-0000-4000-8000-000000000001'),'PO goods qty reopened');
 perform pg_temp.ok((select coalesce(qty_terima,0)=0 from purchase_order_items where id='f8600000-0000-4000-8000-000000000004'),'PO service qty reopened');
 perform pg_temp.ok((select status::text from purchase_orders where id='f8500000-0000-4000-8000-000000000001')='Dipesan','PO back to ordered');
 perform pg_temp.ok((select voided_at is not null and void_reason='Salah input jumlah' and voided_by='f8000000-0000-4000-8000-000000000001' and reversal_journal_id=(res->>'reversal_journal_id')::uuid from goods_receipts where id=rid),'receipt kept with cancelled status');
 perform pg_temp.ok((select count(*) from goods_receipt_items where receipt_id=rid)=2,'original receipt lines kept');
 perform pg_temp.ok((select count(*) from purchase_receipt_cancellations where receipt_id=rid and reason='Salah input jumlah')=1,'audit trail readable by owner');
end$$;

-- 3. Double cancel is idempotent: same key replays, another key reports already cancelled, no second effect.
do $$declare rid uuid:=(select (result->>'receipt_id')::uuid from p08_results where name='A');again jsonb;other jsonb;begin
 again:=cancel_goods_receipt(rid,'p08-cancel-a','Salah input jumlah',current_date);
 perform pg_temp.ok(again=(select result from p08_results where name='cancel-A'),'same key returns recorded result');
 other:=cancel_goods_receipt(rid,'p08-cancel-a-2','Klik kedua',current_date);
 perform pg_temp.ok((other->>'already_cancelled')::boolean and other->>'reversal_journal_id'=(select result->>'reversal_journal_id' from p08_results where name='cancel-A'),'second key reports existing cancellation');
 perform pg_temp.ok((select count(*) from stock_moves where source='purchase-receipt-void')=1 and (select count(*) from journal_entries where source='purchase-receipt-void')=1,'no second effect');
 perform pg_temp.ok((select qty from stock where item_id='f8400000-0000-4000-8000-000000000001')=0,'stock unchanged by retry');
 perform pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L,current_date)',rid,'p08-cancel-a','Alasan lain'),'rincian berbeda');
end$$;
select pg_temp.expect_error(format('update goods_receipts set catatan=%L where id=%L','ubah',(select result->>'receipt_id' from p08_results where name='A')),'sudah dibatalkan');
select pg_temp.expect_error(format('delete from goods_receipt_items where receipt_id=%L',(select result->>'receipt_id' from p08_results where name='A')),'sudah dibatalkan');
-- Reopened quantity can be received again through the normal path.
select pg_temp.ok((receive_purchase_order('f8500000-0000-4000-8000-000000000001','p08-receipt-a2','TB.P08.',5,current_date,null,null,
 '[{"id":"f8600000-0000-4000-8000-000000000001","qty_terima":4},{"id":"f8600000-0000-4000-8000-000000000004","qty_terima":1}]')->>'complete')::boolean,'re-receipt after cancel completes PO');
select pg_temp.ok((select qty from stock where item_id='f8400000-0000-4000-8000-000000000001')=40,'re-receipt stocked');

-- 4. Refused while the PO has an active purchase invoice; allowed after that invoice is voided.
reset role;
insert into purchase_invoices(id,no_faktur,po_id,supplier_id,branch_id,warehouse_id,tanggal,total)
 values('f8700000-0000-4000-8000-000000000001','FB.P08.D','f8500000-0000-4000-8000-000000000002','f8300000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000001','f8200000-0000-4000-8000-000000000001',current_date,200);
set local role authenticated;
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L)',(select result->>'receipt_id' from p08_results where name='D'),'p08-cancel-d','Salah PO'),'faktur pembelian aktif');
select pg_temp.ok((select qty from stock where item_id='f8400000-0000-4000-8000-000000000002')=20 and not exists(select 1 from stock_moves where item_id='f8400000-0000-4000-8000-000000000002' and qty<0),'invoiced refusal left stock');
select pg_temp.ok((select voided_at is null from goods_receipts where id=(select (result->>'receipt_id')::uuid from p08_results where name='D')),'invoiced refusal left receipt');
reset role;
update purchase_invoices set voided_at=now(),voided_on=current_date,void_reason='Fiction void' where id='f8700000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.ok(cancel_goods_receipt((select (result->>'receipt_id')::uuid from p08_results where name='D'),'p08-cancel-d2','Salah PO') ? 'reversal_journal_id','voided invoice no longer blocks');
select pg_temp.ok((select qty from stock where item_id='f8400000-0000-4000-8000-000000000002')=0,'receipt D reversed');

-- 5. Refused once any unit of the received SKU left the warehouse after posting.
reset role;
do $$declare issued record;begin
 select * into issued from stock_out_fifo('f8200000-0000-4000-8000-000000000001','f8400000-0000-4000-8000-000000000003',1,'test-consume','TEST.P08.E',current_date);
end$$;
set local role authenticated;
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L)',(select result->>'receipt_id' from p08_results where name='E'),'p08-cancel-e','Salah PO'),'sudah terpakai');
select pg_temp.ok((select qty from stock where item_id='f8400000-0000-4000-8000-000000000003')=19,'consumed refusal left stock');
select pg_temp.ok((select coalesce(qty_terima,0) from purchase_order_items where id='f8600000-0000-4000-8000-000000000003')=2,'consumed refusal left PO');
select pg_temp.ok(not exists(select 1 from journal_entries where source='purchase-receipt-void' and source_ref=(select result->>'no_terima' from p08_results where name='E')),'consumed refusal left journal');

reset role;
-- GL stays balanced overall.
select pg_temp.ok((select sum(debit)=sum(credit) from journal_lines),'ledger balanced');
rollback;
