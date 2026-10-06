-- LOCAL ONLY. Fixtures and test-only helpers are rolled back.
begin;
do $$ begin
  if to_regprocedure('public.report_compound_ingredients(uuid[])') is null then
    raise exception 'Missing protected historical ingredient reader';
  end if;
  if has_table_privilege('authenticated','public.compound_issues','SELECT') then
    raise exception 'Internal cost ledger must remain private';
  end if;
  if has_function_privilege('anon','public.report_compound_ingredients(uuid[])','EXECUTE')
     or has_function_privilege('service_role','public.report_compound_ingredients(uuid[])','EXECUTE') then
    raise exception 'Only authenticated callers may execute report reader';
  end if;
end $$;
insert into auth.users(id,raw_user_meta_data) select md5('COST-user-'||role)::uuid,jsonb_build_object('full_name','Cost Test '||role)
  from unnest(array['OWNER','FINANCE','ADMIN','DOCTOR','DISABLED'])role;
update public.profiles set role=case when full_name='Cost Test DISABLED' then 'FINANCE'::public.user_role else replace(full_name,'Cost Test ','')::public.user_role end,
  is_active=full_name<>'Cost Test DISABLED' where full_name like 'Cost Test %';
insert into branches(id,code,name,type) values
  (md5('COST-branch-A')::uuid,'COST-A','Cost Test A','KLINIK'),(md5('COST-branch-B')::uuid,'COST-B','Cost Test B','KLINIK');
insert into warehouses(id,branch_id,code,name,type) values
  (md5('COST-warehouse')::uuid,md5('COST-branch-A')::uuid,'COST-W','Cost Test Warehouse','VET');
insert into customers(id,name,phone) values(md5('COST-customer')::uuid,'Cost Test Customer','089991111222');
insert into pets(id,customer_id,name) values(md5('COST-pet')::uuid,md5('COST-customer')::uuid,'Cost Test Pet');
insert into visits(id,branch_id,customer_id,pet_id) select md5('COST-visit-'||label)::uuid,md5('COST-branch-'||label)::uuid,md5('COST-customer')::uuid,md5('COST-pet')::uuid from unnest(array['A','B'])label;
insert into medical_records(id,visit_id) values(md5('COST-record')::uuid,md5('COST-visit-A')::uuid);
insert into items(id,code,name,unit,buy_price)values(md5('COST-item')::uuid,'COST-I','Current changed item name','ml',9999);
insert into compounding_recipes(id,medical_record_id,recipe_name,dosage_form,total_price,status)values
  (md5('COST-recipe')::uuid,md5('COST-record')::uuid,'Cost Test Recipe','sirup',200,'handed_over');
insert into compounding_ingredients(id,recipe_id,item_id,ingredient_name,quantity,unit)values
  (md5('COST-ingredient')::uuid,md5('COST-recipe')::uuid,md5('COST-item')::uuid,'Stored ingredient name',99,'ml');
insert into stock_layers(id,warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source)values
  (md5('COST-layer')::uuid,md5('COST-warehouse')::uuid,md5('COST-item')::uuid,current_date,3,0,8888,'purchase');
insert into invoices(id,visit_id,invoice_no,subtotal,total,paid_status)values
  (md5('COST-invoice-A')::uuid,md5('COST-visit-A')::uuid,'COST-INVOICE-A',200,200,'Lunas'),
  (md5('COST-invoice-B')::uuid,md5('COST-visit-B')::uuid,'COST-INVOICE-B',200,200,'Lunas');
insert into invoice_items(id,invoice_id,deskripsi,qty,harga,hpp,compound_recipe_id)values
  (md5('COST-line-A')::uuid,md5('COST-invoice-A')::uuid,'Cost Test Recipe',1,200,50,md5('COST-recipe')::uuid),
  (md5('COST-line-B')::uuid,md5('COST-invoice-B')::uuid,'Same name different visit',1,200,50,null),
  (md5('COST-line-legacy')::uuid,md5('COST-invoice-A')::uuid,'Cost Test Recipe',1,200,null,null);
insert into compound_issues(id,recipe_id,ingredient_id,warehouse_id,item_id,stock_layer_id,qty,unit_cost,posted_invoice_item_id)values
  (md5('COST-issue')::uuid,md5('COST-recipe')::uuid,md5('COST-ingredient')::uuid,md5('COST-warehouse')::uuid,md5('COST-item')::uuid,md5('COST-layer')::uuid,3,50.0/3,md5('COST-line-A')::uuid);

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',md5('COST-user-OWNER')::uuid::text,true);
do $$declare result record;begin
  select * into result from public.report_compound_ingredients(array[md5('COST-line-A')::uuid]);
  if result.id is null or result.qty<>3 or abs(result.unit_cost*result.qty-50)>0.00001 or result.ingredient_name<>'Stored ingredient name' then raise exception 'Historical issue values were fabricated or missing';end if;
  if exists(select 1 from public.report_compound_ingredients(array[md5('COST-line-B')::uuid,md5('COST-line-legacy')::uuid]))then raise exception 'Historical usage leaked across visit or legacy name link';end if;
end $$;
select set_config('request.jwt.claim.sub',md5('COST-user-FINANCE')::uuid::text,true);
do $$begin if (select count(*) from public.report_compound_ingredients(array[md5('COST-line-A')::uuid]))<>1 then raise exception 'Active finance report unavailable';end if;end $$;
reset role;
insert into role_modules(role,module_id)values('FINANCE','klinik');
set local role authenticated;
do $$begin
  begin perform public.report_compound_ingredients(array[md5('COST-line-A')::uuid]);raise exception 'Missing module unexpectedly allowed';exception when sqlstate '42501' then null;end;
end $$;
reset role;
delete from role_modules where role='FINANCE';
set local role authenticated;
do $$declare label text;begin
  foreach label in array array['ADMIN','DOCTOR','DISABLED'] loop
    perform set_config('request.jwt.claim.sub',md5('COST-user-'||label)::uuid::text,true);
    begin perform public.report_compound_ingredients(array[md5('COST-line-A')::uuid]);raise exception 'Forbidden role unexpectedly allowed: %',label;exception when sqlstate '42501' then null;end;
  end loop;
  perform set_config('request.jwt.claim.sub',md5('COST-user-OWNER')::uuid::text,true);
  begin perform public.report_compound_ingredients(array[md5('COST-nonexistent')::uuid]);raise exception 'Missing invoice unexpectedly allowed';exception when sqlstate '42501' then null;end;
end $$;
reset role;
-- Simulate a restrictive branch policy without changing production permissions.
create or replace function public.user_can_access_branch(b uuid)returns boolean language sql security definer stable set search_path='' as $$select b<>md5('COST-branch-B')::uuid$$;
set local role authenticated;
do $$begin
  begin perform public.report_compound_ingredients(array[md5('COST-line-A')::uuid,md5('COST-line-B')::uuid]);raise exception 'Cross-branch batch unexpectedly allowed';exception when sqlstate '42501' then null;end;
end $$;
reset role;
update compound_issues set restored_at=now() where id=md5('COST-issue')::uuid;
set local role authenticated;
do $$begin if exists(select 1 from public.report_compound_ingredients(array[md5('COST-line-A')::uuid]))then raise exception 'Restored usage incorrectly counted';end if;end $$;
reset role;
rollback;
