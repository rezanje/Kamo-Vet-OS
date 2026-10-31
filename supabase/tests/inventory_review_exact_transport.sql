-- Synthetic data only. A quantity beyond JavaScript precision must still post
-- through the text wrappers; the float-rounded copy is what the old path sent.
begin;
insert into auth.users(id) values(md5('xt-owner')::uuid);
alter table profiles disable trigger guard_profile_privileges;
update profiles set role='OWNER',is_active=true where id=md5('xt-owner')::uuid;
alter table profiles enable trigger guard_profile_privileges;
insert into branches(id,code,name,type) values(md5('xt-branch')::uuid,'XT-B','Fiction exact branch','PETSHOP');
insert into warehouses(id,branch_id,code,name,type) values(md5('xt-wh')::uuid,md5('xt-branch')::uuid,'XT-W','Fiction exact warehouse','RETAIL');
insert into coa_accounts(code,name,type,normal_balance,is_header) values('170001','Fiction inventory','ASET','D',false),('410001','Fiction equity','EKUITAS','K',false)
on conflict(code) do update set is_active=true,is_header=false;
insert into items(id,code,name,unit,item_type) values(md5('xt-item')::uuid,'XT-I','Fiction exact item','PCS','Persediaan'),(md5('xt-paid')::uuid,'XT-P','Fiction valued item','PCS','Persediaan');
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('xt-owner')::uuid::text,true);
do $$ declare run uuid; eq uuid; exact text; rounded jsonb; receipt jsonb; begin
 select id into eq from coa_accounts where code='410001';
 run:=prepare_accurate_initial_stock('xt-exact-qty','fiction.xlsx',md5('xt-branch')::uuid,md5('xt-wh')::uuid,'2026-01-01',
  jsonb_build_array(jsonb_build_object('source_row',2,'source_code','XT-I','status','valid','reason',null,
  'payload',jsonb_build_object('item_id',md5('xt-item')::uuid,'warehouse_id',md5('xt-wh')::uuid,'base_qty','2.0000000000000000001','base_unit_cost','0','as_of','2026-01-01',
  'source_values',jsonb_build_array(jsonb_build_object('qty','2.0000000000000000001','unit_cost','0','factor','1','unit','PCS')))),
  jsonb_build_object('source_row',3,'source_code','XT-P','status','valid','reason',null,
  'payload',jsonb_build_object('item_id',md5('xt-paid')::uuid,'warehouse_id',md5('xt-wh')::uuid,'base_qty','1','base_unit_cost','10','as_of','2026-01-01',
  'source_values',jsonb_build_array(jsonb_build_object('qty','1','unit_cost','10','factor','1','unit','PCS'))))),'STRICT');
 exact:=preview_accurate_inventory_accounting_text(run,eq);
 if exact not like '%3.0000000000000000001%' then raise exception 'Text preview lost precision';end if;
 -- What a JavaScript round trip produced: the old jsonb path rejects it.
 rounded:=jsonb_set(exact::jsonb,'{original_qty}','3');
 begin
  perform post_accurate_inventory_accounting(run,eq,rounded,'Fiction exact transport');
  raise exception 'Rounded evidence unexpectedly posted';
 exception when sqlstate '22023' then null;end;
 receipt:=post_accurate_inventory_accounting_text(run,eq,exact,'Fiction exact transport');
 if (select qty from stock where warehouse_id=md5('xt-wh')::uuid and item_id=md5('xt-item')::uuid)<>2.0000000000000000001 then raise exception 'Exact stock not posted';end if;
 if post_accurate_inventory_accounting_text(run,eq,exact,'Fiction exact transport') is distinct from receipt then raise exception 'Text retry not idempotent';end if;
end $$;
rollback;
