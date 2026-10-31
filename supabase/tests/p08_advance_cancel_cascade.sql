-- P08 one-step cancel of a used purchase advance + cancelled receipts no longer freeze the PO.
-- Fictional fixtures on an owned throwaway PostgreSQL; everything rolls back.
begin;
insert into auth.users(id) values('f2000000-0000-4000-8000-000000000001'),('f2000000-0000-4000-8000-000000000002');
update profiles set role='OWNER',is_active=true where id='f2000000-0000-4000-8000-000000000001';
update profiles set role='FINANCE',is_active=true where id='f2000000-0000-4000-8000-000000000002';
insert into branches(id,code,name,type) values('f2100000-0000-4000-8000-000000000001','P08C-FIC','P08 cascade fiction','KLINIK');
insert into warehouses(id,branch_id,code,name,type) values('f2200000-0000-4000-8000-000000000001','f2100000-0000-4000-8000-000000000001','P08C-WH','P08 cascade warehouse','VET');
insert into suppliers(id,nama) values('f2300000-0000-4000-8000-000000000001','P08 cascade supplier');
insert into items(id,code,name,unit,item_type) values('f2400000-0000-4000-8000-000000000001','P08C-A','P08 cascade goods','pcs','Persediaan');
insert into purchase_orders(id,no_po,supplier_id,branch_id,to_warehouse_id,status,total) values
 ('f2500000-0000-4000-8000-000000000001','PO.P08C.A','f2300000-0000-4000-8000-000000000001','f2100000-0000-4000-8000-000000000001','f2200000-0000-4000-8000-000000000001','Dipesan',1000),
 ('f2500000-0000-4000-8000-000000000002','PO.P08C.B','f2300000-0000-4000-8000-000000000001','f2100000-0000-4000-8000-000000000001','f2200000-0000-4000-8000-000000000001','Dipesan',500);
insert into purchase_order_items(id,po_id,item_id,nama,qty,harga_beli,satuan,faktor) values
 ('f2600000-0000-4000-8000-000000000001','f2500000-0000-4000-8000-000000000001','f2400000-0000-4000-8000-000000000001','P08 cascade goods',10,100,'pcs',1),
 ('f2600000-0000-4000-8000-000000000002','f2500000-0000-4000-8000-000000000002','f2400000-0000-4000-8000-000000000001','P08 cascade goods',5,100,'pcs',1);
insert into coa_accounts(code,name,type,normal_balance) values('170001','Fiction inventory','ASET','D'),('311001','Fiction payable','LIABILITAS','K'),('110219','Fiction cascade bank','ASET','D')
 on conflict(code) do update set is_active=true,is_header=false;
update coa_accounts set is_active=true,is_header=false where code in('170001','160001','311001','311003');
update accounting_locks set closed_until=null;
update company_settings set mode_pkp=false;
insert into cash_accounts(id,nama,jenis,coa_code,branch_id) values('f2700000-0000-4000-8000-000000000001','Fiction cascade bank','Bank','110219','f2100000-0000-4000-8000-000000000001');
create table p08c_results(name text primary key,result jsonb);
grant all on p08c_results to authenticated;
create function pg_temp.expect_error(command text,fragment text) returns void language plpgsql as $$
begin
 begin execute command;
 exception when others then
  if position(fragment in sqlerrm)=0 then raise exception 'Expected error containing "%", got: %',fragment,sqlerrm;end if;
  return;
 end;
 raise exception 'Expected failure containing "%" but the command succeeded',fragment;
end$$;
create function pg_temp.ok(cond boolean,message text) returns void language plpgsql as $$
begin if cond is distinct from true then raise exception 'Assertion failed: %',message;end if;end$$;
create function pg_temp.r(n text) returns jsonb language sql as $$select result from p08c_results where name=n$$;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','f2000000-0000-4000-8000-000000000001',true);

-- 1. Cancelled receipts no longer freeze the PO.
insert into p08c_results select 'UM1',pay_purchase_advance_atomic('p08c-um1','UM.P08C.',5,'f2300000-0000-4000-8000-000000000001','f2500000-0000-4000-8000-000000000001',current_date,200,'Transfer','f2700000-0000-4000-8000-000000000001',null);
insert into p08c_results select 'R1',receive_purchase_order('f2500000-0000-4000-8000-000000000001','p08c-r1','TB.P08C.',5,current_date,null,null,'[{"id":"f2600000-0000-4000-8000-000000000001","qty_terima":5}]');
select pg_temp.expect_error(format('select pay_purchase_advance_atomic(%L,%L,5,%L,%L,current_date,100,%L,%L,null)','p08c-um-blocked','UM.P08C.','f2300000-0000-4000-8000-000000000001','f2500000-0000-4000-8000-000000000001','Transfer','f2700000-0000-4000-8000-000000000001'),'penerimaan pertama');
select cancel_goods_receipt((pg_temp.r('R1')->>'receipt_id')::uuid,'p08c-cancel-r1','Salah PO tujuan');
insert into p08c_results select 'UM2',pay_purchase_advance_atomic('p08c-um2','UM.P08C.',5,'f2300000-0000-4000-8000-000000000001','f2500000-0000-4000-8000-000000000001',current_date,100,'Transfer','f2700000-0000-4000-8000-000000000001',null);
select pg_temp.ok((select status from purchase_advances where id=(pg_temp.r('UM2')->>'advance_id')::uuid)='aktif','new DP accepted after the only receipt was cancelled');
select pg_temp.ok((revise_purchase_order_prices('p08c-prices','f2500000-0000-4000-8000-000000000001',(select revision from purchase_orders where id='f2500000-0000-4000-8000-000000000001'),
 '[{"id":"f2600000-0000-4000-8000-000000000001","harga_beli":100}]','Harga dikonfirmasi ulang')->>'total')::numeric=1000,'price revision accepted after receipt cancel');
-- PO without DP: edit after its receipt was cancelled.
insert into p08c_results select 'RB',receive_purchase_order('f2500000-0000-4000-8000-000000000002','p08c-rb','TB.P08C.',5,current_date,null,null,'[{"id":"f2600000-0000-4000-8000-000000000002","qty_terima":5}]');
select cancel_goods_receipt((pg_temp.r('RB')->>'receipt_id')::uuid,'p08c-cancel-rb','Salah input');
select pg_temp.ok(revise_purchase_order('p08c-edit','f2500000-0000-4000-8000-000000000002',(select revision from purchase_orders where id='f2500000-0000-4000-8000-000000000002'),'edit',
 jsonb_build_object('supplier_id','f2300000-0000-4000-8000-000000000001','to_warehouse_id','f2200000-0000-4000-8000-000000000001'),
 '[{"item_id":"f2400000-0000-4000-8000-000000000001","nama":"P08 cascade goods","qty":3,"harga_beli":100,"satuan":"pcs"}]','Qty dikoreksi') is not null,'PO edit accepted after receipt cancel');
select pg_temp.ok((select total from purchase_orders where id='f2500000-0000-4000-8000-000000000002')=300,'PO edited');
-- An active receipt still freezes the PO.
insert into p08c_results select 'R2',receive_purchase_order('f2500000-0000-4000-8000-000000000001','p08c-r2','TB.P08C.',5,current_date,null,null,'[{"id":"f2600000-0000-4000-8000-000000000001","qty_terima":10}]');
select pg_temp.expect_error(format('select pay_purchase_advance_atomic(%L,%L,5,%L,%L,current_date,1,%L,%L,null)','p08c-um-blocked2','UM.P08C.','f2300000-0000-4000-8000-000000000001','f2500000-0000-4000-8000-000000000001','Transfer','f2700000-0000-4000-8000-000000000001'),'DP baru ditolak');

-- 2. Advance UM1 used by two payments on the invoice.
insert into p08c_results select 'INV',to_jsonb(x) from create_purchase_invoice_from_po('f2500000-0000-4000-8000-000000000001','FB.P08C.',5,null,current_date,current_date,null,
 '[{"po_item_id":"f2600000-0000-4000-8000-000000000001","qty":10,"harga":100}]','[]','[]',0,'p08c-inv') x;
insert into p08c_results select 'P1',pay_purchase_invoice_atomic('p08c-p1',(pg_temp.r('INV')->>'invoice_id')::uuid,current_date,150,'Transfer',null,'f2700000-0000-4000-8000-000000000001',(pg_temp.r('UM1')->>'advance_id')::uuid);
insert into p08c_results select 'P2',pay_purchase_invoice_atomic('p08c-p2',(pg_temp.r('INV')->>'invoice_id')::uuid,current_date,100,'Transfer',null,'f2700000-0000-4000-8000-000000000001',(pg_temp.r('UM1')->>'advance_id')::uuid);
insert into p08c_results select 'P3',pay_purchase_invoice_atomic('p08c-p3',(pg_temp.r('INV')->>'invoice_id')::uuid,current_date,50,'Transfer',null,'f2700000-0000-4000-8000-000000000001',null);
select pg_temp.ok((select terpakai from purchase_advances where id=(pg_temp.r('UM1')->>'advance_id')::uuid)=200,'UM1 fully used');
-- All fixture payments post in one transaction (same now()); P1 is the earlier posting, as in real use.
reset role;
update purchase_invoice_payments set created_at=created_at-interval '1 hour' where id=(pg_temp.r('P1')->>'payment_id')::uuid;
set local role authenticated;
-- The old one-click cancel still refuses a used advance.
select pg_temp.expect_error(format('select cancel_purchase_advance_atomic(%L)',pg_temp.r('UM1')->>'advance_id'),'alokasi pembayaran');

-- 3. Preview: OWNER only; lists exactly the payments that used the advance.
select set_config('request.jwt.claim.sub','f2000000-0000-4000-8000-000000000002',true);
select pg_temp.expect_error(format('select preview_purchase_advance_cascade(%L)',pg_temp.r('UM1')->>'advance_id'),'Super Admin');
select pg_temp.expect_error(format('select cancel_purchase_advance_cascade(%L,%L,%L,%L)',pg_temp.r('UM1')->>'advance_id','Salah pemasok','p08c-finance',md5('x')),'Super Admin');
select set_config('request.jwt.claim.sub','f2000000-0000-4000-8000-000000000001',true);
insert into p08c_results select 'preview',preview_purchase_advance_cascade((pg_temp.r('UM1')->>'advance_id')::uuid);
select pg_temp.ok(jsonb_array_length(pg_temp.r('preview')->'payments')=2
 and (select bool_and((x->>'uses_this_advance')::boolean) from jsonb_array_elements(pg_temp.r('preview')->'payments') x)
 and (pg_temp.r('preview')->'payments'->0->>'payment_id')=(pg_temp.r('P1')->>'payment_id'),'preview lists P1 then P2 only');
-- Stale fingerprint and bad input change nothing.
select pg_temp.expect_error(format('select cancel_purchase_advance_cascade(%L,%L,%L,%L)',pg_temp.r('UM1')->>'advance_id','Salah pemasok','p08c-stale',md5('stale')),'berubah sejak pratinjau');
select pg_temp.expect_error(format('select cancel_purchase_advance_cascade(%L,%L,%L,null)',pg_temp.r('UM1')->>'advance_id','Salah pemasok','p08c-nofp'),'Pratinjau pembatalan wajib');
select pg_temp.expect_error(format('select cancel_purchase_advance_cascade(%L,%L,%L,%L)',pg_temp.r('UM1')->>'advance_id','x','p08c-short',md5('x')),'Alasan pembatalan wajib');
select pg_temp.ok((select count(*) from purchase_invoice_payments where reversal_of is not null)=0,'refusals reversed nothing');

-- 4. Failure in the final advance cancel rolls back every payment reversal.
reset role;
create function p08c_fault() returns trigger language plpgsql as $$begin raise exception 'P08C_FINAL_FAULT';end$$;
create trigger p08c_fault before insert on purchase_advance_cancellations for each row execute function p08c_fault();
set local role authenticated;
select pg_temp.expect_error(format('select cancel_purchase_advance_cascade(%L,%L,%L,%L)',pg_temp.r('UM1')->>'advance_id','Salah pemasok','p08c-fault',pg_temp.r('preview')->>'fingerprint'),'P08C_FINAL_FAULT');
select pg_temp.ok((select count(*) from purchase_invoice_payments where reversal_of is not null)=0
 and (select terpakai from purchase_advances where id=(pg_temp.r('UM1')->>'advance_id')::uuid)=200
 and (select status from purchase_advances where id=(pg_temp.r('UM1')->>'advance_id')::uuid)='aktif','failure left no partial effect');
reset role;
drop trigger p08c_fault on purchase_advance_cancellations;
set local role authenticated;

-- 5. One step: both payments reversed (oldest first), then the advance cancelled; P3 untouched.
insert into p08c_results select 'cascade',cancel_purchase_advance_cascade((pg_temp.r('UM1')->>'advance_id')::uuid,'Salah pemasok','p08c-ok',pg_temp.r('preview')->>'fingerprint');
do $$declare res jsonb:=pg_temp.r('cascade');adv uuid:=(pg_temp.r('UM1')->>'advance_id')::uuid;inv uuid:=(pg_temp.r('INV')->>'invoice_id')::uuid;begin
 perform pg_temp.ok((res->>'payment_count')::int=2 and res->'payments'->0->>'payment_id'=pg_temp.r('P1')->>'payment_id','two reversals, oldest first');
 perform pg_temp.ok((select status='batal' and terpakai=0 from purchase_advances where id=adv),'advance cancelled with zero usage');
 perform pg_temp.ok((select count(*) from journal_entries where source='purchase-advance-void')=1 and res->>'journal_id' is not null,'one advance void journal');
 perform pg_temp.ok((select count(*) from journal_entries where source='purchase-pay-void')=2,'two payment void journals');
 perform pg_temp.ok((select voided_at is not null from purchase_invoice_payments where id=(pg_temp.r('P1')->>'payment_id')::uuid)
  and (select voided_at is not null from purchase_invoice_payments where id=(pg_temp.r('P2')->>'payment_id')::uuid)
  and (select voided_at is null from purchase_invoice_payments where id=(pg_temp.r('P3')->>'payment_id')::uuid),'P1/P2 voided, P3 kept');
 perform pg_temp.ok((select sum(amount) from purchase_invoice_payments where invoice_id=inv)=50,'invoice net paid back to 50');
 perform pg_temp.ok((select sum(l.debit-l.credit) from journal_lines l join coa_accounts a on a.id=l.account_id join journal_entries j on j.id=l.entry_id
  where a.code='160001' and j.source_ref in((select no_um from purchase_advances where id=adv)) )=0,'advance account nets to zero for this DP');
end$$;
-- Replay and key reuse.
select pg_temp.ok(cancel_purchase_advance_cascade((pg_temp.r('UM1')->>'advance_id')::uuid,'Salah pemasok','p08c-ok',pg_temp.r('preview')->>'fingerprint')=pg_temp.r('cascade'),'same key returns recorded result');
select pg_temp.expect_error(format('select cancel_purchase_advance_cascade(%L,%L,%L,%L)',pg_temp.r('UM1')->>'advance_id','Alasan lain','p08c-ok',pg_temp.r('preview')->>'fingerprint'),'rincian berbeda');
select pg_temp.expect_error(format('select cancel_purchase_advance_cascade(%L,%L,%L,%L)',pg_temp.r('UM1')->>'advance_id','Salah pemasok','p08c-again',pg_temp.r('preview')->>'fingerprint'),'sudah dibatalkan');
select pg_temp.ok((select count(*) from journal_entries where source in('purchase-pay-void','purchase-advance-void'))=3,'no second effect');
select pg_temp.expect_error('select * from purchase_advance_cascade_cancellations','permission denied');

-- 6. Unused advance: the same RPC simply cancels it.
insert into p08c_results select 'cascade-um2',cancel_purchase_advance_cascade((pg_temp.r('UM2')->>'advance_id')::uuid,'DP tidak jadi','p08c-um2',preview_purchase_advance_cascade((pg_temp.r('UM2')->>'advance_id')::uuid)->>'fingerprint');
select pg_temp.ok((pg_temp.r('cascade-um2')->>'payment_count')::int=0 and (select status from purchase_advances where id=(pg_temp.r('UM2')->>'advance_id')::uuid)='batal','unused DP cancelled');

reset role;
select pg_temp.ok((select sum(debit)=sum(credit) from journal_lines),'ledger balanced');
rollback;
