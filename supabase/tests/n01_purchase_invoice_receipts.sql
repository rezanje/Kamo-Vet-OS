-- N01 invoice <-> goods receipt links. Fictional fixtures on an owned throwaway PostgreSQL; everything rolls back.
begin;
insert into auth.users(id) values('f1000000-0000-4000-8000-000000000001'),('f1000000-0000-4000-8000-000000000002');
update profiles set role='OWNER',is_active=true where id='f1000000-0000-4000-8000-000000000001';
update profiles set role='FINANCE',is_active=true where id='f1000000-0000-4000-8000-000000000002';
insert into branches(id,code,name,type) values('f1100000-0000-4000-8000-000000000001','N01-FIC','N01 fiction','KLINIK');
insert into warehouses(id,branch_id,code,name,type) values('f1200000-0000-4000-8000-000000000001','f1100000-0000-4000-8000-000000000001','N01-WH','N01 warehouse','VET');
insert into suppliers(id,nama) values('f1300000-0000-4000-8000-000000000001','N01 fiction supplier');
insert into items(id,code,name,unit,item_type) values
 ('f1400000-0000-4000-8000-000000000001','N01-A','N01 goods A','pcs','Persediaan'),
 ('f1400000-0000-4000-8000-000000000002','N01-B','N01 goods B','pcs','Persediaan'),
 ('f1400000-0000-4000-8000-000000000003','N01-C','N01 goods C','pcs','Persediaan');
insert into item_units(item_id,unit,factor) values
 ('f1400000-0000-4000-8000-000000000001','box',10),('f1400000-0000-4000-8000-000000000002','box',10),('f1400000-0000-4000-8000-000000000003','box',10);
insert into purchase_orders(id,no_po,supplier_id,branch_id,to_warehouse_id,status) values
 ('f1500000-0000-4000-8000-000000000001','PO.N01.A','f1300000-0000-4000-8000-000000000001','f1100000-0000-4000-8000-000000000001','f1200000-0000-4000-8000-000000000001','Dipesan'),
 ('f1500000-0000-4000-8000-000000000002','PO.N01.B','f1300000-0000-4000-8000-000000000001','f1100000-0000-4000-8000-000000000001','f1200000-0000-4000-8000-000000000001','Dipesan'),
 ('f1500000-0000-4000-8000-000000000003','PO.N01.C','f1300000-0000-4000-8000-000000000001','f1100000-0000-4000-8000-000000000001','f1200000-0000-4000-8000-000000000001','Dipesan');
insert into purchase_order_items(id,po_id,item_id,nama,qty,harga_beli,satuan,faktor) values
 ('f1600000-0000-4000-8000-000000000001','f1500000-0000-4000-8000-000000000001','f1400000-0000-4000-8000-000000000001','N01 goods A',4,100,'box',10),
 ('f1600000-0000-4000-8000-000000000002','f1500000-0000-4000-8000-000000000002','f1400000-0000-4000-8000-000000000002','N01 goods B',2,100,'box',10),
 ('f1600000-0000-4000-8000-000000000003','f1500000-0000-4000-8000-000000000003','f1400000-0000-4000-8000-000000000003','N01 goods C',4,100,'box',10);
insert into coa_accounts(code,name,type,normal_balance) values('1301','Fiction stock','ASET','D'),('2101','Fiction payable','LIABILITAS','K')
 on conflict(code) do update set is_active=true,is_header=false;
update coa_accounts set is_active=true,is_header=false where code in('1301','2101','2102');
update accounting_locks set closed_until=null;
update company_settings set mode_pkp=false;
create table n01_results(name text primary key,result jsonb);
grant all on n01_results to authenticated;
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
-- All fixture receipts post in one transaction (same now()); age the earlier receipt like a real earlier posting.
create function pg_temp.age_receipt(rid uuid) returns void language plpgsql as $$
declare gr goods_receipts%rowtype;ref text;
begin
 select * into gr from goods_receipts where id=rid;
 select no_po into ref from purchase_orders where id=gr.po_id;
 update stock_moves set created_at=created_at-interval '1 hour' where source='purchase' and source_ref=ref and created_at=gr.created_at;
 update stock_layers set created_at=created_at-interval '1 hour' where source='purchase' and source_ref=ref and created_at=gr.created_at;
 update goods_receipts set created_at=created_at-interval '1 hour' where id=rid;
end$$;
create function pg_temp.rid(n text) returns uuid language sql as $$select (result->>'receipt_id')::uuid from n01_results where name=n$$;
create function pg_temp.iid(n text) returns uuid language sql as $$select (result->>'invoice_id')::uuid from n01_results where name=n$$;
create function pg_temp.inv(po uuid,key text,qty numeric,receipts uuid[],line uuid) returns jsonb language sql as $$
 select to_jsonb(x) from create_purchase_invoice_from_po_receipts(po,'FB.N01.',5,null,current_date,current_date,null,
  jsonb_build_array(jsonb_build_object('po_item_id',line,'qty',qty,'harga',100)),'[]','[]',0,key,null,receipts) x$$;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
insert into n01_results select 'R1',receive_purchase_order('f1500000-0000-4000-8000-000000000001','n01-r1','TB.N01.',5,current_date,null,null,'[{"id":"f1600000-0000-4000-8000-000000000001","qty_terima":2}]');
reset role; select pg_temp.age_receipt(pg_temp.rid('R1')); set local role authenticated;
insert into n01_results select 'R2',receive_purchase_order('f1500000-0000-4000-8000-000000000001','n01-r2','TB.N01.',5,current_date,null,null,'[{"id":"f1600000-0000-4000-8000-000000000001","qty_terima":2}]');
select pg_temp.ok((select qty from stock where item_id='f1400000-0000-4000-8000-000000000001')=40,'two receipts stocked 40');

-- 1. Links must cover the stock the invoice actually used (oldest receipt first); refusal leaves nothing.
select pg_temp.expect_error(format('select pg_temp.inv(%L,%L,2,array[%L]::uuid[],%L)','f1500000-0000-4000-8000-000000000001','n01-i1-wrong',pg_temp.rid('R2'),'f1600000-0000-4000-8000-000000000001'),'belum dipilih');
select pg_temp.ok(not exists(select 1 from purchase_invoices where po_id='f1500000-0000-4000-8000-000000000001'),'refused invoice left nothing');
select pg_temp.expect_error(format('select pg_temp.inv(%L,%L,2,array[%L,%L]::uuid[],%L)','f1500000-0000-4000-8000-000000000001','n01-dup',pg_temp.rid('R1'),pg_temp.rid('R1'),'f1600000-0000-4000-8000-000000000001'),'lebih dari sekali');
select pg_temp.expect_error(format('select pg_temp.inv(%L,%L,2,array[%L]::uuid[],%L)','f1500000-0000-4000-8000-000000000003','n01-other-po',pg_temp.rid('R1'),'f1600000-0000-4000-8000-000000000003'),'bukan milik PO ini');

-- 2. Correct choice: invoice and its link are stored together.
insert into n01_results select 'I1',pg_temp.inv('f1500000-0000-4000-8000-000000000001','n01-i1',2,array[pg_temp.rid('R1')],'f1600000-0000-4000-8000-000000000001');
select pg_temp.ok((select count(*)=1 and bool_and(active) and min(goods_receipt_id::text)=pg_temp.rid('R1')::text and min(po_id::text)='f1500000-0000-4000-8000-000000000001'
 from purchase_invoice_receipts where invoice_id=pg_temp.iid('I1')),'one active link I1->R1, readable by the user');
-- Replay: same key + same receipts returns the same invoice; same key + other receipts is refused.
select pg_temp.ok((pg_temp.inv('f1500000-0000-4000-8000-000000000001','n01-i1',2,array[pg_temp.rid('R1')],'f1600000-0000-4000-8000-000000000001')->>'invoice_id')=pg_temp.iid('I1')::text,'replay returns same invoice');
select pg_temp.ok((select count(*) from purchase_invoices where po_id='f1500000-0000-4000-8000-000000000001')=1 and (select count(*) from purchase_invoice_receipts)=1,'replay added nothing');
select pg_temp.expect_error(format('select pg_temp.inv(%L,%L,2,array[%L]::uuid[],%L)','f1500000-0000-4000-8000-000000000001','n01-i1',pg_temp.rid('R2'),'f1600000-0000-4000-8000-000000000001'),'pilihan penerimaan berbeda');
-- A receipt belongs to at most one active invoice.
select pg_temp.expect_error(format('select pg_temp.inv(%L,%L,2,array[%L]::uuid[],%L)','f1500000-0000-4000-8000-000000000001','n01-i2',pg_temp.rid('R1'),'f1600000-0000-4000-8000-000000000001'),'sudah ditagih');
-- Clients cannot write links directly.
select pg_temp.expect_error(format('insert into purchase_invoice_receipts(invoice_id,goods_receipt_id,po_id) values(%L,%L,%L)',pg_temp.iid('I1'),pg_temp.rid('R2'),'f1500000-0000-4000-8000-000000000001'),'permission denied');
select pg_temp.expect_error('delete from purchase_invoice_receipts','permission denied');
select pg_temp.expect_error('update purchase_invoice_receipts set active=false','permission denied');
-- The database enforces one active invoice per receipt even for privileged writers.
reset role;
do $$begin
 insert into purchase_invoices(id,no_faktur,po_id,supplier_id,branch_id,warehouse_id,tanggal,total)
  values('f1700000-0000-4000-8000-000000000009','FB.N01.RAW','f1500000-0000-4000-8000-000000000001','f1300000-0000-4000-8000-000000000001','f1100000-0000-4000-8000-000000000001','f1200000-0000-4000-8000-000000000001',current_date,1);
 begin
  insert into purchase_invoice_receipts(invoice_id,goods_receipt_id,po_id) values('f1700000-0000-4000-8000-000000000009',pg_temp.rid('R1'),'f1500000-0000-4000-8000-000000000001');
  raise exception 'second active link accepted';
 exception when unique_violation then null;
 end;
 begin
  insert into purchase_invoice_receipts(invoice_id,goods_receipt_id,po_id) values('f1700000-0000-4000-8000-000000000009',pg_temp.rid('R1'),'f1500000-0000-4000-8000-000000000003');
  raise exception 'link with mismatched PO accepted';
 exception when others then if position('bukan milik PO' in sqlerrm)=0 then raise; end if;
 end;
 delete from purchase_invoices where id='f1700000-0000-4000-8000-000000000009';
end$$;
set local role authenticated;

-- 3. Receipt cancel: only an active invoice LINKED to that receipt blocks.
insert into n01_results select 'cancel-R2',cancel_goods_receipt(pg_temp.rid('R2'),'n01-cancel-r2','Salah input penerimaan kedua');
select pg_temp.ok((select qty from stock where item_id='f1400000-0000-4000-8000-000000000001')=20,'R2 reversed while I1 (linked to R1) stays active');
select pg_temp.ok((select qty_terima from purchase_order_items where id='f1600000-0000-4000-8000-000000000001')=2,'PO line reopened to 2 box');
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L)',pg_temp.rid('R1'),'n01-cancel-r1','Salah input'),'sudah ditagih di faktur pembelian aktif FB.N01.');
select pg_temp.ok((select voided_at is null from goods_receipts where id=pg_temp.rid('R1')),'linked receipt kept');
-- Voiding the invoice deactivates its link; the receipt can then be cancelled.
reset role;
update purchase_invoices set voided_at=now(),voided_on=current_date,void_reason='Fiction void' where id=pg_temp.iid('I1');
select pg_temp.ok((select not active from purchase_invoice_receipts where invoice_id=pg_temp.iid('I1')),'link inactive after invoice void');
set local role authenticated;
select pg_temp.ok(cancel_goods_receipt(pg_temp.rid('R1'),'n01-cancel-r1b','Salah PO') ? 'reversal_journal_id','unlinked after void: cancel allowed');
select pg_temp.ok((select qty from stock where item_id='f1400000-0000-4000-8000-000000000001')=0,'R1 reversed');
-- A cancelled receipt cannot be linked.
select pg_temp.expect_error(format('select pg_temp.inv(%L,%L,1,array[%L]::uuid[],%L)','f1500000-0000-4000-8000-000000000001','n01-voided',pg_temp.rid('R1'),'f1600000-0000-4000-8000-000000000001'),'sudah dibatalkan');

-- 4. Old invoice without links keeps the PO-wide block.
insert into n01_results select 'R3',receive_purchase_order('f1500000-0000-4000-8000-000000000002','n01-r3','TB.N01.',5,current_date,null,null,'[{"id":"f1600000-0000-4000-8000-000000000002","qty_terima":2}]');
select create_purchase_invoice_from_po('f1500000-0000-4000-8000-000000000002','FB.N01.',5,null,current_date,current_date,null,
 '[{"po_item_id":"f1600000-0000-4000-8000-000000000002","qty":2,"harga":100}]','[]','[]',0,'n01-old-invoice');
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L)',pg_temp.rid('R3'),'n01-cancel-r3','Salah input'),'PO ini sudah punya faktur pembelian aktif');

-- 5. Remainder of a partly billed receipt; layer and link guards on cancel.
insert into n01_results select 'R4',receive_purchase_order('f1500000-0000-4000-8000-000000000003','n01-r4','TB.N01.',5,current_date,null,null,'[{"id":"f1600000-0000-4000-8000-000000000003","qty_terima":2}]');
reset role; select pg_temp.age_receipt(pg_temp.rid('R4')); set local role authenticated;
insert into n01_results select 'R5',receive_purchase_order('f1500000-0000-4000-8000-000000000003','n01-r5','TB.N01.',5,current_date,null,null,'[{"id":"f1600000-0000-4000-8000-000000000003","qty_terima":2}]');
insert into n01_results select 'I4',pg_temp.inv('f1500000-0000-4000-8000-000000000003','n01-i4',1,array[pg_temp.rid('R4')],'f1600000-0000-4000-8000-000000000003');
-- I5 bills the rest of R4 (already linked to active I4), so it need not claim R4 again.
insert into n01_results select 'I5',pg_temp.inv('f1500000-0000-4000-8000-000000000003','n01-i5',1,array[pg_temp.rid('R5')],'f1600000-0000-4000-8000-000000000003');
select pg_temp.ok((select count(*) from purchase_invoice_receipts where invoice_id=pg_temp.iid('I5'))=1,'I5 linked to R5 only');
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L)',pg_temp.rid('R5'),'n01-cancel-r5','Salah input'),'sudah ditagih');
reset role;
update purchase_invoices set voided_at=now(),voided_on=current_date,void_reason='Fiction void' where id=pg_temp.iid('I4');
set local role authenticated;
-- R4 is no longer linked to an active invoice, but active I5 repriced R4's stock: still refused.
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L)',pg_temp.rid('R4'),'n01-cancel-r4','Salah input'),'Nilai stok penerimaan ini sudah dipakai faktur');
select pg_temp.ok((select voided_at is null from goods_receipts where id=pg_temp.rid('R4')),'R4 kept');

-- 6. Other branches cannot read the links.
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000002',true);
select set_config('request.headers','{"x-kamo-operational-branch":"00000000-0000-4000-8000-0000000000aa"}',true);
select pg_temp.ok(not exists(select 1 from purchase_invoice_receipts),'links hidden outside the PO branch');
select set_config('request.headers','{}',true);
reset role;
rollback;
