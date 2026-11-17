-- Fictional local-only fixtures (migrasi 20261122100000). Pelunasan sisa faktur bersen: tolak cicilan sen & sub-sen,
-- terima sisa persis, jurnal hutang pemasok nol, pembayaran sen tetap bisa dibatalkan.
begin;
insert into auth.users(id) values('ed000000-0000-4000-8000-000000000001');
update profiles set role='OWNER' where id='ed000000-0000-4000-8000-000000000001';
insert into branches(id,code,name,type) values('ed100000-0000-4000-8000-000000000001','PAY-FIC','Payment fiction','KLINIK');
insert into warehouses(id,branch_id,code,name,type) values('ed200000-0000-4000-8000-000000000001','ed100000-0000-4000-8000-000000000001','PAY-WH','Payment warehouse','VET');
insert into suppliers(id,nama) values('ed300000-0000-4000-8000-000000000001','Fiction supplier');
insert into items(id,code,name,unit,item_type) values('ed400000-0000-4000-8000-000000000001','PAY-SKU','Fiction goods','pcs','Persediaan');
insert into purchase_orders(id,no_po,supplier_id,branch_id,to_warehouse_id,status) values('ed500000-0000-4000-8000-000000000001','PO.PAY.FIC','ed300000-0000-4000-8000-000000000001','ed100000-0000-4000-8000-000000000001','ed200000-0000-4000-8000-000000000001','Dipesan');
insert into purchase_order_items(id,po_id,item_id,nama,qty,harga_beli,satuan,faktor) values('ed600000-0000-4000-8000-000000000001','ed500000-0000-4000-8000-000000000001','ed400000-0000-4000-8000-000000000001','Fiction goods',10,100,'pcs',1);
insert into coa_accounts(code,name,type,normal_balance) values('170001','Fiction inventory','ASET','D'),('311001','Fiction payable','LIABILITAS','K'),('130009','Fiction VAT input','ASET','D'),('110209','Fiction bank account','ASET','D') on conflict(code) do update set is_active=true,is_header=false;
update coa_accounts set is_active=true,is_header=false where code in('170001','160001','311003','110003','120002');
update accounting_locks set closed_until=null;
update company_settings set mode_pkp=false;
insert into cash_accounts(id,nama,jenis,coa_code,branch_id) values('ed700000-0000-4000-8000-000000000001','Fiction bank','Bank','110209','ed100000-0000-4000-8000-000000000001');
create table r(name text primary key,result jsonb); grant all on r to authenticated;
create function pg_temp.expect_error(command text,fragment text) returns void language plpgsql as $$begin
 begin execute command;exception when others then if position(fragment in sqlerrm)=0 then raise exception 'Wrong error: % wanted %',sqlerrm,fragment;end if;return;end;
 raise exception 'Expected rejection: %',fragment;
end$$;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','ed000000-0000-4000-8000-000000000001',true);
select receive_purchase_order('ed500000-0000-4000-8000-000000000001','receipt-pay-test','TB.PAY.FIC.',5,current_date,null,null,'[{"id":"ed600000-0000-4000-8000-000000000001","qty_terima":10,"qty_rusak":0}]');
insert into r select 'invoice',to_jsonb(x) from create_purchase_invoice_from_po('ed500000-0000-4000-8000-000000000001','FB.PAY.FIC.',5,null,current_date,current_date,null,'[{"po_item_id":"ed600000-0000-4000-8000-000000000001","qty":10,"harga":100,"expected_harga_po":100,"expected_faktor":1}]','[]','[]',0,'invoice-pay-test')x;
reset role;
-- Fixture: the hosted case is a PPN invoice whose total carries cents (3.585.410,98). Reproduce the same
-- shape on the fictional invoice: total and its payable journal credit both end in ,98.
do $$declare iv uuid; j uuid;begin
 select (result->>'invoice_id')::uuid into iv from r where name='invoice';
 alter table purchase_invoices disable trigger user; alter table journal_lines disable trigger user;
 update purchase_invoices set total=1000.98 where id=iv;
 select l.entry_id into j from journal_lines l join coa_accounts a on a.id=l.account_id where a.code='311001' and l.credit=1000;
 if j is null then raise exception 'fixture: invoice journal not found %',(select jsonb_agg(jsonb_build_object('code',a.code,'d',l.debit,'c',l.credit)) from journal_lines l join coa_accounts a on a.id=l.account_id);end if;
 update journal_lines set credit=1000.98 where entry_id=j and account_id=(select id from coa_accounts where code='311001');
 update journal_lines set debit=debit+0.98 where id=(select l.id from journal_lines l where l.entry_id=j and l.debit>0 order by l.debit desc limit 1);
 alter table purchase_invoices enable trigger user; alter table journal_lines enable trigger user;
end$$;
set local role authenticated;
do $$declare iv uuid; p jsonb; ap numeric;begin
 select (result->>'invoice_id')::uuid into iv from r where name='invoice';
 perform pay_purchase_invoice_atomic('pay-1000',iv,current_date,1000,'Transfer',null,'ed700000-0000-4000-8000-000000000001',null);
 perform pg_temp.expect_error(format('select pay_purchase_invoice_atomic(%L,%L,current_date,1,%L,null,%L,null)','pay-1',iv,'Transfer','ed700000-0000-4000-8000-000000000001'),'melebihi sisa');
 perform pg_temp.expect_error(format('select pay_purchase_invoice_atomic(%L,%L,current_date,0.5,%L,null,%L,null)','pay-half',iv,'Transfer','ed700000-0000-4000-8000-000000000001'),'hanya untuk melunasi');
 perform pg_temp.expect_error(format('select pay_purchase_invoice_atomic(%L,%L,current_date,0.985,%L,null,%L,null)','pay-subcent',iv,'Transfer','ed700000-0000-4000-8000-000000000001'),'tidak valid');
 p:=pay_purchase_invoice_atomic('pay-cents',iv,current_date,0.98,'Transfer',null,'ed700000-0000-4000-8000-000000000001',null);
 if pay_purchase_invoice_atomic('pay-cents',iv,current_date,0.98,'Transfer',null,'ed700000-0000-4000-8000-000000000001',null) is distinct from p then raise exception 'recovery differs';end if;
 if (select sum(amount) from purchase_invoice_payments where invoice_id=iv)<>1000.98 then raise exception 'invoice not settled exactly';end if;
 if not exists(select 1 from journal_lines l join coa_accounts a on a.id=l.account_id where l.entry_id=(p->>'journal_id')::uuid and a.code='311001' and l.debit=0.98)
  or not exists(select 1 from journal_lines l join coa_accounts a on a.id=l.account_id where l.entry_id=(p->>'journal_id')::uuid and a.code='110209' and l.credit=0.98)
  then raise exception 'cent payment journal not exact';end if;
 select sum(l.credit-l.debit) into ap from journal_lines l join coa_accounts a on a.id=l.account_id where a.code='311001';
 if ap<>0 then raise exception 'payable ledger not zero after settlement: %',ap;end if;
 perform pg_temp.expect_error(format('select pay_purchase_invoice_atomic(%L,%L,current_date,0.01,%L,null,%L,null)','pay-more',iv,'Transfer','ed700000-0000-4000-8000-000000000001'),'melebihi sisa');
 insert into r values('cents',p);
 -- the cent payment can still be cancelled like any payment
 perform cancel_purchase_payment((p->>'payment_id')::uuid,0,'cancel-cents','Salah rekening');
 if (select sum(amount) from purchase_invoice_payments where invoice_id=iv)<>1000 then raise exception 'cancel not exact';end if;
 select sum(l.credit-l.debit) into ap from journal_lines l join coa_accounts a on a.id=l.account_id where a.code='311001';
 if ap<>0.98 then raise exception 'payable after cancel: %',ap;end if;
end$$;
select 'SEN_CASE_OK';
rollback;
