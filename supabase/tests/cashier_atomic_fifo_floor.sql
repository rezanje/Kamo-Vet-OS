-- Fictional cashier/stock data in disposable PostgreSQL only.
begin;
create function pg_temp.ok(value boolean, label text) returns void language plpgsql as $$begin
 if value is distinct from true then raise exception 'Assertion failed: %',label;end if;end$$;
create function pg_temp.reject(stmt text, label text) returns void language plpgsql as $$
declare failed boolean:=false;begin
 begin execute stmt;exception when others then failed:=true;end;
 if not failed then raise exception 'Expected rejection: %',label;end if;
end$$;
insert into auth.users(id,raw_user_meta_data) values
 ('e1100000-0000-4000-8000-000000000001','{"full_name":"Cashier"}'),
 ('e1100000-0000-4000-8000-000000000002','{"full_name":"Other cashier"}');
update profiles set role='STAFF',is_active=true where id in
-- Diskon manual (migrasi 20261031120000): fixture ini sengaja memasang potongan,
-- jadi peran STAFF diberi hak diskon manual supaya yang diuji tetap jalur aslinya.
insert into public.role_capabilities(role,manual_discount) values('STAFF',true)
 on conflict(role) do update set manual_discount=true;
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
 ('e5500000-0000-4000-8000-000000000001','ATOMICSTOCK','Fictional stock','pcs','Persediaan',10),
 ('e5500000-0000-4000-8000-000000000002','ATOMICSERVICE','Fictional service','pcs','Jasa',0),
 ('e5500000-0000-4000-8000-000000000003','ATOMICSTOCK2','Fictional stock two','pcs','Persediaan',20),
 ('e5500000-0000-4000-8000-000000000004','ATOMICGROUP','Fictional group','set','Grup',0);
insert into item_group_components(group_item_id,component_item_id,qty,unit,factor) values
 ('e5500000-0000-4000-8000-000000000004','e5500000-0000-4000-8000-000000000003',1,'pcs',1);
insert into stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source) values
 ('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000001',(now() at time zone 'Asia/Jakarta')::date,20,20,10,'purchase'),
 ('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000003',(now() at time zone 'Asia/Jakarta')::date,20,20,20,'purchase');
insert into coa_accounts(code,name,type,normal_balance,is_header) values
 ('1111','Test cash','ASET','D',false),('4101','Sales','PENDAPATAN','K',false),
 ('4102','Discount','PENDAPATAN','D',false),('2201','VAT','LIABILITAS','K',false),
 ('5101','COGS','BEBAN','D',false),('1301','Inventory','ASET','D',false)
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
set local role authenticated;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select pg_temp.ok(not has_function_privilege('anon','public.cashier_post_stock_atomic(uuid,uuid)','EXECUTE'),
 'anonymous callers cannot execute posting');

select pg_temp.line(pg_temp.sale('ATOMIC.OK',20,20),'e5500000-0000-4000-8000-000000000001',1,20);
select pg_temp.ok((cashier_post_stock_atomic((select id from sales where no_struk='ATOMIC.OK'),
 'e3300000-0000-4000-8000-000000000001')->>'finalized')::boolean,'equal/above FIFO posts');
select pg_temp.ok((select hpp=10 from sale_items where sale_id=(select id from sales where no_struk='ATOMIC.OK')),'actual FIFO cost stored');
select pg_temp.ok((select count(*)=1 from stock_moves where source_ref='ATOMIC.OK' and source='sale'),'one FIFO event');
select pg_temp.reject($q$select cashier_post_stock_atomic((select id from sales where no_struk='ATOMIC.OK'),
 'e3300000-0000-4000-8000-000000000001')$q$,'posted retry cannot issue stock');
select pg_temp.ok((select count(*)=1 from stock_moves where source_ref='ATOMIC.OK'),'retry makes no duplicate stock');

-- An expensive later line rejects the entire call, including the cheap first
-- line's stock event and both payment and HPP journals.
select pg_temp.line(pg_temp.sale('ATOMIC.BELOW',30,30),'e5500000-0000-4000-8000-000000000001',1,20);
select pg_temp.line((select id from sales where no_struk='ATOMIC.BELOW'),
 'e5500000-0000-4000-8000-000000000003',1,10);
select pg_temp.reject($q$select cashier_post_stock_atomic((select id from sales where no_struk='ATOMIC.BELOW'),
 'e3300000-0000-4000-8000-000000000001')$q$,'below actual FIFO');
select pg_temp.ok((select count(*)=0 from stock_moves where source_ref='ATOMIC.BELOW'),'all stock rolled back');
select pg_temp.ok((select count(*)=0 from journal_entries where source_ref='ATOMIC.BELOW'),'all journals rolled back');
select pg_temp.ok((select bool_and(hpp=0) from sale_items where sale_id=(select id from sales where no_struk='ATOMIC.BELOW')),'all costs rolled back');
select pg_temp.ok((select payments_finalized_at is null from sales where no_struk='ATOMIC.BELOW'),'payment remains pending');

-- Transaction-wide discounts are allocated before the FIFO comparison.
select pg_temp.line(pg_temp.sale('ATOMIC.DISCOUNT',20,5),'e5500000-0000-4000-8000-000000000001',1,20);
select pg_temp.reject($q$select cashier_post_stock_atomic((select id from sales where no_struk='ATOMIC.DISCOUNT'),
 'e3300000-0000-4000-8000-000000000001')$q$,'net transaction discount below FIFO');
select pg_temp.ok((select count(*)=0 from stock_moves where source_ref='ATOMIC.DISCOUNT'),'discount failure rolls back');

-- A later account/posting failure must roll back the successful FIFO issue too.
select pg_temp.line(pg_temp.sale('ATOMIC.POSTING',20,20),'e5500000-0000-4000-8000-000000000001',1,20);
reset role;
update coa_accounts set is_active=false where code='4101';
set local role authenticated;
select pg_temp.reject($q$select cashier_post_stock_atomic((select id from sales where no_struk='ATOMIC.POSTING'),
 'e3300000-0000-4000-8000-000000000001')$q$,'posting failure after FIFO');
select pg_temp.ok((select count(*)=0 from stock_moves where source_ref='ATOMIC.POSTING'),'posting failure rolls stock back');
select pg_temp.ok((select payments_finalized_at is null from sales where no_struk='ATOMIC.POSTING'),'posting failure leaves pending sale');
reset role;
update coa_accounts set is_active=true where code='4101';
set local role authenticated;

-- A zero-price service is allowed alongside a properly priced stock line.
select pg_temp.line(pg_temp.sale('ATOMIC.FREESERVICE',20,20),'e5500000-0000-4000-8000-000000000001',1,20);
select pg_temp.line((select id from sales where no_struk='ATOMIC.FREESERVICE'),
 'e5500000-0000-4000-8000-000000000002',1,0);
select pg_temp.ok((cashier_post_stock_atomic((select id from sales where no_struk='ATOMIC.FREESERVICE'),
 'e3300000-0000-4000-8000-000000000001')->>'finalized')::boolean,'free service with stock allowed');

-- A priced group issues its saved component and attributes its HPP to parent.
select pg_temp.line(pg_temp.sale('ATOMIC.GROUP',35,35),'e5500000-0000-4000-8000-000000000004',1,35);
insert into sale_item_group_components(sale_item_id,component_item_id,component_name,item_type,
 qty_per_group,unit,factor,total_base_qty,hpp)
select i.id,'e5500000-0000-4000-8000-000000000003','Group stock','Persediaan',1,'pcs',1,1,0
from sale_items i join sales s on s.id=i.sale_id where s.no_struk='ATOMIC.GROUP';
select pg_temp.ok((cashier_post_stock_atomic((select id from sales where no_struk='ATOMIC.GROUP'),
 'e3300000-0000-4000-8000-000000000001')->>'finalized')::boolean,'group component posts');
select pg_temp.ok((select i.hpp=20 and c.hpp=20 from sale_items i join sale_item_group_components c on c.sale_item_id=i.id
 join sales s on s.id=i.sale_id where s.no_struk='ATOMIC.GROUP'),'group FIFO cost attribution');
select pg_temp.ok((select count(*)=1 from stock_moves where source_ref='ATOMIC.GROUP' and source='sale-group'),
 'one group FIFO event');

select pg_temp.line(pg_temp.sale('ATOMIC.ZERO',10,0),'e5500000-0000-4000-8000-000000000001',1,10);
select pg_temp.reject($q$select cashier_post_stock_atomic((select id from sales where no_struk='ATOMIC.ZERO'),
 'e3300000-0000-4000-8000-000000000001')$q$,'zero-net inventory');
select pg_temp.ok((select count(*)=0 from stock_moves where source_ref='ATOMIC.ZERO'),'zero-net rolls back');
select pg_temp.reject($q$select cashier_post_stock_atomic((select id from sales where no_struk='ATOMIC.BELOW'),
 'e3300000-0000-4000-8000-000000000002')$q$,'foreign warehouse');
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000002',true);
select pg_temp.reject($q$select cashier_post_stock_atomic((select id from sales where no_struk='ATOMIC.BELOW'),
 'e3300000-0000-4000-8000-000000000001')$q$,'foreign actor');
rollback;
