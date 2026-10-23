-- Appended to the existing fictional POS fixture prefix; runner rolls everything back.
select pg_temp.assert_ok(exists(select 1 from information_schema.columns where table_schema='public' and table_name='sale_items' and column_name='service_performers'),'per-line performer storage missing');
insert into employees(id,nama,jabatan,branch_id,status,profile_id) values
 ('f1000000-0000-4000-8000-000000000001','Historical doctor','Dokter','e2200000-0000-4000-8000-000000000001','Aktif',null),
 ('f1000000-0000-4000-8000-000000000002','Historical groomer','Groomer','e2200000-0000-4000-8000-000000000001','Aktif',null),
 ('f1000000-0000-4000-8000-000000000003','Other branch','Dokter','e2200000-0000-4000-8000-000000000002','Aktif',null),
 ('f1000000-0000-4000-8000-000000000004','Future assignment','Groomer','e2200000-0000-4000-8000-000000000002','Aktif',null);
insert into employee_branch_assignments(employee_id,branch_id,role,effective_date) values('f1000000-0000-4000-8000-000000000004','e2200000-0000-4000-8000-000000000001','SECONDARY',current_date+10);
set local role authenticated;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select pg_temp.sale('PERFORMERS.PAIR');
insert into sale_items(id,sale_id,item_id,nama,qty,harga,satuan,faktor,hpp,service_performers)
select 'f2000000-0000-4000-8000-000000000001',id,'e5500000-0000-4000-8000-000000000001','Grooming',1,100000,'pcs',1,0,
 '{"doctor_id":"f1000000-0000-4000-8000-000000000001","staff_id":"f1000000-0000-4000-8000-000000000002","doctor_name":"SPOOF","staff_name":"SPOOF"}' from sales where no_struk='PERFORMERS.PAIR';
select pg_temp.assert_ok((select service_performers->>'doctor_name'='Historical doctor' and service_performers->>'staff_name'='Historical groomer' and service_performers->>'version'='1' from sale_items where id='f2000000-0000-4000-8000-000000000001'),'names must be server snapshots');
select pg_temp.assert_ok((select cashier_name='Split cashier' from sales where no_struk='PERFORMERS.PAIR'),'cashier snapshot derives from account');
select pg_temp.reject($q$update sales set cashier_name='SPOOF' where no_struk='PERFORMERS.PAIR'$q$,'cashier name immutable');
select pg_temp.reject($q$update sale_items set service_performers='{}' where id='f2000000-0000-4000-8000-000000000001'$q$,'line performers immutable');
select pg_temp.reject($q$insert into sale_items(sale_id,item_id,nama,qty,harga,service_performers) select id,'e5500000-0000-4000-8000-000000000001','Wrong branch',1,0,'{"doctor_id":"f1000000-0000-4000-8000-000000000003"}' from sales where no_struk='PERFORMERS.PAIR'$q$,'cross-branch doctor');
select pg_temp.reject($q$insert into sale_items(sale_id,item_id,nama,qty,harga,service_performers) select id,'e5500000-0000-4000-8000-000000000001','Wrong role',1,0,'{"doctor_id":"f1000000-0000-4000-8000-000000000002"}' from sales where no_struk='PERFORMERS.PAIR'$q$,'non-doctor in doctor slot');
select pg_temp.reject($q$insert into sale_items(sale_id,item_id,nama,qty,harga,service_performers) select id,'e5500000-0000-4000-8000-000000000001','Two doctors',1,0,'{"staff_id":"f1000000-0000-4000-8000-000000000001"}' from sales where no_struk='PERFORMERS.PAIR'$q$,'doctor in non-doctor slot');
select pg_temp.reject($q$insert into sale_items(sale_id,item_id,nama,qty,harga,service_performers) select id,'e5500000-0000-4000-8000-000000000001','Future',1,0,'{"staff_id":"f1000000-0000-4000-8000-000000000004"}' from sales where no_struk='PERFORMERS.PAIR'$q$,'future assignment');
select pg_temp.reject($q$insert into sale_items(sale_id,item_id,nama,qty,harga,service_performers) select id,'e5500000-0000-4000-8000-000000000002','Physical',1,0,'{"staff_id":"f1000000-0000-4000-8000-000000000002"}' from sales where no_struk='PERFORMERS.PAIR'$q$,'ordinary stock is not service');
select pg_temp.reject($q$insert into sale_items(sale_id,item_id,nama,qty,harga,service_performers) select id,'e5500000-0000-4000-8000-000000000001','Array',1,0,'["f1000000-0000-4000-8000-000000000001"]' from sales where no_struk='PERFORMERS.PAIR'$q$,'array cannot bypass role slots');
select pg_temp.assert_ok((select count(*)=1 from sale_items i join sales s on s.id=i.sale_id where s.no_struk='PERFORMERS.PAIR'),'failed attribution creates no extra line');
select finalize_pos_sale((select id from sales where no_struk='PERFORMERS.PAIR'));
select pg_temp.reject($q$delete from sale_items where id='f2000000-0000-4000-8000-000000000001'$q$,'posted deletion remains blocked');
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000002',true);
select pg_temp.assert_ok((select count(*)=0 from sale_items where id='f2000000-0000-4000-8000-000000000001'),'source line hidden across branches');
select pg_temp.reject($q$select public.normalize_service_performers('{}','e2200000-0000-4000-8000-000000000001')$q$,'normalizer is internal, no new public endpoint');
rollback;
