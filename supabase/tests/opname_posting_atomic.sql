-- Fictional fixtures; owned network-none PostgreSQL only.
insert into auth.users(id) values(md5('i02-owner')::uuid),(md5('i02-cashier')::uuid);
update profiles set role='OWNER',is_active=true where id=md5('i02-owner')::uuid;
update profiles set role='STAFF',is_active=true where id=md5('i02-cashier')::uuid;
insert into branches(id,code,name,type) values(md5('i02-vet-branch')::uuid,'I02V','Fictional clinic','KLINIK'),(md5('i02-retail-branch')::uuid,'I02R','Fictional retail','PETSHOP');
insert into warehouses(id,branch_id,code,name,type) values(md5('i02-vet-wh')::uuid,md5('i02-vet-branch')::uuid,'I02V','Fictional clinic warehouse','VET'),(md5('i02-retail-wh')::uuid,md5('i02-retail-branch')::uuid,'I02R','Fictional retail warehouse','RETAIL');
insert into items(id,code,name,unit,item_type,buy_price,sell_price) values(md5('i02-a')::uuid,'I02A','Fictional item A','PCS','Persediaan',100,150),(md5('i02-b')::uuid,'I02B','Fictional item B','PCS','Persediaan',50,100);
insert into coa_accounts(code,name,type,normal_balance) values('1301','Fiction inventory','ASET','D'),('5902','Fiction variance','BEBAN','D'),('5101','Fiction COGS','BEBAN','D'),('1201','Fiction receivable','ASET','D'),('4101','Fiction revenue','PENDAPATAN','K') on conflict(code) do update set is_active=true,is_header=false;
create function pg_temp.assert_ok(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'ASSERT: %',label;end if;end$$;
create function pg_temp.order_doc(label text,wh text default 'i02-vet-wh') returns uuid language plpgsql as $$declare id uuid:=md5(label)::uuid;begin insert into opname_orders(id,no_opname,warehouse_id,penanggung_jawab) values(id,'OPO.'||left(md5(label),12),md5(wh)::uuid,'Fictional counter');return id;end$$;

begin;
select pg_temp.order_doc('i02-gain');
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i02-owner')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
select post_opname_atomic(md5('i02-gain')::uuid,current_date-1,jsonb_build_object(md5('i02-a')::uuid::text,2));
select pg_temp.assert_ok((select qty=2 from stock where warehouse_id=md5('i02-vet-wh')::uuid and item_id=md5('i02-a')::uuid),'positive stock');
select pg_temp.assert_ok((select count(*)=1 and min(tanggal)=current_date-1 from stock_moves where source='opname'),'positive move date matches selected date');
select pg_temp.assert_ok((select sum(l.debit-l.credit)=200 from journal_lines l join coa_accounts a on a.id=l.account_id join journal_entries j on j.id=l.entry_id where a.code='1301' and j.source='opname'),'inventory gain journal');
select pg_temp.assert_ok((select status::text='Selesai' from opname_orders where id=md5('i02-gain')::uuid),'completed after journal');
select post_opname_atomic(md5('i02-gain')::uuid,current_date-1,jsonb_build_object(md5('i02-a')::uuid::text,2));
select pg_temp.assert_ok((select count(*)=1 from opname_results where order_id=md5('i02-gain')::uuid),'retry one result');
select pg_temp.assert_ok((select count(*)=1 from stock_moves where source='opname'),'retry one stock movement');
select pg_temp.assert_ok((select count(*)=1 from journal_entries where source='opname'),'retry one journal');
rollback;

-- The forced line-write failure occurs after stock mutation, inside the new RPC.
-- Every source/stock/layer/GL/receipt change must roll back together.
begin;
select pg_temp.order_doc('i02-gl-fail');
create function pg_temp.fail_i02_journal() returns trigger language plpgsql as $$begin raise exception 'Fictional journal failure';end$$;
create trigger fictional_i02_journal_fail before insert on journal_lines for each row execute function pg_temp.fail_i02_journal();
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i02-owner')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
do $$begin
 begin
  perform post_opname_atomic(md5('i02-gl-fail')::uuid,current_date,jsonb_build_object(md5('i02-a')::uuid::text,2));
  raise exception 'Expected journal failure';
 exception when others then if sqlerrm not like '%Fictional journal failure%' then raise;end if;end;
 if exists(select 1 from opname_results where order_id=md5('i02-gl-fail')::uuid) or exists(select 1 from stock_moves where source='opname') or exists(select 1 from stock_layers where source='opname') or exists(select 1 from journal_entries where source='opname') then raise exception 'Partial posting survived journal failure';end if;
 if (select status::text from opname_orders where id=md5('i02-gl-fail')::uuid)<>'Terbuka' then raise exception 'Failed order completed';end if;
end$$;
rollback;

begin;
select pg_temp.order_doc('i02-mixed');
select stock_in_fifo(md5('i02-vet-wh')::uuid,md5('i02-a')::uuid,10,100,'fixture','MIXED',current_date,null);
insert into opname_counts(order_id,item_id,qty_sistem,qty_fisik) values(md5('i02-mixed')::uuid,md5('i02-a')::uuid,10,8);
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i02-owner')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
select post_opname_atomic(md5('i02-mixed')::uuid,current_date,jsonb_build_object(md5('i02-a')::uuid::text,8,md5('i02-b')::uuid::text,2));
select pg_temp.assert_ok((select count(*)=2 from opname_result_items),'mixed two counted lines');
select pg_temp.assert_ok((select sum(l.debit-l.credit)=-100 from journal_lines l join coa_accounts a on a.id=l.account_id join journal_entries j on j.id=l.entry_id where a.code='1301' and j.source='opname'),'mixed gain/loss exact inventory journal delta');
select pg_temp.assert_ok((select count(*)=2 from journal_entries where source='opname'),'mixed two distinct balanced journals');
select pg_temp.assert_ok(not exists(select j.id from journal_entries j join journal_lines l on l.entry_id=j.id where j.source='opname' group by j.id having sum(l.debit)<>sum(l.credit)),'each journal balanced');
select pg_temp.assert_ok((select sum(qty_left*unit_cost)=900 from stock_layers),'mixed layer cost delta equals GL');
reset role;
select pg_temp.assert_ok((select count(*)=1 and sum((result->>'cost')::numeric)=200 from stock_document_issue_proofs where kind='opname'),'exact outgoing cost proof');
rollback;

-- Locked baseline -5, physical 1 => +6; later sale -1 must remain deducted.
begin;
select pg_temp.order_doc('i02-after-sale');
insert into stock(warehouse_id,item_id,qty) values(md5('i02-vet-wh')::uuid,md5('i02-a')::uuid,-6);
insert into opname_counts(order_id,item_id,qty_sistem,qty_fisik) values(md5('i02-after-sale')::uuid,md5('i02-a')::uuid,-5,1);
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i02-owner')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
select post_opname_atomic(md5('i02-after-sale')::uuid,current_date,jsonb_build_object(md5('i02-a')::uuid::text,1));
select pg_temp.assert_ok((select qty=0 from stock where warehouse_id=md5('i02-vet-wh')::uuid and item_id=md5('i02-a')::uuid),'post-lock sale preserved, not absolute set');
select pg_temp.assert_ok((select qty_sistem=-5 and qty_fisik=1 and selisih=6 from opname_result_items),'negative snapshot preserved');
select pg_temp.assert_ok(not exists(select 1 from stock_layers),'negative coverage created no phantom layer');
select pg_temp.assert_ok((select sum(l.debit-l.credit)=600 from journal_lines l join coa_accounts a on a.id=l.account_id where a.code='1301'),'negative gain journal exact');
rollback;

begin;
select pg_temp.order_doc('i02-zero');
update items set buy_price=0 where id=md5('i02-a')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i02-owner')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
select post_opname_atomic(md5('i02-zero')::uuid,current_date,jsonb_build_object(md5('i02-a')::uuid::text,1));
select pg_temp.assert_ok((select qty=1 from stock where item_id=md5('i02-a')::uuid),'explicit free item still counted');
select pg_temp.assert_ok(not exists(select 1 from journal_entries where source='opname'),'zero source cost does not fabricate journal value');
select pg_temp.assert_ok(not exists(select 1 from stock where item_id=md5('i02-b')::uuid),'uncounted row unchanged');
rollback;

-- Sub-cent clinic FIFO costs use NUMERIC throughout; no JS float rounding.
begin;
select pg_temp.order_doc('i02-fraction');
select stock_in_fifo(md5('i02-vet-wh')::uuid,md5('i02-a')::uuid,1,2.5,'fixture','FRACTION',current_date,null);
insert into opname_counts(order_id,item_id,qty_sistem,qty_fisik) values(md5('i02-fraction')::uuid,md5('i02-a')::uuid,1,0.875);
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i02-owner')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
select post_opname_atomic(md5('i02-fraction')::uuid,current_date,jsonb_build_object(md5('i02-a')::uuid::text,0.875));
select pg_temp.assert_ok((select sum(l.credit)=0.3125 from journal_lines l join coa_accounts a on a.id=l.account_id where a.code='1301'),'sub-cent FIFO cost preserved exactly');
select pg_temp.assert_ok((select sum(qty_left*unit_cost)=2.1875 from stock_layers),'sub-cent layer value reconciles');
rollback;

begin;
select pg_temp.order_doc('i02-retail','i02-retail-wh');
select stock_in_fifo(md5('i02-retail-wh')::uuid,md5('i02-a')::uuid,10,100,'fixture','RETAIL',current_date,null);
insert into opname_counts(order_id,item_id,qty_sistem,qty_fisik) values(md5('i02-retail')::uuid,md5('i02-a')::uuid,10,8);
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i02-owner')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
select post_opname_atomic(md5('i02-retail')::uuid,current_date,jsonb_build_object(md5('i02-a')::uuid::text,8));
select pg_temp.assert_ok((select count(*)=1 and sum(total)=300 from sales_invoices where kategori='selisih_stok'),'legacy retail invoice preserved');
select pg_temp.assert_ok((select sum(qty*harga)=300 from sales_invoice_items),'retail invoice lines reconcile');
select pg_temp.assert_ok((select sum(l.debit-l.credit)=200 from journal_lines l join coa_accounts a on a.id=l.account_id where a.code='5101'),'retail COGS uses FIFO cost');
select pg_temp.assert_ok((select sum(l.debit-l.credit)=300 from journal_lines l join coa_accounts a on a.id=l.account_id where a.code='1201'),'retail receivable matches invoice');
rollback;

-- No retry of legacy partial source, no coercion of blank/invalid input, no
-- widening partial scope, and no write after the accounting period is closed.
create function pg_temp.reject_post(sql text,label text) returns void language plpgsql as $$declare rejected boolean:=false;begin
 begin execute sql;exception when others then rejected:=true;end;
 if not rejected then raise exception 'Expected rejection: %',label;end if;
end$$;
begin;
select pg_temp.order_doc('i02-guards');
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i02-owner')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
select pg_temp.reject_post($q$select post_opname_atomic(md5('i02-guards')::uuid,current_date,'{}')$q$,'uncounted is not zero');
select pg_temp.reject_post($q$select post_opname_atomic(md5('i02-guards')::uuid,current_date,jsonb_build_object(md5('i02-a')::uuid::text,null))$q$,'blank is not zero');
select pg_temp.reject_post($q$select post_opname_atomic(md5('i02-guards')::uuid,current_date,jsonb_build_object(md5('i02-a')::uuid::text,-1))$q$,'negative physical count');
reset role;
insert into opname_order_items(order_id,item_id) values(md5('i02-guards')::uuid,md5('i02-a')::uuid);
set local role authenticated;
select pg_temp.reject_post($q$select post_opname_atomic(md5('i02-guards')::uuid,current_date,jsonb_build_object(md5('i02-b')::uuid::text,1))$q$,'outside partial scope');
reset role;
insert into opname_results(order_id,no_hasil) values(md5('i02-guards')::uuid,'OPR.I02.LEGACY');
set local role authenticated;
select pg_temp.reject_post($q$select post_opname_atomic(md5('i02-guards')::uuid,current_date,jsonb_build_object(md5('i02-a')::uuid::text,1))$q$,'legacy partial result');
select pg_temp.assert_ok(not exists(select 1 from stock_moves where source='opname'),'rejected requests created no movements');
rollback;

begin;
select pg_temp.order_doc('i02-period');
update accounting_locks set closed_until=current_date where id;
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i02-owner')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
select pg_temp.reject_post($q$select post_opname_atomic(md5('i02-period')::uuid,current_date,jsonb_build_object(md5('i02-a')::uuid::text,1))$q$,'closed period');
select pg_temp.assert_ok(not exists(select 1 from opname_results where order_id=md5('i02-period')::uuid),'closed period created no result');
rollback;

begin;
select pg_temp.order_doc('i02-cashier','i02-retail-wh');
select pg_temp.order_doc('i02-foreign');
delete from role_modules where role='STAFF';
insert into role_modules(role,module_id) values('STAFF','crm');
insert into user_branches(user_id,branch_id) values(md5('i02-cashier')::uuid,md5('i02-retail-branch')::uuid);
insert into cashier_shifts(branch_id,opened_by,status,shift_type) values(md5('i02-retail-branch')::uuid,md5('i02-cashier')::uuid,'open','petshop');
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i02-cashier')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
select pg_temp.reject_post($q$select post_opname_atomic(md5('i02-foreign')::uuid,current_date,jsonb_build_object(md5('i02-a')::uuid::text,1))$q$,'other branch denied');
select post_opname_atomic(md5('i02-cashier')::uuid,current_date,jsonb_build_object(md5('i02-a')::uuid::text,1));
select pg_temp.reject_post($q$update opname_orders set status='Terbuka' where id=md5('i02-cashier')::uuid$q$,'posted status cannot reopen');
select pg_temp.reject_post($q$insert into opname_results(order_id,no_hasil) values(md5('i02-cashier')::uuid,'OPR.I02.LATE')$q$,'stale legacy client cannot add result');
select pg_temp.reject_post($q$delete from opname_counts where order_id=md5('i02-cashier')::uuid$q$,'stale unlock denied');
select pg_temp.reject_post($q$update opname_counts set qty_fisik=5 where order_id=md5('i02-cashier')::uuid$q$,'stale lock update denied');
select pg_temp.reject_post($q$select post_opname_atomic(md5('i02-cashier')::uuid,current_date,jsonb_build_object(md5('i02-a')::uuid::text,2))$q$,'changed retry payload');
reset role;
select pg_temp.assert_ok((select count(*)=1 from opname_posting_receipts),'one durable receipt');
rollback;

begin;
select pg_temp.order_doc('i02-audit-fail');
create function pg_temp.fail_i02_audit() returns trigger language plpgsql as $$begin
 if new.row_entity='opname_orders' and new.row_id=md5('i02-audit-fail')::uuid::text then raise exception 'Fictional audit failure';end if;
 return new;end$$;
create trigger fictional_i02_audit_fail before insert on activity_log for each row execute function pg_temp.fail_i02_audit();
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i02-owner')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
do $$begin
 begin perform post_opname_atomic(md5('i02-audit-fail')::uuid,current_date,jsonb_build_object(md5('i02-a')::uuid::text,1));raise exception 'Expected audit failure';
 exception when others then if sqlerrm not like '%Fictional audit failure%' then raise;end if;end;
 if exists(select 1 from opname_results where order_id=md5('i02-audit-fail')::uuid) or exists(select 1 from stock_moves where source='opname') or exists(select 1 from journal_entries where source='opname') then raise exception 'Audit failure left partial financial effects';end if;
end$$;
reset role;
select pg_temp.assert_ok(not exists(select 1 from opname_posting_receipts where order_id=md5('i02-audit-fail')::uuid),'audit failure left no successful receipt');
rollback;

begin;
select pg_temp.order_doc('i02-correct');
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i02-owner')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
do $$declare receipt jsonb;plan jsonb;newrows jsonb:=jsonb_build_array(jsonb_build_object('item_id',md5('i02-a')::uuid,'qty',1));begin
 receipt:=post_opname_atomic(md5('i02-correct')::uuid,current_date,jsonb_build_object(md5('i02-a')::uuid::text,2));
 plan:=preview_stock_document_correction('opname',(receipt->>'result_id')::uuid,newrows);
 perform correct_stock_document('opname',(receipt->>'result_id')::uuid,newrows,'Fictional corrected count','i02-correction',plan->>'token');
 if (select qty from stock where warehouse_id=md5('i02-vet-wh')::uuid and item_id=md5('i02-a')::uuid)<>1 then raise exception 'Existing correction no longer works';end if;
 if (select qty_fisik from opname_result_items where result_id=(receipt->>'result_id')::uuid)<>2 then raise exception 'Original source changed during correction';end if;
 receipt:=post_opname_atomic(md5('i02-correct')::uuid,current_date,jsonb_build_object(md5('i02-a')::uuid::text,2));
 if (receipt->>'already_posted')::boolean is distinct from true or (select qty from stock where warehouse_id=md5('i02-vet-wh')::uuid and item_id=md5('i02-a')::uuid)<>1 then raise exception 'Old receipt retry overwrote effective correction';end if;
end$$;
rollback;

-- Document inherited correction precision boundary, without weakening the guard
-- or rewriting historical financial policy to make this posting patch pass.
begin;
select pg_temp.order_doc('i02-fraction-edit');
select stock_in_fifo(md5('i02-vet-wh')::uuid,md5('i02-a')::uuid,1,2.5,'fixture','FRACTION-EDIT',current_date,null);
insert into opname_counts(order_id,item_id,qty_sistem,qty_fisik) values(md5('i02-fraction-edit')::uuid,md5('i02-a')::uuid,1,0.875);
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i02-owner')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
do $$declare receipt jsonb;begin
 receipt:=post_opname_atomic(md5('i02-fraction-edit')::uuid,current_date,jsonb_build_object(md5('i02-a')::uuid::text,0.875));
 begin
  perform preview_stock_document_correction('opname',(receipt->>'result_id')::uuid,jsonb_build_array(jsonb_build_object('item_id',md5('i02-a')::uuid,'qty',0.75)));
  raise exception 'Expected inherited sub-cent correction guard';
 exception when others then if sqlerrm not like '%Nilai jurnal dan stok sumber tidak cocok%' then raise;end if;end;
 if (select qty from stock where warehouse_id=md5('i02-vet-wh')::uuid and item_id=md5('i02-a')::uuid)<>0.875 then raise exception 'Rejected correction changed stock';end if;
end$$;
rollback;
