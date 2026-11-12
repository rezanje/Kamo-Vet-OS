-- Shared fictional fixture for the promo_syarat_hasil_* suites (disposable PostgreSQL only). Prepended by
-- scripts/test-promo-syarat-hasil-postgres.py; every suite wraps it in its own transaction and rolls back.
create function pg_temp.ok(value boolean, label text) returns text language plpgsql as $$begin
 if value is distinct from true then raise exception 'Assertion failed: %',label;end if;return 'PASS '||label;end$$;
create function pg_temp.must_reject(stmt text, pattern text, label text) returns text language plpgsql as $$
declare message text;begin
 begin execute stmt;exception when others then
  get stacked diagnostics message=message_text;
  if message !~ pattern then raise exception 'WRONG REJECTION %: %',label,message;end if;
  return 'PASS '||label||' ['||left(message,110)||']';
 end;
 raise exception 'Expected rejection: %',label;
end$$;
insert into auth.users(id,raw_user_meta_data) values
 ('e1100000-0000-4000-8000-000000000001','{"full_name":"Cashier"}'),
 ('e1100000-0000-4000-8000-000000000002','{"full_name":"Other cashier"}'),
 ('e1100000-0000-4000-8000-000000000003','{"full_name":"Fictional Owner"}'),
 ('e1100000-0000-4000-8000-000000000004','{"full_name":"Fictional Admin"}');
update profiles set role='STAFF',is_active=true where id in('e1100000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000002');
update profiles set role='OWNER',is_active=true where id='e1100000-0000-4000-8000-000000000003';
update profiles set role='ADMIN',is_active=true where id='e1100000-0000-4000-8000-000000000004';
insert into role_modules(role,module_id) values('STAFF','pos') on conflict do nothing;
insert into role_settings_private.action_policies(role, allowed) values ('STAFF', array['kasir.diskon_manual']) on conflict (role) do update set allowed = excluded.allowed; -- izin diskon manual (20261116100000): suite ini menguji harga-dasar/klaim promo dengan diskon total ketikan sebagai STAFF; yang diuji bukan izin diskonnya
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
-- Stock items: Bolt x3 (pool scope), ANC (reward), EXPIRE (below-HPP reward), KOPI (filler, price 80000), one service.
insert into items(id,code,name,unit,item_type,sell_price,buy_price) values
 ('e5500000-0000-4000-8000-000000000001','DRC8993374326970','Fictional Bolt Ikan','PCS','Persediaan',20000,0),
 ('e5500000-0000-4000-8000-000000000003','DRC8993374326987','Fictional Bolt Donat','PCS','Persediaan',20000,0),
 ('e5500000-0000-4000-8000-000000000006','DRC8993374326994','Fictional Bolt third','PCS','Persediaan',20000,0),
 ('e5500000-0000-4000-8000-000000000008','ANC-CREAMY','Fictional ANC Creamy Stick','PCS','Persediaan',15000,0),
 ('e5500000-0000-4000-8000-000000000009','EXP-REJECT','Fictional expiring goods','PCS','Persediaan',20000,0),
 ('e5500000-0000-4000-8000-00000000000a','KOPI','Fictional filler goods','PCS','Persediaan',80000,0),
 ('e5500000-0000-4000-8000-000000000002','ATOMICSERVICE','Fictional service','PCS','Jasa',0,0);
insert into item_units(item_id,unit,factor,sell_price,buy_price) values
 ('e5500000-0000-4000-8000-000000000008','BOX',10,140000,0),
 ('e5500000-0000-4000-8000-000000000001','SAK',25,500000,0);
insert into stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source,exp_date)
 select 'e3300000-0000-4000-8000-000000000001',id,(now() at time zone 'Asia/Jakarta')::date,1000,1000,
  case code when 'ANC-CREAMY' then 10000 when 'EXP-REJECT' then 17040 when 'KOPI' then 50000 else 17040 end,'purchase','2030-01-01'
 from items where item_type='Persediaan';
insert into stock(warehouse_id,item_id,qty) select warehouse_id,item_id,1000 from stock_layers;
insert into coa_accounts(code,name,type,normal_balance,is_header) values
 ('1111','Test cash','ASET','D',false),('510001','Sales','PENDAPATAN','K',false),
 ('520002','Discount','PENDAPATAN','D',false),('312005','VAT','LIABILITAS','K',false),
 ('600001','COGS','BEBAN','D',false),('170001','Inventory','ASET','D',false)
 on conflict(code) do update set is_active=true,is_header=false;
insert into cash_accounts(id,nama,jenis,coa_code) values('e6600000-0000-4000-8000-000000000001','Atomic cash','Kas','1111');
insert into payment_account_map(metode,branch_id,cash_account_id) values
 ('Tunai','e2200000-0000-4000-8000-000000000001','e6600000-0000-4000-8000-000000000001') on conflict do nothing;
update accounting_locks set closed_until=null;
update company_settings set mode_pkp=false;
-- The reviewed Bolt 2/6 quantity pool (active), exactly as in the quantity-pool suite.
insert into promos(id,name,promo_type,is_active,auto_apply,discount_type,discount_value,min_qty,kelipatan,valid_from,valid_until,rule)
values('f2000000-0000-4000-8000-000000000001','Fictional Bolt pool','diskon_produk',true,true,'nominal',1,2,true,
 (now() at time zone 'Asia/Jakarta')::date,(now() at time zone 'Asia/Jakarta')::date+30,
 '{"discount_mode":"quantity_pool","quantity_pool_scope":"bolt_800gr","quantity_pool":{"version":1,"unit":"PCS","normal_price":20000,"tiers":[{"qty":6,"total":110000},{"qty":2,"total":38000}]}}');
insert into promo_items select 'f2000000-0000-4000-8000-000000000001',id from items where code in('DRC8993374326970','DRC8993374326987','DRC8993374326994');
set constraints all immediate;set constraints all deferred;

create function pg_temp.iid(c text) returns uuid language sql as $$select id from items where code=c$$;
create function pg_temp.ref(c text,u text default 'PCS') returns jsonb language sql as $$select jsonb_build_object('item_id',pg_temp.iid(c),'unit',u)$$;
-- Definition values for save_promo_syarat_hasil.
create function pg_temp.values_of(nm text,syarat jsonb,hasil jsonb,rep boolean default true,below jsonb default '{"allowed":false}',
 branches jsonb default '[]',vfrom date default null,vuntil date default null) returns jsonb language sql as $$
 select jsonb_build_object('name',nm,'suggest',nm||' (saran)','branch_ids',branches,
  'valid_from',coalesce(vfrom,(now() at time zone 'Asia/Jakarta')::date),'valid_until',coalesce(vuntil,(now() at time zone 'Asia/Jakarta')::date+30),
  'repeat',rep,'syarat',syarat,'hasil',hasil,'below_hpp',below)
$$;
create function pg_temp.hasil_of(c text,discount jsonb,rq integer default null,unit text default 'PCS') returns jsonb language sql as $$
 select jsonb_build_object('kind','barang','items',jsonb_build_array(pg_temp.ref(c,unit)),'discount',discount)
  ||case when rq is null then '{}'::jsonb else jsonb_build_object('reward_qty',rq) end
$$;
-- "Beli 2 Bolt (Ikan/Donat campur) -> ANC Creamy Stick -Rp1.000", Accurate example.
create function pg_temp.bolt_syarat(min_qty integer default 2) returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object('kind','qty','min',min_qty,'items',jsonb_build_array(pg_temp.ref('DRC8993374326970'),pg_temp.ref('DRC8993374326987'))))
$$;
create function pg_temp.set_user(uid text) returns void language sql as $$
 select set_config('request.jwt.claim.sub',uid,true),set_config('request.jwt.claims','{"role":"authenticated"}',true)
$$;
create function pg_temp.version(id uuid) returns text language sql as $$select public.read_promo_edit(id)->>'version'$$;
