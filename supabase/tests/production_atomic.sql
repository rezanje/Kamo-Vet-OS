-- Fictional fixtures; only the owned isolated PostgreSQL runner.
insert into auth.users(id) values(md5('i08-owner')::uuid),(md5('i08-staff')::uuid),(md5('i08-admin')::uuid);
update profiles set role='OWNER',is_active=true where id=md5('i08-owner')::uuid;
update profiles set role='STAFF',is_active=true where id=md5('i08-staff')::uuid;
update profiles set role='ADMIN',is_active=true where id=md5('i08-admin')::uuid;
insert into branches(id,code,name,type) values(md5('i08-branch')::uuid,'I08A','Fictional branch','PETSHOP'),(md5('i08-other')::uuid,'I08B','Other fictional branch','PETSHOP');
insert into warehouses(id,branch_id,code,name,type) values(md5('i08-wh')::uuid,md5('i08-branch')::uuid,'I08A','Fictional warehouse','RETAIL'),(md5('i08-other-wh')::uuid,md5('i08-other')::uuid,'I08B','Other fictional warehouse','RETAIL');
insert into items(id,code,name,unit,item_type,buy_price,sell_price) values(md5('i08-material')::uuid,'I08A','Fictional material','PCS','Persediaan',2.5,5),(md5('i08-output')::uuid,'I08B','Fictional output','PCS','Persediaan',3,6);
insert into coa_accounts(code,name,type,normal_balance) values('1301','Fictional inventory','ASET','D'),('1302','Fictional WIP','ASET','D') on conflict(code) do update set is_active=true,is_header=false;
insert into production_recipes(id,item_id,nama,output_qty) values(md5('i08-recipe')::uuid,md5('i08-output')::uuid,'Fictional recipe',1);
insert into production_recipe_items(recipe_id,item_id,qty) values(md5('i08-recipe')::uuid,md5('i08-material')::uuid,0.125);
create function pg_temp.ok(v boolean,label text) returns void language plpgsql as $$begin if v is distinct from true then raise exception 'ASSERT %',label;end if;end$$;
create function pg_temp.reject(q text,label text) returns void language plpgsql as $$begin begin execute q;exception when others then return;end;raise exception 'Expected rejection: %',label;end$$;
create function pg_temp.input(wh text default 'i08-wh',batch numeric default 1) returns jsonb language sql as $$select jsonb_build_object('recipe_id',md5('i08-recipe')::uuid,'warehouse_id',md5(wh)::uuid,'batch',batch,'tanggal',current_date-1,'catatan','Fictional job')$$;

create function pg_temp.fail_journal() returns trigger language plpgsql as $$begin raise exception 'Fictional journal failure';end$$;

-- Before widening, these inserts round exact FIFO 0.3125 to 0.31.
begin;
insert into production_orders(id,no_produksi,recipe_id,warehouse_id,nilai_bahan) values(md5('i08-precision')::uuid,'PRD.FICTION.PRECISION',md5('i08-recipe')::uuid,md5('i08-wh')::uuid,0.3125);
insert into production_order_items(order_id,item_id,nama,qty,hpp) values(md5('i08-precision')::uuid,md5('i08-material')::uuid,'Fictional material',0.125,0.3125);
select pg_temp.ok((select nilai_bahan=0.3125 from production_orders where id=md5('i08-precision')::uuid),'WIP retains full FIFO precision');
select pg_temp.ok((select hpp=0.3125 from production_order_items where order_id=md5('i08-precision')::uuid),'material retains full FIFO precision');
rollback;

begin;
select stock_in_fifo(md5('i08-wh')::uuid,md5('i08-material')::uuid,2,2.5,'fixture','I08-SEED',current_date-1,null);
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i08-owner')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
do $$declare a jsonb;b jsonb;c jsonb;oid uuid;begin
 a:=post_production_atomic('start','i08-start',pg_temp.input());oid:=(a->>'order_id')::uuid;
 if (a->>'value')::numeric<>0.3125 then raise exception 'FIFO cost rounded';end if;
 b:=post_production_atomic('start','i08-start',pg_temp.input());
 if b->>'order_id'<>oid::text or (b->>'already_posted')::boolean is distinct from true then raise exception 'Start retry duplicated';end if;
 perform pg_temp.reject($q$select post_production_atomic('start','i08-start',pg_temp.input('i08-wh',2))$q$,'changed start payload');
 b:=post_production_atomic('finish','i08-finish',jsonb_build_object('id',oid,'qty_jadi',3,'tanggal_selesai',current_date));
 c:=post_production_atomic('finish','i08-finish-again',jsonb_build_object('id',oid,'qty_jadi',3,'tanggal_selesai',current_date));
 if (c->>'already_posted')::boolean is distinct from true then raise exception 'Finish retry not replayed';end if;
 if (select qty from stock where warehouse_id=md5('i08-wh')::uuid and item_id=md5('i08-output')::uuid)<>3 then raise exception 'Output duplicated';end if;
 if (select sum(qty_in*unit_cost) from stock_layers where source='produksi' and source_ref=a->>'no_produksi' and item_id=md5('i08-output')::uuid)<>0.3125 then raise exception 'Output residual allocation lost WIP';end if;
 if (select sum(l.debit-l.credit) from journal_lines l join coa_accounts ac on ac.id=l.account_id join journal_entries j on j.id=l.entry_id where ac.code='1302' and j.source='produksi' and j.source_ref=a->>'no_produksi')<>0 then raise exception 'WIP not cleared';end if;
 if (select count(*) from journal_entries where source='produksi' and source_ref=a->>'no_produksi')<>2 then raise exception 'Journals duplicated';end if;
 if (select min(tanggal) from stock_moves where source='produksi' and qty<0)<>current_date-1 then raise exception 'Material date mismatch';end if;
 perform pg_temp.reject(format('update production_orders set qty_jadi=9 where id=%L',oid),'late source mutation');
 perform pg_temp.reject(format('delete from production_order_items where order_id=%L',oid),'late material mutation');
end$$;
reset role;
select pg_temp.ok((select count(*)=2 from production_atomic_postings),'two durable stage receipts');
rollback;

begin;
select stock_in_fifo(md5('i08-wh')::uuid,md5('i08-material')::uuid,2,2.5,'fixture','I08-SEED',current_date-1,null);
create trigger fictional_i08_fail before insert on journal_lines for each row execute function pg_temp.fail_journal();
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i08-owner')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
select pg_temp.reject($q$select post_production_atomic('start','i08-gl-fail',pg_temp.input())$q$,'failed journal');
select pg_temp.ok(not exists(select 1 from production_orders),'no partial order');
select pg_temp.ok(not exists(select 1 from stock_moves where source='produksi'),'no partial material issue');
reset role;
select pg_temp.ok(not exists(select 1 from production_atomic_postings),'no false receipt');
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i08-staff')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
select pg_temp.reject($q$select post_production_atomic('start','i08-role',pg_temp.input())$q$,'staff denied');
reset role;
insert into user_branches(user_id,branch_id) values(md5('i08-admin')::uuid,md5('i08-branch')::uuid);
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i08-admin')::uuid::text,true);
select pg_temp.reject($q$select post_production_atomic('start','i08-branch',pg_temp.input('i08-other-wh'))$q$,'other branch denied');
select pg_temp.reject($q$select post_production_atomic('start','i08-short',pg_temp.input())$q$,'stock shortage');
reset role;
select pg_temp.ok(not exists(select 1 from production_orders),'rejections no source');
rollback;

begin;
select stock_in_fifo(md5('i08-wh')::uuid,md5('i08-material')::uuid,2,2.5,'fixture','I08-SEED',current_date-1,null);
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i08-owner')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
create temp table fiction_receipt as select post_production_atomic('start','i08-finish-failure',pg_temp.input()) receipt;
reset role;
create trigger fictional_i08_fail before insert on journal_lines for each row execute function pg_temp.fail_journal();
set local role authenticated;
select pg_temp.reject(format('select post_production_atomic(''finish'',''finish-fail'',%L::jsonb)',jsonb_build_object('id',(select receipt->>'order_id' from fiction_receipt),'qty_jadi',1,'tanggal_selesai',current_date)),'finish journal failed');
select pg_temp.ok((select status='berjalan' from production_orders where id=(select (receipt->>'order_id')::uuid from fiction_receipt)),'finish error retains running order');
select pg_temp.ok(coalesce((select qty from stock where warehouse_id=md5('i08-wh')::uuid and item_id=md5('i08-output')::uuid),0)=0,'finish error no output');
reset role;
select pg_temp.ok((select count(*)=1 from production_atomic_postings),'finish error no successful receipt');
rollback;

begin;
select stock_in_fifo(md5('i08-wh')::uuid,md5('i08-material')::uuid,2,2.5,'fixture','I08-SEED',current_date-1,null);
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i08-owner')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
create temp table fiction_receipt as select post_production_atomic('start','i08-freeze',pg_temp.input()) receipt;
reset role;
-- Master changes after material issue must not alter the authoritative output.
update production_recipes set item_id=md5('i08-material')::uuid,nama='Changed after issue',is_active=false where id=md5('i08-recipe')::uuid;
set local role authenticated;
select post_production_atomic('finish','i08-frozen-finish',jsonb_build_object('id',(select receipt->>'order_id' from fiction_receipt),'qty_jadi',0.003,'tanggal_selesai',current_date));
select pg_temp.ok((read_production_atomic_sources(array[(select (receipt->>'order_id')::uuid from fiction_receipt)])->(select receipt->>'order_id' from fiction_receipt)->>'recipe_name')='Fictional recipe','read frozen source despite master edit');
select pg_temp.ok((select qty=0.003 from stock where warehouse_id=md5('i08-wh')::uuid and item_id=md5('i08-output')::uuid),'frozen output identity');
select pg_temp.ok((select sum(qty_in*unit_cost)=0.3125 from stock_layers where source='produksi' and item_id=md5('i08-output')::uuid),'fractional output conserves cost');
rollback;

begin;
select stock_in_fifo(md5('i08-wh')::uuid,md5('i08-material')::uuid,2,2.5,'fixture','I08-SEED',current_date-1,null);
insert into stock(warehouse_id,item_id,qty) values(md5('i08-wh')::uuid,md5('i08-output')::uuid,-5) on conflict(warehouse_id,item_id) do update set qty=-5;
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i08-owner')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
do $$declare a jsonb;begin
 a:=post_production_atomic('start','i08-negative-output',pg_temp.input());
 perform post_production_atomic('finish','i08-negative-output-finish',jsonb_build_object('id',a->>'order_id','qty_jadi',3,'tanggal_selesai',current_date));
end$$;
select pg_temp.ok((select qty=-2 from stock where warehouse_id=md5('i08-wh')::uuid and item_id=md5('i08-output')::uuid),'negative output covers deficit once');
select pg_temp.ok(not exists(select 1 from stock_layers where item_id=md5('i08-output')::uuid),'no phantom positive layers');
select pg_temp.ok((select sum(qty*unit_cost)=0.3125 from stock_moves where source='produksi' and item_id=md5('i08-output')::uuid),'incoming movement cost matches consumed WIP');
rollback;

-- The active moving-average mode is covered by production_average.sql. It no
-- longer rejects production after the reviewed costing mode has been enabled.

begin;
select stock_in_fifo(md5('i08-wh')::uuid,md5('i08-material')::uuid,2,0,'fixture','I08-FREE',current_date-1,null);
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i08-owner')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
do $$declare a jsonb;begin
 a:=post_production_atomic('start','i08-free',pg_temp.input());
 perform post_production_atomic('finish','i08-free-finish',jsonb_build_object('id',a->>'order_id','qty_jadi',1,'tanggal_selesai',current_date));
end$$;
select pg_temp.ok(not exists(select 1 from journal_entries where source='produksi'),'free production has no invented money');
select pg_temp.ok((select qty=1 from stock where warehouse_id=md5('i08-wh')::uuid and item_id=md5('i08-output')::uuid),'free output quantity');
rollback;

begin;
select stock_in_fifo(md5('i08-wh')::uuid,md5('i08-material')::uuid,2,2.5,'fixture','I08-SEED',current_date-1,null);
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i08-owner')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
create temp table fiction_receipt as select post_production_atomic('start','i08-audit',pg_temp.input()) receipt;
reset role;
create function pg_temp.audit_failure() returns trigger language plpgsql as $$begin if new.row_entity='production_orders' then raise exception 'Fictional audit failure';end if;return new;end$$;
create trigger fictional_i08_audit before insert on activity_log for each row execute function pg_temp.audit_failure();
set local role authenticated;
select pg_temp.reject(format('select post_production_atomic(''finish'',''audit-fail'',%L::jsonb)',jsonb_build_object('id',(select receipt->>'order_id' from fiction_receipt),'qty_jadi',1,'tanggal_selesai',current_date)),'audit failure');
select pg_temp.ok((select status='berjalan' from production_orders where id=(select (receipt->>'order_id')::uuid from fiction_receipt)),'audit error retains running order');
select pg_temp.ok(coalesce((select qty from stock where warehouse_id=md5('i08-wh')::uuid and item_id=md5('i08-output')::uuid),0)=0,'audit rollback no output');
reset role;
select pg_temp.ok((select count(*)=1 from production_atomic_postings),'audit failure no final receipt');
rollback;

begin;
update accounting_locks set closed_until=current_date where id;
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i08-owner')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
select pg_temp.reject($q$select post_production_atomic('start','i08-period',pg_temp.input())$q$,'closed period');
select pg_temp.ok(not exists(select 1 from production_orders),'closed period no source');
rollback;

begin;
select stock_in_fifo(md5('i08-wh')::uuid,md5('i08-material')::uuid,2,2.5,'fixture','I08-MODE-GUARD',current_date-1,null);
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i08-owner')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
select post_production_atomic('start','i08-mode-guard',pg_temp.input());
reset role;
select pg_temp.reject($q$update inventory_costing_settings set method='moving_average' where id$q$,'activation cannot strand proof-backed running FIFO WIP');
select pg_temp.ok((select method='fifo' from inventory_costing_settings where id),'blocked activation retains FIFO');
rollback;

begin;
insert into stock(warehouse_id,item_id,qty) values(md5('i08-wh')::uuid,md5('i08-material')::uuid,'Infinity');
insert into stock_layers(warehouse_id,item_id,qty_in,qty_left,unit_cost,source,source_ref) values(md5('i08-wh')::uuid,md5('i08-material')::uuid,'Infinity','Infinity',2.5,'fixture','I08-NONFINITE');
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i08-owner')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
select pg_temp.reject($q$select post_production_atomic('start','i08-nonfinite',pg_temp.input())$q$,'nonfinite stock cannot create WIP');
select pg_temp.ok(not exists(select 1 from production_orders),'nonfinite stock no source');
rollback;
