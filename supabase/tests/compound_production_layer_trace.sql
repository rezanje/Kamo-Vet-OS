-- Fictional isolated fixture only. Never run against target data.
begin;
insert into auth.users(id) values(md5('i09-owner')::uuid),(md5('i09-staff')::uuid),(md5('i09-admin')::uuid);
update profiles set role='OWNER',is_active=true where id=md5('i09-owner')::uuid;
update profiles set role='STAFF',is_active=true where id=md5('i09-staff')::uuid;
update profiles set role='ADMIN',is_active=true where id=md5('i09-admin')::uuid;
insert into role_modules(role,module_id) values('ADMIN','pos');
insert into branches(id,code,name,type) values
 (md5('i09-clinic-branch')::uuid,'I09C','Fictional clinic','KLINIK'),
 (md5('i09-production-branch')::uuid,'I09P','Fictional production','PETSHOP');
insert into warehouses(id,branch_id,code,name,type) values
 (md5('i09-wh')::uuid,md5('i09-production-branch')::uuid,'I09W','Fictional warehouse','RETAIL');
insert into customers(id,name,phone) values(md5('i09-customer')::uuid,'Fictional owner','000');
insert into pets(id,customer_id,name) values(md5('i09-pet')::uuid,md5('i09-customer')::uuid,'Fictional pet');
insert into visits(id,branch_id,customer_id,pet_id) values(md5('i09-visit')::uuid,md5('i09-clinic-branch')::uuid,md5('i09-customer')::uuid,md5('i09-pet')::uuid);
insert into medical_records(id,visit_id) values(md5('i09-record')::uuid,md5('i09-visit')::uuid);
insert into items(id,code,name,unit,item_type,buy_price,sell_price) values(md5('i09-material')::uuid,'I09M','Fictional produced material','PCS','Persediaan',2,3);
insert into compounding_recipes(id,medical_record_id,recipe_name,dosage_instruction,total_volume,dosage_form,compounding_steps)
 values(md5('i09-recipe')::uuid,md5('i09-record')::uuid,'Fictional clinical recipe','Fictional instruction','1','kapsul','Fictional steps');
insert into compounding_ingredients(id,recipe_id,ingredient_name,item_id,quantity,unit)
 values(md5('i09-ingredient')::uuid,md5('i09-recipe')::uuid,'Fictional produced material',md5('i09-material')::uuid,1,'PCS');
insert into production_orders(id,no_produksi,output_item_id,warehouse_id,status,qty_jadi)
 values(md5('i09-job')::uuid,'PRD.I09.00001',md5('i09-material')::uuid,md5('i09-wh')::uuid,'selesai',1);
insert into production_atomic_postings(kind,order_id,actor_id,request_key,payload,source_snapshot,receipt)
 values('start',md5('i09-job')::uuid,md5('i09-owner')::uuid,'i09-start','{}','{}','{}'),
       ('finish',md5('i09-job')::uuid,md5('i09-owner')::uuid,'i09-finish','{}','{}','{}');
insert into stock_layers(id,warehouse_id,item_id,qty_in,qty_left,unit_cost,source,source_ref)
 values(md5('i09-layer')::uuid,md5('i09-wh')::uuid,md5('i09-material')::uuid,1,0,2,'produksi','PRD.I09.00001');
insert into compound_issues(recipe_id,ingredient_id,warehouse_id,item_id,stock_layer_id,qty,unit_cost,physical_unit_cost)
 values(md5('i09-recipe')::uuid,md5('i09-ingredient')::uuid,md5('i09-wh')::uuid,md5('i09-material')::uuid,md5('i09-layer')::uuid,1,2,2);

create function pg_temp.ok(value boolean,label text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'ASSERT %',label;end if;end$$;
create function pg_temp.reject(q text,label text) returns void language plpgsql as $$begin begin execute q;exception when others then return;end;raise exception 'Expected rejection: %',label;end$$;

set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i09-owner')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
select pg_temp.ok((select jsonb_array_length(read_compound_production_layer_trace(md5('i09-recipe')::uuid))=1),'exact production layer traced');
select pg_temp.ok((select read_compound_production_layer_trace(md5('i09-recipe')::uuid)->0->>'no_produksi'='PRD.I09.00001'),'exact production number');
select pg_temp.ok((select read_compound_production_layer_trace(md5('i09-recipe')::uuid)->0->>'restored'='false'),'active issue');
select pg_temp.ok((select read_compound_production_layer_trace(md5('i09-recipe')::uuid)->0 ? 'unit_cost')=false,'cost not exposed');
select pg_temp.ok(not has_table_privilege('authenticated','public.compound_issues','SELECT'),'private issue table remains private');
select set_config('request.headers',jsonb_build_object('x-kamo-operational-branch',md5('i09-clinic-branch')::uuid::text)::text,true);
select pg_temp.reject($q$select read_compound_production_layer_trace(md5('i09-recipe')::uuid)$q$,'production branch denied by operational scope');
select set_config('request.headers','{}',true);
select set_config('request.jwt.claim.sub',md5('i09-staff')::uuid::text,true);
select pg_temp.reject($q$select read_compound_production_layer_trace(md5('i09-recipe')::uuid)$q$,'staff denied');
select set_config('request.jwt.claim.sub',md5('i09-admin')::uuid::text,true);
select pg_temp.reject($q$select read_compound_production_layer_trace(md5('i09-recipe')::uuid)$q$,'admin without clinic module denied');
reset role;
update compound_issues set restored_at=now() where recipe_id=md5('i09-recipe')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i09-owner')::uuid::text,true);
select pg_temp.ok((select read_compound_production_layer_trace(md5('i09-recipe')::uuid)->0->>'restored'='true'),'restored issue explicit');
reset role;
update stock_layers set source_ref='PRD.UNKNOWN' where id=md5('i09-layer')::uuid;
set local role authenticated;
select pg_temp.reject($q$select read_compound_production_layer_trace(md5('i09-recipe')::uuid)$q$,'unknown production source denied');
reset role;
update stock_layers set source_ref='PRD.I09.00001' where id=md5('i09-layer')::uuid;
insert into warehouses(id,branch_id,code,name,type) values(md5('i09-wrong-wh')::uuid,md5('i09-production-branch')::uuid,'I09X','Other fictional warehouse','RETAIL');
update compound_issues set warehouse_id=md5('i09-wrong-wh')::uuid where recipe_id=md5('i09-recipe')::uuid;
set local role authenticated;
select pg_temp.reject($q$select read_compound_production_layer_trace(md5('i09-recipe')::uuid)$q$,'warehouse mismatch denied');
reset role;
rollback;
