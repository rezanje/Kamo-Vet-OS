-- Appended to the fictional fee-suite bootstrap, inside its rolled-back transaction.
insert into customers(id,name,phone,points) values
 ('f1000000-0000-4000-8000-000000000001','Synthetic cross-branch customer','FIXTURE-1',17),
 ('f1000000-0000-4000-8000-000000000002','Synthetic hidden customer','FIXTURE-2',0),
 ('f1000000-0000-4000-8000-000000000003','Synthetic rounding customer','FIXTURE-3',0);
insert into sales(id,branch_id,customer_id,no_struk,subtotal,total,merchant_fee_total,metode_bayar,bayar,cashier_id,payment_plan,shift_id,checkout_key,checkout_fingerprint) values
 ('f2000000-0000-4000-8000-000000000002','e2200000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000001','SPENDING.B',200000,200000,0,'Tunai',200000,'e1100000-0000-4000-8000-000000000002',null,null,null,null),
 ('f2000000-0000-4000-8000-000000000003','e2200000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000002','HIDDEN.B',100,100,0,'Tunai',100,'e1100000-0000-4000-8000-000000000002',null,null,null,null);
set local role authenticated;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
insert into sales(id,branch_id,customer_id,no_struk,subtotal,total,merchant_fee_total,metode_bayar,bayar,cashier_id,payment_plan,shift_id,checkout_key,checkout_fingerprint) values
 ('f2000000-0000-4000-8000-000000000001','e2200000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','SPENDING.A',100000,101600,1600,'Split',101600,'e1100000-0000-4000-8000-000000000001','[{"method":"Tunai","amount":20000},{"method":"Debit","amount":81600,"fee_percent":2,"fee_amount":1600}]','e4400000-0000-4000-8000-000000000001', 'fictional-fee',repeat('f',64)),
 ('f2000000-0000-4000-8000-000000000004','e2200000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000003','ROUND.A',1,1.03,.03,'Debit',1.03,'e1100000-0000-4000-8000-000000000001','[{"method":"Debit","amount":1.03,"fee_percent":3,"fee_amount":0.03}]','e4400000-0000-4000-8000-000000000001', 'fictional-round',repeat('f',64));
-- A saved planned checkout is not revenue until finalization.
insert into sales(branch_id,customer_id,no_struk,subtotal,total,metode_bayar,bayar,cashier_id,payment_plan,shift_id,checkout_key,checkout_fingerprint) values
 ('e2200000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','PENDING.SPENDING',999999,999999,'Tunai',999999,'e1100000-0000-4000-8000-000000000001','[{"method":"Tunai","amount":999999}]','e4400000-0000-4000-8000-000000000001','spending-pending',repeat('d',64));
insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp) values
 ('f2000000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000001','Synthetic fee source',2,50000,'pcs',1,0),
 ('f2000000-0000-4000-8000-000000000004','e5500000-0000-4000-8000-000000000001','Synthetic cent source',2,.50,'pcs',1,0);
set local role authenticated;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select finalize_pos_sale('f2000000-0000-4000-8000-000000000001');
select finalize_pos_sale('f2000000-0000-4000-8000-000000000004');
-- Persist the first partial refund through its real atomic posting path.
select pg_temp.refund('SPENDING.A','spending-initial-return',1);
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
insert into sales_returns(no_retur,tanggal,sale_id,total,created_by) values
 ('SPENDING.R2',current_date,'f2000000-0000-4000-8000-000000000004',.17,'e1100000-0000-4000-8000-000000000001'),
 ('SPENDING.R3',current_date,'f2000000-0000-4000-8000-000000000004',.17,'e1100000-0000-4000-8000-000000000001');
insert into pets(id,customer_id,name) values('f3000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','Synthetic pet');
insert into visits(id,branch_id,customer_id,pet_id) values('f4000000-0000-4000-8000-000000000001','e2200000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001');
insert into invoices(visit_id,total,paid_status) values('f4000000-0000-4000-8000-000000000001',30000,'Lunas');
update tier_settings set bronze_min=250000,silver_min=300000,gold_min=400000,platinum_min=500000;
set local role authenticated;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select set_config('request.headers','{"x-kamo-operational-branch":"e2200000-0000-4000-8000-000000000001"}',true);
select pg_temp.assert_ok((select count(*)=2 from sales where customer_id='f1000000-0000-4000-8000-000000000001'),'caller sees only branch A completed and pending headers');
select pg_temp.assert_ok((select count(*)=0 from invoices),'caller cannot read branch B clinical invoice');
select pg_temp.assert_ok(refresh_customer_spending('f1000000-0000-4000-8000-000000000001'),'authorized refresh returns acknowledgement only');
select pg_temp.assert_ok((select total_spending=280000 and tier='Bronze' and points=17 from customers where id='f1000000-0000-4000-8000-000000000001'),'global A+B+clinic less merchandise refund without changing points');
select refresh_customer_spending('f1000000-0000-4000-8000-000000000001');
select pg_temp.assert_ok((select total_spending=280000 from customers where id='f1000000-0000-4000-8000-000000000001'),'retry is absolute and does not deduct twice');
select refresh_customer_spending('f1000000-0000-4000-8000-000000000003');
select pg_temp.assert_ok((select total_spending=.67 from customers where id='f1000000-0000-4000-8000-000000000003'),'cumulative cent allocation matches return fee semantics');
select pg_temp.reject($q$select refresh_customer_spending('f1000000-0000-4000-8000-000000000002')$q$,'hidden-only customer not eligible');
select set_config('request.jwt.claim.sub','',true);
select pg_temp.reject($q$select refresh_customer_spending('f1000000-0000-4000-8000-000000000001')$q$,'anonymous forbidden');
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
-- A missing live branch grant/inactive account cannot use an old session.
update profiles set is_active=false where id='e1100000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select pg_temp.reject($q$select refresh_customer_spending('f1000000-0000-4000-8000-000000000001')$q$,'inactive account denied');
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
update profiles set is_active=true where id='e1100000-0000-4000-8000-000000000001';
-- Online purchase and cancellation must not restore previously returned spending.
update profiles set role='OWNER' where id='e1100000-0000-4000-8000-000000000001';
insert into warehouses(id,branch_id,code,name,type) values('f5000000-0000-4000-8000-000000000001','e2200000-0000-4000-8000-000000000001','SPENDONL','Synthetic online','ONLINE');
insert into stock(warehouse_id,item_id,qty) values('f5000000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',5);
insert into stock_layers(warehouse_id,item_id,qty_in,qty_left,unit_cost,source) values('f5000000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',5,5,1,'manual');
set local role authenticated;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
do $test$ declare receipt jsonb;begin
 receipt:=post_online_order('spending-online',jsonb_build_object('warehouse_id','f5000000-0000-4000-8000-000000000001','channel','WA','customer_id','f1000000-0000-4000-8000-000000000001','tanggal',(now() at time zone 'Asia/Jakarta')::date),'[{"item_id":"e5500000-0000-4000-8000-000000000002","qty":1,"harga":100,"satuan":"pcs"}]');
 perform pg_temp.assert_ok((select total_spending=280100 from customers where id='f1000000-0000-4000-8000-000000000001'),'online purchase preserves previous merchandise refund');
 perform cancel_posted_sale((receipt->>'document_id')::uuid,0,'spending-online-cancel','Synthetic cancellation');
 perform pg_temp.assert_ok((select total_spending=280000 from customers where id='f1000000-0000-4000-8000-000000000001'),'cancellation preserves unrelated earlier refund');
end $test$;
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
-- >1000 headers have no browser/API page cap. All are legacy completed fixtures.
insert into sales(branch_id,customer_id,no_struk,subtotal,total,metode_bayar,bayar,cashier_id)
select 'e2200000-0000-4000-8000-000000000002'::uuid,'f1000000-0000-4000-8000-000000000001'::uuid,'BULK.'||n,1,1,'Tunai',1,'e1100000-0000-4000-8000-000000000002'::uuid from generate_series(1,1205)n;
set local role authenticated;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select refresh_customer_spending('f1000000-0000-4000-8000-000000000001');
select pg_temp.assert_ok((select total_spending=281205 from customers where id='f1000000-0000-4000-8000-000000000001'),'complete global history exceeds 1000 rows');
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
-- Bad source must roll back the secondary update, leaving prior derived values.
insert into sales_returns(no_retur,tanggal,sale_id,total,created_by) values('EXCESS',current_date,'f2000000-0000-4000-8000-000000000001',60000,'e1100000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select pg_temp.reject($q$select refresh_customer_spending('f1000000-0000-4000-8000-000000000001')$q$,'over-refund data fails closed');
select pg_temp.assert_ok((select total_spending=281205 from customers where id='f1000000-0000-4000-8000-000000000001'),'invalid source preserves previous customer total');
rollback;
