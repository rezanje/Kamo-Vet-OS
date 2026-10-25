-- Only fictional catalog and promotions in the disposable PostgreSQL runner.
begin;
create function pg_temp.ok(value boolean,label text) returns void language plpgsql as $$begin
 if value is distinct from true then raise exception 'Assertion failed: %',label;end if;end$$;
create function pg_temp.reject(stmt text,label text) returns void language plpgsql as $$
declare failed boolean:=false;begin
 begin execute stmt;exception when others then failed:=true;end;
 if not failed then raise exception 'Expected rejection: %',label;end if;
end$$;
insert into auth.users(id,raw_user_meta_data) values
 ('f1100000-0000-4000-8000-000000000001','{"full_name":"Promo owner"}'),
 ('f1100000-0000-4000-8000-000000000002','{"full_name":"Promo staff"}');
update profiles set role='OWNER',is_active=true where id='f1100000-0000-4000-8000-000000000001';
update profiles set role='STAFF',is_active=true where id='f1100000-0000-4000-8000-000000000002';
insert into branches(id,code,name,type) values('f2200000-0000-4000-8000-000000000001','PROMOEXCEL','Promo Excel','PETSHOP');
insert into user_branches(user_id,branch_id) values
 ('f1100000-0000-4000-8000-000000000001','f2200000-0000-4000-8000-000000000001');
insert into items(id,code,name,unit,item_type) values
 ('f5500000-0000-4000-8000-000000000001','PROMO-SKU-A','Fiction A','PCS','Persediaan'),
 ('f5500000-0000-4000-8000-000000000002','PROMO-SKU-B','Fiction B','PCS','Persediaan');
insert into item_units(item_id,unit,factor,sell_price) values
 ('f5500000-0000-4000-8000-000000000001','DUS',12,100000);
create function pg_temp.batch() returns jsonb language sql as $$select jsonb_build_object(
 'name','Fiction monthly','valid_from','2026-10-01','valid_until','2026-10-31',
 'all_branches',false,'branch_ids',jsonb_build_array('f2200000-0000-4000-8000-000000000001'))$$;
create function pg_temp.rows() returns jsonb language sql as $$select jsonb_build_array(
 jsonb_build_object('code','PROMO-SKU-A','unit','PCS','discount_type','percent','discount_value',10),
 jsonb_build_object('code','PROMO-SKU-A','unit','DUS','discount_type','nominal','discount_value',5000),
 jsonb_build_object('code','PROMO-SKU-B','unit','PCS','discount_type','percent','discount_value',20))$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','f1100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select pg_temp.ok((import_promo_excel_batch('f7700000-0000-4000-8000-000000000001',pg_temp.batch(),pg_temp.rows())->>'imported')::int=3,'all three rows imported');
select pg_temp.ok((select count(*)=3 from promos where rule->>'import_batch_key'='f7700000-0000-4000-8000-000000000001'),'one promo per SKU/unit');
select pg_temp.ok((select count(*)=3 from promo_items pi join promos p on p.id=pi.promo_id
 where p.rule->>'import_batch_key'='f7700000-0000-4000-8000-000000000001'),'every promo has one explicit target');
select pg_temp.ok((select count(*)=1 from promos where rule->>'unit'='DUS' and discount_value=5000),'DUS discount remains distinct');
select pg_temp.reject($q$delete from promo_items where promo_id=(select id from promos where rule->>'unit'='DUS')$q$,'import target cannot become all-products');
insert into promos(id,name,promo_type,rule) values
 ('f6600000-0000-4000-8000-000000000001','Fiction ordinary promo','diskon_produk','{}');
select pg_temp.reject($q$update promo_items set promo_id='f6600000-0000-4000-8000-000000000001'
 where promo_id=(select id from promos where rule->>'unit'='DUS')$q$,'import target cannot move to ordinary promo');
select pg_temp.ok((select count(*)=1 from promo_items where promo_id=(select id from promos where rule->>'unit'='DUS')),'import target remains after rejected move');
select pg_temp.reject($q$update promos set rule=jsonb_set(rule,'{unit}','"PCS"') where rule->>'unit'='DUS'$q$,'import unit cannot change behind checkout');
update promos set is_active=false where rule->>'unit'='DUS';
select pg_temp.ok((select is_active=false from promos where rule->>'unit'='DUS'),'authorized activation control preserved');
update promos set is_active=true where rule->>'unit'='DUS';
select pg_temp.ok((import_promo_excel_batch('f7700000-0000-4000-8000-000000000001',pg_temp.batch(),pg_temp.rows())->>'repeat')::boolean,'same-key retry');
select pg_temp.ok((import_promo_excel_batch('f7700000-0000-4000-8000-000000000002',pg_temp.batch(),pg_temp.rows())->>'repeat')::boolean,'same file reupload with new key');
select pg_temp.ok((select count(*)=3 from promos where rule->>'import_batch_key'='f7700000-0000-4000-8000-000000000001'),'no duplicate promo after retries');
select pg_temp.reject($q$select import_promo_excel_batch('f7700000-0000-4000-8000-000000000001',
 pg_temp.batch(),jsonb_build_array(jsonb_build_object('code','PROMO-SKU-A','unit','PCS','discount_type','percent','discount_value',99)))$q$,'same key changed payload');

select pg_temp.reject($q$select import_promo_excel_batch('f7700000-0000-4000-8000-000000000003',
 pg_temp.batch(),pg_temp.rows()||jsonb_build_array(jsonb_build_object('code','UNKNOWN','unit','PCS','discount_type','percent','discount_value',10)))$q$,'unknown later SKU');
reset role;
select pg_temp.ok((select count(*)=0 from promo_import_batches where import_key='f7700000-0000-4000-8000-000000000003'),'failed batch key rolled back');
set local role authenticated;
select pg_temp.ok((select count(*)=0 from promos where rule->>'import_batch_key'='f7700000-0000-4000-8000-000000000003'),'failed batch promotions rolled back');
select pg_temp.reject($q$select import_promo_excel_batch('f7700000-0000-4000-8000-000000000004',
 pg_temp.batch(),pg_temp.rows()||jsonb_build_array(jsonb_build_object('code','PROMO-SKU-A','unit','PCS','discount_type','nominal','discount_value',5)))$q$,'duplicate SKU/unit');
select pg_temp.reject($q$select import_promo_excel_batch('f7700000-0000-4000-8000-000000000005',
 pg_temp.batch(),jsonb_build_array(jsonb_build_object('code','PROMO-SKU-A','unit','BOX','discount_type','percent','discount_value',10)))$q$,'unregistered unit');
select pg_temp.reject($q$select import_promo_excel_batch('f7700000-0000-4000-8000-000000000006',
 pg_temp.batch(),jsonb_build_array(jsonb_build_object('code','PROMO-SKU-A','unit','PCS','discount_type','percent','discount_value',101)))$q$,'over-100 percent');
select pg_temp.reject($q$select import_promo_excel_batch('f7700000-0000-4000-8000-000000000007',
 jsonb_set(pg_temp.batch(),'{branch_ids}','[]'::jsonb),pg_temp.rows())$q$,'no branch without explicit all-branches');
select set_config('request.jwt.claim.sub','f1100000-0000-4000-8000-000000000002',true);
select pg_temp.reject($q$select import_promo_excel_batch('f7700000-0000-4000-8000-000000000008',
 pg_temp.batch(),pg_temp.rows())$q$,'staff cannot import');
rollback;
