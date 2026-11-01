-- Fictional, disposable full-schema fixture. Rendered only by the focused harness.
-- ONLINE sorts before RETAIL: the unmodified public receipt RPC selects it wrongly.
insert into auth.users(id) values
 ('fa100000-0000-4000-8000-000000000001'),
 ('fa100000-0000-4000-8000-000000000002');
update profiles set role='OWNER',is_active=true where id='fa100000-0000-4000-8000-000000000001';
update profiles set role='STAFF',is_active=true where id='fa100000-0000-4000-8000-000000000002';
insert into branches(id,code,name,type) values
 ('fa200000-0000-4000-8000-000000000001','RECEIPT-PET','Fictional receipt petshop','PETSHOP'),
 ('fa200000-0000-4000-8000-000000000002','RECEIPT-DC','Fictional receipt DC','DC'),
 ('fa200000-0000-4000-8000-000000000003','RECEIPT-VET','Fictional receipt clinic','KLINIK'),
 ('fa200000-0000-4000-8000-000000000004','RECEIPT-WEB','Fictional receipt online','ONLINE');
insert into user_branches(user_id,branch_id,role) values
 ('fa100000-0000-4000-8000-000000000002','fa200000-0000-4000-8000-000000000002','PRIMARY');
insert into warehouses(id,branch_id,code,name,type,is_active) values
 ('fa300000-0000-4000-8000-000000000001','fa200000-0000-4000-8000-000000000001','A-RECEIPT-ONLINE','Fictional online','ONLINE',true),
 ('fa300000-0000-4000-8000-000000000002','fa200000-0000-4000-8000-000000000001','Z-RECEIPT-RETAIL','Fictional retail','RETAIL',true),
 ('fa300000-0000-4000-8000-000000000003','fa200000-0000-4000-8000-000000000002','RECEIPT-SOURCE','Fictional source DC','DC',true),
 ('fa300000-0000-4000-8000-000000000004','fa200000-0000-4000-8000-000000000001','0-RECEIPT-TRANSIT','Fictional transit','TRANSIT',true),
 ('fa300000-0000-4000-8000-000000000005','fa200000-0000-4000-8000-000000000003','A-RECEIPT-VET','Fictional VET','VET',true),
 ('fa300000-0000-4000-8000-000000000006','fa200000-0000-4000-8000-000000000004','A-RECEIPT-WEB','Fictional web','ONLINE',true);

-- POST_RECEIPT_ASSERTION
-- Harness substitutes only fictional item/request UUIDs after original public RPC.
do $assert$
declare v_retail numeric; v_online numeric;
begin
 select coalesce(sum(qty),0) into v_retail from stock where warehouse_id='fa300000-0000-4000-8000-000000000002' and item_id='__ITEM__';
 select coalesce(sum(qty),0) into v_online from stock where warehouse_id='fa300000-0000-4000-8000-000000000001' and item_id='__ITEM__';
 if v_retail<>36 or v_online<>0 then
  raise exception 'Wrong receipt destination: RETAIL actual %, expected 36; ONLINE actual %, expected 0',v_retail,v_online;
 end if;
 if (select sum(qty_left*unit_cost) from stock_layers where item_id='__ITEM__') is distinct from 156::numeric then
  raise exception 'Receipt did not conserve exact FIFO layer value156';
 end if;
 if (select count(*) from stock_receipts where stock_request_id='__REQUEST__')<>1 then
  raise exception 'Expected exactly one receipt';
 end if;
end $assert$;
