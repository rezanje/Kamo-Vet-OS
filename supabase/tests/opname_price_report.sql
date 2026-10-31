-- Fictional posting and access checks. Run only in disposable PostgreSQL.
insert into auth.users(id) values
 (md5('i05-owner')::uuid),(md5('i05-finance')::uuid),(md5('i05-staff')::uuid);
update public.profiles set role='OWNER',is_active=true where id=md5('i05-owner')::uuid;
update public.profiles set role='FINANCE',is_active=true where id=md5('i05-finance')::uuid;
update public.profiles set role='STAFF',is_active=true where id=md5('i05-staff')::uuid;
insert into public.branches(id,code,name,type) values
 (md5('i05-branch-a')::uuid,'I05A','Fictional A','KLINIK'),
 (md5('i05-branch-b')::uuid,'I05B','Fictional B','KLINIK');
insert into public.warehouses(id,branch_id,code,name,type) values
 (md5('i05-wh-a')::uuid,md5('i05-branch-a')::uuid,'I05A','Fictional A','VET'),
 (md5('i05-wh-b')::uuid,md5('i05-branch-b')::uuid,'I05B','Fictional B','VET');
insert into public.user_branches(user_id,branch_id) values
 (md5('i05-finance')::uuid,md5('i05-branch-a')::uuid),
 (md5('i05-staff')::uuid,md5('i05-branch-a')::uuid);
insert into public.role_capabilities(role,all_branches,create_accounts)
 values('FINANCE',false,false)
 on conflict(role) do update set all_branches=false;
insert into public.role_modules(role,module_id) values('FINANCE','laporan') on conflict do nothing;
insert into public.items(id,code,name,unit,item_type,buy_price,sell_price) values
 (md5('i05-item-a')::uuid,'I05A','Fictional shortage','PCS','Persediaan',90,150),
 (md5('i05-item-b')::uuid,'I05B','Fictional surplus','PCS','Persediaan',50,70);
insert into public.item_branch_prices(item_id,branch_id,unit,sell_price)
 values(md5('i05-item-a')::uuid,md5('i05-branch-a')::uuid,'PCS',0);
insert into public.coa_accounts(code,name,type,normal_balance) values
 ('170001','Fictional inventory','ASET','D'),('720010','Fictional variance','BEBAN','D')
 on conflict(code) do update set is_active=true,is_header=false;
create function pg_temp.i05_check(p_ok boolean,p_label text) returns void
 language plpgsql as $$begin if p_ok is distinct from true then raise exception 'I05: %',p_label;end if;end$$;

begin;
insert into public.opname_orders(id,no_opname,warehouse_id,penanggung_jawab)
 values(md5('i05-order')::uuid,'OPO.I05.TEST',md5('i05-wh-a')::uuid,'Fictional counter');
insert into public.opname_order_items(order_id,item_id) values
 (md5('i05-order')::uuid,md5('i05-item-a')::uuid),
 (md5('i05-order')::uuid,md5('i05-item-b')::uuid);
select public.stock_in_fifo(md5('i05-wh-a')::uuid,md5('i05-item-a')::uuid,5,100,'fixture','I05-1',current_date-2,null);
select public.stock_in_fifo(md5('i05-wh-a')::uuid,md5('i05-item-a')::uuid,5,200,'fixture','I05-2',current_date-1,null);
insert into public.opname_counts(order_id,item_id,qty_sistem,qty_fisik) values
 (md5('i05-order')::uuid,md5('i05-item-a')::uuid,10,8);
update public.item_branch_prices set sell_price='NaN'::numeric
 where item_id=md5('i05-item-a')::uuid and branch_id=md5('i05-branch-a')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i05-owner')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
do $$declare rejected boolean:=false;begin
 begin perform public.post_opname_atomic(md5('i05-order')::uuid,current_date,
  jsonb_build_object(md5('i05-item-a')::uuid::text,8,md5('i05-item-b')::uuid::text,2));
 exception when others then rejected:=true;end;
 perform pg_temp.i05_check(rejected,'nonfinite branch price aborts posting');
 perform pg_temp.i05_check(not exists(select 1 from public.opname_results where order_id=md5('i05-order')::uuid),
  'failed snapshot rolls back result');
end$$;
reset role;
update public.item_branch_prices set sell_price=0
 where item_id=md5('i05-item-a')::uuid and branch_id=md5('i05-branch-a')::uuid;
set local role authenticated;
select public.post_opname_atomic(md5('i05-order')::uuid,current_date,
 jsonb_build_object(md5('i05-item-a')::uuid::text,8,md5('i05-item-b')::uuid::text,2));
do $$declare r jsonb;a jsonb;b jsonb;begin
 select public.read_opname_price_report(x.id) into r from public.opname_results x where x.order_id=md5('i05-order')::uuid;
 select value into a from jsonb_array_elements(r->'rows') value where value->>'item_id'=md5('i05-item-a')::uuid::text;
 select value into b from jsonb_array_elements(r->'rows') value where value->>'item_id'=md5('i05-item-b')::uuid::text;
 perform pg_temp.i05_check(r->>'scope'='Sebagian' and r->>'method'='fifo' and jsonb_array_length(r->'rows')=2,'partial multi-line snapshot');
 perform pg_temp.i05_check((a->>'qty_sistem')::numeric=10 and (a->>'qty_fisik')::numeric=8 and (a->>'selisih')::numeric=-2,'shortage quantities');
 perform pg_temp.i05_check((a->>'hpp_selisih_keluar')::numeric=200 and (a->>'modal_satuan')::numeric=100 and (a->>'nilai_lapisan_setelah')::numeric=1300,'shortage FIFO cost and separate remaining layer value');
 perform pg_temp.i05_check((a->>'selisih')::numeric*(a->>'modal_satuan')::numeric=(a->>'nilai_selisih_modal')::numeric,'shortage unit times quantity matches posted delta');
 perform pg_temp.i05_check((a->>'harga_jual_cabang')::numeric=0 and (a->>'nilai_selisih_jual')::numeric=0,'zero branch override retained');
 perform pg_temp.i05_check((b->>'modal_satuan')::numeric=50 and (b->>'nilai_selisih_modal')::numeric=100 and (b->>'harga_jual_cabang')::numeric=70,'surplus posted cost and default sale price');
 perform pg_temp.i05_check((b->>'selisih')::numeric*(b->>'modal_satuan')::numeric=(b->>'nilai_selisih_modal')::numeric,'surplus unit times quantity matches posted delta');
end$$;
update public.item_branch_prices set sell_price=999 where item_id=md5('i05-item-a')::uuid;
select public.post_opname_atomic(md5('i05-order')::uuid,current_date,
 jsonb_build_object(md5('i05-item-a')::uuid::text,8,md5('i05-item-b')::uuid::text,2));
select pg_temp.i05_check((select (r.value->>'harga_jual_cabang')::numeric=0
 from public.opname_results x cross join lateral jsonb_array_elements(public.read_opname_price_report(x.id)->'rows') r(value)
 where x.order_id=md5('i05-order')::uuid and r.value->>'item_id'=md5('i05-item-a')::uuid::text),
 'retry keeps original branch price snapshot');
reset role;
select pg_temp.i05_check(not has_table_privilege('authenticated','public.opname_posting_receipts','SELECT'),'receipt remains private');
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i05-finance')::uuid::text,true);
do $$begin
 perform pg_temp.i05_check((select jsonb_array_length(public.read_opname_price_report(x.id)->'rows')=2
  from public.opname_results x where x.order_id=md5('i05-order')::uuid),'authorized finance can read');
end$$;
select set_config('request.jwt.claim.sub',md5('i05-staff')::uuid::text,true);
do $$declare rejected boolean:=false;begin
 begin perform public.read_opname_price_report((select id from public.opname_results where order_id=md5('i05-order')::uuid));
 exception when insufficient_privilege then rejected:=true;end;
 perform pg_temp.i05_check(rejected,'cashier cannot read costs');
end$$;
reset role;
rollback;

begin;
insert into public.opname_orders(id,no_opname,warehouse_id,penanggung_jawab)
 values(md5('i05-order-b')::uuid,'OPO.I05.FULL',md5('i05-wh-b')::uuid,'Fictional full');
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i05-owner')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
select public.post_opname_atomic(md5('i05-order-b')::uuid,current_date,jsonb_build_object(md5('i05-item-b')::uuid::text,1));
select pg_temp.i05_check((select public.read_opname_price_report(r.id)->>'scope'='Seluruh'
 from public.opname_results r where r.order_id=md5('i05-order-b')::uuid),'whole-order snapshot');
select set_config('test.i05_other_result',(select r.id::text from public.opname_results r where r.order_id=md5('i05-order-b')::uuid),true);
select set_config('request.jwt.claim.sub',md5('i05-finance')::uuid::text,true);
do $$declare rejected boolean:=false;begin
 begin perform public.read_opname_price_report(current_setting('test.i05_other_result')::uuid);
 exception when insufficient_privilege then rejected:=true;end;
 perform pg_temp.i05_check(rejected,'finance outside branch denied');
end$$;
rollback;

begin;
insert into public.opname_orders(id,no_opname,warehouse_id,penanggung_jawab)
 values(md5('i05-legacy')::uuid,'OPO.I05.OLD',md5('i05-wh-a')::uuid,'Fictional legacy');
insert into public.opname_results(id,no_hasil,order_id)
 values(md5('i05-legacy-result')::uuid,'OPR.I05.OLD',md5('i05-legacy')::uuid);
insert into public.opname_orders(id,no_opname,warehouse_id,penanggung_jawab)
 values(md5('i05-unrelated-order')::uuid,'OPO.I05.UNRELATED',md5('i05-wh-b')::uuid,'Fictional unrelated');
do $$declare rejected boolean:=false;begin
 begin
  insert into public.opname_posting_receipts(order_id,result_id,actor_id,payload,receipt,source_snapshot,journal_ids)
   values(md5('i05-unrelated-order')::uuid,md5('i05-legacy-result')::uuid,md5('i05-owner')::uuid,
    '{}'::jsonb,'{}'::jsonb,'{"rows":[{"item_id":"00000000-0000-0000-0000-000000000001"}]}'::jsonb,'{}'::uuid[]);
 exception when others then rejected:=true;end;
 perform pg_temp.i05_check(rejected,'receipt result must belong to matching order');
end$$;
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i05-owner')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
select pg_temp.i05_check(public.read_opname_price_report(md5('i05-legacy-result')::uuid) is null,'legacy has no invented snapshot');
rollback;
