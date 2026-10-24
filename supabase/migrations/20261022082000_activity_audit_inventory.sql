-- A01 inventory expansion: explicit business sources, no source grants/policy changes.
-- Arbitrary names, units, notes, staff details and JSON payloads are never values.
insert into public.activity_log_sources
 (entity,module_id,label_key,value_keys,scope_kind,parent_entity,parent_key,identity_keys,branch_columns,scope_parents,metadata_only,reader_roles)
values
 ('item_categories','pos',null,array['track_expiry','track_batch','is_active'],'global',null,null,array['id'],'{}','[]',false,array['OWNER','ADMIN']),
 ('item_units','pos',null,array['factor','sell_price','buy_price'],'refs','items','item_id',array['id'],'{}','[{"entity":"items","key":"item_id"}]',false,array['OWNER','ADMIN']),
 ('item_price_tiers','pos',null,array['min_qty','harga'],'refs','items','item_id',array['id'],'{}','[{"entity":"items","key":"item_id"}]',false,array['OWNER','ADMIN']),
 ('item_branch_prices','pos',null,array['sell_price'],'refs','items','item_id',array['id'],array['branch_id'],'[{"entity":"items","key":"item_id"}]',false,array['OWNER','ADMIN']),
 ('item_group_components','pos',null,array['qty','factor','sort_order'],'refs','items','group_item_id',array['id'],'{}','[{"entity":"items","key":"group_item_id"},{"entity":"items","key":"component_item_id"}]',false,array['OWNER','ADMIN']),
 ('item_variant_families','pos',null,'{}','global',null,null,array['id'],'{}','[]',false,array['OWNER','ADMIN']),
 ('item_variant_members','pos',null,array['sort_order'],'refs','item_variant_families','family_id',array['family_id','item_id'],'{}','[{"entity":"item_variant_families","key":"family_id"},{"entity":"items","key":"item_id"}]',false,array['OWNER','ADMIN']),
 ('stock','pos',null,array['qty','average_cost'],'refs',null,null,array['id'],'{}','[{"entity":"warehouses","key":"warehouse_id"}]',false,array['OWNER','ADMIN']),
 ('stock_moves','pos',null,array['tanggal','qty','unit_cost','fifo_shortfall','valuation_adjustment'],'refs',null,null,array['id'],'{}','[{"entity":"warehouses","key":"warehouse_id"}]',false,array['OWNER','ADMIN']),
 ('stock_layers','pos',null,array['tanggal','qty_in','qty_left','unit_cost','exp_date'],'refs',null,null,array['id'],'{}','[{"entity":"warehouses","key":"warehouse_id"}]',false,array['OWNER','ADMIN']),
 ('opname_order_items','pos',null,'{}','refs','opname_orders','order_id',array['id'],'{}','[{"entity":"opname_orders","key":"order_id"}]',false,array['OWNER','ADMIN']),
 ('opname_counts','pos',null,array['qty_fisik','qty_sistem','locked_at'],'refs','opname_orders','order_id',array['id'],'{}','[{"entity":"opname_orders","key":"order_id"}]',false,array['OWNER','ADMIN']),
 ('production_recipes','pos',null,array['output_qty','is_active'],'global',null,null,array['id'],'{}','[]',false,array['OWNER','ADMIN']),
 ('production_recipe_items','pos',null,array['qty'],'refs','production_recipes','recipe_id',array['id'],'{}','[{"entity":"production_recipes","key":"recipe_id"}]',false,array['OWNER','ADMIN']),
 ('production_orders','pos','no_produksi',array['batch','qty_jadi','nilai_bahan','status','tanggal','tanggal_selesai'],'refs',null,null,array['id'],'{}','[{"entity":"warehouses","key":"warehouse_id"}]',false,array['OWNER','ADMIN']),
 ('production_order_items','pos',null,array['qty','hpp'],'refs','production_orders','order_id',array['id'],'{}','[{"entity":"production_orders","key":"order_id"}]',false,array['OWNER','ADMIN']),
 ('cashier_shifts','pos',null,array['opening_balance','closing_balance','expected_cash','selisih','opened_at','closed_at','status'],'refs',null,null,array['id'],array['branch_id'],'[{"entity":"employees","key":"employee_id"}]',false,array['OWNER','ADMIN']),
 ('sale_drafts','pos',null,'{}','refs',null,null,array['id'],array['branch_id'],'[]',true,array['OWNER','ADMIN']),
 ('quest_settings','pos',null,array['streak_bonus_every_days','streak_bonus_points'],'global',null,null,array['id'],'{}','[]',false,array['OWNER','ADMIN']),
 ('staff_quest_definitions','pos',null,array['target_value','points_reward','is_active'],'refs',null,null,array['id'],array['branch_id'],'[]',false,array['OWNER','ADMIN']),
 ('staff_quest_progress','pos',null,'{}','refs','staff_quest_definitions','quest_definition_id',array['id'],'{}','[{"entity":"staff_quest_definitions","key":"quest_definition_id"}]',true,array['OWNER','ADMIN']),
 ('staff_points','pos',null,'{}','all',null,null,array['staff_id'],'{}','[]',true,array['OWNER','ADMIN']),
 ('staff_streaks','pos',null,'{}','all',null,null,array['staff_id'],'{}','[]',true,array['OWNER','ADMIN']),
 ('staff_points_ledger','pos',null,'{}','refs',null,null,array['id'],array['branch_id'],'[]',true,array['OWNER','ADMIN']),
 ('staff_reward_catalog','pos',null,array['points_cost','is_active'],'global',null,null,array['id'],'{}','[]',false,array['OWNER','ADMIN']),
 ('staff_reward_redemptions','pos',null,'{}','all',null,null,array['id'],'{}','[]',true,array['OWNER','ADMIN']),
 ('point_ledger','crm',null,'{}','refs','customers','customer_id',array['id'],'{}','[{"entity":"customers","key":"customer_id"}]',true,array['OWNER','ADMIN']),
 -- Cancellation proof contains staff snapshots; record only metadata under the sale.
 ('sale_staff_effects','pos',null,'{}','all','sales','sale_id',array['sale_id'],'{}','[]',true,'{}'),
 ('sale_item_group_components','pos',null,array['qty_per_group','factor','total_base_qty','hpp','sort_order'],'refs','sale_items','sale_item_id',array['id'],'{}','[{"entity":"sale_items","key":"sale_item_id"}]',false,array['OWNER','ADMIN']),
 ('inventory_costing_settings','pos',null,array['activated_at','closed_through'],'all',null,null,array['id'],'{}','[]',false,array['OWNER','ADMIN']),
 ('inventory_cost_events','pos',null,array['tanggal','qty_delta','value_delta','qty_after','value_after','average_before','average_after','variance'],'refs',null,null,array['id'],'{}','[{"entity":"warehouses","key":"warehouse_id"}]',false,array['OWNER','ADMIN']),
 -- Existing closing source permits OWNER/FINANCE. General audit readers never add ADMIN.
 ('inventory_month_closes','pos',null,'{}','all',null,null,array['id'],'{}','[]',true,array['OWNER']),
 -- Values already have a warehouse-scoped source policy independent of close header access.
 ('inventory_month_values','pos',null,array['qty','average_cost','value'],'refs',null,null,array['close_id','warehouse_id','item_id'],'{}','[{"entity":"warehouses","key":"warehouse_id"}]',false,array['OWNER','ADMIN']),
 ('stock_document_issue_proofs','pos',null,'{}','refs',null,null,array['move_id'],'{}','[{"entity":"stock_moves","key":"move_id"}]',true,'{}');

-- Shared table, distinct source modules. A type change retains both module gates.
update public.activity_log_sources
 set module_column='shift_type',module_map='{"klinik":"klinik","petshop":"pos"}'
 where entity='cashier_shifts';

-- Do not re-index existing domain correction snapshots/request payload stores:
-- stock_document_corrections and stock_document_correction_requests remain authoritative.
do $$declare t text;begin
 foreach t in array array[
  'item_categories','item_units','item_price_tiers','item_branch_prices',
  'item_group_components','item_variant_families','item_variant_members',
  'stock','stock_moves','stock_layers','opname_order_items','opname_counts',
  'production_recipes','production_recipe_items','production_orders','production_order_items',
  'cashier_shifts','sale_drafts','quest_settings','staff_quest_definitions','staff_quest_progress',
  'staff_points','staff_streaks','staff_points_ledger','staff_reward_catalog','staff_reward_redemptions',
  'point_ledger','sale_staff_effects','sale_item_group_components','inventory_costing_settings',
  'inventory_cost_events','inventory_month_closes','inventory_month_values','stock_document_issue_proofs'
 ] loop
  execute format('create trigger a01_activity_change after insert or update on public.%I for each row execute function public.capture_activity_log()',t);
  execute format('create trigger a01_activity_delete before delete on public.%I for each row execute function public.capture_activity_log()',t);
 end loop;
end$$;
