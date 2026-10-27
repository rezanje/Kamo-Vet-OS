-- Fictional fixtures in disposable PostgreSQL only; never production data.
begin;
insert into auth.users(id,raw_user_meta_data) values
 ('eb100000-0000-4000-8000-000000000001','{}'),('eb100000-0000-4000-8000-000000000002','{}'),('eb100000-0000-4000-8000-000000000003','{}');
update profiles set role='OWNER' where id='eb100000-0000-4000-8000-000000000001';
insert into branches(id,code,name,type) values
 ('eb200000-0000-4000-8000-000000000001','CTX-A','Fictional A','BOTH'),('eb200000-0000-4000-8000-000000000002','CTX-B','Fictional B','BOTH');
insert into employees(id,nik,nama,status,profile_id) values
 ('eb500000-0000-4000-8000-000000000001','CTX-1','Fictional employee','Aktif',null),
 ('eb500000-0000-4000-8000-000000000002','CTX-2','Fictional other','Aktif',null);
insert into sales(id,branch_id,no_struk,total,cashier_id) values
 ('eb600000-0000-4000-8000-000000000001','eb200000-0000-4000-8000-000000000001','CTX-A-SALE',0,'eb100000-0000-4000-8000-000000000002'),
 ('eb600000-0000-4000-8000-000000000002','eb200000-0000-4000-8000-000000000002','CTX-B-SALE',0,'eb100000-0000-4000-8000-000000000003');
insert into sale_items(sale_id,nama,qty,harga) values ('eb600000-0000-4000-8000-000000000001','Fictional A',1,0),('eb600000-0000-4000-8000-000000000002','Fictional B',1,0);
insert into warehouses(id,branch_id,code,name,type) values
 ('eb210000-0000-4000-8000-000000000001','eb200000-0000-4000-8000-000000000001','CTX-WH-A','Fictional source','RETAIL'),
 ('eb210000-0000-4000-8000-000000000002','eb200000-0000-4000-8000-000000000002','DC-CTX-WH-B','Fictional destination','DC');
insert into customers(id,name,phone) values ('eb300000-0000-4000-8000-000000000001','Fictional owner','080012345600');
insert into pets(id,customer_id,name) values ('eb400000-0000-4000-8000-000000000001','eb300000-0000-4000-8000-000000000001','Fictional pet');
insert into visits(id,branch_id,customer_id,pet_id) values
 ('eb610000-0000-4000-8000-000000000001','eb200000-0000-4000-8000-000000000001','eb300000-0000-4000-8000-000000000001','eb400000-0000-4000-8000-000000000001'),
 ('eb610000-0000-4000-8000-000000000002','eb200000-0000-4000-8000-000000000002','eb300000-0000-4000-8000-000000000001','eb400000-0000-4000-8000-000000000001');
insert into medical_records(visit_id) values ('eb610000-0000-4000-8000-000000000001'),('eb610000-0000-4000-8000-000000000002');
insert into compounding_recipes(medical_record_id,recipe_name,dosage_instruction,total_volume,dosage_form,compounding_steps)
select id,case when visit_id='eb610000-0000-4000-8000-000000000001' then 'CTX own compound' else 'CTX other compound' end,'Fictional instruction','1 ml','sirup','Fictional steps'
from medical_records where visit_id in ('eb610000-0000-4000-8000-000000000001','eb610000-0000-4000-8000-000000000002');
insert into compounding_ingredients(recipe_id,ingredient_name,quantity,unit)
select id,case when recipe_name='CTX own compound' then 'CTX own ingredient' else 'CTX other ingredient' end,1,'ml' from compounding_recipes where recipe_name like 'CTX%';
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"eb100000-0000-4000-8000-000000000001"}',true);
select configure_employee_account('eb100000-0000-4000-8000-000000000002','eb500000-0000-4000-8000-000000000001','Fictional account','STAFF',array['eb200000-0000-4000-8000-000000000001']::uuid[]);
-- Idempotent repair leaves all existing payroll, roles and grants unchanged.
select link_employee_account('eb100000-0000-4000-8000-000000000002','eb500000-0000-4000-8000-000000000001');
do $$ begin
 begin
  perform link_employee_account('eb100000-0000-4000-8000-000000000003','eb500000-0000-4000-8000-000000000001');
  raise exception 'conflicting employee link accepted';
 exception when raise_exception then if sqlerrm<>'EMPLOYEE_ALREADY_LINKED' then raise; end if; end;
 begin
  perform link_employee_account('eb100000-0000-4000-8000-000000000002','eb500000-0000-4000-8000-000000000002');
  raise exception 'two employee links accepted';
 exception when raise_exception then if sqlerrm<>'EMPLOYEE_ALREADY_LINKED' then raise; end if; end;
 if exists(select 1 from sales where id='eb600000-0000-4000-8000-000000000001' and cashier_employee_id is not null) then raise exception 'historical sale was backfilled'; end if;
end $$;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"eb100000-0000-4000-8000-000000000002"}',true);
do $$ begin
 if not user_can_access_branch('eb200000-0000-4000-8000-000000000001') or user_can_access_branch('eb200000-0000-4000-8000-000000000002') then raise exception 'branch grants broken'; end if;
 if (select count(*) from visits where id in ('eb610000-0000-4000-8000-000000000001','eb610000-0000-4000-8000-000000000002'))<>1 or (select count(*) from medical_records where visit_id in ('eb610000-0000-4000-8000-000000000001','eb610000-0000-4000-8000-000000000002'))<>1 then raise exception 'clinic parent or child data leaked'; end if;
 if (select count(*) from sales where no_struk like 'CTX-%')<>1 or (select count(*) from sale_items where nama like 'Fictional%')<>1 then raise exception 'direct or child data leaked'; end if;
 begin
  update profiles set role='OWNER' where id=auth.uid(); raise exception 'self promotion accepted';
 exception when raise_exception then if sqlerrm<>'ACCOUNT_ADMIN_REQUIRED' then raise; end if; end;
 begin
  -- HRIS pilot RLS hides the row from STAFF writes (0 rows); the link guard is the second line.
  update employees set profile_id=auth.uid() where id='eb500000-0000-4000-8000-000000000002';
  if found then raise exception 'self link accepted'; end if;
 exception when raise_exception then if sqlerrm<>'ACCOUNT_ADMIN_REQUIRED' then raise; end if; end;
 begin
  perform link_employee_account('eb100000-0000-4000-8000-000000000003','eb500000-0000-4000-8000-000000000002'); raise exception 'staff link accepted';
 exception when raise_exception then if sqlerrm<>'ACCOUNT_ADMIN_REQUIRED' then raise; end if; end;
end $$;
select set_config('request.headers','{"x-kamo-operational-branch":"eb200000-0000-4000-8000-000000000002"}',true);
do $$ begin
 if exists(select 1 from sales where no_struk like 'CTX-%') then raise exception 'forged branch granted access'; end if;
end $$;
select set_config('request.headers','{"x-kamo-operational-branch":"eb200000-0000-4000-8000-000000000001"}',true);
do $$ begin
 if not exists(select 1 from operational_request_destinations(true) where id='eb210000-0000-4000-8000-000000000002') then raise exception 'DC reference missing'; end if;
 if exists(select 1 from warehouses where id='eb210000-0000-4000-8000-000000000002') then raise exception 'DC operational metadata leaked through normal reads'; end if;
end $$;
insert into cashier_shifts(id,branch_id,opened_by,shift_type) values ('eb700000-0000-4000-8000-000000000001','eb200000-0000-4000-8000-000000000001',auth.uid(),'petshop');
do $$ begin
 if (select employee_id from cashier_shifts where id='eb700000-0000-4000-8000-000000000001') is distinct from 'eb500000-0000-4000-8000-000000000001'::uuid then raise exception 'employee snapshot missing'; end if;
end $$;
-- A caller-supplied snapshot is replaced with the actual linked employee.
insert into expenses(branch_id,kategori,jumlah,created_by,created_by_employee_id) values ('eb200000-0000-4000-8000-000000000001','CTX test',0,auth.uid(),'eb500000-0000-4000-8000-000000000002');
do $$ begin
 if exists(select 1 from expenses where kategori='CTX test' and created_by_employee_id<>'eb500000-0000-4000-8000-000000000001') then raise exception 'forged employee snapshot'; end if;
 begin
  insert into sale_items(sale_id,nama,qty,harga) values ('eb600000-0000-4000-8000-000000000002','Forbidden',1,0); raise exception 'foreign child insert accepted';
 exception when insufficient_privilege then null; end;
end $$;
update cashier_shifts set employee_id='eb500000-0000-4000-8000-000000000002' where id='eb700000-0000-4000-8000-000000000001';
do $$ begin
 if (select employee_id from cashier_shifts where id='eb700000-0000-4000-8000-000000000001') is distinct from 'eb500000-0000-4000-8000-000000000001'::uuid then raise exception 'historical snapshot changed'; end if;
end $$;
do $$ declare affected integer; begin
 if (select count(*) from compounding_recipes where recipe_name='CTX own compound')<>1
   or exists(select 1 from compounding_recipes where recipe_name='CTX other compound')
   or exists(select 1 from compounding_ingredients where ingredient_name='CTX other ingredient') then raise exception 'compound branch isolation failed'; end if;
 update compounding_recipes set total_volume='2 ml' where recipe_name='CTX other compound';
 get diagnostics affected=row_count;
 if affected<>0 then raise exception 'foreign compound mutation accepted'; end if;
 begin
  update cashier_shifts set opened_by=null where id='eb700000-0000-4000-8000-000000000001';
  raise exception 'shift orphaning accepted';
 exception when raise_exception then if sqlerrm<>'OPERATIONAL_ACTOR_IMMUTABLE' then raise; end if; end;
 begin
  update sales set cashier_id=null where id='eb600000-0000-4000-8000-000000000001';
  raise exception 'sale actor clearing accepted';
 exception when raise_exception then if sqlerrm<>'OPERATIONAL_ACTOR_IMMUTABLE' then raise; end if; end;
 begin
  update expenses set created_by=null where kategori='CTX test';
  raise exception 'expense actor clearing accepted';
 exception when raise_exception then if sqlerrm<>'OPERATIONAL_ACTOR_IMMUTABLE' then raise; end if; end;
end $$;
-- Global accounts retain backoffice access but operational context narrows them.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"eb100000-0000-4000-8000-000000000001"}',true);
do $$ begin
 if (select count(*) from sales where no_struk like 'CTX-%')<>1 then raise exception 'owner context not narrowed'; end if;
end $$;
select set_config('request.headers','{}',true);
do $$ begin
 if (select count(*) from sales where no_struk like 'CTX-%')<>2 then raise exception 'backoffice branch access changed'; end if;
end $$;
-- Disabled profiles lose database branch access even with an unexpired token.
update profiles set is_active=false where id='eb100000-0000-4000-8000-000000000002';
select set_config('request.jwt.claims','{"role":"authenticated","sub":"eb100000-0000-4000-8000-000000000002"}',true);
do $$ begin
 if user_can_access_branch('eb200000-0000-4000-8000-000000000001') then raise exception 'disabled account allowed'; end if;
end $$;
-- Legitimate system auth deletion clears profile FKs while preserving HRIS snapshots.
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
delete from auth.users where id='eb100000-0000-4000-8000-000000000002';
do $$ begin
 if not exists(select 1 from cashier_shifts where id='eb700000-0000-4000-8000-000000000001' and opened_by is null and employee_id='eb500000-0000-4000-8000-000000000001') then raise exception 'auth deletion lost shift employee snapshot'; end if;
 if not exists(select 1 from expenses where kategori='CTX test' and created_by is null and created_by_employee_id='eb500000-0000-4000-8000-000000000001') then raise exception 'auth deletion lost expense employee snapshot'; end if;
end $$;
rollback;
