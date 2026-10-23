-- Fictional PostgreSQL acceptance. Requires real migrations in an owned isolated DB.
begin;
insert into auth.users(id) values
 ('d6000000-0000-4000-8000-000000000001'),('d6000000-0000-4000-8000-000000000002'),('d6000000-0000-4000-8000-000000000003');
insert into profiles(id,role,is_active) values
 ('d6000000-0000-4000-8000-000000000001','OWNER',true),('d6000000-0000-4000-8000-000000000002','STAFF',true),('d6000000-0000-4000-8000-000000000003','ADMIN',true)
 on conflict(id)do update set role=excluded.role,is_active=excluded.is_active;
insert into branches(id,code,name,type,is_active) values('d6100000-0000-4000-8000-000000000001','QA-DP','Fiction DP branch','KLINIK',true);
insert into suppliers(id,nama) values('d6300000-0000-4000-8000-000000000001','Fiction DP supplier'),('d6300000-0000-4000-8000-000000000002','Fiction other supplier');
insert into coa_accounts(code,name,type,normal_balance) values('1196','Fiction DP cash','ASET','D'),('2101','Fiction DP payable','LIABILITAS','K') on conflict(code)do update set is_active=true,is_header=false;
insert into cash_accounts(id,nama,jenis,coa_code,is_active) values('d6700000-0000-4000-8000-000000000001','Fiction DP bank','Bank','1196',true);
insert into purchase_orders(id,no_po,supplier_id,branch_id,status,total) values
 ('d6400000-0000-4000-8000-000000000001','PO.QA.CAP','d6300000-0000-4000-8000-000000000001','d6100000-0000-4000-8000-000000000001','Draft',600000.55),
 ('d6400000-0000-4000-8000-000000000002','PO.QA.RECEIVED','d6300000-0000-4000-8000-000000000001','d6100000-0000-4000-8000-000000000001','Diterima',600000),
 ('d6400000-0000-4000-8000-000000000003','PO.QA.ROLLBACK','d6300000-0000-4000-8000-000000000001','d6100000-0000-4000-8000-000000000001','Dipesan',600000);
set local role authenticated;
set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='d6000000-0000-4000-8000-000000000001';
do $$declare a jsonb;b jsonb;c jsonb;failed boolean:=false;n bigint;begin
 a:=pay_purchase_advance_atomic('fraction-first','UM.QA.',5,'d6300000-0000-4000-8000-000000000001','d6400000-0000-4000-8000-000000000001',current_date,400000.25,'Transfer','d6700000-0000-4000-8000-000000000001',null);
 select count(*) into n from purchase_advances;
 begin perform pay_purchase_advance_atomic('fraction-over','UM.QA.',5,'d6300000-0000-4000-8000-000000000001','d6400000-0000-4000-8000-000000000001',current_date,200000.31,'Transfer','d6700000-0000-4000-8000-000000000001',null);exception when sqlstate '22003' then failed:=true;end;
 if not failed or (select count(*) from purchase_advances)<>n then raise exception 'cent excess was accepted or left a write';end if;
 b:=pay_purchase_advance_atomic('fraction-exact','UM.QA.',5,'d6300000-0000-4000-8000-000000000001','d6400000-0000-4000-8000-000000000001',current_date,200000.30,'Transfer','d6700000-0000-4000-8000-000000000001',null);
 if (select sum(jumlah) from purchase_advances where po_id='d6400000-0000-4000-8000-000000000001' and status='aktif')<>600000.55 then raise exception 'cent cap differs from PO';end if;
 if (select sum(debit) from journal_lines where entry_id=(b->>'journal_id')::uuid)<>200000.30 or (select sum(credit) from journal_lines where entry_id=(b->>'journal_id')::uuid)<>200000.30 then raise exception 'cent journal value changed';end if;
 if b is distinct from pay_purchase_advance_atomic('fraction-exact','UM.QA.',5,'d6300000-0000-4000-8000-000000000001','d6400000-0000-4000-8000-000000000001',current_date,200000.3,'Transfer','d6700000-0000-4000-8000-000000000001',null) or (select count(*) from purchase_advances)<>n+1 then raise exception 'cent retry duplicated';end if;
 c:=cancel_purchase_advance_atomic((b->>'advance_id')::uuid);
 if (select sum(debit) from journal_lines where entry_id=(c->>'journal_id')::uuid)<>200000.30 or (select sum(credit) from journal_lines where entry_id=(c->>'journal_id')::uuid)<>200000.30 then raise exception 'cent cancellation lost precision';end if;
 if cancel_purchase_advance_atomic((b->>'advance_id')::uuid) is distinct from c then raise exception 'cent cancellation retry changed';end if;
 perform pay_purchase_advance_atomic('fraction-after-refund','UM.QA.',5,'d6300000-0000-4000-8000-000000000001','d6400000-0000-4000-8000-000000000001',current_date,200000.30,'Transfer','d6700000-0000-4000-8000-000000000001',null);
 if (select sum(jumlah) from purchase_advances where po_id='d6400000-0000-4000-8000-000000000001' and status='aktif')<>600000.55 then raise exception 'cent refund did not release exact cap';end if;
end$$;
reset role;
insert into warehouses(id,branch_id,code,name,type) values('d6800000-0000-4000-8000-000000000001','d6100000-0000-4000-8000-000000000001','DP-CENT-WH','Fiction cent warehouse','VET');
insert into items(id,code,name,unit,item_type) values('d6900000-0000-4000-8000-000000000001','DP-CENT-SKU','Fiction cent goods','pcs','Persediaan');
insert into purchase_orders(id,no_po,supplier_id,branch_id,to_warehouse_id,status,total) values('d6400000-0000-4000-8000-000000000004','PO.QA.CENT.ALLOCATION','d6300000-0000-4000-8000-000000000001','d6100000-0000-4000-8000-000000000001','d6800000-0000-4000-8000-000000000001','Dipesan',1);
insert into purchase_order_items(id,po_id,item_id,nama,qty,harga_beli,satuan,faktor) values('d6a00000-0000-4000-8000-000000000001','d6400000-0000-4000-8000-000000000004','d6900000-0000-4000-8000-000000000001','Fiction cent goods',1,1,'pcs',1);
insert into coa_accounts(code,name,type,normal_balance) values('1301','Fiction inventory','ASET','D') on conflict(code)do update set is_active=true,is_header=false;
update company_settings set mode_pkp=false;
set local role authenticated;
do $$declare advance jsonb;invoice jsonb;payment jsonb;reversal jsonb;begin
 advance:=pay_purchase_advance_atomic('allocate-cent','UM.QA.',5,'d6300000-0000-4000-8000-000000000001','d6400000-0000-4000-8000-000000000004',current_date,0.30,'Transfer','d6700000-0000-4000-8000-000000000001',null);
 perform receive_purchase_order('d6400000-0000-4000-8000-000000000004','receipt-cent','TB.CENT.',5,current_date,null,null,'[{"id":"d6a00000-0000-4000-8000-000000000001","qty_terima":1,"qty_rusak":0}]');
 select to_jsonb(x) into invoice from create_purchase_invoice_from_po('d6400000-0000-4000-8000-000000000004','FB.CENT.',5,null,current_date,current_date,null,'[{"po_item_id":"d6a00000-0000-4000-8000-000000000001","qty":1,"harga":1,"expected_harga_po":1,"expected_faktor":1}]','[]','[]',0,'invoice-cent') x;
 payment:=pay_purchase_invoice_atomic('pay-cent',(invoice->>'invoice_id')::uuid,current_date,1,'Transfer',null,'d6700000-0000-4000-8000-000000000001',(advance->>'advance_id')::uuid);
 if (select terpakai from purchase_advances where id=(advance->>'advance_id')::uuid)<>0.30 then raise exception 'cent advance not fully allocated';end if;
 if (select sum(l.credit) from journal_lines l join coa_accounts a on a.id=l.account_id where l.entry_id=(payment->>'journal_id')::uuid and a.code='1303')<>0.30 or (select sum(l.credit) from journal_lines l join coa_accounts a on a.id=l.account_id where l.entry_id=(payment->>'journal_id')::uuid and a.code='1196')<>0.70 then raise exception 'cent allocation journal changed';end if;
 if pay_purchase_invoice_atomic('pay-cent',(invoice->>'invoice_id')::uuid,current_date,1,'Transfer',null,'d6700000-0000-4000-8000-000000000001',(advance->>'advance_id')::uuid) is distinct from payment then raise exception 'cent payment retry changed';end if;
 reversal:=cancel_purchase_payment((payment->>'payment_id')::uuid,0,'reverse-cent','Fiction cent allocation reversal');
 if (select terpakai from purchase_advances where id=(advance->>'advance_id')::uuid)<>0 or (select sum(dari_uang_muka) from purchase_invoice_payments where advance_id=(advance->>'advance_id')::uuid)<>0 then raise exception 'cent reversal did not restore advance';end if;
 if exists(select account_id from journal_lines where entry_id in((payment->>'journal_id')::uuid,(reversal->>'reversal_journal_id')::uuid) group by account_id having sum(debit)<>sum(credit)) then raise exception 'cent reversal did not reconcile';end if;
 if cancel_purchase_payment((payment->>'payment_id')::uuid,0,'reverse-cent','Fiction cent allocation reversal') is distinct from reversal then raise exception 'cent reversal retry changed';end if;
end$$;
rollback;

