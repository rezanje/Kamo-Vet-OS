-- Fictional cashier/stock data in disposable PostgreSQL only.
begin;
create function pg_temp.ok(value boolean, label text) returns text language plpgsql as $$begin
 if value is distinct from true then raise exception 'Assertion failed: %',label;end if;return 'PASS '||label;end$$;
create function pg_temp.reject(stmt text, label text) returns void language plpgsql as $$
declare failed boolean:=false;begin
 begin execute stmt;exception when others then failed:=true;end;
 if not failed then raise exception 'Expected rejection: %',label;end if;
end$$;
insert into auth.users(id,raw_user_meta_data) values
 ('e1100000-0000-4000-8000-000000000001','{"full_name":"Cashier"}'),
 ('e1100000-0000-4000-8000-000000000002','{"full_name":"Other cashier"}');
update profiles set role='STAFF',is_active=true where id in
 ('e1100000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000002');
insert into role_modules(role,module_id) values('STAFF','pos') on conflict do nothing;
insert into branches(id,code,name,type) values
 ('e2200000-0000-4000-8000-000000000001','ATOMICPOS','Atomic test','PETSHOP'),
 ('e2200000-0000-4000-8000-000000000002','OTHERPOS','Other test','PETSHOP');
insert into user_branches(user_id,branch_id) values
 ('e1100000-0000-4000-8000-000000000001','e2200000-0000-4000-8000-000000000001'),
 ('e1100000-0000-4000-8000-000000000002','e2200000-0000-4000-8000-000000000002');
insert into warehouses(id,branch_id,code,name,type) values
 ('e3300000-0000-4000-8000-000000000001','e2200000-0000-4000-8000-000000000001','ATOMICWH','Atomic warehouse','RETAIL'),
 ('e3300000-0000-4000-8000-000000000002','e2200000-0000-4000-8000-000000000002','OTHERWH','Other warehouse','RETAIL');
insert into cashier_shifts(id,branch_id,opened_by,shift_type) values
 ('e4400000-0000-4000-8000-000000000001','e2200000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000001','petshop');
insert into items(id,code,name,unit,item_type,buy_price) values
 ('e5500000-0000-4000-8000-000000000001','DRC8993374326970','Fictional stock','PCS','Persediaan',10),
 ('e5500000-0000-4000-8000-000000000002','ATOMICSERVICE','Fictional service','PCS','Jasa',0),
 ('e5500000-0000-4000-8000-000000000003','DRC8993374326987','Fictional stock two','PCS','Persediaan',20),
 ('e5500000-0000-4000-8000-000000000004','ATOMICGROUP','Fictional group','set','Grup',0);
insert into item_group_components(group_item_id,component_item_id,qty,unit,factor) values
 ('e5500000-0000-4000-8000-000000000004','e5500000-0000-4000-8000-000000000003',1,'PCS',1);
insert into stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source) values
 ('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000001',(now() at time zone 'Asia/Jakarta')::date,20,20,10,'purchase'),
 ('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000003',(now() at time zone 'Asia/Jakarta')::date,20,20,20,'purchase');
insert into coa_accounts(code,name,type,normal_balance,is_header) values
 ('1111','Test cash','ASET','D',false),('510001','Sales','PENDAPATAN','K',false),
 ('520002','Discount','PENDAPATAN','D',false),('312005','VAT','LIABILITAS','K',false),
 ('600001','COGS','BEBAN','D',false),('170001','Inventory','ASET','D',false)
 on conflict(code) do update set is_active=true,is_header=false;
insert into cash_accounts(id,nama,jenis,coa_code) values
 ('e6600000-0000-4000-8000-000000000001','Atomic cash','Kas','1111');
insert into payment_account_map(metode,branch_id,cash_account_id) values
 ('Tunai','e2200000-0000-4000-8000-000000000001','e6600000-0000-4000-8000-000000000001') on conflict do nothing;
update accounting_locks set closed_until=null;
update company_settings set mode_pkp=false;
create function pg_temp.sale(ref text, gross numeric, net numeric) returns uuid language plpgsql as $$
declare result uuid;begin
 insert into sales(branch_id,no_struk,subtotal,discount,total,metode_bayar,bayar,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint)
 values('e2200000-0000-4000-8000-000000000001',ref,gross,gross-net,net,'Tunai',net,auth.uid(),
 'e4400000-0000-4000-8000-000000000001',case when net=0 then '[]'::jsonb else jsonb_build_array(jsonb_build_object('method','Tunai','amount',net)) end,
 'sql:'||ref,repeat('a',64)) returning id into result;
 return result;
end$$;
create function pg_temp.line(doc uuid,item uuid,qty numeric,price numeric) returns uuid language plpgsql as $$
declare result uuid;stock_unit text;begin
 select unit into strict stock_unit from items where id=item;
 insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp)
 values(doc,item,'Fictional cashier line',qty,price,stock_unit,1,0) returning id into result;
 return result;
end$$;


create function pg_temp.must_reject(stmt text, pattern text, label text) returns text language plpgsql as $$
declare message text;begin
 begin execute stmt;exception when others then
  get stacked diagnostics message=message_text;
  if message !~ pattern then raise exception 'WRONG REJECTION %: %',label,message;end if;
  return 'PASS '||label||' ['||message||']';
 end;
 raise exception 'Expected rejection: %',label;
end$$;
create function pg_temp.pool_line(ref text,code text,q numeric,discount numeric,pos integer,
 unit text default 'PCS',factor numeric default 1,price numeric default 20000,promo uuid default 'f2000000-0000-4000-8000-000000000001',manual numeric default 0) returns uuid language plpgsql as $$
#variable_conflict use_variable
declare id uuid;begin
 insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp,source_position,promo_id,promo_discount,item_discount_type,item_discount_value)
 select s.id,i.id,i.name,q,price,unit,factor,0,pos,promo,discount,case when manual>0 then 'nominal' end,manual
 from sales s cross join items i where s.no_struk=ref and i.code=code returning sale_items.id into id;
 return id;
end$$;
create function pg_temp.post(ref text) returns jsonb language sql as $$
 select cashier_post_stock_atomic((select id from sales where no_struk=ref),'e3300000-0000-4000-8000-000000000001')
$$;
create function pg_temp.return_rows(ref text,positions integer[],q numeric default 1) returns jsonb language sql as $$
 select jsonb_agg(jsonb_build_object('source_line_id',l.id,'item_id',l.item_id,'qty',q,'satuan',l.satuan,'kondisi','baik','exp_date','2030-01-01') order by l.source_position)
 from sale_items l join sales s on s.id=l.sale_id where s.no_struk=ref and l.source_position=any(positions)
$$;
create function pg_temp.cash_return(ref text,key text,positions integer[],q numeric default 1) returns jsonb language sql as $$
 select post_sales_return_with_payout((select id from sales where no_struk=ref),key,
 jsonb_build_object('tanggal',(now() at time zone 'Asia/Jakarta')::date,'dari','kasir','refund_method','Tunai'),pg_temp.return_rows(ref,positions,q))
$$;

insert into auth.users(id,raw_user_meta_data) values('e1100000-0000-4000-8000-000000000003','{"full_name":"Fictional Owner"}');
update profiles set role='OWNER',is_active=true where id='e1100000-0000-4000-8000-000000000003';
-- Exact reviewed code scopes with live-like NULL brand metadata; fictional IDs, FIFO17040.
insert into brands(id,name) values('f1000000-0000-4000-8000-000000000001','Fictional Bolt'),('f1000000-0000-4000-8000-000000000002','Fictional CatChoize');
update items set buy_price=0,sell_price=20000,brand_id=null where code in('DRC8993374326970','DRC8993374326987');
update stock_layers set unit_cost=17040,qty_in=1000,qty_left=1000,exp_date='2030-01-01';
insert into stock(warehouse_id,item_id,qty) select warehouse_id,item_id,1000 from stock_layers;
insert into item_units(item_id,unit,factor,sell_price,buy_price) select id,'SAK',25,500000,0 from items where code in('DRC8993374326970','DRC8993374326987');
insert into promos(id,name,promo_type,is_active,auto_apply,discount_type,discount_value,min_qty,kelipatan,valid_from,valid_until,rule)
values('f2000000-0000-4000-8000-000000000001','Fictional Bolt pool','diskon_produk',true,true,'nominal',1,2,true,
 (now() at time zone 'Asia/Jakarta')::date,(now() at time zone 'Asia/Jakarta')::date+30,
 '{"discount_mode":"quantity_pool","quantity_pool_scope":"bolt_800gr","quantity_pool":{"version":1,"unit":"PCS","normal_price":20000,"tiers":[{"qty":6,"total":110000},{"qty":2,"total":38000}]}}');
insert into promo_items(promo_id,item_id) select 'f2000000-0000-4000-8000-000000000001',id from items where code in('DRC8993374326970','DRC8993374326987');

insert into items(id,code,name,unit,item_type,sell_price,buy_price,brand_id) values
 ('e5500000-0000-4000-8000-000000000005','DRC8994125000118','Fictional Cat variant','PCS','Persediaan',20000,0,null);
insert into stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source,exp_date) values
 ('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000005',(now() at time zone 'Asia/Jakarta')::date,1000,1000,17040,'purchase','2030-01-01');
insert into stock(warehouse_id,item_id,qty) values('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000005',1000);
insert into promos(id,name,promo_type,is_active,auto_apply,discount_type,discount_value,min_qty,kelipatan,valid_from,valid_until,rule)
 select 'f2000000-0000-4000-8000-000000000002','Fictional Cat pool',promo_type,is_active,auto_apply,discount_type,discount_value,min_qty,kelipatan,valid_from,valid_until,jsonb_set(rule,'{quantity_pool_scope}','"cat_choize_adult"')
 from promos where id='f2000000-0000-4000-8000-000000000001';
insert into promo_items values('f2000000-0000-4000-8000-000000000002','e5500000-0000-4000-8000-000000000005');
insert into items(id,code,name,unit,item_type,sell_price,buy_price,brand_id) values
 ('e5500000-0000-4000-8000-000000000006','DRC8993374326994','Fictional Bolt third variant','PCS','Persediaan',20000,0,null),
 ('e5500000-0000-4000-8000-000000000007','DRC8994125000064','Fictional Cat second variant','PCS','Persediaan',20000,0,null);
insert into item_units(item_id,unit,factor,sell_price,buy_price) select id,'SAK',25,500000,0 from items where code in('DRC8994125000118','DRC8994125000064','DRC8993374326994');
insert into stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source,exp_date)
 select 'e3300000-0000-4000-8000-000000000001',id,(now() at time zone 'Asia/Jakarta')::date,1000,1000,17040,'purchase','2030-01-01' from items where code in('DRC8993374326994','DRC8994125000064');
insert into stock(warehouse_id,item_id,qty) select 'e3300000-0000-4000-8000-000000000001',id,1000 from items where code in('DRC8993374326994','DRC8994125000064');
insert into promo_items values
 ('f2000000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000006'),
 ('f2000000-0000-4000-8000-000000000002','e5500000-0000-4000-8000-000000000007');
select pg_temp.ok((select count(*)=5 and bool_and(brand_id is null) from items where code in('DRC8993374326970','DRC8993374326987','DRC8993374326994','DRC8994125000118','DRC8994125000064')),'exact reviewed five fictional target SKUs all have NULL brand_id before activation');
set constraints all immediate;
select pg_temp.ok((select count(*)=2 from promos where is_active and rule->>'discount_mode'='quantity_pool'),'both reviewed NULL-brand pools activate');
select pg_temp.ok((select count(*)=5 from promo_items where promo_id in('f2000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000002')),'exact five fictional eligible SKUs, separate3Bolt/2Cat masters');
select pg_temp.must_reject($q$insert into promo_items values('f2000000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000005')$q$,'QUANTITY_POOL_TARGET','cross-brand pool configuration refused');
select pg_temp.must_reject($q$update promos set rule=jsonb_set(rule,'{quantity_pool,normal_price}','1') where id='f2000000-0000-4000-8000-000000000001'$q$,'promos_discount_mode_valid','partial/unsupported new rule refused');
select pg_temp.must_reject($q$delete from promo_items where promo_id='f2000000-0000-4000-8000-000000000001' and item_id='e5500000-0000-4000-8000-000000000006'$q$,'QUANTITY_POOL_TARGET','missing reviewed target refused');
select pg_temp.must_reject($q$insert into promo_items values('f2000000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002')$q$,'QUANTITY_POOL_TARGET','extra unreviewed target refused');
select pg_temp.must_reject($q$update promos set rule=rule-'quantity_pool_scope' where id='f2000000-0000-4000-8000-000000000001'$q$,'promos_discount_mode_valid','missing scope refused');
select pg_temp.must_reject($q$update promos set rule=jsonb_set(rule,'{quantity_pool_scope}','"unknown"') where id='f2000000-0000-4000-8000-000000000001'$q$,'promos_discount_mode_valid','unknown scope refused');
update promos set is_active=false where id='f2000000-0000-4000-8000-000000000002';
select pg_temp.must_reject($q$update promos set rule=jsonb_set(rule,'{quantity_pool_scope}','"cat_choize_adult"') where id='f2000000-0000-4000-8000-000000000001'$q$,'QUANTITY_POOL_TARGET','cross-scope target set refused');
update promos set is_active=true where id='f2000000-0000-4000-8000-000000000002';

-- Authoritative saved-mode protection, independent of legacy caller mode hints.
create function pg_temp.legacy_edit_pool(mode text default null) returns jsonb language plpgsql as $$
declare p public.promos%rowtype;v jsonb;begin
 select * into strict p from promos where id='f2000000-0000-4000-8000-000000000001';
 v:=jsonb_build_object('name',p.name,'promo_type',p.promo_type,'suggest','Spoofed legacy editor','min_subtotal',0,
  'min_qty',p.min_qty,'max_qty',p.max_qty,'kelipatan',p.kelipatan,'auto_apply',p.auto_apply,
  'discount_type',p.discount_type,'discount_value',p.discount_value,'branch_ids',p.branch_ids,'valid_from',p.valid_from,'valid_until',p.valid_until);
 if mode is not null then v:=v||jsonb_build_object('discount_mode',mode);end if;
 return public.edit_promo(p.id,public.read_promo_edit(p.id)->>'version',v,
  (select array_agg(item_id) from promo_items where promo_id=p.id));
end$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select pg_temp.must_reject($q$select pg_temp.legacy_edit_pool()$q$,'QUANTITY_POOL_READONLY','missing caller saved mode cannot edit authoritative saved pool');
select pg_temp.must_reject($q$select pg_temp.legacy_edit_pool('per_unit')$q$,'QUANTITY_POOL_READONLY','spoofed saved mode cannot downgrade saved pool to per_unit');
select pg_temp.must_reject($q$select pg_temp.legacy_edit_pool('package_total')$q$,'QUANTITY_POOL_READONLY','spoofed package mode cannot edit authoritative saved pool');
select pg_temp.must_reject($q$update promos set rule=rule-'discount_mode' where id='f2000000-0000-4000-8000-000000000001'$q$,'promos_discount_mode_valid','orphan quantity_pool JSON with nonpool mode refused');
select pg_temp.ok((select rule->>'discount_mode'='quantity_pool' and not(rule?'suggest') from promos where id='f2000000-0000-4000-8000-000000000001'),'legacy editor rejection leaves pool unchanged');

select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select pg_temp.sale('QP.MIXED2',40000,38000);
insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp,source_position,promo_id,promo_discount)
select s.id,i.id,i.name,1,20000,'PCS',1,0,row_number() over(order by i.code)-1,'f2000000-0000-4000-8000-000000000001',1000
from sales s cross join items i where s.no_struk='QP.MIXED2' and i.code in('DRC8993374326970','DRC8993374326987');
select pg_temp.ok((cashier_post_stock_atomic((select id from sales where no_struk='QP.MIXED2'),'e3300000-0000-4000-8000-000000000001')->>'finalized')::boolean,'original cashier RPC posts mixed variants 2=38000');
select pg_temp.ok((select count(*)=2 and sum(net_paid)=38000 and min(net_paid)=19000 from sale_line_pricing where sale_id=(select id from sales where no_struk='QP.MIXED2')),'DB derives exact immutable per-line net 19000 each');
-- New-version refund quote must price the selected source, not the global gross ratio.
select pg_temp.sale('QP.REFUND',140000,138000);
insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp,source_position,promo_id,promo_discount)
select s.id,i.id,i.name,1,20000,'PCS',1,0,row_number() over(order by i.code)-1,'f2000000-0000-4000-8000-000000000001',1000
from sales s cross join items i where s.no_struk='QP.REFUND' and i.code in('DRC8993374326970','DRC8993374326987');
insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp,source_position)
select id,'e5500000-0000-4000-8000-000000000002','Unrelated service',1,100000,'PCS',1,0,2 from sales where no_struk='QP.REFUND';
select cashier_post_stock_atomic((select id from sales where no_struk='QP.REFUND'),'e3300000-0000-4000-8000-000000000001');
select pg_temp.ok((post_sales_return_with_payout((select id from sales where no_struk='QP.REFUND'),'qp-quote',
 jsonb_build_object('tanggal',(now() at time zone 'Asia/Jakarta')::date,'dari','kasir','refund_method','Transfer','destination',jsonb_build_object('bank','Fictional','account','TEST123','name','Fictional Owner')),
 (select jsonb_agg(jsonb_build_object('source_line_id',id,'item_id',item_id,'qty',1,'satuan','PCS','kondisi','baik')) from sale_items where sale_id=(select id from sales where no_struk='QP.REFUND') and source_position=0))->>'quoted_total')::numeric=19000,
 'public refund quote selects stored19000, not global19714.29');
-- Even a perfectly labelled/allocated caller cannot finalize new-mode stock with fabricated HPP.
select pg_temp.sale('QP.DIRECT',40000,38000);
insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp,source_position,promo_id,promo_discount)
select s.id,i.id,i.name,1,20000,'PCS',1,0,row_number() over(order by i.code)-1,'f2000000-0000-4000-8000-000000000001',1000
from sales s cross join items i where s.no_struk='QP.DIRECT' and i.code in('DRC8993374326970','DRC8993374326987');
select pg_temp.must_reject($q$select finalize_pos_sale((select id from sales where no_struk='QP.DIRECT'))$q$,'QUANTITY_POOL_HPP','direct STAFF cannot fabricate new-rule HPP without stock provenance');

-- Tier boundaries, exact rounding and distinct duplicate rows.
select pg_temp.sale('QP.Q6',120000,110000);
select pg_temp.pool_line('QP.Q6','DRC8993374326970',5,8333,0);
select pg_temp.pool_line('QP.Q6','DRC8993374326987',1,1667,1);
select pg_temp.post('QP.Q6');
select pg_temp.ok((select array_agg(item_discount order by source_position)=array[8333,1667]::numeric[] and sum(net_paid)=110000 from sale_line_pricing where sale_id=(select id from sales where no_struk='QP.Q6')),'6PCS=110000 with exact largest remainder 8333/1667');
select pg_temp.sale('QP.Q8',160000,148000);
select pg_temp.pool_line('QP.Q8','DRC8993374326970',5,7500,0);
select pg_temp.pool_line('QP.Q8','DRC8993374326987',3,4500,1);
select pg_temp.post('QP.Q8');
select pg_temp.ok((select array_agg(net_paid order by source_position)=array[92500,55500]::numeric[] from sale_line_pricing where sale_id=(select id from sales where no_struk='QP.Q8')),'8PCS=148000 repeated6 then2, exact line nets92500/55500');
select pg_temp.sale('QP.Q7.DUP',140000,130000);
select pg_temp.pool_line('QP.Q7.DUP','DRC8993374326970',3,4286,0);
select pg_temp.pool_line('QP.Q7.DUP','DRC8993374326987',3,4286,1);
select pg_temp.pool_line('QP.Q7.DUP','DRC8993374326970',1,1428,2);
select pg_temp.post('QP.Q7.DUP');
select pg_temp.ok((select count(*)=3 and array_agg(item_discount order by source_position)=array[4286,4286,1428]::numeric[] and sum(net_paid)=130000 from sale_line_pricing where sale_id=(select id from sales where no_struk='QP.Q7.DUP')),'odd remainder and duplicateSKU positions preserve deterministic 4286/4286/1428');
-- Independent brand identities: one of each cannot buy a tier together.
select pg_temp.sale('QP.BOLT.THREE.VARIANTS8',160000,148000);
select pg_temp.pool_line('QP.BOLT.THREE.VARIANTS8','DRC8993374326970',3,4500,0);
select pg_temp.pool_line('QP.BOLT.THREE.VARIANTS8','DRC8993374326987',3,4500,1);
select pg_temp.pool_line('QP.BOLT.THREE.VARIANTS8','DRC8993374326994',2,3000,2);
select pg_temp.post('QP.BOLT.THREE.VARIANTS8');
select pg_temp.ok((select array_agg(item_discount order by source_position)=array[4500,4500,3000]::numeric[] and sum(net_paid)=148000 from sale_line_pricing where sale_id=(select id from sales where no_struk='QP.BOLT.THREE.VARIANTS8')),'all three Bolt variants8PCS=148000, exact4500/4500/3000');
select pg_temp.sale('QP.CAT.MIXED2',40000,38000);
select pg_temp.pool_line('QP.CAT.MIXED2','DRC8994125000118',1,1000,0,promo=>'f2000000-0000-4000-8000-000000000002');
select pg_temp.pool_line('QP.CAT.MIXED2','DRC8994125000064',1,1000,1,promo=>'f2000000-0000-4000-8000-000000000002');
select pg_temp.post('QP.CAT.MIXED2');
select pg_temp.ok((select count(*)=2 and sum(net_paid)=38000 from sale_line_pricing where sale_id=(select id from sales where no_struk='QP.CAT.MIXED2')),'both Cat variants independently mix2PCS=38000');
select pg_temp.sale('QP.CAT.MIXED6',120000,110000);
select pg_temp.pool_line('QP.CAT.MIXED6','DRC8994125000118',5,8333,0,promo=>'f2000000-0000-4000-8000-000000000002');
select pg_temp.pool_line('QP.CAT.MIXED6','DRC8994125000064',1,1667,1,promo=>'f2000000-0000-4000-8000-000000000002');
select pg_temp.post('QP.CAT.MIXED6');
select pg_temp.ok((select array_agg(item_discount order by source_position)=array[8333,1667]::numeric[] and sum(net_paid)=110000 from sale_line_pricing where sale_id=(select id from sales where no_struk='QP.CAT.MIXED6')),'NULL-brand Cat mixed6PCS=110000 exact8333/1667');
select pg_temp.sale('QP.CAT.MIXED8',160000,148000);
select pg_temp.pool_line('QP.CAT.MIXED8','DRC8994125000118',5,7500,0,promo=>'f2000000-0000-4000-8000-000000000002');
select pg_temp.pool_line('QP.CAT.MIXED8','DRC8994125000064',3,4500,1,promo=>'f2000000-0000-4000-8000-000000000002');
select pg_temp.post('QP.CAT.MIXED8');
select pg_temp.ok((select array_agg(net_paid order by source_position)=array[92500,55500]::numeric[] and sum(net_paid)=148000 from sale_line_pricing where sale_id=(select id from sales where no_struk='QP.CAT.MIXED8')),'NULL-brand Cat mixed8PCS=148000 exact92500/55500');

select pg_temp.sale('QP.TWO.POOLS',160000,148000);
select pg_temp.pool_line('QP.TWO.POOLS','DRC8993374326970',3,5000,0);
select pg_temp.pool_line('QP.TWO.POOLS','DRC8993374326994',3,5000,1);
select pg_temp.pool_line('QP.TWO.POOLS','DRC8994125000118',1,1000,2,promo=>'f2000000-0000-4000-8000-000000000002');
select pg_temp.pool_line('QP.TWO.POOLS','DRC8994125000064',1,1000,3,promo=>'f2000000-0000-4000-8000-000000000002');
select pg_temp.post('QP.TWO.POOLS');
select pg_temp.ok((select array_agg(net_paid order by source_position)=array[55000,55000,19000,19000]::numeric[] from sale_line_pricing where sale_id=(select id from sales where no_struk='QP.TWO.POOLS')),'separate6Bolt110000 +2Cat38000 share receipt without pooling brands');
select pg_temp.sale('QP.BRANDS',40000,40000);
select pg_temp.pool_line('QP.BRANDS','DRC8993374326970',1,0,0,promo=>null);
select pg_temp.pool_line('QP.BRANDS','DRC8994125000118',1,0,1,promo=>null);
select pg_temp.post('QP.BRANDS');
select pg_temp.ok((select count(*)=0 from sale_line_pricing where sale_id=(select id from sales where no_struk='QP.BRANDS')),'cross-brand1+1 remains40000 without new pricing version');
select pg_temp.sale('QP.FORGED.BRAND',40000,38000);
select pg_temp.pool_line('QP.FORGED.BRAND','DRC8993374326970',1,1000,0);
select pg_temp.pool_line('QP.FORGED.BRAND','DRC8994125000118',1,1000,1);
select pg_temp.must_reject($q$select pg_temp.post('QP.FORGED.BRAND')$q$,'QUANTITY_POOL_ELIGIBILITY','forged cross-brand discount refused at original finalization');
select pg_temp.ok((select count(*)=0 from stock_moves where source_ref='QP.FORGED.BRAND'),'cross-brand rejection rolls back all original stock events');
-- SAK25 is neither 1PCS nor autoexpanded25 for quantity pools.
select pg_temp.sale('QP.SAK',520000,520000);
select pg_temp.pool_line('QP.SAK','DRC8993374326970',1,0,0,promo=>null);
select pg_temp.pool_line('QP.SAK','DRC8993374326987',1,0,1,unit=>'SAK',factor=>25,price=>500000,promo=>null);
select pg_temp.post('QP.SAK');
select pg_temp.ok((select -sum(qty)=26 from stock_moves where source_ref='QP.SAK'),'SAK stock still consumes25 while pool excludes it');
select pg_temp.ok((select count(*)=0 from sale_line_pricing where sale_id=(select id from sales where no_struk='QP.SAK')),'SAK cannot create a2PCS promotion');
-- Fractional source quantities and manual-discount rows never contribute.
select pg_temp.sale('QP.FRACTIONAL',40000,40000);
select pg_temp.pool_line('QP.FRACTIONAL','DRC8993374326970',1.5,0,0,promo=>null);
select pg_temp.pool_line('QP.FRACTIONAL','DRC8993374326987',0.5,0,1,promo=>null);
select pg_temp.post('QP.FRACTIONAL');
select pg_temp.ok((select count(*)=0 from sale_line_pricing where sale_id=(select id from sales where no_struk='QP.FRACTIONAL')),'fractional PCS not pooled');
select pg_temp.sale('QP.MANUAL',40000,39000);
select pg_temp.pool_line('QP.MANUAL','DRC8993374326970',1,0,0,promo=>null,manual=>1000);
select pg_temp.pool_line('QP.MANUAL','DRC8993374326987',1,0,1,promo=>null);
select pg_temp.post('QP.MANUAL');
select pg_temp.ok((select count(*)=0 from sale_line_pricing where sale_id=(select id from sales where no_struk='QP.MANUAL')),'manual precedence preserved, remaining1PCS not pooled');
-- Wrong distribution with a correct pooled total must still be rejected.
select pg_temp.sale('QP.FORGED.ALLOC',40000,38000);
select pg_temp.pool_line('QP.FORGED.ALLOC','DRC8993374326970',1,999,0);
select pg_temp.pool_line('QP.FORGED.ALLOC','DRC8993374326987',1,1001,1);
select pg_temp.must_reject($q$select pg_temp.post('QP.FORGED.ALLOC')$q$,'QUANTITY_POOL_TOTAL','forged exact-total allocation refused');
select pg_temp.ok((select count(*)=0 from stock_moves where source_ref='QP.FORGED.ALLOC'),'allocation failure rolls stock back');
select pg_temp.ok((select count(*)=0 from journal_entries where source_ref='QP.FORGED.ALLOC'),'allocation failure rolls journals back');
-- Old clients missing allocations must refresh, not silently sell at a wrong quote.
select pg_temp.sale('QP.STALE',40000,40000);
select pg_temp.pool_line('QP.STALE','DRC8993374326970',1,0,0,promo=>null);
select pg_temp.pool_line('QP.STALE','DRC8993374326987',1,0,1,promo=>null);
select pg_temp.must_reject($q$select pg_temp.post('QP.STALE')$q$,'QUANTITY_POOL_TOTAL','old client without required pool allocation fails closed');
-- Snapshot and source order are not client-writable, regardless of a forged GUC.
select set_config('kamo.quantity_pool_snapshot','trusted',true);
select pg_temp.must_reject($q$insert into sale_line_pricing(sale_item_id,sale_id,version,source_position,gross,item_discount,net_goods,net_paid,snapshot) select id,sale_id,1,source_position,20000,1000,1,1,'{}' from sale_items where sale_id=(select id from sales where no_struk='QP.DIRECT')$q$,'permission denied','STAFF cannot insert caller-authored pricing snapshot');
select pg_temp.must_reject($q$update sale_line_pricing set net_paid=1 where sale_id=(select id from sales where no_struk='QP.Q6')$q$,'permission denied','STAFF cannot rewrite immutable paid net');
select pg_temp.must_reject($q$update sale_items set source_position=5 where sale_id=(select id from sales where no_struk='QP.DIRECT') and source_position=0$q$,'QUANTITY_POOL_POSITION','pending source order cannot be rearranged');
select pg_temp.must_reject($q$update sale_items set quantity_pool_claim=false where sale_id=(select id from sales where no_struk='QP.DIRECT')$q$,'QUANTITY_POOL_SNAPSHOT','STAFF cannot clear DB-derived pending new-rule intent');
select pg_temp.ok(not has_function_privilege('authenticated','public.quantity_pool_refund_unit_price(uuid,numeric)','EXECUTE') and not has_function_privilege('anon','public.finalize_pos_sale(uuid)','EXECUTE'),'private pricing helper and original public role ACLs retained');
-- Replay returns the original finalizer result, does not change snapshots/stock.
select finalize_pos_sale((select id from sales where no_struk='QP.Q6'));
select pg_temp.ok((select count(*)=2 from sale_line_pricing where sale_id=(select id from sales where no_struk='QP.Q6')) and (select count(*)=2 from stock_moves where source_ref='QP.Q6'),'original finalization replay never duplicates pricing or FIFO');
-- Quote AND actual original posting must agree for mixed eligible/unrelated lines.
select pg_temp.cash_return('QP.REFUND','qp-cash-partial',array[0]);
select pg_temp.ok((select sum(total)=19000 from sales_returns where sale_id=(select id from sales where no_struk='QP.REFUND')),'partial actual payout is stored19000, not global19714.29');
select pg_temp.ok((select min(ri.harga)=19000 and sum(ri.hpp)=17040 from sales_return_items ri join sales_returns rt on rt.id=ri.return_id where rt.sale_id=(select id from sales where no_struk='QP.REFUND')),'return core stores exact19000 source price and original17040 HPP');
select pg_temp.cash_return('QP.REFUND','qp-cash-partial',array[0]);
select pg_temp.ok((select count(*)=1 from sales_returns where sale_id=(select id from sales where no_struk='QP.REFUND')),'same return request replays without duplicate payout');
select pg_temp.cash_return('QP.REFUND','qp-cash-rest',array[1,2]);
select pg_temp.ok((select sum(total)=138000 from sales_returns where sale_id=(select id from sales where no_struk='QP.REFUND')),'full mixed-source refund conserves exact138000 paid');
select pg_temp.ok((select sum(f.amount)=138000 from sale_payment_refunds f join sale_payments p on p.id=f.sale_payment_id where p.sale_id=(select id from sales where no_struk='QP.REFUND')),'original payment allocations conserve full refund');
select pg_temp.must_reject($q$select pg_temp.cash_return('QP.REFUND','qp-too-much',array[0])$q$,'Qty retur melebihi','full return prevents overrefund');
select pg_temp.cash_return('QP.Q7.DUP','qp-rounding1',array[0]);
select pg_temp.ok((select total=18571.33 from sales_returns where sale_id=(select id from sales where no_struk='QP.Q7.DUP')),'fractional per-unit net rounds cumulative first refund to18571.33');
select pg_temp.cash_return('QP.Q7.DUP','qp-rounding2',array[0],2);
select pg_temp.ok((select sum(total)=55714 from sales_returns where sale_id=(select id from sales where no_struk='QP.Q7.DUP')),'partial plus remaining source units conserve exact stored55714');
select pg_temp.ok(not exists(select entry_id from journal_lines group by entry_id having sum(debit-credit)<>0),'all original revenue/HPP/refund journals balanced');
select pg_temp.sale('QP.LEGACY.CANCEL',5000,5000);
select pg_temp.line((select id from sales where no_struk='QP.LEGACY.CANCEL'),'e5500000-0000-4000-8000-000000000002',1,5000);
select finalize_pos_sale((select id from sales where no_struk='QP.LEGACY.CANCEL'));
-- Existing promo cancellation denial must remain unchanged (no money-rule widening).
select pg_temp.must_reject($q$select cancel_posted_sale((select id from sales where no_struk='QP.MIXED2'),0,'qp-staff-cancel','Fictional cancellation test')$q$,'Hanya Super Admin','original STAFF cancellation denial preserved');
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000003',true);
select pg_temp.must_reject($q$select cancel_posted_sale((select id from sales where no_struk='QP.MIXED2'),0,'qp-owner-cancel','Fictional cancellation test')$q$,'Penjualan memakai voucher atau promo','original OWNER promo cancellation reconciliation gate preserved');
select pg_temp.ok((select voided_at is null from sales where no_struk='QP.MIXED2') and (select count(*)=0 from sale_cancellations where sale_id=(select id from sales where no_struk='QP.MIXED2')),'refused promo cancellation leaves original sale, stock and snapshots intact');
select cancel_posted_sale((select id from sales where no_struk='QP.LEGACY.CANCEL'),0,'qp-legacy-cancel','Fictional original no-promo cancellation');
select pg_temp.ok((select voided_at is not null from sales where no_struk='QP.LEGACY.CANCEL'),'original no-promo cancellation still succeeds');

-- Legacy brand metadata is not pool authority; code drift is independently refused.
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000003',true);
update items set brand_id='f1000000-0000-4000-8000-000000000002' where code='DRC8993374326987';
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select pg_temp.sale('QP.BRAND.DRIFT',40000,38000);
select pg_temp.pool_line('QP.BRAND.DRIFT','DRC8993374326970',1,1000,0);
select pg_temp.pool_line('QP.BRAND.DRIFT','DRC8993374326987',1,1000,1);
select pg_temp.post('QP.BRAND.DRIFT');
select pg_temp.ok((select sum(net_paid)=38000 from sale_line_pricing where sale_id=(select id from sales where no_struk='QP.BRAND.DRIFT')),'wrong legacy brand metadata does not override reviewed code scope');
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000003',true);
update items set code='UNREVIEWED.DRIFT' where code='DRC8993374326987';
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select pg_temp.sale('QP.CODE.DRIFT',40000,38000);
select pg_temp.pool_line('QP.CODE.DRIFT','DRC8993374326970',1,1000,0);
select pg_temp.pool_line('QP.CODE.DRIFT','UNREVIEWED.DRIFT',1,1000,1);
select pg_temp.must_reject($q$select pg_temp.post('QP.CODE.DRIFT')$q$,'QUANTITY_POOL_TARGET','current reviewed code drift is independently refused at finalization');
select pg_temp.ok((select count(*)=0 from stock_moves where source_ref='QP.CODE.DRIFT'),'code drift rejection rolls back stock');

-- Restore the deliberately changed brand and test stale official prices/schedules.
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000003',true);
update items set brand_id=null,code='DRC8993374326987' where code='UNREVIEWED.DRIFT';
insert into item_branch_prices(item_id,branch_id,unit,sell_price)
values('e5500000-0000-4000-8000-000000000001','e2200000-0000-4000-8000-000000000001','PCS',21000);
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select pg_temp.sale('QP.PRICE.DRIFT',40000,38000);
select pg_temp.pool_line('QP.PRICE.DRIFT','DRC8993374326970',1,1000,0);
select pg_temp.pool_line('QP.PRICE.DRIFT','DRC8993374326987',1,1000,1);
select pg_temp.must_reject($q$select pg_temp.post('QP.PRICE.DRIFT')$q$,'QUANTITY_POOL_ELIGIBILITY','stale normal price cannot spoof current official branch price');
select pg_temp.ok((select count(*)=0 from stock_moves where source_ref='QP.PRICE.DRIFT'),'official price rejection rolls back FIFO');
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000003',true);
delete from item_branch_prices where item_id='e5500000-0000-4000-8000-000000000001';
update promos set is_active=false,valid_until=(now() at time zone 'Asia/Jakarta')::date-1 where id='f2000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select pg_temp.sale('QP.EXPIRED',40000,38000);
select pg_temp.pool_line('QP.EXPIRED','DRC8993374326970',1,1000,0);
select pg_temp.pool_line('QP.EXPIRED','DRC8993374326987',1,1000,1);
select pg_temp.must_reject($q$select pg_temp.post('QP.EXPIRED')$q$,'QUANTITY_POOL_ELIGIBILITY','expired/inactive promo rechecked inside original finalization');
select pg_temp.ok((select count(*)=0 from stock_moves where source_ref='QP.EXPIRED') and (select payments_finalized_at is null from sales where no_struk='QP.EXPIRED'),'expiry failure leaves payment pending and no FIFO effects');
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000003',true);
update promos set is_active=true,valid_until=(now() at time zone 'Asia/Jakarta')::date+30,valid_from=(now() at time zone 'Asia/Jakarta')::date+1 where id='f2000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select pg_temp.sale('QP.FUTURE',40000,38000);
select pg_temp.pool_line('QP.FUTURE','DRC8993374326970',1,1000,0);
select pg_temp.pool_line('QP.FUTURE','DRC8993374326987',1,1000,1);
select pg_temp.must_reject($q$select pg_temp.post('QP.FUTURE')$q$,'QUANTITY_POOL_ELIGIBILITY','future promo cannot be claimed early');
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000003',true);
update promos set valid_from=(now() at time zone 'Asia/Jakarta')::date,branch_ids=array['e2200000-0000-4000-8000-000000000002']::uuid[] where id='f2000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select pg_temp.sale('QP.FOREIGN.BRANCH',40000,38000);
select pg_temp.pool_line('QP.FOREIGN.BRANCH','DRC8993374326970',1,1000,0);
select pg_temp.pool_line('QP.FOREIGN.BRANCH','DRC8993374326987',1,1000,1);
select pg_temp.must_reject($q$select pg_temp.post('QP.FOREIGN.BRANCH')$q$,'QUANTITY_POOL_ELIGIBILITY','branch scope rechecked under original sale lock');
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000003',true);
update promos set branch_ids=null where id='f2000000-0000-4000-8000-000000000001';
-- A forged legacy label must not suppress authoritative new-rule eligibility.
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000003',true);
insert into promos(id,name,promo_type,is_active,auto_apply,discount_type,discount_value,min_qty,kelipatan,rule)
values('f2000000-0000-4000-8000-000000000003','Fictional inactive legacy','diskon_produk',false,true,'nominal',1000,1,false,'{}');
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select pg_temp.sale('QP.FORGED.LEGACY',40000,38000);
select pg_temp.pool_line('QP.FORGED.LEGACY','DRC8993374326970',1,1000,0,promo=>'f2000000-0000-4000-8000-000000000003');
select pg_temp.pool_line('QP.FORGED.LEGACY','DRC8993374326987',1,1000,1,promo=>'f2000000-0000-4000-8000-000000000003');
select pg_temp.must_reject($q$select pg_temp.post('QP.FORGED.LEGACY')$q$,'QUANTITY_POOL_TOTAL','inactive forged legacy label cannot suppress new pool');
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000003',true);
update promos set is_active=true,discount_value=100 where id='f2000000-0000-4000-8000-000000000003';
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select pg_temp.sale('QP.FORGED.LEGACY.VALUE',40000,38000);
select pg_temp.pool_line('QP.FORGED.LEGACY.VALUE','DRC8993374326970',1,1000,0,promo=>'f2000000-0000-4000-8000-000000000003');
select pg_temp.pool_line('QP.FORGED.LEGACY.VALUE','DRC8993374326987',1,1000,1,promo=>'f2000000-0000-4000-8000-000000000003');
select pg_temp.must_reject($q$select pg_temp.post('QP.FORGED.LEGACY.VALUE')$q$,'QUANTITY_POOL_TOTAL','forged legacy amount above actual master cannot suppress new pool');
-- New-mode backoffice composes ORIGINAL stock writers + finalizer atomically.
select pg_temp.sale('QP.BACKOFFICE.ATOMIC',40000,38000);
select pg_temp.pool_line('QP.BACKOFFICE.ATOMIC','DRC8993374326970',1,1000,0);
select pg_temp.pool_line('QP.BACKOFFICE.ATOMIC','DRC8993374326987',1,1000,1);
select quantity_pool_post_backoffice_atomic((select id from sales where no_struk='QP.BACKOFFICE.ATOMIC'),'e3300000-0000-4000-8000-000000000001');
select pg_temp.ok((select count(*)=2 and sum(net_paid)=38000 from sale_line_pricing where sale_id=(select id from sales where no_struk='QP.BACKOFFICE.ATOMIC')),'backoffice new-mode atomic composition uses original finalizer/net snapshots');
-- Correct stronger legacy promotions still win without receiving new-version snapshots.
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000003',true);
update promos set discount_value=1500 where id='f2000000-0000-4000-8000-000000000003';
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select pg_temp.sale('QP.LEGACY.PERUNIT',40000,37000);
select pg_temp.pool_line('QP.LEGACY.PERUNIT','DRC8993374326970',1,1500,0,promo=>'f2000000-0000-4000-8000-000000000003');
select pg_temp.pool_line('QP.LEGACY.PERUNIT','DRC8993374326987',1,1500,1,promo=>'f2000000-0000-4000-8000-000000000003');
select quantity_pool_post_backoffice_atomic((select id from sales where no_struk='QP.LEGACY.PERUNIT'),'e3300000-0000-4000-8000-000000000001');
select pg_temp.ok((select count(*)=0 from sale_line_pricing where sale_id=(select id from sales where no_struk='QP.LEGACY.PERUNIT')),'stronger real per_unit remains legacy37000');
-- Quote has no applied pool; stronger legacy deactivated after staging.
select pg_temp.sale('QP.LEGACY.DRIFT.ATOMIC',40000,37000);
select pg_temp.pool_line('QP.LEGACY.DRIFT.ATOMIC','DRC8993374326970',1,1500,0,promo=>'f2000000-0000-4000-8000-000000000003');
select pg_temp.pool_line('QP.LEGACY.DRIFT.ATOMIC','DRC8993374326987',1,1500,1,promo=>'f2000000-0000-4000-8000-000000000003');
select pg_temp.ok((select bool_and(not quantity_pool_claim) from sale_items where sale_id=(select id from sales where no_struk='QP.LEGACY.DRIFT.ATOMIC')),'stronger legacy quote has quantityPoolApplied=false');
create temp table qp_drift_stock_before as select id,qty_left from stock_layers;
create temp table qp_drift_balances_before as select warehouse_id,item_id,qty from stock;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000003',true);
update promos set is_active=false where id='f2000000-0000-4000-8000-000000000003';
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select pg_temp.must_reject($q$select quantity_pool_post_backoffice_atomic((select id from sales where no_struk='QP.LEGACY.DRIFT.ATOMIC'),'e3300000-0000-4000-8000-000000000001')$q$,'QUANTITY_POOL_TOTAL','deactivated stronger legacy rechecked inside atomic covered-row path');
select pg_temp.ok((select count(*)=0 from stock_moves where source_ref='QP.LEGACY.DRIFT.ATOMIC') and (select count(*)=0 from journal_entries where source_ref='QP.LEGACY.DRIFT.ATOMIC') and (select bool_and(hpp=0) from sale_items where sale_id=(select id from sales where no_struk='QP.LEGACY.DRIFT.ATOMIC')) and (select payments_finalized_at is null from sales where no_struk='QP.LEGACY.DRIFT.ATOMIC'),'nonpool quote drift rolls back all stock/HPP/journals without orphan issues');
select pg_temp.ok(not exists(select 1 from stock_layers l join qp_drift_stock_before b using(id) where l.qty_left is distinct from b.qty_left) and not exists(select 1 from stock s join qp_drift_balances_before b using(warehouse_id,item_id) where s.qty is distinct from b.qty),'covered-row rejection restores exact layer quantities and stock balances');
-- No pool at quote: activation before finalization still stays within one transaction.
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000003',true);
update promos set is_active=false where id='f2000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select pg_temp.sale('QP.ACTIVATED.AFTER.QUOTE',40000,40000);
select pg_temp.pool_line('QP.ACTIVATED.AFTER.QUOTE','DRC8993374326970',1,0,0,promo=>null);
select pg_temp.pool_line('QP.ACTIVATED.AFTER.QUOTE','DRC8993374326987',1,0,1,promo=>null);
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000003',true);
update promos set is_active=true where id='f2000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select pg_temp.must_reject($q$select quantity_pool_post_backoffice_atomic((select id from sales where no_struk='QP.ACTIVATED.AFTER.QUOTE'),'e3300000-0000-4000-8000-000000000001')$q$,'QUANTITY_POOL_TOTAL','pool activated after no-pool quote is checked atomically');
select pg_temp.ok((select count(*)=0 from stock_moves where source_ref='QP.ACTIVATED.AFTER.QUOTE') and (select bool_and(hpp=0) from sale_items where sale_id=(select id from sales where no_struk='QP.ACTIVATED.AFTER.QUOTE')),'activation after quote leaves no stock/HPP fragments');
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000003',true);
update promos set is_active=true where id='f2000000-0000-4000-8000-000000000003';
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);

select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000003',true);
update promos set discount_type='percent',discount_value=10 where id='f2000000-0000-4000-8000-000000000003';
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select pg_temp.sale('QP.LEGACY.PERCENT',40000,36000);
select pg_temp.pool_line('QP.LEGACY.PERCENT','DRC8993374326970',1,2000,0,promo=>'f2000000-0000-4000-8000-000000000003');
select pg_temp.pool_line('QP.LEGACY.PERCENT','DRC8993374326987',1,2000,1,promo=>'f2000000-0000-4000-8000-000000000003');
select pg_temp.post('QP.LEGACY.PERCENT');
select pg_temp.ok((select count(*)=0 from sale_line_pricing where sale_id=(select id from sales where no_struk='QP.LEGACY.PERCENT')),'stronger real percent remains legacy36000');
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000003',true);
insert into promo_items values('f2000000-0000-4000-8000-000000000003','e5500000-0000-4000-8000-000000000001');
update promos set discount_type='nominal',discount_value=5000,min_qty=2,kelipatan=true,rule='{"discount_mode":"package_total"}' where id='f2000000-0000-4000-8000-000000000003';
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select pg_temp.sale('QP.LEGACY.PACKAGE',60000,55000);
select pg_temp.pool_line('QP.LEGACY.PACKAGE','DRC8993374326970',1,2500,0,promo=>'f2000000-0000-4000-8000-000000000003');
select pg_temp.pool_line('QP.LEGACY.PACKAGE','DRC8993374326970',1,2500,1,promo=>'f2000000-0000-4000-8000-000000000003');
select pg_temp.pool_line('QP.LEGACY.PACKAGE','DRC8993374326987',1,0,2,promo=>null);
select pg_temp.post('QP.LEGACY.PACKAGE');
select pg_temp.ok((select count(*)=0 from sale_line_pricing where sale_id=(select id from sales where no_struk='QP.LEGACY.PACKAGE')),'stronger original package_total with duplicate rows remains legacy55000');
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000003',true);
update promos set is_active=false where id='f2000000-0000-4000-8000-000000000003';
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select pg_temp.sale('QP.BACKOFFICE.FAIL',40000,38000);
select pg_temp.pool_line('QP.BACKOFFICE.FAIL','DRC8993374326970',1,999,0);
select pg_temp.pool_line('QP.BACKOFFICE.FAIL','DRC8993374326987',1,1001,1);
select pg_temp.must_reject($q$select quantity_pool_post_backoffice_atomic((select id from sales where no_struk='QP.BACKOFFICE.FAIL'),'e3300000-0000-4000-8000-000000000001')$q$,'QUANTITY_POOL_TOTAL','backoffice stale allocation rolls back original writers atomically');
select pg_temp.ok((select count(*)=0 from stock_moves where source_ref='QP.BACKOFFICE.FAIL') and (select count(*)=0 from journal_entries where source_ref='QP.BACKOFFICE.FAIL') and (select bool_and(hpp=0) from sale_items where sale_id=(select id from sales where no_struk='QP.BACKOFFICE.FAIL')),'backoffice failure leaves no stock/journal/HPP fragments');
select pg_temp.ok((select not prosecdef from pg_proc where oid='public.quantity_pool_post_backoffice_atomic(uuid,uuid)'::regprocedure),'new backoffice composition is SECURITY INVOKER, not a privilege elevation');
-- Original FIFO HPP remains authoritative even with buy_price0.
reset role;
select set_config('request.jwt.claim.sub','',true);
update stock_layers set unit_cost=19001 where item_id='e5500000-0000-4000-8000-000000000001' and qty_left>0;
set local role authenticated;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select pg_temp.sale('QP.BELOW.HPP',40000,38000);
select pg_temp.pool_line('QP.BELOW.HPP','DRC8993374326970',1,1000,0);
select pg_temp.pool_line('QP.BELOW.HPP','DRC8993374326987',1,1000,1);
select pg_temp.must_reject($q$select pg_temp.post('QP.BELOW.HPP')$q$,'di bawah HPP FIFO','new promo never bypasses original actual FIFO19001 floor');
select pg_temp.ok((select count(*)=0 from stock_moves where source_ref='QP.BELOW.HPP') and (select count(*)=0 from journal_entries where source_ref='QP.BELOW.HPP') and (select count(*)=0 from sale_line_pricing where sale_id=(select id from sales where no_struk='QP.BELOW.HPP')),'HPP rejection rolls back stock/journals/new snapshot together');
select pg_temp.ok((select bool_and(hpp=0) from sale_items where sale_id=(select id from sales where no_struk='QP.BELOW.HPP')),'failed HPP does not leave partial cost writes');
select pg_temp.sale('QP.BACKOFFICE.HPP.POLICY',40000,38000);
select pg_temp.pool_line('QP.BACKOFFICE.HPP.POLICY','DRC8993374326970',1,1000,0);
select pg_temp.pool_line('QP.BACKOFFICE.HPP.POLICY','DRC8993374326987',1,1000,1);
select quantity_pool_post_backoffice_atomic((select id from sales where no_struk='QP.BACKOFFICE.HPP.POLICY'),'e3300000-0000-4000-8000-000000000001');
select pg_temp.ok((select i.hpp=19001 and p.net_goods=19000 from sale_items i join sale_line_pricing p on p.sale_item_id=i.id where i.sale_id=(select id from sales where no_struk='QP.BACKOFFICE.HPP.POLICY') and i.source_position=0),'backoffice original warning-only HPP policy retained with actual19001 provenance');
select pg_temp.ok((select bool_and((m.fifo_takes->0->>'exp_date')::date='2030-01-01') from stock_moves m where m.source_ref='QP.MIXED2'),'original FIFO expiry provenance retained unchanged');
-- Historical no-snapshot rows still use the old gross-ratio rule in quote+posting.
select pg_temp.sale('QP.HISTORY',100000,90000);
select pg_temp.pool_line('QP.HISTORY','ATOMICSERVICE',1,0,0,price=>100000,promo=>null);
select finalize_pos_sale((select id from sales where no_struk='QP.HISTORY'));
select pg_temp.cash_return('QP.HISTORY','qp-history',array[0]);
select pg_temp.ok((select total=90000 from sales_returns where sale_id=(select id from sales where no_struk='QP.HISTORY')) and (select count(*)=0 from sale_line_pricing where sale_id=(select id from sales where no_struk='QP.HISTORY')),'historical fallback unchanged, exact90000 quote+post');
-- Original branch RLS and actor check remain effective on new pricing.
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000002',true);
select pg_temp.ok((select count(*)=0 from sale_line_pricing),'out-of-branch STAFF cannot read any new pricing snapshots');
select pg_temp.must_reject($q$select finalize_pos_sale((select id from sales where no_struk='QP.DIRECT'))$q$,'Pembayaran POS tidak ditemukan|Akses pembayaran POS','foreign STAFF cannot finalize new-rule source');

-- A deleted new-rule master cannot erase pending pricing intent via ON DELETE SET NULL.
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000003',true);
update promos set is_active=false where id='f2000000-0000-4000-8000-000000000001';
set constraints quantity_pool_targets_header,quantity_pool_targets_items deferred;
insert into promos(id,name,promo_type,is_active,auto_apply,discount_type,discount_value,min_qty,kelipatan,valid_from,valid_until,rule)
select 'f2000000-0000-4000-8000-000000000004','Fictional deleted pool',promo_type,true,auto_apply,discount_type,discount_value,min_qty,kelipatan,valid_from,valid_until,rule from promos where id='f2000000-0000-4000-8000-000000000001';
insert into promo_items select 'f2000000-0000-4000-8000-000000000004',item_id from promo_items where promo_id='f2000000-0000-4000-8000-000000000001';
set constraints quantity_pool_targets_header,quantity_pool_targets_items immediate;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select pg_temp.sale('QP.DELETED.MASTER',40000,38000);
select pg_temp.pool_line('QP.DELETED.MASTER','DRC8993374326987',2,2000,0,promo=>'f2000000-0000-4000-8000-000000000004');
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000003',true);
delete from promos where id='f2000000-0000-4000-8000-000000000004';
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select pg_temp.must_reject($q$select pg_temp.post('QP.DELETED.MASTER')$q$,'QUANTITY_POOL_ELIGIBILITY','deleted pending master cannot silently turn new sale into legacy');
select pg_temp.cash_return('QP.Q6','qp-stored-after-master-deactivated',array[0]);
select pg_temp.ok((select total=18333.4 from sales_returns where sale_id=(select id from sales where no_struk='QP.Q6')),'stored source91667/5 refunds18333.40 after master deactivation, not global18333.33');
rollback;
