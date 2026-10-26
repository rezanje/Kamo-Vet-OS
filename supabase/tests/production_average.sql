-- Fictional moving-average production; disposable PostgreSQL only.
insert into auth.users(id) values(md5('i08-avg-owner')::uuid);
update profiles set role='OWNER',is_active=true where id=md5('i08-avg-owner')::uuid;
insert into branches(id,code,name,type) values(md5('i08-avg-branch')::uuid,'I08AV','Fictional branch','PETSHOP');
insert into warehouses(id,branch_id,code,name,type) values(md5('i08-avg-a')::uuid,md5('i08-avg-branch')::uuid,'I08AVA','Source A','RETAIL'),(md5('i08-avg-b')::uuid,md5('i08-avg-branch')::uuid,'I08AVB','Source B','RETAIL');
insert into items(id,code,name,unit,item_type,buy_price,sell_price) values(md5('i08-avg-material')::uuid,'I08AVM','Fictional material','PCS','Persediaan',2.5,5),(md5('i08-avg-output')::uuid,'I08AVO','Fictional output','PCS','Persediaan',7,10);
insert into coa_accounts(code,name,type,normal_balance) values('1301','Fictional inventory','ASET','D'),('1302','Fictional WIP','ASET','D'),('5101','Fictional HPP','BEBAN','D') on conflict(code) do update set is_active=true,is_header=false;
insert into production_recipes(id,item_id,nama,output_qty) values(md5('i08-avg-recipe')::uuid,md5('i08-avg-output')::uuid,'Fictional recipe',1);
insert into production_recipe_items(recipe_id,item_id,qty) values(md5('i08-avg-recipe')::uuid,md5('i08-avg-material')::uuid,0.125);
create function pg_temp.ok(v boolean,label text) returns void language plpgsql as $$begin if v is distinct from true then raise exception 'ASSERT %',label;end if;end$$;
create function pg_temp.reject(q text,fragment text) returns void language plpgsql as $$begin begin execute q;exception when others then if position(fragment in sqlerrm)=0 then raise exception 'Wrong rejection: %',sqlerrm;end if;return;end;raise exception 'Expected rejection: %',fragment;end$$;
create function pg_temp.fail_average_journal() returns trigger language plpgsql as $$begin raise exception 'Fictional average journal failure';end$$;

begin;
select stock_in_fifo(md5('i08-avg-a')::uuid,md5('i08-avg-material')::uuid,2,2.5,'fixture','I08AVG.A1',current_date-1,null);
select stock_in_fifo(md5('i08-avg-a')::uuid,md5('i08-avg-material')::uuid,3,3.125,'fixture','I08AVG.A2',current_date-1,null);
select stock_in_fifo(md5('i08-avg-a')::uuid,md5('i08-avg-output')::uuid,2,7,'fixture','I08AVG.O',current_date-1,null);
-- Fixture simulates an already reconciled active mode, without activating a target.
update stock set average_cost=2.875 where warehouse_id=md5('i08-avg-a')::uuid and item_id=md5('i08-avg-material')::uuid;
update stock set average_cost=7 where warehouse_id=md5('i08-avg-a')::uuid and item_id=md5('i08-avg-output')::uuid;
update inventory_costing_settings set method='moving_average',activated_at=now() where id;
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i08-avg-owner')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
do $$declare a jsonb;b jsonb;oid uuid;ref text;begin
 a:=post_production_atomic('start','avg-recipe-start',jsonb_build_object('recipe_id',md5('i08-avg-recipe')::uuid,'warehouse_id',md5('i08-avg-a')::uuid,'batch',1,'tanggal',current_date-1));
 oid:=(a->>'order_id')::uuid;ref:=a->>'no_produksi';
 perform pg_temp.ok((a->>'value')::numeric=0.359375,'recipe issues average rather than first FIFO layer');
 perform pg_temp.ok((select hpp=0.359375 from production_order_items where order_id=oid),'frozen material HPP is average');
 perform pg_temp.ok((select sum(value_delta)=-0.359375 from inventory_cost_events where source_ref=ref and item_id=md5('i08-avg-material')::uuid),'average material event balances WIP');
 b:=post_production_atomic('start','avg-recipe-start',jsonb_build_object('recipe_id',md5('i08-avg-recipe')::uuid,'warehouse_id',md5('i08-avg-a')::uuid,'batch',1,'tanggal',current_date-1));
 perform pg_temp.ok((b->>'already_posted')::boolean and b->>'order_id'=oid::text,'recipe retry exact once');
 b:=post_production_atomic('finish','avg-recipe-finish',jsonb_build_object('id',oid,'qty_jadi',7,'tanggal_selesai',current_date));
 perform pg_temp.ok((b->>'value')::numeric=0.359375,'finished output inherits WIP');
 perform pg_temp.ok((select sum(qty*unit_cost)=0.359375 from stock_moves where source='produksi' and source_ref=ref and item_id=md5('i08-avg-output')::uuid and qty>0),'output movement cost conserved');
 perform pg_temp.ok((select qty=9 and average_cost=1.595486111111 from stock where warehouse_id=md5('i08-avg-a')::uuid and item_id=md5('i08-avg-output')::uuid),'output weighted average rounded by existing engine');
 perform pg_temp.ok((select abs(sum(variance))<0.005 from inventory_cost_events where source_ref=ref and item_id=md5('i08-avg-output')::uuid),'output rounding variance below cent');
 perform pg_temp.ok((select sum(l.debit-l.credit)=0 from journal_lines l join coa_accounts c on c.id=l.account_id join journal_entries j on j.id=l.entry_id where c.code='1302' and j.source='produksi' and j.source_ref=ref),'WIP ledger closes');
end$$;
reset role;
select pg_temp.ok((select count(*)=2 from production_atomic_postings),'two and only two stage receipts');
rollback;

-- Positive stock with an unknown moving-average cost must not be priced from
-- the master item price by a production start.
begin;
select stock_in_fifo(md5('i08-avg-a')::uuid,md5('i08-avg-material')::uuid,2,2.5,'fixture','I08AVG.NULL.M',current_date-1,null);
update inventory_costing_settings set method='moving_average',activated_at=now() where id;
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i08-avg-owner')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
select pg_temp.reject($q$select post_production_atomic('start','avg-null-material',jsonb_build_object('recipe_id',md5('i08-avg-recipe')::uuid,'warehouse_id',md5('i08-avg-a')::uuid,'batch',1,'tanggal',current_date-1))$q$,'Valuasi average bahan tidak sesuai WIP');
reset role;
select pg_temp.ok(not exists(select 1 from production_orders),'unknown source cost leaves no order');
select pg_temp.ok(not exists(select 1 from inventory_cost_events where source='produksi'),'unknown source cost leaves no event');
select pg_temp.ok(not exists(select 1 from stock_moves where source='produksi'),'unknown source cost leaves no movement');
rollback;

-- A corrupted NULL output event cannot be hidden by SUM/COALESCE when the
-- numerical total is otherwise zero. The finish rolls back as one unit.
begin;
select stock_in_fifo(md5('i08-avg-a')::uuid,md5('i08-avg-material')::uuid,2,0,'fixture','I08AVG.NULL.EVENT',(date_trunc('month',current_date)-interval '1 month')::date,null);
update stock set average_cost=0 where warehouse_id=md5('i08-avg-a')::uuid and item_id=md5('i08-avg-material')::uuid;
update inventory_costing_settings set method='moving_average',activated_at=date_trunc('month',current_date)-interval '1 month' where id;
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i08-avg-owner')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
create temp table i08_avg_null_event as select post_production_atomic('start','avg-null-output-start',jsonb_build_object('recipe_id',md5('i08-avg-recipe')::uuid,'warehouse_id',md5('i08-avg-a')::uuid,'batch',1,'tanggal',(date_trunc('month',current_date)-interval '1 month')::date)) receipt;
reset role;
create function pg_temp.null_output_event() returns trigger language plpgsql as $$begin if new.source='produksi' and new.qty_delta>0 then new.value_after:=null;end if;return new;end$$;
create trigger fictional_i08_null_output before insert on inventory_cost_events for each row execute function pg_temp.null_output_event();
set local role authenticated;
select pg_temp.reject(format('select post_production_atomic(''finish'',''avg-null-output-finish'',%L::jsonb)',jsonb_build_object('id',(select receipt->>'order_id' from i08_avg_null_event),'qty_jadi',1,'tanggal_selesai',(date_trunc('month',current_date)-interval '1 month')::date)),'Valuasi average barang jadi tidak sesuai jurnal persediaan');
reset role;
select pg_temp.ok((select status='berjalan' from production_orders where id=(select (receipt->>'order_id')::uuid from i08_avg_null_event)),'NULL event keeps order running');
select pg_temp.ok(not exists(select 1 from stock_moves where source='produksi' and qty>0),'NULL event rolls back output');
select pg_temp.ok(not exists(select 1 from production_atomic_postings where kind='finish'),'NULL event leaves no finish proof');
rollback;

begin;
insert into item_units(item_id,unit,factor,sell_price,buy_price) values(md5('i08-avg-material')::uuid,'BOX',2,10,5);
select stock_in_fifo(md5('i08-avg-a')::uuid,md5('i08-avg-material')::uuid,2,2.5,'fixture','I08AVG.A1',current_date-1,null);
select stock_in_fifo(md5('i08-avg-a')::uuid,md5('i08-avg-material')::uuid,3,3.125,'fixture','I08AVG.A2',current_date-1,null);
select stock_in_fifo(md5('i08-avg-b')::uuid,md5('i08-avg-material')::uuid,2,4,'fixture','I08AVG.B1',current_date-1,null);
select stock_in_fifo(md5('i08-avg-b')::uuid,md5('i08-avg-material')::uuid,3,6,'fixture','I08AVG.B2',current_date-1,null);
update stock set average_cost=2.875 where warehouse_id=md5('i08-avg-a')::uuid and item_id=md5('i08-avg-material')::uuid;
update stock set average_cost=5.2 where warehouse_id=md5('i08-avg-b')::uuid and item_id=md5('i08-avg-material')::uuid;
update inventory_costing_settings set method='moving_average',activated_at=now() where id;
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i08-avg-owner')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
do $$declare a jsonb;b jsonb;oid uuid;ref text;payload jsonb;begin
 payload:=jsonb_build_object('mode','adhoc','nama','Fictional multi-source','branch_id',md5('i08-avg-branch')::uuid,'warehouse_id',md5('i08-avg-a')::uuid,'output_item_id',md5('i08-avg-output')::uuid,'output_qty',2,'output_unit','PCS','tanggal',current_date-1,'bahan',jsonb_build_array(jsonb_build_object('item_id',md5('i08-avg-material')::uuid,'warehouse_id',md5('i08-avg-a')::uuid,'qty',1,'satuan','PCS'),jsonb_build_object('item_id',md5('i08-avg-material')::uuid,'warehouse_id',md5('i08-avg-b')::uuid,'qty',1,'satuan','PCS')));
 a:=post_production_adhoc_atomic('start','avg-adhoc-start',payload);oid:=(a->>'order_id')::uuid;ref:=a->>'no_produksi';
 perform pg_temp.ok((a->>'value')::numeric=8.075,'ad hoc sums each warehouse average');
 perform pg_temp.ok((select sum(hpp)=8.075 and count(*)=2 from production_order_items where order_id=oid),'per-source average costs frozen');
 b:=post_production_adhoc_atomic('start','avg-adhoc-start',payload);
 perform pg_temp.ok((b->>'already_posted')::boolean and b->>'order_id'=oid::text,'ad hoc retry exact once');
 perform post_production_atomic('finish','avg-adhoc-finish',jsonb_build_object('id',oid,'qty_jadi',2,'tanggal_selesai',current_date));
 perform pg_temp.ok((select sum(qty*unit_cost)=8.075 from stock_moves where source='produksi' and source_ref=ref and item_id=md5('i08-avg-output')::uuid and qty>0),'ad hoc output inherits cost');
 perform pg_temp.ok((select sum(l.debit-l.credit)=0 from journal_lines l join coa_accounts c on c.id=l.account_id join journal_entries j on j.id=l.entry_id where c.code='1302' and j.source='produksi' and j.source_ref=ref),'ad hoc WIP clears');
end$$;
rollback;

-- A failed WIP journal rolls back issue, order, cost event and receipt together.
begin;
select stock_in_fifo(md5('i08-avg-a')::uuid,md5('i08-avg-material')::uuid,2,2.5,'fixture','I08AVG.FAIL',current_date-1,null);
update stock set average_cost=2.5 where warehouse_id=md5('i08-avg-a')::uuid and item_id=md5('i08-avg-material')::uuid;
update inventory_costing_settings set method='moving_average',activated_at=now() where id;
create trigger fictional_i08_average_journal before insert on journal_lines for each row execute function pg_temp.fail_average_journal();
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i08-avg-owner')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
select pg_temp.reject($q$select post_production_atomic('start','avg-failed-start',jsonb_build_object('recipe_id',md5('i08-avg-recipe')::uuid,'warehouse_id',md5('i08-avg-a')::uuid,'batch',1,'tanggal',current_date-1))$q$,'Fictional average journal failure');
reset role;
select pg_temp.ok(not exists(select 1 from production_orders),'failed average journal leaves no order');
select pg_temp.ok(not exists(select 1 from stock_moves where source='produksi'),'failed average journal leaves no issue');
select pg_temp.ok(not exists(select 1 from inventory_cost_events where source='produksi'),'failed average journal leaves no valuation event');
select pg_temp.ok(not exists(select 1 from production_atomic_postings),'failed average journal leaves no receipt');
rollback;

-- A failure when clearing WIP preserves the running order and consumed source.
begin;
select stock_in_fifo(md5('i08-avg-a')::uuid,md5('i08-avg-material')::uuid,2,2.5,'fixture','I08AVG.FINISH',current_date-1,null);
update stock set average_cost=2.5 where warehouse_id=md5('i08-avg-a')::uuid and item_id=md5('i08-avg-material')::uuid;
update inventory_costing_settings set method='moving_average',activated_at=now() where id;
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i08-avg-owner')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
create temp table i08_avg_started as select post_production_atomic('start','avg-finish-fail-start',jsonb_build_object('recipe_id',md5('i08-avg-recipe')::uuid,'warehouse_id',md5('i08-avg-a')::uuid,'batch',1,'tanggal',current_date-1)) receipt;
reset role;
create trigger fictional_i08_average_journal before insert on journal_lines for each row execute function pg_temp.fail_average_journal();
set local role authenticated;
select pg_temp.reject(format('select post_production_atomic(''finish'',''avg-finish-fail'',%L::jsonb)',jsonb_build_object('id',(select receipt->>'order_id' from i08_avg_started),'qty_jadi',3,'tanggal_selesai',current_date)),'Fictional average journal failure');
reset role;
select pg_temp.ok((select status='berjalan' from production_orders where id=(select (receipt->>'order_id')::uuid from i08_avg_started)),'failed average finish keeps order running');
select pg_temp.ok((select count(*)=1 from production_atomic_postings),'failed average finish has only start receipt');
select pg_temp.ok(not exists(select 1 from stock_moves where source='produksi' and qty>0),'failed average finish has no output');
select pg_temp.ok(not exists(select 1 from inventory_cost_events where source='produksi' and qty_delta>0),'failed average finish has no output valuation');
rollback;

-- Existing output stock can make 12-digit average rounding materially diverge
-- from the WIP journal. Reject the finish atomically instead of booking fiction.
begin;
select stock_in_fifo(md5('i08-avg-a')::uuid,md5('i08-avg-material')::uuid,2,1.05,'fixture','I08AVG.DRIFT.M',current_date-1,null);
select stock_in_fifo(md5('i08-avg-a')::uuid,md5('i08-avg-output')::uuid,100000000000,1,'fixture','I08AVG.DRIFT.O',current_date-1,null);
update stock set average_cost=1.05 where warehouse_id=md5('i08-avg-a')::uuid and item_id=md5('i08-avg-material')::uuid;
update stock set average_cost=1 where warehouse_id=md5('i08-avg-a')::uuid and item_id=md5('i08-avg-output')::uuid;
update inventory_costing_settings set method='moving_average',activated_at=now() where id;
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i08-avg-owner')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
create temp table i08_avg_drift as select post_production_atomic('start','avg-drift-start',jsonb_build_object('recipe_id',md5('i08-avg-recipe')::uuid,'warehouse_id',md5('i08-avg-a')::uuid,'batch',8,'tanggal',current_date-1)) receipt;
select pg_temp.reject(format('select post_production_atomic(''finish'',''avg-drift-finish'',%L::jsonb)',jsonb_build_object('id',(select receipt->>'order_id' from i08_avg_drift),'qty_jadi',1,'tanggal_selesai',current_date)),'Valuasi average barang jadi tidak sesuai jurnal persediaan');
reset role;
select pg_temp.ok((select status='berjalan' from production_orders where id=(select (receipt->>'order_id')::uuid from i08_avg_drift)),'rounding drift leaves source WIP open');
select pg_temp.ok(not exists(select 1 from stock_moves where source='produksi' and qty>0),'rounding drift rolls back output');
select pg_temp.ok(not exists(select 1 from production_atomic_postings where kind='finish'),'rounding drift has no finish receipt');
rollback;

-- An inconsistent material valuation event must never become a WIP journal.
begin;
select stock_in_fifo(md5('i08-avg-a')::uuid,md5('i08-avg-material')::uuid,2,2.5,'fixture','I08AVG.BAD.EVENT',current_date-1,null);
update stock set average_cost=2.5 where warehouse_id=md5('i08-avg-a')::uuid and item_id=md5('i08-avg-material')::uuid;
update inventory_costing_settings set method='moving_average',activated_at=now() where id;
create function pg_temp.distort_average_event() returns trigger language plpgsql as $$begin if new.source='produksi' and new.qty_delta<0 then new.value_delta:=new.value_delta+1;end if;return new;end$$;
create trigger fictional_i08_distorted_event before insert on inventory_cost_events for each row execute function pg_temp.distort_average_event();
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i08-avg-owner')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
select pg_temp.reject($q$select post_production_atomic('start','avg-material-drift',jsonb_build_object('recipe_id',md5('i08-avg-recipe')::uuid,'warehouse_id',md5('i08-avg-a')::uuid,'batch',1,'tanggal',current_date-1))$q$,'Valuasi average bahan tidak sesuai WIP');
reset role;
select pg_temp.ok(not exists(select 1 from production_orders),'material event drift leaves no order');
select pg_temp.ok(not exists(select 1 from stock_moves where source='produksi'),'material event drift leaves no stock issue');
select pg_temp.ok(not exists(select 1 from production_atomic_postings),'material event drift leaves no receipt');
rollback;

-- Existing negative-stock variance policy remains in control when output fills
-- a deficit; no production-specific variance account is created.
begin;
select stock_in_fifo(md5('i08-avg-a')::uuid,md5('i08-avg-material')::uuid,2,2.5,'fixture','I08AVG.NEG.M',current_date-1,null);
select stock_in_fifo(md5('i08-avg-a')::uuid,md5('i08-avg-output')::uuid,1,7,'fixture','I08AVG.NEG.O',current_date-1,null);
update stock set average_cost=2.5 where warehouse_id=md5('i08-avg-a')::uuid and item_id=md5('i08-avg-material')::uuid;
update stock set average_cost=7 where warehouse_id=md5('i08-avg-a')::uuid and item_id=md5('i08-avg-output')::uuid;
update inventory_costing_settings set method='moving_average',activated_at=now() where id;
select stock_out_fifo(md5('i08-avg-a')::uuid,md5('i08-avg-output')::uuid,3,'fixture','I08AVG.NEG.ISSUE',current_date-1);
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i08-avg-owner')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
do $$declare a jsonb;begin
 a:=post_production_atomic('start','avg-negative-start',jsonb_build_object('recipe_id',md5('i08-avg-recipe')::uuid,'warehouse_id',md5('i08-avg-a')::uuid,'batch',1,'tanggal',current_date-1));
 perform post_production_atomic('finish','avg-negative-finish',jsonb_build_object('id',a->>'order_id','qty_jadi',3,'tanggal_selesai',current_date));
 perform pg_temp.ok((select qty=1 from stock where warehouse_id=md5('i08-avg-a')::uuid and item_id=md5('i08-avg-output')::uuid),'average output covers deficit');
 perform pg_temp.ok((select count(*)>0 from journal_entries where source='inventory-variance' and source_ref in(select id::text from stock_moves where source='produksi' and source_ref=a->>'no_produksi' and qty>0)),'existing variance journal covers deficit');
end$$;
rollback;

-- Zero is a known cost, not an unknown cost. The receipt, event, and closing
-- snapshot must all keep zero instead of silently recording NULL value.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i08-avg-owner')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
select activate_moving_average();
reset role;
-- Shift only the fictional activation timestamp to exercise a completed month.
update inventory_costing_settings set activated_at=date_trunc('month',current_date)-interval '1 month' where id;
select stock_in_fifo(md5('i08-avg-a')::uuid,md5('i08-avg-material')::uuid,2,0,'fixture','I08AVG.ZERO.M',(date_trunc('month',current_date)-interval '1 month')::date,null);
select pg_temp.ok((select qty=2 and average_cost=0 from stock where warehouse_id=md5('i08-avg-a')::uuid and item_id=md5('i08-avg-material')::uuid),'zero-cost receipt stores known zero average');
set local role authenticated;
do $$declare a jsonb;b jsonb;ref text;begin
 a:=post_production_atomic('start','avg-zero-start',jsonb_build_object('recipe_id',md5('i08-avg-recipe')::uuid,'warehouse_id',md5('i08-avg-a')::uuid,'batch',1,'tanggal',(date_trunc('month',current_date)-interval '1 month')::date));
 ref:=a->>'no_produksi';
 perform pg_temp.ok((a->>'value')::numeric=0,'zero-cost issue is known zero');
 b:=post_production_atomic('finish','avg-zero-finish',jsonb_build_object('id',a->>'order_id','qty_jadi',1,'tanggal_selesai',(date_trunc('month',current_date)-interval '1 month')::date));
 perform pg_temp.ok((b->>'value')::numeric=0,'zero-cost output is known zero');
 perform pg_temp.ok((select qty=1 and average_cost=0 from stock where warehouse_id=md5('i08-avg-a')::uuid and item_id=md5('i08-avg-output')::uuid),'positive output has known zero average');
 perform pg_temp.ok((select count(*)=1 and bool_and(value_delta=0 and value_after=0 and average_after=0) from inventory_cost_events where source='produksi' and source_ref=ref and item_id=md5('i08-avg-output')::uuid and qty_delta>0),'output event has known zero values');
 perform pg_temp.ok((select count(*)=0 from journal_entries where source='produksi' and source_ref=ref),'zero value needs no invented journal amount');
 perform pg_temp.ok((close_inventory_month((date_trunc('month',current_date)-interval '1 month')::date)->>'already_closed')::boolean=false,'zero-cost month closes');
 perform pg_temp.ok((select qty=1 and average_cost=0 and value=0 from inventory_month_values where warehouse_id=md5('i08-avg-a')::uuid and item_id=md5('i08-avg-output')::uuid),'closing snapshot preserves known zero');
end$$;
rollback;
