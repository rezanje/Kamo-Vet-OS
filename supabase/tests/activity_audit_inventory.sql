begin;
-- Fictional, isolated fixtures only. No source policy or guard is disabled.
do $$declare t text;begin
 foreach t in array array['item_categories','item_units','item_price_tiers','item_branch_prices','item_group_components','item_variant_families','item_variant_members','stock','stock_moves','stock_layers','opname_order_items','opname_counts','production_recipes','production_recipe_items','production_orders','production_order_items','cashier_shifts','sale_drafts','quest_settings','staff_quest_definitions','staff_quest_progress','staff_points','staff_streaks','staff_points_ledger','staff_reward_catalog','staff_reward_redemptions','point_ledger','sale_staff_effects','sale_item_group_components','inventory_costing_settings','inventory_cost_events','inventory_month_closes','inventory_month_values','stock_document_issue_proofs'] loop
  if not exists(select 1 from activity_log_sources where entity=t) then raise exception 'Inventory source missing: %',t;end if;
  if (select count(*) from pg_trigger where tgrelid=('public.'||t)::regclass and tgname in('a01_activity_change','a01_activity_delete') and not tgisinternal)<>2 then raise exception 'Inventory triggers missing: %',t;end if;
 end loop;
end$$;
insert into auth.users(id,raw_user_meta_data) values
 (md5('a01-inv-owner')::uuid,'{"full_name":"Inventory Owner"}'),
 (md5('a01-inv-admin')::uuid,'{"full_name":"Inventory Admin"}');
update profiles set role='OWNER',is_active=true where id=md5('a01-inv-owner')::uuid;
update profiles set role='ADMIN',is_active=true where id=md5('a01-inv-admin')::uuid;
insert into role_capabilities(role,all_branches) values('ADMIN',false) on conflict(role) do update set all_branches=false;
insert into branches(id,code,name,type) values
 (md5('a01-inv-a')::uuid,'A01-INV-A','Inventory A','PETSHOP'),
 (md5('a01-inv-b')::uuid,'A01-INV-B','Inventory B','PETSHOP');
insert into user_branches(user_id,branch_id) values(md5('a01-inv-admin')::uuid,md5('a01-inv-a')::uuid);
insert into warehouses(id,branch_id,code,name,type) values
 (md5('a01-inv-wa')::uuid,md5('a01-inv-a')::uuid,'A01-INV-WA','Inventory warehouse A','RETAIL'),
 (md5('a01-inv-wb')::uuid,md5('a01-inv-b')::uuid,'A01-INV-WB','Inventory warehouse B','RETAIL');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',md5('a01-inv-owner')::uuid::text,true);
insert into items(id,code,name) values
 (md5('a01-inv-i1')::uuid,'A01-INV-I1','PRIVATE ITEM 1'),
 (md5('a01-inv-i2')::uuid,'A01-INV-I2','PRIVATE ITEM 2');
-- Registry module-map values are configuration, not SKU business references.
insert into items(id,code,name) values(md5('a01-inv-module-code')::uuid,'pos','PRIVATE UNUSED MODULE CODE');
update items set code='A01-INV-POS-RENAMED' where id=md5('a01-inv-module-code')::uuid;
do $$begin if (select code from items where id=md5('a01-inv-module-code')::uuid)<>'A01-INV-POS-RENAMED' then raise exception 'Registry module map froze unused SKU code';end if;end$$;
insert into item_categories(id,name,track_expiry,track_batch) values(md5('a01-inv-category')::uuid,'PRIVATE CATEGORY',true,true);
update item_categories set is_active=false,name='PRIVATE CATEGORY EDIT' where id=md5('a01-inv-category')::uuid;
insert into item_units(id,item_id,unit,factor,sell_price,buy_price) values(md5('a01-inv-unit')::uuid,md5('a01-inv-i1')::uuid,'PRIVATE UNIT',2,20,10);
update item_units set sell_price=25 where id=md5('a01-inv-unit')::uuid;
delete from item_units where id=md5('a01-inv-unit')::uuid;
insert into item_price_tiers(id,item_id,min_qty,harga) values(md5('a01-inv-tier')::uuid,md5('a01-inv-i1')::uuid,2,18);
update item_price_tiers set harga=17 where id=md5('a01-inv-tier')::uuid;
delete from item_price_tiers where id=md5('a01-inv-tier')::uuid;
insert into items(id,code,name,item_type) values(md5('a01-inv-group')::uuid,'A01-INV-GROUP','PRIVATE GROUP','Grup');
select replace_item_group_components(md5('a01-inv-group')::uuid,jsonb_build_array(jsonb_build_object('component_item_id',md5('a01-inv-i2')::uuid,'qty',2,'unit','pcs','factor',1,'sort_order',0)));
update item_group_components set qty=3 where group_item_id=md5('a01-inv-group')::uuid;
select replace_item_group_components(md5('a01-inv-group')::uuid,'[]');
insert into item_branch_prices(id,item_id,branch_id,unit,sell_price) values(md5('a01-inv-price')::uuid,md5('a01-inv-i1')::uuid,md5('a01-inv-a')::uuid,'PRIVATE PRICE UNIT',30);
update item_branch_prices set branch_id=md5('a01-inv-b')::uuid,sell_price=40 where id=md5('a01-inv-price')::uuid;
delete from item_branch_prices where id=md5('a01-inv-price')::uuid;
-- Official family RPC exercises composite identities and replacement deletes.
select set_config('a01.inv.family',replace_item_variant_family(null,'PRIVATE FAMILY',null,
 jsonb_build_array(jsonb_build_object('item_id',md5('a01-inv-i1')::uuid,'label','PRIVATE MEMBER 1','sort_order',1),jsonb_build_object('item_id',md5('a01-inv-i2')::uuid,'label','PRIVATE MEMBER 2','sort_order',2)))::text,true);
select replace_item_variant_family(current_setting('a01.inv.family')::uuid,'PRIVATE FAMILY EDIT',null,
 jsonb_build_array(jsonb_build_object('item_id',md5('a01-inv-i1')::uuid,'label','PRIVATE MEMBER EDIT','sort_order',2),jsonb_build_object('item_id',md5('a01-inv-i2')::uuid,'label','PRIVATE MEMBER 2','sort_order',1)));
insert into item_variant_families(id,name) values(md5('a01-inv-family-b')::uuid,'PRIVATE FAMILY B');
update item_variant_members set family_id=md5('a01-inv-family-b')::uuid where family_id=current_setting('a01.inv.family')::uuid and item_id=md5('a01-inv-i1')::uuid;
delete from item_variant_families where id=md5('a01-inv-family-b')::uuid;
do $$begin
 if (select count(*) from activity_log where row_entity='item_units' and row_id=md5('a01-inv-unit')::uuid::text)<>3 then raise exception 'Unit CUD evidence missing';end if;
 if not exists(select 1 from activity_log where row_entity='item_units' and action='update' and (after_state->>'sell_price')::numeric=25) then raise exception 'Unit numeric snapshot absent';end if;
 if not exists(select 1 from activity_log where row_entity='item_branch_prices' and action='update' and branch_ids @> array[md5('a01-inv-a')::uuid,md5('a01-inv-b')::uuid]) then raise exception 'Branch-price reparent lost scope';end if;
 if (select count(distinct row_id) from activity_log where row_entity='item_variant_members' and action='create')<>2 then raise exception 'Composite member identity collision';end if;
 if not exists(select 1 from activity_log where row_entity='item_variant_members' and action='update' and entity_ids @> array[current_setting('a01.inv.family'),md5('a01-inv-family-b')::uuid::text]) then raise exception 'Composite reparent lost histories';end if;
 if not exists(select 1 from activity_log where row_entity='item_variant_members' and action='delete' and entity_id=md5('a01-inv-family-b')::uuid::text) then raise exception 'Composite cascade history missing';end if;
end$$;
insert into opname_orders(id,no_opname,warehouse_id,tanggal_mulai,penanggung_jawab) values
 (md5('a01-inv-oa')::uuid,'A01-INV-OA',md5('a01-inv-wa')::uuid,current_date,'PRIVATE STAFF A'),
 (md5('a01-inv-ob')::uuid,'A01-INV-OB',md5('a01-inv-wb')::uuid,current_date,'PRIVATE STAFF B');
insert into opname_order_items(id,order_id,item_id) values(md5('a01-inv-oi')::uuid,md5('a01-inv-oa')::uuid,md5('a01-inv-i1')::uuid);
insert into opname_counts(id,order_id,item_id,qty_fisik,qty_sistem) values(md5('a01-inv-count')::uuid,md5('a01-inv-oa')::uuid,md5('a01-inv-i1')::uuid,8,10);
update opname_counts set order_id=md5('a01-inv-ob')::uuid,qty_fisik=9 where id=md5('a01-inv-count')::uuid;
delete from opname_orders where id=md5('a01-inv-ob')::uuid;
delete from opname_orders where id=md5('a01-inv-oa')::uuid;
insert into production_recipes(id,item_id,nama,output_qty) values(md5('a01-inv-recipe')::uuid,md5('a01-inv-i1')::uuid,'PRIVATE RECIPE',2);
insert into production_recipe_items(id,recipe_id,item_id,qty) values(md5('a01-inv-material')::uuid,md5('a01-inv-recipe')::uuid,md5('a01-inv-i2')::uuid,1);
update production_recipe_items set qty=2 where id=md5('a01-inv-material')::uuid;
insert into production_orders(id,no_produksi,recipe_id,warehouse_id,catatan) values(md5('a01-inv-production')::uuid,'A01-INV-PRODUCTION',md5('a01-inv-recipe')::uuid,md5('a01-inv-wa')::uuid,'PRIVATE PRODUCTION NOTE');
insert into production_order_items(id,order_id,item_id,nama,qty,hpp) values(md5('a01-inv-production-line')::uuid,md5('a01-inv-production')::uuid,md5('a01-inv-i2')::uuid,'PRIVATE MATERIAL',2,20);
update production_orders set qty_jadi=2,status='selesai',tanggal_selesai=current_date where id=md5('a01-inv-production')::uuid;
delete from production_orders where id=md5('a01-inv-production')::uuid;
delete from production_recipes where id=md5('a01-inv-recipe')::uuid;
insert into cashier_shifts(id,branch_id,opened_by,opening_balance,closing_breakdown) values(md5('a01-inv-shift')::uuid,md5('a01-inv-a')::uuid,md5('a01-inv-admin')::uuid,100,'{"PRIVATE":"payload"}');
update cashier_shifts set closing_balance=120,status='closed',closed_at=clock_timestamp() where id=md5('a01-inv-shift')::uuid;
delete from cashier_shifts where id=md5('a01-inv-shift')::uuid;
insert into cashier_shifts(id,branch_id,opening_balance,shift_type) values(md5('a01-inv-clinic-shift')::uuid,md5('a01-inv-a')::uuid,300,'klinik');
update cashier_shifts set shift_type='petshop' where id=md5('a01-inv-clinic-shift')::uuid;
insert into sale_drafts(id,branch_id,cart) values(md5('a01-inv-draft')::uuid,md5('a01-inv-a')::uuid,'[{"PRIVATE":"cart"}]');
update sale_drafts set cart='[{"PRIVATE":"cart update"}]' where id=md5('a01-inv-draft')::uuid;
delete from sale_drafts where id=md5('a01-inv-draft')::uuid;
-- Real inventory RPCs produce branch-scoped stock, physical layers, moves and cost events.
select activate_moving_average();
select stock_in_fifo(md5('a01-inv-wa')::uuid,md5('a01-inv-i1')::uuid,5,10,'manual','A01-INV-RECEIPT');
select stock_out_fifo(md5('a01-inv-wa')::uuid,md5('a01-inv-i1')::uuid,1,'manual','A01-INV-ISSUE');
do $$begin
 if not exists(select 1 from activity_log where row_entity='stock' and action='update' and branch_ids=array[md5('a01-inv-a')::uuid] and after_state->>'qty'='4') then raise exception 'Official stock mutation missing';end if;
 if not exists(select 1 from activity_log where row_entity='stock_layers' and action='update' and after_state->>'qty_left'='4') then raise exception 'Official physical layer mutation missing';end if;
 if not exists(select 1 from activity_log where row_entity='inventory_cost_events' and action='create' and branch_ids=array[md5('a01-inv-a')::uuid] and after_state->>'qty_after'='4') then raise exception 'Official valuation event missing';end if;
 if not exists(select 1 from activity_log where row_entity='opname_counts' and action='update' and branch_ids @> array[md5('a01-inv-a')::uuid,md5('a01-inv-b')::uuid] and entity_ids @> array[md5('a01-inv-oa')::uuid::text,md5('a01-inv-ob')::uuid::text]) then raise exception 'Count reparent scope lost';end if;
 if not exists(select 1 from activity_log where row_entity='opname_counts' and action='delete' and branch_ids=array[md5('a01-inv-b')::uuid] and object_label='A01-INV-OB') then raise exception 'Count cascade tombstone scope lost';end if;
 if not exists(select 1 from activity_log where row_entity='production_order_items' and action='delete' and branch_ids=array[md5('a01-inv-a')::uuid] and object_label='A01-INV-PRODUCTION') then raise exception 'Production cascade scope lost';end if;
end$$;
-- An official documented issue writes an opaque retained proof, without copying its payload.
insert into inventory_adjustments(id,no_adj,warehouse_id,tanggal,alasan,created_by,nilai_keluar) values(md5('a01-inv-adjustment')::uuid,'A01-INV-ADJ',md5('a01-inv-wa')::uuid,current_date,'temuan',md5('a01-inv-owner')::uuid,10);
insert into inventory_adjustment_items(adjustment_id,item_id,nama,qty_sistem,qty_baru,selisih,nilai) values(md5('a01-inv-adjustment')::uuid,md5('a01-inv-i1')::uuid,'PRIVATE ADJUSTMENT',4,3,-1,10);
select issue_stock_document_recorded('adjustment',md5('a01-inv-adjustment')::uuid,md5('a01-inv-i1')::uuid);
reset role;
do $$begin
 if not exists(select 1 from activity_log where row_entity='stock_document_issue_proofs' and action='create' and branch_ids=array[md5('a01-inv-a')::uuid] and changed_fields=array['metadata'] and after_state='{}') then raise exception 'Official proof metadata missing';end if;
end$$;
set local role authenticated;
do $$begin if exists(select 1 from activity_log where row_entity='stock_document_issue_proofs') then raise exception 'Private proof source disclosed';end if;end$$;
insert into staff_quest_definitions(id,branch_id,quest_type,title,target_kind,target_value,points_reward) values(md5('a01-inv-quest')::uuid,md5('a01-inv-a')::uuid,'daily','PRIVATE QUEST','total_sales_amount',100,10);
insert into staff_reward_catalog(id,reward_name,reward_type,points_cost,reward_value) values(md5('a01-inv-reward')::uuid,'PRIVATE REWARD','bonus_points',10,'{"PRIVATE":"reward payload"}');
insert into customers(id,name,phone) values(md5('a01-inv-customer')::uuid,'PRIVATE POINT CUSTOMER','PRIVATE POINT PHONE');
insert into point_ledger(id,customer_id,delta,saldo,ref,description) values(md5('a01-inv-customer-points')::uuid,md5('a01-inv-customer')::uuid,1,1,'PRIVATE REF','PRIVATE POINT DESCRIPTION');
update point_ledger set delta=2,saldo=2,description='PRIVATE POINT EDIT' where id=md5('a01-inv-customer-points')::uuid;
delete from point_ledger where id=md5('a01-inv-customer-points')::uuid;
insert into sales(id,branch_id,no_struk,cashier_id) values(md5('a01-inv-sale')::uuid,md5('a01-inv-a')::uuid,'A01-INV-SALE',md5('a01-inv-owner')::uuid);
insert into sale_items(id,sale_id,item_id,nama,qty,harga) values(md5('a01-inv-sale-line')::uuid,md5('a01-inv-sale')::uuid,md5('a01-inv-group')::uuid,'PRIVATE SALE LINE',1,20);
insert into sale_item_group_components(id,sale_item_id,component_item_id,component_code,component_name,item_type,qty_per_group,unit,factor,total_base_qty,hpp) values(md5('a01-inv-sale-component')::uuid,md5('a01-inv-sale-line')::uuid,md5('a01-inv-i2')::uuid,'PRIVATE CODE','PRIVATE COMPONENT','Persediaan',2,'pcs',1,2,10);
reset role;
-- Existing guards require the official award/redemption path; seed earned balance as fixture owner.
insert into staff_points(staff_id,total_points) values(md5('a01-inv-owner')::uuid,20);
insert into staff_streaks(staff_id,current_streak_days,longest_streak_days,last_active_date) values(md5('a01-inv-owner')::uuid,1,1,current_date);
update staff_streaks set current_streak_days=2,longest_streak_days=2 where staff_id=md5('a01-inv-owner')::uuid;
delete from staff_streaks where staff_id=md5('a01-inv-owner')::uuid;
insert into staff_quest_progress(id,staff_id,quest_definition_id,period_key,current_value,status) values(md5('a01-inv-progress')::uuid,md5('a01-inv-owner')::uuid,md5('a01-inv-quest')::uuid,'PRIVATE PERIOD',100,'completed');
-- Retained staff-effect snapshots are internal and have no general reader.
insert into sale_staff_effects(sale_id,staff_id,before_value,after_value,ledger_ids) values(md5('a01-inv-sale')::uuid,md5('a01-inv-owner')::uuid,'{"PRIVATE":"staff before"}','{"PRIVATE":"staff after"}','{}');
do $$begin
 if not exists(select 1 from activity_log where row_entity='sale_staff_effects' and action='create' and reader_roles='{}' and changed_fields=array['metadata'] and before_state='{}' and after_state='{}') then raise exception 'Internal staff-effect metadata missing';end if;
end$$;
-- Historical closing fixtures exercise the three-column identity and independent warehouse policy.
insert into inventory_month_closes(id,period,closed_through,closed_by,snapshot_count,total_value) values(md5('a01-inv-close')::uuid,'2020-01-01','2020-01-31',md5('a01-inv-owner')::uuid,2,100);
insert into inventory_month_values(close_id,warehouse_id,item_id,qty,average_cost,value) values
 (md5('a01-inv-close')::uuid,md5('a01-inv-wa')::uuid,md5('a01-inv-i1')::uuid,3,10,30),
 (md5('a01-inv-close')::uuid,md5('a01-inv-wb')::uuid,md5('a01-inv-i1')::uuid,7,10,70);
update inventory_month_values set qty=4,value=40 where close_id=md5('a01-inv-close')::uuid and warehouse_id=md5('a01-inv-wa')::uuid;
delete from inventory_month_values where close_id=md5('a01-inv-close')::uuid;
delete from inventory_month_closes where id=md5('a01-inv-close')::uuid;
set local role authenticated;
select claim_staff_quest(md5('a01-inv-progress')::uuid);
select set_config('a01.inv.reward.result',redeem_staff_reward(md5('a01-inv-reward')::uuid,'a01-inv-reward-request')::text,true);
do $$declare n bigint;begin
 select count(*) into n from activity_log;
 if redeem_staff_reward(md5('a01-inv-reward')::uuid,'a01-inv-reward-request')<>current_setting('a01.inv.reward.result')::jsonb then raise exception 'Reward retry result mismatch';end if;
 if (select count(*) from activity_log)<>n then raise exception 'Reward retry duplicated business/audit writes';end if;
 if not exists(select 1 from activity_log where row_entity='staff_quest_progress' and action='update' and branch_ids=array[md5('a01-inv-a')::uuid] and changed_fields=array['metadata'] and before_state='{}'::jsonb and after_state='{}'::jsonb) then raise exception 'Official claim metadata evidence missing';end if;
 if not exists(select 1 from activity_log where row_entity='staff_points' and row_id=md5('a01-inv-owner')::uuid::text and action='update' and scope='all' and changed_fields=array['metadata']) then raise exception 'Non-id staff balance identity/scope missing';end if;
 if not exists(select 1 from activity_log where row_entity='staff_reward_redemptions' and action='create' and scope='all') then raise exception 'Reward redemption evidence missing';end if;
 if (select count(distinct row_id) from activity_log where row_entity='inventory_month_values' and action='create')<>2 then raise exception 'Three-key inventory identity collision';end if;
 if not exists(select 1 from activity_log where row_entity='inventory_month_values' and action='update' and after_state->>'qty'='4' and branch_ids=array[md5('a01-inv-a')::uuid]) then raise exception 'Composite snapshot update missing';end if;
 if not exists(select 1 from activity_log where row_entity='inventory_costing_settings' and row_id='true' and action='update') then raise exception 'Boolean settings identity missing';end if;
 if (select count(*) from activity_log where row_entity='point_ledger' and row_id=md5('a01-inv-customer-points')::uuid::text and changed_fields=array['metadata'] and before_state='{}' and after_state='{}')<>3 then raise exception 'Customer point metadata CUD missing';end if;
 if not exists(select 1 from activity_log where row_entity='sale_item_group_components' and entity='sales' and entity_id=md5('a01-inv-sale')::uuid::text and branch_ids=array[md5('a01-inv-a')::uuid] and (after_state->>'total_base_qty')::numeric=2) then raise exception 'Nested group-sale line scope/history missing';end if;
 if exists(select 1 from activity_log where row_entity='sale_staff_effects') then raise exception 'Internal staff-effect snapshot disclosed';end if;
 if exists(select 1 from activity_log where row_entity in('staff_points','staff_quest_progress','staff_points_ledger','staff_reward_redemptions','sale_drafts') and (changed_fields<>array['metadata'] or before_state<>'{}'::jsonb or after_state<>'{}'::jsonb)) then raise exception 'Operational private payload or fields retained';end if;
 if exists(select 1 from activity_log where before_state::text||after_state::text||object_label like '%PRIVATE%') then raise exception 'Inventory raw text or payload retained';end if;
 if exists(select 1 from activity_log where row_entity in('item_units','item_variant_members','staff_points','staff_quest_progress','stock','production_orders') and (actor_id is distinct from md5('a01-inv-owner')::uuid or actor_name<>'Inventory Owner')) then raise exception 'Actor attribution lost/spoofed';end if;
end$$;
-- Branch-limited admin sees A only; history retains branch after parent deletion.
select set_config('request.jwt.claim.sub',md5('a01-inv-admin')::uuid::text,true);
do $$begin
 if exists(select 1 from activity_log where row_entity='item_branch_prices' and action in('update','delete')) then raise exception 'Cross-branch price disclosure';end if;
 if exists(select 1 from activity_log where row_entity='opname_counts' and action in('update','delete')) then raise exception 'Cross-branch count disclosure';end if;
 if exists(select 1 from activity_log where row_entity in('staff_points','staff_reward_redemptions','staff_points_ledger')) then raise exception 'Unscoped staff disclosure';end if;
 if exists(select 1 from activity_log where row_entity='inventory_month_values' and branch_ids @> array[md5('a01-inv-b')::uuid]) then raise exception 'Cross-branch inventory snapshot disclosure';end if;
 if exists(select 1 from activity_log where row_entity='inventory_month_closes') then raise exception 'Closing source role broadened';end if;
 if not exists(select 1 from activity_log where row_entity='production_order_items' and action='delete') then raise exception 'Authorized cascade history unavailable';end if;
 if not exists(select 1 from activity_log where row_entity='staff_quest_progress' and action='update') then raise exception 'Branch quest metadata unavailable';end if;
end$$;
reset role;
update role_capabilities set all_branches=true where role='ADMIN';
set local role authenticated;
do $$begin
 if not exists(select 1 from activity_log where row_entity='staff_points') then raise exception 'All-branch fixture did not open all scope';end if;
 if exists(select 1 from activity_log where row_entity='inventory_month_closes') then raise exception 'All-branch admin disclosed OWNER-only closing source';end if;
end$$;
reset role;
update role_capabilities set all_branches=false where role='ADMIN';
delete from role_modules where role='ADMIN';
insert into role_modules(role,module_id) values('ADMIN','pos');
set local role authenticated;
do $$begin
 if not exists(select 1 from activity_log where row_entity='cashier_shifts' and row_id=md5('a01-inv-shift')::uuid::text and action='create') then raise exception 'POS shift module fixture unavailable';end if;
 if exists(select 1 from activity_log where row_entity='cashier_shifts' and row_id=md5('a01-inv-clinic-shift')::uuid::text) then raise exception 'Clinic shift or module-change disclosed to POS-only admin';end if;
end$$;
reset role;
insert into role_modules(role,module_id) values('ADMIN','klinik');
set local role authenticated;
do $$begin
 if not exists(select 1 from activity_log where row_entity='cashier_shifts' and row_id=md5('a01-inv-clinic-shift')::uuid::text and action='create' and module_id='klinik') then raise exception 'Clinic shift did not route to clinic module';end if;
 if not exists(select 1 from activity_log where row_entity='cashier_shifts' and row_id=md5('a01-inv-clinic-shift')::uuid::text and action='update' and required_modules @> array['pos','klinik']) then raise exception 'Shift module change lost old/new module gates';end if;
end$$;
select set_config('request.headers',jsonb_build_object('x-kamo-operational-branch',md5('a01-inv-b')::uuid)::text,true);
do $$begin if exists(select 1 from activity_log where row_entity in('stock','inventory_cost_events','production_order_items','staff_quest_progress','sale_drafts')) then raise exception 'Selected-branch inventory disclosure';end if;end$$;
select set_config('request.headers','{}',true);
reset role;
delete from role_modules where role='ADMIN';
insert into role_modules(role,module_id) values('ADMIN','crm');
set local role authenticated;
do $$begin if exists(select 1 from activity_log where module_id='pos') then raise exception 'Revoked inventory module disclosed';end if;end$$;
reset role;
select set_config('request.jwt.claim.sub',md5('a01-inv-owner')::uuid::text,true);
-- New-source writes are atomic with their audit evidence.
create function pg_temp.fail_inventory_append() returns trigger language plpgsql as $$begin raise exception 'A01 inventory injected audit failure';end$$;
create trigger a01_inventory_fail_append before insert on activity_log for each row execute function pg_temp.fail_inventory_append();
do $$begin
 begin insert into item_units(id,item_id,unit,factor) values(md5('a01-inv-rollback')::uuid,md5('a01-inv-i1')::uuid,'fixture',1);raise exception 'Expected inventory append failure';exception when others then if sqlerrm<>'A01 inventory injected audit failure' then raise;end if;end;
 if exists(select 1 from item_units where id=md5('a01-inv-rollback')::uuid) then raise exception 'Inventory source survived audit failure';end if;
end$$;
rollback;
