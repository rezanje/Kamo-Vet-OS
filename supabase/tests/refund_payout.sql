-- Appended to existing fictional merchant-fee prelude; entire transaction rolls back.
set local role authenticated;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select pg_temp.fee_sale('J03.BANK.CASH','[{"method":"Transfer","amount":100000}]',0,100000,100000,'Transfer');
select pg_temp.lines((select id from sales where no_struk='J03.BANK.CASH'));
select finalize_pos_sale((select id from sales where no_struk='J03.BANK.CASH'));
create temp table j03_results(name text,result jsonb);
create function pg_temp.j03_items(ref text,q numeric default 1) returns jsonb language sql as $$select jsonb_build_array(jsonb_build_object('source_line_id',i.id,'item_id',i.item_id,'qty',q,'satuan','pcs','kondisi','baik')) from sale_items i join sales s on s.id=i.sale_id where s.no_struk=ref$$;
create function pg_temp.j03_header(method text) returns jsonb language sql as $$select jsonb_build_object('tanggal',(now() at time zone 'Asia/Jakarta')::date,'dari','kasir','refund_method',method,'destination',jsonb_build_object('bank','Fictional bank','account','000123456','name','Fictional recipient'))$$;
insert into j03_results select 'cash',post_sales_return_with_payout(id,'j03-cash',pg_temp.j03_header('Tunai'),pg_temp.j03_items(no_struk)) from sales where no_struk='J03.BANK.CASH';
select pg_temp.assert_ok((select result->>'status'='selesai' from j03_results where name='cash'),'cash is completed, not pending');
select pg_temp.assert_ok((select sum(jumlah)=50000 and bool_and(metode_bayar='Tunai') and bool_and(shift_id='e4400000-0000-4000-8000-000000000001') from expenses),'cash payout follows active shift');
select pg_temp.assert_ok(pg_temp.return_balance('J03.BANK.CASH','1111')=-50000 and pg_temp.return_balance('J03.BANK.CASH','1112')=0,'transfer-origin refund credits actual cash only');
select pg_temp.assert_ok((select sum(f.amount)=50000 and bool_and(p.method='Transfer') from sale_payment_refunds f join sale_payments p on p.id=f.sale_payment_id),'source allocation retained independently');
insert into j03_results select 'cash-replay',post_sales_return_with_payout(id,'j03-cash',pg_temp.j03_header('Tunai'),pg_temp.j03_items(no_struk)) from sales where no_struk='J03.BANK.CASH';
select pg_temp.assert_ok((select count(*)=1 from sales_returns),'cash retry once');
select pg_temp.reject($q$select post_sales_return_with_payout((select id from sales where no_struk='J03.BANK.CASH'),'j03-cash',pg_temp.j03_header('Transfer'),pg_temp.j03_items('J03.BANK.CASH'))$q$,'changed method rejected');

select pg_temp.fee_sale('J03.REQUEST','[{"method":"Tunai","amount":100000}]',0,100000,100000,'Tunai');
select pg_temp.lines((select id from sales where no_struk='J03.REQUEST'));
select finalize_pos_sale((select id from sales where no_struk='J03.REQUEST'));
insert into j03_results select 'pending',post_sales_return_with_payout(id,'j03-request',pg_temp.j03_header('Transfer'),pg_temp.j03_items(no_struk,2)) from sales where no_struk='J03.REQUEST';
select pg_temp.assert_ok((select result->>'status'='pending' from j03_results where name='pending'),'transfer request stays pending');
select pg_temp.assert_ok((select count(*)=1 from sales_returns) and (select count(*)=1 from expenses),'pending request does not post return or payout');
select pg_temp.reject($q$select claim_sales_refund_request((select (result->>'refund_request_id')::uuid from j03_results where name='pending'))$q$,'cashier cannot claim finance queue');
select pg_temp.reject($q$select get_sales_refund_requests(null,true)$q$,'cashier cannot read office destinations');
create temp table j03_known_source as select id from sales where no_struk='J03.REQUEST';
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000002',true);
select pg_temp.reject($q$select post_sales_return_with_payout((select id from j03_known_source),'j03-wrong-branch',pg_temp.j03_header('Transfer'),pg_temp.j03_items('J03.REQUEST'))$q$,'other branch cashier cannot submit refund');
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
reset role;
update profiles set role='OWNER' where id='e1100000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000002',true);
insert into j03_results select 'processing',claim_sales_refund_request((result->>'refund_request_id')::uuid) from j03_results where name='pending';
select pg_temp.assert_ok((select result->>'status'='diproses' from j03_results where name='processing'),'finance claim reserves return');
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select pg_temp.reject($q$select post_unit_return('sales',(select id from sales where no_struk='J03.REQUEST'),'reservation-cash',jsonb_build_object('tanggal',(now() at time zone 'Asia/Jakarta')::date,'dari','kasir'),pg_temp.j03_items('J03.REQUEST'))$q$,'claimed refund blocks conflicting old return path');
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000002',true);
-- Wrong account and a journal failure must preserve the processing reservation,
-- with no return, expense, allocation or completion metadata committed.
select pg_temp.reject($q$select complete_sales_refund_request((select (result->>'refund_request_id')::uuid from j03_results where name='pending'),(now() at time zone 'Asia/Jakarta')::date,'e6600000-0000-4000-8000-000000000001','FICT-CASH-AS-BANK')$q$,'transfer cannot use cash account');
reset role;
create function pg_temp.j03_fail_journal() returns trigger language plpgsql as $$begin if current_setting('test.j03_fail',true)='yes' then raise exception 'Fictional J03 journal failure';end if;return new;end$$;
create trigger fictional_j03_journal_fail before insert on journal_lines for each row execute function pg_temp.j03_fail_journal();
set local role authenticated;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000002',true);
set local test.j03_fail='yes';
do $$begin
 begin perform complete_sales_refund_request((select (result->>'refund_request_id')::uuid from j03_results where name='pending'),(now() at time zone 'Asia/Jakarta')::date,'e6600000-0000-4000-8000-000000000003','FICT-FAIL');raise exception 'Expected journal failure';
 exception when others then if sqlerrm<>'Fictional J03 journal failure' then raise;end if;end;
end$$;
reset role;
select pg_temp.assert_ok((select count(*)=1 from sales_returns) and (select count(*)=1 from expenses) and (select completion_payload is null and return_id is null and status='diproses' from sales_refund_requests where request_key='j03-request'),'no partial return/expense or completion after failure');
drop trigger fictional_j03_journal_fail on journal_lines;
set local test.j03_fail='no';
set local role authenticated;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000002',true);
insert into j03_results select 'complete',complete_sales_refund_request((result->>'refund_request_id')::uuid,(now() at time zone 'Asia/Jakarta')::date,'e6600000-0000-4000-8000-000000000003','FICT-TRANSFER-1') from j03_results where name='pending';
insert into j03_results select 'complete-retry',complete_sales_refund_request((result->>'refund_request_id')::uuid,(now() at time zone 'Asia/Jakarta')::date,'e6600000-0000-4000-8000-000000000003','FICT-TRANSFER-1') from j03_results where name='pending';
select pg_temp.assert_ok((select result->>'status'='selesai' from j03_results where name='complete'),'transfer completion confirmed');
select pg_temp.assert_ok(pg_temp.return_balance('J03.REQUEST','1113')=-100000 and pg_temp.return_balance('J03.REQUEST','1111')=0,'selected bank, not original cash');
select pg_temp.assert_ok((select count(*)=2 from sales_returns) and (select sum(jumlah)=150000 from expenses),'transfer retry no duplicate money');

-- J03 owner rule: redeemed points are restored and earned points deducted, both
-- proportionally to the cumulative refunded value (floor), never below a zero balance.
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
insert into customers(id,name,phone,points)values('e9900000-0000-4000-8000-000000000007','Fictional loyalty source','J03-POINT-FIXTURE',4);
insert into sales(branch_id,customer_id,no_struk,subtotal,total,metode_bayar,bayar,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint,poin_earned,poin_digunakan)
values('e2200000-0000-4000-8000-000000000001','e9900000-0000-4000-8000-000000000007','J03.POINT.SOURCE',100000,100000,'Tunai',100000,'e1100000-0000-4000-8000-000000000001','e4400000-0000-4000-8000-000000000001','[{"method":"Tunai","amount":100000}]','j03-point-source',repeat('a',64),10,4);
select pg_temp.lines((select id from sales where no_struk='J03.POINT.SOURCE'));
select finalize_pos_sale((select id from sales where no_struk='J03.POINT.SOURCE'));
select post_sales_return_with_payout((select id from sales where no_struk='J03.POINT.SOURCE'),'j03-point-half',pg_temp.j03_header('Tunai'),pg_temp.j03_items('J03.POINT.SOURCE',1));
select pg_temp.assert_ok((select points=7 from customers where id='e9900000-0000-4000-8000-000000000007'),'half refund: 10 + 2 redeemed restored - 5 earned deducted');
reset role;
select pg_temp.assert_ok((select sum(point_delta)=-5 and sum(point_restored)=2 from sales_refund_payouts where sale_id=(select id from sales where no_struk='J03.POINT.SOURCE')),'payout records the point deduction');
update customers set points=2 where id='e9900000-0000-4000-8000-000000000007';
set local role authenticated;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select post_sales_return_with_payout((select id from sales where no_struk='J03.POINT.SOURCE'),'j03-point-rest',pg_temp.j03_header('Tunai'),pg_temp.j03_items('J03.POINT.SOURCE',1));
select pg_temp.assert_ok((select points=0 from customers where id='e9900000-0000-4000-8000-000000000007'),'deduction stops at a zero balance');
reset role;
select pg_temp.assert_ok((select sum(point_delta)=-9 and sum(point_restored)=4 from sales_refund_payouts where sale_id=(select id from sales where no_struk='J03.POINT.SOURCE')),'full refund restores all redeemed points; deduction stops at the balance');
select pg_temp.assert_ok((select count(*) filter(where delta<0)=2 and count(*) filter(where delta>0)=2 from point_ledger where customer_id='e9900000-0000-4000-8000-000000000007' and entry_type='adjustment'),'restores and deductions are on the point ledger');
set local role authenticated;
-- A point-free sale may share a customer with other loyalty purchases. Refresh
-- spending atomically while leaving the existing point balance alone.
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
insert into sales(branch_id,customer_id,no_struk,subtotal,total,metode_bayar,bayar,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint)
values('e2200000-0000-4000-8000-000000000001','e9900000-0000-4000-8000-000000000007','J03.NOPOINT.CUSTOMER',100000,100000,'Tunai',100000,'e1100000-0000-4000-8000-000000000001','e4400000-0000-4000-8000-000000000001','[{"method":"Tunai","amount":100000}]','j03-nopoint-source',repeat('b',64));
select pg_temp.lines((select id from sales where no_struk='J03.NOPOINT.CUSTOMER'));
select finalize_pos_sale((select id from sales where no_struk='J03.NOPOINT.CUSTOMER'));
select refresh_customer_spending('e9900000-0000-4000-8000-000000000007');
select post_sales_return_with_payout((select id from sales where no_struk='J03.NOPOINT.CUSTOMER'),'j03-customer-refund',pg_temp.j03_header('Tunai'),pg_temp.j03_items('J03.NOPOINT.CUSTOMER',1));
select pg_temp.assert_ok((select total_spending=50000 and points=0 from customers where id='e9900000-0000-4000-8000-000000000007'),'atomic payout refreshes source customer spending without changing points');

insert into sales(branch_id,customer_id,no_struk,subtotal,total,metode_bayar,bayar,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint)
values('e2200000-0000-4000-8000-000000000001','e9900000-0000-4000-8000-000000000007','J03.NOPOINT.TRANSFER',100000,100000,'Tunai',100000,'e1100000-0000-4000-8000-000000000001','e4400000-0000-4000-8000-000000000001','[{"method":"Tunai","amount":100000}]','j03-nopoint-transfer',repeat('c',64));
select pg_temp.lines((select id from sales where no_struk='J03.NOPOINT.TRANSFER'));
select finalize_pos_sale((select id from sales where no_struk='J03.NOPOINT.TRANSFER'));
select refresh_customer_spending('e9900000-0000-4000-8000-000000000007');
insert into j03_results select 'customer-transfer',post_sales_return_with_payout(id,'j03-customer-transfer',pg_temp.j03_header('Transfer'),pg_temp.j03_items(no_struk,2))from sales where no_struk='J03.NOPOINT.TRANSFER';
select pg_temp.assert_ok((select total_spending=150000 and points=0 from customers where id='e9900000-0000-4000-8000-000000000007'),'pending transfer has no spending or point effect');
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000002',true);
select claim_sales_refund_request((select(result->>'refund_request_id')::uuid from j03_results where name='customer-transfer'));
select complete_sales_refund_request((select(result->>'refund_request_id')::uuid from j03_results where name='customer-transfer'),(now()at time zone'Asia/Jakarta')::date,'e6600000-0000-4000-8000-000000000003','FICT-CUSTOMER-TRANSFER');
select complete_sales_refund_request((select(result->>'refund_request_id')::uuid from j03_results where name='customer-transfer'),(now()at time zone'Asia/Jakarta')::date,'e6600000-0000-4000-8000-000000000003','FICT-CUSTOMER-TRANSFER');
select pg_temp.assert_ok((select total_spending=50000 and points=0 from customers where id='e9900000-0000-4000-8000-000000000007'),'finance completion and retry reconcile spending without changing points');

-- Real FIFO stock/HPP: good cash return restores one unit; damaged transfer
-- keeps stock unchanged while reversing source HPP to the existing loss account.
reset role;
insert into stock(warehouse_id,item_id,qty)values('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',10);
insert into stock_layers(warehouse_id,item_id,qty_in,qty_left,unit_cost,source,exp_date)values('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',10,10,125.5,'manual','2031-01-01');
set local role authenticated;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
do $$declare doc uuid;issued record;begin
 doc:=pg_temp.fee_sale('J03.STOCK','[{"method":"Transfer","amount":100000}]',0,100000,100000,'Transfer');
 select * into issued from sale_stock_out_fifo('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',2,'sale','J03.STOCK');
 perform pg_temp.lines(doc,100000,issued.cost,'e5500000-0000-4000-8000-000000000002');
 perform finalize_pos_sale(doc);
end$$;
select pg_temp.assert_ok((select qty=8 from stock where item_id='e5500000-0000-4000-8000-000000000002'),'physical sale issued two units');
insert into j03_results select 'stock-good',post_sales_return_with_payout(id,'j03-stock-good',pg_temp.j03_header('Tunai'),pg_temp.j03_items(no_struk,1))from sales where no_struk='J03.STOCK';
select post_sales_return_with_payout(id,'j03-stock-good',pg_temp.j03_header('Tunai'),pg_temp.j03_items(no_struk,1))from sales where no_struk='J03.STOCK';
select pg_temp.assert_ok((select qty=9 from stock where item_id='e5500000-0000-4000-8000-000000000002'),'good cash return retry restores exactly one unit');
insert into j03_results select 'stock-damaged',post_sales_return_with_payout(id,'j03-stock-damaged',pg_temp.j03_header('Transfer'),jsonb_set(pg_temp.j03_items(no_struk,1),'{0,kondisi}','"rusak"'))from sales where no_struk='J03.STOCK';
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000002',true);
select claim_sales_refund_request((select(result->>'refund_request_id')::uuid from j03_results where name='stock-damaged'));
select complete_sales_refund_request((select(result->>'refund_request_id')::uuid from j03_results where name='stock-damaged'),(now()at time zone'Asia/Jakarta')::date,'e6600000-0000-4000-8000-000000000003','FICT-STOCK-DAMAGE');
select complete_sales_refund_request((select(result->>'refund_request_id')::uuid from j03_results where name='stock-damaged'),(now()at time zone'Asia/Jakarta')::date,'e6600000-0000-4000-8000-000000000003','FICT-STOCK-DAMAGE');
reset role;
select pg_temp.assert_ok((select qty=9 from stock where item_id='e5500000-0000-4000-8000-000000000002')and(select sum(qty_left)=9 and sum(qty_left*unit_cost)=1129.5 from stock_layers where item_id='e5500000-0000-4000-8000-000000000002'),'damaged return and retries preserve FIFO quantity and value');
select pg_temp.assert_ok(pg_temp.return_balance('J03.STOCK','1111')=-50000 and pg_temp.return_balance('J03.STOCK','1113')=-50000 and pg_temp.return_balance('J03.STOCK','1112')=0,'stock refunds use actual cash/bank once');
select pg_temp.assert_ok((select sum(ri.hpp)=251 and count(*)=2 from sales_return_items ri join sales_returns rt on rt.id=ri.return_id join sales s on s.id=rt.sale_id where s.no_struk='J03.STOCK'),'return source HPP reconciles exactly');
select pg_temp.assert_ok((select sum(l.debit-l.credit)filter(where a.code='1301')=125.5 and sum(l.debit-l.credit)filter(where a.code='5902')=125.5 and sum(l.debit-l.credit)filter(where a.code='5101')=-251 and sum(l.debit-l.credit)=0 from sales_returns rt join sales s on s.id=rt.sale_id join journal_entries j on j.source='sales-return-hpp'and j.source_ref=rt.no_retur join journal_lines l on l.entry_id=j.id join coa_accounts a on a.id=l.account_id where s.no_struk='J03.STOCK'),'good/damaged HPP journals reconcile source cost and balance');
set local role authenticated;

-- Finance pagination counts only eligible branch sources, before LIMIT/OFFSET.
reset role;
savepoint j03_queue_pages;
insert into auth.users(id,raw_user_meta_data)values('e1100000-0000-4000-8000-000000000003','{"full_name":"Fictional branch finance"}');
update profiles set role='FINANCE',is_active=true where id='e1100000-0000-4000-8000-000000000003';
insert into role_modules(role,module_id)values('FINANCE','pos'),('FINANCE','penjualan')on conflict do nothing;
insert into user_branches(user_id,branch_id)values('e1100000-0000-4000-8000-000000000003','e2200000-0000-4000-8000-000000000001');
insert into sales(branch_id,no_struk,subtotal,total,metode_bayar,bayar,cashier_id)values('e2200000-0000-4000-8000-000000000002','J03.OTHER.QUEUE',100,100,'Tunai',100,'e1100000-0000-4000-8000-000000000002');
insert into sales_refund_requests(sale_id,branch_id,requested_by,request_key,payload,quoted_total,status,receipt,created_at)
 select s.id,s.branch_id,'e1100000-0000-4000-8000-000000000002','j03-queue-other-'||n,'{}',1,'pending','{}',now()+interval '2 minutes'from sales s cross join generate_series(1,101)n where no_struk='J03.OTHER.QUEUE';
insert into sales_refund_requests(sale_id,branch_id,requested_by,request_key,payload,quoted_total,status,receipt)
 select s.id,s.branch_id,'e1100000-0000-4000-8000-000000000001','j03-queue-own-'||n,'{}',1,'pending','{}'from sales s cross join generate_series(1,101)n where no_struk='J03.STOCK';
set local role authenticated;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000003',true);
select set_config('request.headers','{"x-kamo-operational-branch":"e2200000-0000-4000-8000-000000000001"}',true);
select pg_temp.assert_ok(jsonb_array_length(get_sales_refund_requests(null,true,'pending',0))=100,'foreign requests cannot hide first finance page');
select pg_temp.assert_ok(jsonb_array_length(get_sales_refund_requests(null,true,'pending',100))=1,'eligible second finance page is reachable');
select pg_temp.assert_ok(not exists(select 1 from jsonb_array_elements(get_sales_refund_requests(null,true,'pending',0))r where r->>'branch_id'<>'e2200000-0000-4000-8000-000000000001'),'foreign queue destination never exposed');
reset role;
rollback to savepoint j03_queue_pages;
set local role authenticated;

-- A null selected-payout response is authoritative only after source access.
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select pg_temp.fee_sale('J03.LEGACY.RETURN','[{"method":"Tunai","amount":100000}]',0,100000,100000,'Tunai');
select pg_temp.lines((select id from sales where no_struk='J03.LEGACY.RETURN'));
select finalize_pos_sale((select id from sales where no_struk='J03.LEGACY.RETURN'));
insert into j03_results select 'legacy-return',post_unit_return('sales',id,'j03-legacy-return',jsonb_build_object('tanggal',(now()at time zone'Asia/Jakarta')::date,'dari','kasir'),pg_temp.j03_items(no_struk,1))from sales where no_struk='J03.LEGACY.RETURN';
select pg_temp.assert_ok(get_sales_return_payout((select(result->>'document_id')::uuid from j03_results where name='legacy-return'))is null,'authorized legacy source confirms no selected payout');
select set_config('request.headers','{"x-kamo-operational-branch":"e2200000-0000-4000-8000-000000000002"}',true);
do $$begin
 begin perform get_sales_return_payout((select(result->>'document_id')::uuid from j03_results where name='legacy-return'));raise exception 'Expected source access denial';exception when insufficient_privilege then null;end;
end$$;
select set_config('request.headers','{}',true);
select set_config('request.jwt.claim.sub','',true);
do $$begin
 begin perform get_sales_return_payout((select(result->>'document_id')::uuid from j03_results where name='legacy-return'));raise exception 'Expected inactive session denial';exception when insufficient_privilege then null;end;
end$$;

-- Refund source deletion must remain visible in the immutable activity index,
-- without retaining the private request or bank destination payload.
savepoint j03_audit_delete;
reset role;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
delete from sales_refund_payouts where request_id=(select id from sales_refund_requests where request_key='j03-request');
delete from sales_refund_requests where request_key='j03-request';
select pg_temp.assert_ok((select count(*)=1 from activity_log where row_entity='sales_refund_payouts' and action='delete'
 and actor_id='e1100000-0000-4000-8000-000000000001' and before_state='{}' and after_state='{}'
 and changed_fields=array['metadata'] and branch_ids=array['e2200000-0000-4000-8000-000000000001']::uuid[]),
 'deleted payout keeps redacted audit evidence');
select pg_temp.assert_ok((select count(*)=1 from activity_log where row_entity='sales_refund_requests' and action='delete'
 and actor_id='e1100000-0000-4000-8000-000000000001' and before_state='{}' and after_state='{}'
 and changed_fields=array['metadata'] and branch_ids=array['e2200000-0000-4000-8000-000000000001']::uuid[]),
 'deleted request keeps redacted audit evidence');
rollback to savepoint j03_audit_delete;
rollback;
