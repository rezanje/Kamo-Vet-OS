-- Uses only fictional fixture helpers from pos_merchant_fees.sql; production RPCs unchanged.
update profiles set role='OWNER' where id='e1100000-0000-4000-8000-000000000001';
insert into customers(id,name,phone,points) values('e9900000-0000-4000-8000-000000000001','Cancellation test','000-TEST-VOID',0);
insert into stock(warehouse_id,item_id,qty) values('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',10) on conflict(warehouse_id,item_id) do update set qty=10;
insert into stock_layers(id,warehouse_id,item_id,qty_in,qty_left,unit_cost,source,exp_date) values
('e8800000-0000-4000-8000-000000000001','e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',3,3,123.45,'manual','2030-01-01'),
('e8800000-0000-4000-8000-000000000002','e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',7,7,234.56,'manual','2031-01-01');
create function pg_temp.cancel(ref text,key text default null) returns jsonb language sql as $$select cancel_posted_sale((select id from sales where no_struk=ref),0,coalesce(key,'cancel:'||ref),'Salah input barang')$$;
create function pg_temp.stock_sale(ref text) returns uuid language plpgsql as $$declare doc uuid;issued record;begin
 doc:=pg_temp.fee_sale(ref);
 select * into issued from sale_stock_out_fifo('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',4,'sale',ref);
 insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp) values(doc,'e5500000-0000-4000-8000-000000000002','Four base units',2,50000,'box',2,issued.cost);
 perform finalize_pos_sale(doc);return doc;
end$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select pg_temp.fee_sale('VOID.FEE');
select pg_temp.lines((select id from sales where no_struk='VOID.FEE'));
select finalize_pos_sale((select id from sales where no_struk='VOID.FEE'));
select pg_temp.reject($q$update sales set voided_at=now() where no_struk='VOID.FEE'$q$,'direct cancellation metadata');
select pg_temp.cancel('VOID.FEE');
select pg_temp.cancel('VOID.FEE');
select pg_temp.assert_ok((select voided_at is not null and revision=1 from sales where no_struk='VOID.FEE'),'source void state once');
select pg_temp.assert_ok((select count(*)=1 from sale_cancellations where sale_id=(select id from sales where no_struk='VOID.FEE')),'durable audit once');
select pg_temp.assert_ok((select count(*)=1 from journal_entries where source='sale-void'),'one revenue reversal on retry');
select pg_temp.assert_ok(not exists(select account_id from journal_lines l join journal_entries e on e.id=l.entry_id where e.source in('sale','sale-void') group by account_id having sum(debit-credit)<>0),'exact cash, split, merchant fee reversal');
select pg_temp.reject($q$select pg_temp.cancel('VOID.FEE','other-key')$q$,'stale second cancellation');
select pg_temp.reject($q$select pg_temp.refund('VOID.FEE','late-return',1)$q$,'no return after cancellation');
select pg_temp.reject($q$update sales set marketplace_status='cair' where no_struk='VOID.FEE'$q$,'void state immutable');
select pg_temp.reject($q$delete from journal_lines where entry_id in(select id from journal_entries where source='sale-void')$q$,'reversal journal immutable');
select pg_temp.stock_sale('VOID.STOCK');
select pg_temp.assert_ok((select qty=6 from stock where item_id='e5500000-0000-4000-8000-000000000002'),'stock issued');
select pg_temp.cancel('VOID.STOCK');
select pg_temp.assert_ok((select qty=10 from stock where item_id='e5500000-0000-4000-8000-000000000002'),'stock restored');
select pg_temp.assert_ok((select qty_left=3 and unit_cost=123.45 and exp_date='2030-01-01' from stock_layers where id='e8800000-0000-4000-8000-000000000001'),'first exact FIFO layer restored');
select pg_temp.assert_ok((select qty_left=7 and unit_cost=234.56 and exp_date='2031-01-01' from stock_layers where id='e8800000-0000-4000-8000-000000000002'),'second exact FIFO layer restored');
select pg_temp.assert_ok(not exists(select account_id from journal_lines l join journal_entries e on e.id=l.entry_id where e.source in('sale-hpp','sale-void-hpp') group by account_id having sum(debit-credit)<>0),'exact HPP reversal');
-- Missing FIFO provenance fails closed even if the historical HPP looks plausible.
select pg_temp.fee_sale('VOID.LEGACY');
select pg_temp.lines((select id from sales where no_struk='VOID.LEGACY'),100000,10,'e5500000-0000-4000-8000-000000000002');
select finalize_pos_sale((select id from sales where no_struk='VOID.LEGACY'));
select pg_temp.reject($q$select pg_temp.cancel('VOID.LEGACY')$q$,'legacy incomplete FIFO');
select pg_temp.assert_ok((select voided_at is null from sales where no_struk='VOID.LEGACY'),'failed cancellation preserves sale');
-- Both original and reversal period, current role, active state and branch rechecked on replay.
select pg_temp.fee_sale('VOID.PERIOD');select pg_temp.lines((select id from sales where no_struk='VOID.PERIOD'));select finalize_pos_sale((select id from sales where no_struk='VOID.PERIOD'));
reset role;
update accounting_locks set closed_until=(now() at time zone 'Asia/Jakarta')::date;
set local role authenticated;
select pg_temp.reject($q$select pg_temp.cancel('VOID.PERIOD')$q$,'closed period');
reset role;
update accounting_locks set closed_until=null;
update profiles set is_active=false where id='e1100000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.reject($q$select pg_temp.cancel('VOID.FEE')$q$,'inactive retry');
reset role;
update profiles set is_active=true,role='STAFF' where id='e1100000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.reject($q$select pg_temp.cancel('VOID.FEE')$q$,'demoted retry');
reset role;
update profiles set role='OWNER' where id='e1100000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.headers','{"x-kamo-operational-branch":"e2200000-0000-4000-8000-000000000002"}',true);
select pg_temp.reject($q$select pg_temp.cancel('VOID.FEE')$q$,'branch retry');
select set_config('request.headers','{}',true);
-- Existing refund must retain its original sale; cancellation cannot double refund.
select pg_temp.fee_sale('VOID.RETURN');select pg_temp.lines((select id from sales where no_struk='VOID.RETURN'));select finalize_pos_sale((select id from sales where no_struk='VOID.RETURN'));
select pg_temp.refund('VOID.RETURN','return-first',1);
select pg_temp.reject($q$select pg_temp.cancel('VOID.RETURN')$q$,'existing refund');
-- Changed tax configuration cannot alter the source reversal.
reset role;
update company_settings set mode_pkp=true,ppn_rate=11;
set local role authenticated;
select pg_temp.fee_sale('VOID.VAT');select pg_temp.lines((select id from sales where no_struk='VOID.VAT'));select finalize_pos_sale((select id from sales where no_struk='VOID.VAT'));
reset role;
update company_settings set ppn_rate=12;
set local role authenticated;
select pg_temp.cancel('VOID.VAT');
select pg_temp.assert_ok(not exists(select account_id from journal_lines l join journal_entries e on e.id=l.entry_id where e.source_ref='VOID.VAT' or e.source_ref=(select id::text from sale_cancellations where sale_id=(select id from sales where no_struk='VOID.VAT')) group by account_id having sum(debit-credit)<>0),'VAT and fee reverse exact original rate');
-- Group component snapshots, not today's recipe, determine inventory restoration.
reset role;
insert into items(id,code,name,unit,item_type) values('e5500000-0000-4000-8000-000000000003','VOIDGROUP','Group test','set','Grup');
insert into item_group_components(group_item_id,component_item_id,qty,unit,factor) values('e5500000-0000-4000-8000-000000000003','e5500000-0000-4000-8000-000000000002',4,'pcs',1);
set local role authenticated;
do $$ declare doc uuid;line uuid:=gen_random_uuid();issued record;begin
 doc:=pg_temp.fee_sale('VOID.GROUP');
 select * into issued from sale_stock_out_fifo('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',4,'sale-group','VOID.GROUP',p_sale_line_id=>line);
 insert into sale_items(id,sale_id,item_id,nama,qty,harga,satuan,faktor,hpp) values(line,doc,'e5500000-0000-4000-8000-000000000003','Group',1,100000,'set',1,issued.cost) returning id into line;
 insert into sale_item_group_components(sale_item_id,component_item_id,component_name,item_type,qty_per_group,unit,factor,total_base_qty,hpp) values(line,'e5500000-0000-4000-8000-000000000002','Stock component','Persediaan',4,'pcs',1,4,issued.cost);
 perform finalize_pos_sale(doc);perform pg_temp.cancel('VOID.GROUP');
end$$;
select pg_temp.assert_ok((select qty=10 from stock where item_id='e5500000-0000-4000-8000-000000000002'),'group source restored stock');
-- Normal checkout rounds each component and the raw parent sum independently.
-- Two group lines share both SKUs, so attribution cannot be inferred from SKU totals.
savepoint fractional_group_costs;
reset role;
insert into items(id,code,name,unit,item_type) values('e5500000-0000-4000-8000-000000000004','VOIDGROUPPART','Group fractional component','pcs','Persediaan');
insert into stock(warehouse_id,item_id,qty) values('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000004',10);
insert into stock_layers(warehouse_id,item_id,qty_in,qty_left,unit_cost,source) values('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000004',10,10,123.45,'manual');
update item_group_components set qty=0.111 where group_item_id='e5500000-0000-4000-8000-000000000003';
insert into item_group_components(group_item_id,component_item_id,qty,unit,factor) values('e5500000-0000-4000-8000-000000000003','e5500000-0000-4000-8000-000000000004',0.111,'pcs',1);
create function pg_temp.fraction_group_sale(ref text,bad_parent boolean default false,bad_component boolean default false) returns uuid language plpgsql as $$
declare doc uuid;line uuid;first_issue record;second_issue record;n integer;shift_cost numeric;begin
 doc:=pg_temp.fee_sale(ref);
 for n in 1..2 loop
  line:=gen_random_uuid();shift_cost:=case when n=1 then 0.01 else -0.01 end;
  select * into first_issue from sale_stock_out_fifo('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',0.111,'sale-group',ref,p_sale_line_id=>line);
  select * into second_issue from sale_stock_out_fifo('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000004',0.111,'sale-group',ref,p_sale_line_id=>line);
  insert into sale_items(id,sale_id,item_id,nama,qty,harga,satuan,faktor,hpp) values(line,doc,'e5500000-0000-4000-8000-000000000003','Fraction group',1,50000,'set',1,first_issue.cost+second_issue.cost+case when bad_parent then shift_cost else 0 end);
  insert into sale_item_group_components(sale_item_id,component_item_id,component_name,item_type,qty_per_group,unit,factor,total_base_qty,hpp) values
   (line,'e5500000-0000-4000-8000-000000000002','First component','Persediaan',0.111,'pcs',1,0.111,first_issue.cost+case when bad_component then shift_cost else 0 end),
   (line,'e5500000-0000-4000-8000-000000000004','Second component','Persediaan',0.111,'pcs',1,0.111,second_issue.cost);
 end loop;
 perform finalize_pos_sale(doc);return doc;
end$$;
set local role authenticated;
select pg_temp.fraction_group_sale('VOID.GROUP.FRACTION');
select pg_temp.assert_ok((select sum(hpp)=54.82 from sale_items where sale_id=(select id from sales where no_struk='VOID.GROUP.FRACTION')),'raw parent sums round independently');
select pg_temp.assert_ok((select sum(c.hpp)=54.80 from sale_item_group_components c join sale_items i on i.id=c.sale_item_id where i.sale_id=(select id from sales where no_struk='VOID.GROUP.FRACTION')),'component costs round individually');
select pg_temp.cancel('VOID.GROUP.FRACTION');select pg_temp.cancel('VOID.GROUP.FRACTION');
select pg_temp.assert_ok((select qty=10 from stock where item_id='e5500000-0000-4000-8000-000000000004'),'fraction group restores other component once');
select pg_temp.assert_ok((select qty=10 from stock where item_id='e5500000-0000-4000-8000-000000000002'),'fraction group restores original component once');
select pg_temp.assert_ok(not exists(select l.account_id from journal_lines l join journal_entries e on e.id=l.entry_id where e.source_ref='VOID.GROUP.FRACTION' or e.source_ref=(select id::text from sale_cancellations where sale_id=(select id from sales where no_struk='VOID.GROUP.FRACTION')) group by l.account_id having sum(l.debit-l.credit)<>0),'fraction group exact original journal reversal');
savepoint tampered_group_parent;
select pg_temp.fraction_group_sale('VOID.GROUP.BADPARENT',true,false);
select pg_temp.reject($q$select pg_temp.cancel('VOID.GROUP.BADPARENT')$q$,'redistributed parent HPP cannot pass aggregate equality');
select pg_temp.assert_ok((select voided_at is null from sales where no_struk='VOID.GROUP.BADPARENT'),'bad parent cancellation has no effect');
rollback to tampered_group_parent;
savepoint tampered_group_component;
select pg_temp.fraction_group_sale('VOID.GROUP.BADCOMPONENT',false,true);
select pg_temp.reject($q$select pg_temp.cancel('VOID.GROUP.BADCOMPONENT')$q$,'redistributed same-SKU component HPP cannot pass aggregate equality');
select pg_temp.assert_ok((select voided_at is null from sales where no_struk='VOID.GROUP.BADCOMPONENT'),'bad component cancellation has no effect');
rollback to tampered_group_component;
-- Failed finalization leaves the same pending source available for repair/retry.
do $$ declare doc uuid;line uuid:=gen_random_uuid();wrong_line uuid;issued record;begin
 doc:=pg_temp.fee_sale('VOID.LINE.RETRY');
 select * into issued from sale_stock_out_fifo('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',1,'sale','VOID.LINE.RETRY',p_sale_line_id=>line);
 insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp) values(doc,'e5500000-0000-4000-8000-000000000002','Unlinked line',1,100000,'pcs',1,issued.cost) returning id into wrong_line;
 perform pg_temp.reject(format('select finalize_pos_sale(%L)',doc),'unresolved line identity cannot finalize');
 if exists(select 1 from journal_entries where source_ref='VOID.LINE.RETRY') then raise exception 'Failed link validation left posted journals';end if;
 delete from sale_items where id=wrong_line;
 insert into sale_items(id,sale_id,item_id,nama,qty,harga,satuan,faktor,hpp) values(line,doc,'e5500000-0000-4000-8000-000000000002','Linked line',1,100000,'pcs',1,issued.cost);
 perform finalize_pos_sale(doc);perform finalize_pos_sale(doc);perform pg_temp.cancel('VOID.LINE.RETRY');
end$$;
select pg_temp.fee_sale('VOID.LINE.FORGE');
select pg_temp.reject($q$select sale_stock_out_fifo('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',1,'sale','VOID.LINE.FORGE',p_sale_line_id=>(select id from sale_items where sale_id=(select id from sales where no_struk='VOID.GROUP') limit 1))$q$,'line owned by another sale rejected before stock consumption');
select pg_temp.reject($q$insert into stock_moves(warehouse_id,item_id,qty,unit_cost,source,source_ref,sale_line_id) values('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',-1,123.45,'sale','VOID.LINE.FORGE',gen_random_uuid())$q$,'direct logical line forgery');
select pg_temp.assert_ok((select qty=10 from stock where item_id='e5500000-0000-4000-8000-000000000002'),'forged line leaves stock unchanged');
-- Failing the final capture-link write rolls back stock, layer and movement together.
select pg_temp.fee_sale('VOID.LINE.CAPFAIL');
reset role;
create function pg_temp.fail_issue_link() returns trigger language plpgsql as $$begin if new.source_ref='VOID.LINE.CAPFAIL' and new.sale_line_id is not null then raise exception 'Injected issue link capture failure';end if;return new;end$$;
create trigger test_fail_issue_link before update on stock_moves for each row execute function pg_temp.fail_issue_link();
set local role authenticated;
select pg_temp.reject($q$select sale_stock_out_fifo('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',1,'sale','VOID.LINE.CAPFAIL',p_sale_line_id=>'eab00000-0000-4000-8000-000000000001')$q$,'failed logical link capture is atomic');
select pg_temp.assert_ok((select qty=10 from stock where item_id='e5500000-0000-4000-8000-000000000002'),'failed logical link capture restores stock');
select pg_temp.assert_ok(not exists(select 1 from stock_moves where source_ref='VOID.LINE.CAPFAIL'),'failed logical link capture leaves no movement');
reset role;
drop trigger test_fail_issue_link on stock_moves;
set local role authenticated;
select sale_stock_out_fifo('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',1,'sale','VOID.LINE.CAPFAIL',p_sale_line_id=>'eab00000-0000-4000-8000-000000000001');
select pg_temp.assert_ok((select count(*)=1 and max(sale_line_id::text)='eab00000-0000-4000-8000-000000000001' from stock_moves where source_ref='VOID.LINE.CAPFAIL'),'retry after rollback captures one issue');
rollback to fractional_group_costs;
-- Earned/redeemed loyalty is offset once and spending/tier recomputed atomically.
reset role;
update customers set points=200 where id='e9900000-0000-4000-8000-000000000001';
set local role authenticated;
insert into sales(branch_id,customer_id,no_struk,subtotal,total,metode_bayar,bayar,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint,poin_earned,poin_digunakan)
values('e2200000-0000-4000-8000-000000000001','e9900000-0000-4000-8000-000000000001','VOID.LOYAL',100000,100000,'Tunai',100000,auth.uid(),'e4400000-0000-4000-8000-000000000001','[{"method":"Tunai","amount":100000}]','void-loyal',repeat('b',64),100,50);
select pg_temp.lines((select id from sales where no_struk='VOID.LOYAL'));select finalize_pos_sale((select id from sales where no_struk='VOID.LOYAL'));
select pg_temp.assert_ok((select points=250 from customers where id='e9900000-0000-4000-8000-000000000001'),'source loyalty issued');
select pg_temp.cancel('VOID.LOYAL');select pg_temp.cancel('VOID.LOYAL');
select pg_temp.assert_ok((select points=200 and total_spending=0 and tier='New' from customers where id='e9900000-0000-4000-8000-000000000001'),'loyalty balance spending tier restored once');
select pg_temp.assert_ok((select sum(delta)=0 from point_ledger where ref='VOID.LOYAL'),'loyalty ledger exact offset');
-- A failure at the final audit insert must roll back all inventory and money.
select pg_temp.stock_sale('VOID.ROLLBACK');
reset role;
create function pg_temp.fail_cancel_audit() returns trigger language plpgsql as $$begin raise exception 'Injected final audit failure';end$$;
create trigger test_fail_sale_audit before insert on sale_cancellations for each row execute function pg_temp.fail_cancel_audit();
set local role authenticated;
select pg_temp.reject($q$select pg_temp.cancel('VOID.ROLLBACK')$q$,'late failure');
select pg_temp.assert_ok((select voided_at is null and revision=0 from sales where no_struk='VOID.ROLLBACK'),'late failure source rollback');
select pg_temp.assert_ok((select qty=6 from stock where item_id='e5500000-0000-4000-8000-000000000002'),'late failure stock rollback');
select pg_temp.assert_ok((select qty_left=0 from stock_layers where id='e8800000-0000-4000-8000-000000000001'),'late failure FIFO rollback');
reset role;
drop trigger test_fail_sale_audit on sale_cancellations;
set local role authenticated;
select pg_temp.cancel('VOID.ROLLBACK');
-- Per-issue rounding does not excuse an actual incorrect source HPP.
savepoint incorrect_source_hpp;
do $$ declare doc uuid;issued record;begin
 doc:=pg_temp.fee_sale('VOID.BAD.HPP');
 select * into issued from sale_stock_out_fifo('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',4,'sale','VOID.BAD.HPP');
 insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp) values(doc,'e5500000-0000-4000-8000-000000000002','Wrong HPP',2,50000,'box',2,issued.cost+0.01);
 perform finalize_pos_sale(doc);
end$$;
select pg_temp.reject($q$select pg_temp.cancel('VOID.BAD.HPP')$q$,'true source HPP mismatch still blocked');
select pg_temp.assert_ok((select qty=6 from stock where item_id='e5500000-0000-4000-8000-000000000002'),'mismatched source cancellation does not change stock');
rollback to incorrect_source_hpp;
-- New provenance cannot be forged; a failure writing it rolls FIFO consumption back.
select pg_temp.fee_sale('VOID.CAPTURE');
select pg_temp.reject($q$insert into stock_moves(warehouse_id,item_id,qty,unit_cost,source,source_ref,fifo_takes,fifo_shortfall) values('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',-1,123.45,'sale','VOID.CAPTURE','[]',0)$q$,'forged provenance');
select pg_temp.reject($q$select stock_out_fifo('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',1,'sale','VOID.CAPTURE')$q$,'old direct sale FIFO path cannot forge provenance');
select pg_temp.assert_ok((select qty=10 from stock where item_id='e5500000-0000-4000-8000-000000000002'),'rejected capture rolls stock back');
select pg_temp.assert_ok((select qty_left=3 from stock_layers where id='e8800000-0000-4000-8000-000000000001'),'rejected capture rolls layer back');
delete from sales where no_struk='VOID.CAPTURE';
savepoint other_fifo_callers;
do $$ declare src text;issued record;begin
 foreach src in array array['produksi','opname','penyesuaian','retur-beli','klinik-edit','terima-permintaan'] loop
  select * into issued from stock_out_fifo('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',0.1,src,'OTHER.FIFO');
  if issued.cost<>12.345 or issued.shortfall<>0 or jsonb_array_length(issued.takes)<>1 then raise exception 'Shared FIFO caller changed: %',src;end if;
 end loop;
end$$;
select pg_temp.assert_ok(not exists(select 1 from stock_moves where source_ref='OTHER.FIFO' and (fifo_takes is not null or fifo_shortfall is not null)),'non-sale callers do not capture sale provenance');
rollback to other_fifo_callers;
-- Other stock-out callers preserve return shape and never capture sale provenance.
do $$ declare issued record;begin
 select * into issued from stock_out_fifo('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',1,'transfer-out','VOID.TRANSFER');
 if issued.cost<>123.45 or issued.shortfall<>0 or jsonb_array_length(issued.takes)<>1 then raise exception 'Shared FIFO contract changed';end if;
end$$;
select pg_temp.assert_ok((select fifo_takes is null and fifo_shortfall is null from stock_moves where source_ref='VOID.TRANSFER'),'non-sale provenance untouched');
-- Online cancellation uses original warehouse and exact marketplace/WA accounts.
reset role;
insert into item_units(item_id,unit,factor,sell_price,buy_price) values('e5500000-0000-4000-8000-000000000002','box',2,666.66,246.90);
insert into warehouses(id,branch_id,code,name,type) values('e3300000-0000-4000-8000-000000000003','e2200000-0000-4000-8000-000000000001','VOIDONLINE','Online warehouse','ONLINE');
set local role authenticated;
select stock_in_fifo('e3300000-0000-4000-8000-000000000003','e5500000-0000-4000-8000-000000000002',10,123.45,'manual','VOID.ONLINE.SEED');
do $$ declare result jsonb;doc uuid;ref text;begin
 result:=post_online_order('void-online',jsonb_build_object('warehouse_id','e3300000-0000-4000-8000-000000000003','channel','Shopee','tanggal',(now() at time zone 'Asia/Jakarta')::date),'[{"item_id":"e5500000-0000-4000-8000-000000000002","qty":2,"harga":222.22,"satuan":"pcs"}]');
 doc:=(result->>'document_id')::uuid;ref:=result->>'document_no';
 perform cancel_posted_sale(doc,0,'void-online-cancel','Salah barang online');
 if not exists(select 1 from sales where id=doc and voided_at is not null) then raise exception 'Online not voided';end if;
 if exists(select account_id from journal_lines l join journal_entries e on e.id=l.entry_id where e.source_ref=ref or e.source_ref=(select id::text from sale_cancellations where sale_id=doc) group by account_id having sum(debit-credit)<>0) then raise exception 'Online accounts do not reconcile';end if;
 result:=post_online_order('void-online-fraction',jsonb_build_object('warehouse_id','e3300000-0000-4000-8000-000000000003','channel','Shopee','tanggal',(now() at time zone 'Asia/Jakarta')::date),'[{"item_id":"e5500000-0000-4000-8000-000000000002","qty":0.333,"harga":333.33,"satuan":"pcs"}]');
 doc:=(result->>'document_id')::uuid;ref:=result->>'document_no';
 perform cancel_posted_sale(doc,0,'void-fraction-cancel','Salah jumlah pecahan');
 if exists(select account_id from journal_lines l join journal_entries e on e.id=l.entry_id where e.source_ref=ref or e.source_ref=(select id::text from sale_cancellations where sale_id=doc) group by account_id having sum(debit-credit)<>0) then raise exception 'Fractional original ledger not exactly reversed';end if;
 result:=post_online_order('void-online-duplicate',jsonb_build_object('warehouse_id','e3300000-0000-4000-8000-000000000003','channel','Shopee','tanggal',(now() at time zone 'Asia/Jakarta')::date),'[{"item_id":"e5500000-0000-4000-8000-000000000002","qty":0.111,"harga":333.33,"satuan":"pcs"},{"item_id":"e5500000-0000-4000-8000-000000000002","qty":0.0555,"harga":666.66,"satuan":"box"}]');
 doc:=(result->>'document_id')::uuid;ref:=result->>'document_no';
 if (select sum(hpp) from sale_items where sale_id=doc)<>27.40 then raise exception 'Expected individually rounded source HPP';end if;
 if (select sum(debit) from journal_lines l join journal_entries e on e.id=l.entry_id where e.source_ref=ref and e.source='sale-online-hpp')<>27.40590 then raise exception 'Expected raw online journal HPP';end if;
 perform cancel_posted_sale(doc,0,'void-duplicate-cancel','Salah jumlah pecahan campur satuan');
 if (select qty from stock where warehouse_id='e3300000-0000-4000-8000-000000000003' and item_id='e5500000-0000-4000-8000-000000000002')<>10 then raise exception 'Duplicate mixed-unit exact quantity not restored';end if;
 if exists(select account_id from journal_lines l join journal_entries e on e.id=l.entry_id where e.source_ref=ref or e.source_ref=(select id::text from sale_cancellations where sale_id=doc) group by account_id having sum(debit-credit)<>0) then raise exception 'Duplicate mixed-unit raw journal not reversed exactly';end if;
 result:=post_online_order('void-online-wa',jsonb_build_object('warehouse_id','e3300000-0000-4000-8000-000000000003','channel','WA','customer_id','e9900000-0000-4000-8000-000000000001','tanggal',(now() at time zone 'Asia/Jakarta')::date),'[{"item_id":"e5500000-0000-4000-8000-000000000002","qty":1,"harga":10000,"satuan":"pcs"}]');
 doc:=(result->>'document_id')::uuid;
 perform cancel_posted_sale(doc,0,'void-wa-cancel','Salah barang WA');
end$$;
select pg_temp.assert_ok((select qty=10 from stock where warehouse_id='e3300000-0000-4000-8000-000000000003' and item_id='e5500000-0000-4000-8000-000000000002'),'online exact warehouse restoration');
select pg_temp.assert_ok((select points=200 and total_spending=0 from customers where id='e9900000-0000-4000-8000-000000000001'),'WA loyalty and spending restored');
-- A newly posted cashier sale can undo its attributable staff rewards exactly.
reset role;
insert into staff_quest_definitions(id,quest_type,title,target_kind,target_value,points_reward)
 values('eaa00000-0000-4000-8000-000000000001','daily','Cancellation reward','total_sales_amount',1,10),
 ('eaa00000-0000-4000-8000-000000000002','daily','Merchandise threshold','total_sales_amount',101000,100);
insert into staff_points(staff_id,total_points) values('e1100000-0000-4000-8000-000000000001',7);
update quest_settings set streak_bonus_every_days=1,streak_bonus_points=5;
set local role authenticated;
select pg_temp.fee_sale('VOID.QUEST');select pg_temp.lines((select id from sales where no_struk='VOID.QUEST'));select finalize_pos_sale((select id from sales where no_struk='VOID.QUEST'));
select apply_sale_staff_effects((select id from sales where no_struk='VOID.QUEST'));
select apply_sale_staff_effects((select id from sales where no_struk='VOID.QUEST'));
select pg_temp.assert_ok((select current_value=100000 and status='in_progress' from staff_quest_progress where staff_id=auth.uid() and quest_definition_id='eaa00000-0000-4000-8000-000000000002'),'merchant fee cannot complete merchandise quest');
select pg_temp.assert_ok((select total_points=22 from staff_points where staff_id=auth.uid()),'quest and streak award once');
select pg_temp.cancel('VOID.QUEST');select pg_temp.cancel('VOID.QUEST');
select pg_temp.assert_ok((select total_points=7 from staff_points where staff_id=auth.uid()),'exact previous staff points restored');
select pg_temp.assert_ok(not exists(select 1 from staff_quest_progress where staff_id=auth.uid()),'new progress removed');
select pg_temp.assert_ok(not exists(select 1 from staff_streaks where staff_id=auth.uid()),'new streak removed');
select pg_temp.assert_ok((select sum(points_delta)=0 from staff_points_ledger where staff_id=auth.uid()),'reward ledger offsets once');
select pg_temp.reject($q$select apply_sale_staff_effects((select id from sales where no_struk='VOID.QUEST'))$q$,'no late quest effects after void');
select pg_temp.fee_sale('VOID.QUEST.A');select pg_temp.lines((select id from sales where no_struk='VOID.QUEST.A'));select finalize_pos_sale((select id from sales where no_struk='VOID.QUEST.A'));select apply_sale_staff_effects((select id from sales where no_struk='VOID.QUEST.A'));
select pg_temp.fee_sale('VOID.QUEST.B');select pg_temp.lines((select id from sales where no_struk='VOID.QUEST.B'));select finalize_pos_sale((select id from sales where no_struk='VOID.QUEST.B'));select apply_sale_staff_effects((select id from sales where no_struk='VOID.QUEST.B'));
select pg_temp.reject($q$select pg_temp.cancel('VOID.QUEST.A')$q$,'later progress cannot be lost');
select pg_temp.assert_ok((select current_value=200000 from staff_quest_progress where staff_id=auth.uid() and quest_definition_id='eaa00000-0000-4000-8000-000000000001'),'failed earlier cancellation preserves later progress');
select pg_temp.cancel('VOID.QUEST.B');select pg_temp.cancel('VOID.QUEST.A');
select pg_temp.assert_ok((select total_points=7 from staff_points where staff_id=auth.uid()),'reverse order preserves exact previous rewards');

-- Same-day effects with identical snapshots still have an ordered dependency.
reset role;
create temporary table noop_active_quests as select id from staff_quest_definitions where is_active;
update staff_quest_definitions set is_active=false where is_active;
update quest_settings set streak_bonus_points=0;
set local role authenticated;
select pg_temp.fee_sale('VOID.NOOP.0.A');select pg_temp.lines((select id from sales where no_struk='VOID.NOOP.0.A'));select finalize_pos_sale((select id from sales where no_struk='VOID.NOOP.0.A'));select apply_sale_staff_effects((select id from sales where no_struk='VOID.NOOP.0.A'));
select pg_temp.fee_sale('VOID.NOOP.0.B');select pg_temp.lines((select id from sales where no_struk='VOID.NOOP.0.B'));select finalize_pos_sale((select id from sales where no_struk='VOID.NOOP.0.B'));select apply_sale_staff_effects((select id from sales where no_struk='VOID.NOOP.0.B'));
reset role;
select pg_temp.assert_ok((select a.after_value=b.after_value and a.created_at=b.created_at and a.effect_order<b.effect_order from sale_staff_effects a join sales sa on sa.id=a.sale_id cross join sale_staff_effects b join sales sb on sb.id=b.sale_id where sa.no_struk='VOID.NOOP.0.A' and sb.no_struk='VOID.NOOP.0.B'),'no-op has identical state and timestamp but ordered provenance');
set local role authenticated;
select pg_temp.reject($q$select pg_temp.cancel('VOID.NOOP.0.A')$q$,'later no-op activity blocks earlier streak reversal');
select pg_temp.assert_ok((select count(*)=2 from sales where no_struk in('VOID.NOOP.0.A','VOID.NOOP.0.B') and voided_at is null),'failed cancellation preserves both sales');
select pg_temp.assert_ok((select current_streak_days=1 from staff_streaks where staff_id=auth.uid()),'failed cancellation preserves today streak');
select pg_temp.assert_ok((select total_points=7 from staff_points where staff_id=auth.uid()),'failed cancellation preserves streak bonus');
select pg_temp.cancel('VOID.NOOP.0.B');
select pg_temp.assert_ok((select current_streak_days=1 from staff_streaks where staff_id=auth.uid()),'no-op reverse preserves earlier active streak');
select pg_temp.cancel('VOID.NOOP.0.A');select pg_temp.cancel('VOID.NOOP.0.A');
select pg_temp.assert_ok(not exists(select 1 from staff_streaks where staff_id=auth.uid()),'reverse order restores original absent streak');
select pg_temp.assert_ok((select total_points=7 from staff_points where staff_id=auth.uid()),'reverse order offsets bonus exactly once');
select pg_temp.assert_ok((select sum(points_delta)=0 from staff_points_ledger where staff_id=auth.uid()),'reverse order ledger net zero');
reset role;
update quest_settings set streak_bonus_points=5;
set local role authenticated;
select pg_temp.fee_sale('VOID.NOOP.5.A');select pg_temp.lines((select id from sales where no_struk='VOID.NOOP.5.A'));select finalize_pos_sale((select id from sales where no_struk='VOID.NOOP.5.A'));select apply_sale_staff_effects((select id from sales where no_struk='VOID.NOOP.5.A'));
select pg_temp.fee_sale('VOID.NOOP.5.B');select pg_temp.lines((select id from sales where no_struk='VOID.NOOP.5.B'));select finalize_pos_sale((select id from sales where no_struk='VOID.NOOP.5.B'));select apply_sale_staff_effects((select id from sales where no_struk='VOID.NOOP.5.B'));
reset role;
select pg_temp.assert_ok((select a.after_value=b.after_value and a.created_at=b.created_at and a.effect_order<b.effect_order from sale_staff_effects a join sales sa on sa.id=a.sale_id cross join sale_staff_effects b join sales sb on sb.id=b.sale_id where sa.no_struk='VOID.NOOP.5.A' and sb.no_struk='VOID.NOOP.5.B'),'no-op has identical state and timestamp but ordered provenance');
set local role authenticated;
select pg_temp.reject($q$select pg_temp.cancel('VOID.NOOP.5.A')$q$,'later no-op activity blocks earlier streak reversal');
select pg_temp.assert_ok((select count(*)=2 from sales where no_struk in('VOID.NOOP.5.A','VOID.NOOP.5.B') and voided_at is null),'failed cancellation preserves both sales');
select pg_temp.assert_ok((select current_streak_days=1 from staff_streaks where staff_id=auth.uid()),'failed cancellation preserves today streak');
select pg_temp.assert_ok((select total_points=12 from staff_points where staff_id=auth.uid()),'failed cancellation preserves streak bonus');
select pg_temp.cancel('VOID.NOOP.5.B');
select pg_temp.assert_ok((select current_streak_days=1 from staff_streaks where staff_id=auth.uid()),'no-op reverse preserves earlier active streak');
select pg_temp.cancel('VOID.NOOP.5.A');select pg_temp.cancel('VOID.NOOP.5.A');
select pg_temp.assert_ok(not exists(select 1 from staff_streaks where staff_id=auth.uid()),'reverse order restores original absent streak');
select pg_temp.assert_ok((select total_points=7 from staff_points where staff_id=auth.uid()),'reverse order offsets bonus exactly once');
select pg_temp.assert_ok((select sum(points_delta)=0 from staff_points_ledger where staff_id=auth.uid()),'reverse order ledger net zero');
reset role;
update staff_quest_definitions set is_active=true where id in(select id from noop_active_quests);
update quest_settings set streak_bonus_points=5;
set local role authenticated;

-- Redemption is one durable transaction and becomes an explicit downstream dependency.
reset role;
insert into staff_reward_catalog(id,reward_name,reward_type,points_cost) values('ebb00000-0000-4000-8000-000000000001','Cancellation test reward','free_product',10);
set local role authenticated;
select pg_temp.reject($q$select redeem_staff_reward('ebb00000-0000-4000-8000-000000000001','insufficient')$q$,'insufficient balance');
select pg_temp.assert_ok(not exists(select 1 from staff_reward_redemptions where staff_id=auth.uid()),'insufficient balance has no partial redemption');
select pg_temp.reject($q$update staff_points set total_points=999 where staff_id=auth.uid()$q$,'direct balance overwrite');
select pg_temp.reject($q$insert into staff_points_ledger(staff_id,points_delta,source_type) values(auth.uid(),999,'manual_adjustment')$q$,'direct ledger award');
select pg_temp.fee_sale('VOID.REDEEM');select pg_temp.lines((select id from sales where no_struk='VOID.REDEEM'));select finalize_pos_sale((select id from sales where no_struk='VOID.REDEEM'));select apply_sale_staff_effects((select id from sales where no_struk='VOID.REDEEM'));
select redeem_staff_reward('ebb00000-0000-4000-8000-000000000001','redeem-once');
select redeem_staff_reward('ebb00000-0000-4000-8000-000000000001','redeem-once');
select pg_temp.assert_ok((select total_points=12 from staff_points where staff_id=auth.uid()),'redemption subtracts once');
select pg_temp.assert_ok((select count(*)=1 from staff_reward_redemptions where staff_id=auth.uid()),'redemption retry once');
select pg_temp.assert_ok((select count(*)=1 and sum(points_delta)=-10 from staff_points_ledger where staff_id=auth.uid() and source_type='reward_redemption'),'redemption ledger once');
select pg_temp.reject($q$select pg_temp.cancel('VOID.REDEEM')$q$,'redeemed rewards require reconciliation');
select pg_temp.assert_ok((select total_points=12 from staff_points where staff_id=auth.uid()),'failed cancellation preserves redemption balance');
select pg_temp.reject($q$select * from staff_reward_requests$q$,'redemption requests private');
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000002',true);
select pg_temp.reject($q$select redeem_staff_reward('ebb00000-0000-4000-8000-000000000001','redeem-once')$q$,'cannot replay another employee redemption');
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
reset role;
update profiles set is_active=false where id='e1100000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.reject($q$select redeem_staff_reward('ebb00000-0000-4000-8000-000000000001','redeem-once')$q$,'inactive redemption replay');
reset role;
update profiles set is_active=true where id='e1100000-0000-4000-8000-000000000001';
set local role authenticated;
select claim_staff_quest((select id from staff_quest_progress where staff_id=auth.uid() and quest_definition_id='eaa00000-0000-4000-8000-000000000001'));
select pg_temp.assert_ok((select status='claimed' from staff_quest_progress where staff_id=auth.uid() and quest_definition_id='eaa00000-0000-4000-8000-000000000001'),'existing quest claim preserved');
update staff_reward_redemptions set status='fulfilled',fulfilled_by=auth.uid(),fulfilled_at=now() where staff_id=auth.uid();
select pg_temp.assert_ok((select status='fulfilled' and points_spent=10 from staff_reward_redemptions where staff_id=auth.uid()),'manager fulfillment preserves exact points');

-- Invalid request, private request storage, and settled marketplace are denied.
select pg_temp.reject($q$select cancel_posted_sale((select id from sales where no_struk='VOID.PERIOD'),0,'bad-reason','x')$q$,'reason required');
select pg_temp.reject($q$select * from sale_cancellation_requests$q$,'request history private');
select pg_temp.reject($q$select pg_temp.cancel('VOID.FEE','cancel:VOID.STOCK')$q$,'request identity cannot target another sale');
do $$ declare result jsonb;doc uuid;begin
 result:=post_online_order('void-settled',jsonb_build_object('warehouse_id','e3300000-0000-4000-8000-000000000003','channel','Shopee','tanggal',(now() at time zone 'Asia/Jakarta')::date),'[{"item_id":"e5500000-0000-4000-8000-000000000001","qty":1,"harga":10000,"satuan":"pcs"}]');
 doc:=(result->>'document_id')::uuid;
 update sales set marketplace_status='cair',disbursed_at=now() where id=doc;
 begin
  perform cancel_posted_sale(doc,0,'void-settled-cancel','Salah order cair');
  raise exception 'Settled marketplace should reject';
 exception when others then if sqlerrm not like '%marketplace sudah dicairkan%' then raise;end if;end;
end$$;
-- Changed source layers cannot be restored at a guessed historical cost.
select pg_temp.stock_sale('VOID.REPRICED');
reset role;
update stock_layers set unit_cost=999 where id='e8800000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.reject($q$select pg_temp.cancel('VOID.REPRICED')$q$,'repriced historical layer');
select pg_temp.assert_ok((select qty=5 from stock where warehouse_id='e3300000-0000-4000-8000-000000000001' and item_id='e5500000-0000-4000-8000-000000000002'),'failed layer restoration leaves issued stock');
reset role;
update stock_layers set unit_cost=123.45 where id='e8800000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.cancel('VOID.REPRICED');

-- A closed cashier shift is a hard dependency, even when the accounting month is open.
reset role;
update cashier_shifts set status='closed',
 expected_cash=(select coalesce(sum(p.amount),0) from sale_payments p join sales s on s.id=p.sale_id where s.shift_id=cashier_shifts.id and s.voided_at is null and p.method='Tunai')-(select coalesce(sum(jumlah),0) from expenses where shift_id=cashier_shifts.id and metode_bayar='Tunai'),
 closing_breakdown='{"Tunai":0,"Transfer":0,"Debit":0,"Kredit":0,"QRIS":0,"E-Wallet":0}'::jsonb || (select jsonb_object_agg(method,amount) from(select p.method,sum(p.amount) amount from sale_payments p join sales s on s.id=p.sale_id where s.shift_id=cashier_shifts.id and s.voided_at is null group by p.method) x)
 where id='e4400000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.reject($q$select pg_temp.cancel('VOID.PERIOD')$q$,'closed shift');

rollback;
