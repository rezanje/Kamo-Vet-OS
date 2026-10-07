-- Fictional test-only data; all changes rolled back.
begin;
insert into auth.users(id,raw_user_meta_data) values('ee100000-0000-4000-8000-000000000001','{"full_name":"Atomic transfer test"}');
update profiles set role='OWNER',is_active=true where id='ee100000-0000-4000-8000-000000000001';
insert into branches(id,code,name,type) values('ee200000-0000-4000-8000-000000000001','ATOMIC-TEST','Atomic Test','PETSHOP');
insert into warehouses(id,branch_id,code,name,type) values
('ee300000-0000-4000-8000-000000000001','ee200000-0000-4000-8000-000000000001','ZATOMIC-FROM','Atomic From','RETAIL'),
('ee300000-0000-4000-8000-000000000002','ee200000-0000-4000-8000-000000000001','ATOMIC-TO','Atomic To','RETAIL');
insert into items(id,code,name,unit,item_type,buy_price,sell_price) values
('ee500000-0000-4000-8000-000000000001','ATOMIC-ONE','Atomic One','pcs','Persediaan',3,5),
('ee500000-0000-4000-8000-000000000002','ATOMIC-TWO','Atomic Two','pcs','Persediaan',3,5);
insert into item_units(item_id,unit,factor,sell_price,buy_price) values('ee500000-0000-4000-8000-000000000001','box',12,60,36);
select stock_in_fifo('ee300000-0000-4000-8000-000000000001','ee500000-0000-4000-8000-000000000001',24,3,'test','fixture');
insert into stock_requests(id,no_request,from_branch_id,to_warehouse_id,status,approved_by) values('ee700000-0000-4000-8000-000000000001','ATOMIC-REQUEST','ee200000-0000-4000-8000-000000000001','ee300000-0000-4000-8000-000000000001','Dikirim','ee100000-0000-4000-8000-000000000001');
insert into stock_request_items(id,request_id,item_id,nama,qty_diminta,satuan,faktor) values
('ee800000-0000-4000-8000-000000000001','ee700000-0000-4000-8000-000000000001','ee500000-0000-4000-8000-000000000001','Atomic One',1,'box',12),
('ee800000-0000-4000-8000-000000000002','ee700000-0000-4000-8000-000000000001','ee500000-0000-4000-8000-000000000002','Atomic Two',1,'pcs',1);
set local role authenticated;
select set_config('request.jwt.claim.sub','ee100000-0000-4000-8000-000000000001',true);
-- Legacy first stock-out must fail before any aggregate/FIFO/movement effects.
do $$ declare v_source text; v_before jsonb; v_after jsonb; begin
 select jsonb_build_object('stock',(select jsonb_agg(to_jsonb(s) order by id) from stock s),'layers',(select jsonb_agg(to_jsonb(l) order by id) from stock_layers l),'moves',(select jsonb_agg(to_jsonb(m) order by id) from stock_moves m)) into v_before;
 foreach v_source in array array['terima-permintaan','transfer'] loop
  begin
   perform stock_out_fifo('ee300000-0000-4000-8000-000000000001','ee500000-0000-4000-8000-000000000001',1,v_source,'legacy-cutover');
   raise exception 'legacy stock-out accepted';
  exception when sqlstate '55000' then null; end;
 end loop;
 select jsonb_build_object('stock',(select jsonb_agg(to_jsonb(s) order by id) from stock s),'layers',(select jsonb_agg(to_jsonb(l) order by id) from stock_layers l),'moves',(select jsonb_agg(to_jsonb(m) order by id) from stock_moves m)) into v_after;
 if v_before is distinct from v_after then raise exception 'legacy gate changed stock/FIFO/movements'; end if;
 -- Ordinary stock sources retain their behavior.
 perform stock_out_fifo('ee300000-0000-4000-8000-000000000001','ee500000-0000-4000-8000-000000000001',1,'test-other-source','compatibility');
end $$;
reset role;
select stock_in_fifo('ee300000-0000-4000-8000-000000000001','ee500000-0000-4000-8000-000000000001',1,3,'test','restore-compatibility');
set local role authenticated;
do $$ declare v_id uuid; v_again uuid; v_before integer; begin
 select count(*) into v_before from stock_moves;
 begin
  perform post_stock_transfer_atomic('ee600000-0000-4000-8000-000000000001',null,'ee300000-0000-4000-8000-000000000001','ee300000-0000-4000-8000-000000000002',current_date,null,'[{"item_id":"ee500000-0000-4000-8000-000000000001","qty":1,"satuan":"box"},{"item_id":"ee500000-0000-4000-8000-000000000002","qty":1}]');
  raise exception 'expected insufficient stock';
 exception when others then if sqlerrm='expected insufficient stock' then raise; end if; end;
 if (select qty from stock where warehouse_id='ee300000-0000-4000-8000-000000000001' and item_id='ee500000-0000-4000-8000-000000000001')<>24 or (select count(*) from stock_moves)<>v_before or exists(select 1 from stock_transfers where request_key='ee600000-0000-4000-8000-000000000001') then raise exception 'partial transfer survived rollback'; end if;
 v_id:=post_stock_transfer_atomic('ee600000-0000-4000-8000-000000000002',null,'ee300000-0000-4000-8000-000000000001','ee300000-0000-4000-8000-000000000002',current_date,null,'[{"item_id":"ee500000-0000-4000-8000-000000000001","qty":1,"satuan":"box"}]');
 begin
  perform post_stock_transfer_atomic('ee600000-0000-4000-8000-000000000002',null,'ee300000-0000-4000-8000-000000000001','ee300000-0000-4000-8000-000000000002',current_date,null,'[{"item_id":"ee500000-0000-4000-8000-000000000001","qty":2,"satuan":"box"}]');
  raise exception 'different retry payload accepted';
 exception when others then if sqlerrm='different retry payload accepted' then raise; end if; end;
 v_again:=post_stock_transfer_atomic('ee600000-0000-4000-8000-000000000002',null,'ee300000-0000-4000-8000-000000000001','ee300000-0000-4000-8000-000000000002',current_date,null,'[{"item_id":"ee500000-0000-4000-8000-000000000001","qty":1,"satuan":"box"}]');
 if v_id<>v_again or not exists(select 1 from stock_transfer_items where transfer_id=v_id and qty=12 and selected_qty=1 and faktor=12 and satuan='box') or (select qty from stock where warehouse_id='ee300000-0000-4000-8000-000000000001' and item_id='ee500000-0000-4000-8000-000000000001')<>12 then raise exception 'unit conversion/retry wrong'; end if;
 perform post_stock_transfer_atomic('ee600000-0000-4000-8000-000000000003',v_id,null,null,current_date,null,'[{"item_id":"ee500000-0000-4000-8000-000000000001","qty":12}]');
 begin
  perform post_stock_transfer_atomic('ee600000-0000-4000-8000-000000000004',v_id,null,null,current_date,null,'[{"item_id":"ee500000-0000-4000-8000-000000000001","qty":1}]');
  raise exception 'expected source ceiling';
 exception when others then if sqlerrm='expected source ceiling' then raise; end if; end;
 if (select qty from stock where warehouse_id='ee300000-0000-4000-8000-000000000002' and item_id='ee500000-0000-4000-8000-000000000001')<>12 then raise exception 'receipt inflated stock'; end if;
end $$;
do $$ declare v_before integer; v_no text; v_retry text; begin
 select count(*) into v_before from stock_moves;
 begin
  perform receive_stock_request_atomic('ee700000-0000-4000-8000-000000000001','ee200000-0000-4000-8000-000000000001','[{"id":"ee800000-0000-4000-8000-000000000001","qty_diterima":1,"kondisi":"baik"},{"id":"ee800000-0000-4000-8000-000000000002","qty_diterima":1,"kondisi":"baik"}]');
  raise exception 'expected request rollback';
 exception when others then if sqlerrm='expected request rollback' then raise; end if; end;
 if (select count(*) from stock_moves)<>v_before or exists(select 1 from stock_receipts where stock_request_id='ee700000-0000-4000-8000-000000000001') or (select status from stock_requests where id='ee700000-0000-4000-8000-000000000001')<>'Dikirim' then raise exception 'partial request receipt committed'; end if;
 select receipt_number into v_no from receive_stock_request_atomic('ee700000-0000-4000-8000-000000000001','ee200000-0000-4000-8000-000000000001','[{"id":"ee800000-0000-4000-8000-000000000001","qty_diterima":1,"kondisi":"baik"},{"id":"ee800000-0000-4000-8000-000000000002","qty_diterima":0,"kondisi":"kurang"}]');
 select receipt_number into v_retry from receive_stock_request_atomic('ee700000-0000-4000-8000-000000000001','ee200000-0000-4000-8000-000000000001','[{"id":"ee800000-0000-4000-8000-000000000001","qty_diterima":1,"kondisi":"baik"},{"id":"ee800000-0000-4000-8000-000000000002","qty_diterima":0,"kondisi":"kurang"}]');
 if v_no<>v_retry or (select count(*) from stock_receipts where stock_request_id='ee700000-0000-4000-8000-000000000001')<>1 or (select qty from stock where warehouse_id='ee300000-0000-4000-8000-000000000001' and item_id='ee500000-0000-4000-8000-000000000001')<>0 then raise exception 'request retry or conversion wrong'; end if;
end $$;

-- Even an approver cannot reset a completed source document for a second receipt.
do $$ begin
 begin
  update stock_requests set status='Dikirim' where id='ee700000-0000-4000-8000-000000000001';
  raise exception 'completed request reset accepted';
 exception when others then if sqlerrm='completed request reset accepted' then raise; end if; end;
end $$;
reset role;
insert into auth.users(id,raw_user_meta_data) values('ee100000-0000-4000-8000-000000000002','{"full_name":"Fiction attacker"}');
update profiles set role='STAFF',is_active=true where id='ee100000-0000-4000-8000-000000000002';
insert into user_branches(user_id,branch_id) values('ee100000-0000-4000-8000-000000000002','ee200000-0000-4000-8000-000000000001');
insert into cashier_shifts(branch_id,opened_by,status,shift_type) values('ee200000-0000-4000-8000-000000000001','ee100000-0000-4000-8000-000000000002','open','petshop');
set local role authenticated;
select set_config('request.jwt.claim.sub','ee100000-0000-4000-8000-000000000002',true);
do $$ declare v_pending uuid; begin
 begin
  insert into stock_requests(from_branch_id,to_warehouse_id,status) values('ee200000-0000-4000-8000-000000000001','ee300000-0000-4000-8000-000000000001','Dikirim');
  raise exception 'forged shipment accepted';
 exception when others then if sqlerrm='forged shipment accepted' then raise; end if; end;
 insert into stock_requests(from_branch_id,to_warehouse_id) values('ee200000-0000-4000-8000-000000000001','ee300000-0000-4000-8000-000000000001') returning id into v_pending;
 insert into stock_request_items(request_id,item_id,nama,qty_diminta,satuan,faktor) values(v_pending,'ee500000-0000-4000-8000-000000000001','Fiction',1,'box',999);
 if not exists(select 1 from stock_request_items where request_id=v_pending and faktor=12) then raise exception 'official factor not enforced'; end if;
 begin
  update stock_requests set status='Disetujui',approved_by=auth.uid() where id=v_pending;
  raise exception 'staff forged approval';
 exception when others then if sqlerrm='staff forged approval' then raise; end if; end;
 begin
  update stock_request_items set faktor=999 where request_id=v_pending;
  raise exception 'source factor changed';
 exception when others then if sqlerrm='source factor changed' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub','ee100000-0000-4000-8000-000000000001',true);

reset role;
update profiles set is_active=false where id='ee100000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin
 begin
  perform post_stock_transfer_atomic('ee600000-0000-4000-8000-000000000002',null,'ee300000-0000-4000-8000-000000000001','ee300000-0000-4000-8000-000000000002',current_date,null,'[{"item_id":"ee500000-0000-4000-8000-000000000001","qty":1,"satuan":"box"}]');
  raise exception 'inactive actor retried';
 exception when others then if sqlerrm='inactive actor retried' then raise; end if; end;
end $$;

rollback;
