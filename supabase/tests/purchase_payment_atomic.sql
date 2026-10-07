-- Fictional fixtures supplied by scripts/test-purchase-payment-postgres.py.
begin;
insert into purchase_invoices(id,no_faktur,po_id,tanggal,jatuh_tempo,total)
values('fa000000-0000-4000-8000-000000000001','FB.PAYMENT.TEST','f6000000-0000-4000-8000-000000000010',current_date,current_date,220);
insert into coa_accounts(code,name,type,normal_balance) values('1303','Advance','ASET','D') on conflict(code) do update set is_active=true,is_header=false;
set role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$ declare r jsonb; retry jsonb; before_count int; begin
 r:=pay_purchase_invoice_atomic('pay-one','fa000000-0000-4000-8000-000000000001',current_date,10,'Transfer',null,null,null);
 retry:=pay_purchase_invoice_atomic('pay-one','fa000000-0000-4000-8000-000000000001',current_date,10,'Transfer',null,null,null);
 if r<>retry then raise exception 'Exact retry did not recover';end if;
 if (select count(*) from purchase_invoice_payments where invoice_id='fa000000-0000-4000-8000-000000000001')<>1 then raise exception 'Duplicate payment';end if;
 if (select count(*) from journal_lines where entry_id=(r->>'journal_id')::uuid)<>2 then raise exception 'Payment journal incomplete';end if;
 begin perform pay_purchase_invoice_atomic('pay-one','fa000000-0000-4000-8000-000000000001',current_date,11,'Transfer',null,null,null);raise exception 'Changed payload accepted';exception when sqlstate '22023' then null;end;
 begin perform pay_purchase_invoice_atomic('pay-fraction','fa000000-0000-4000-8000-000000000001',current_date,0.5,'Transfer',null,null,null);raise exception 'Fractional mismatch accepted';exception when sqlstate '22023' then null;end;
 -- Fixtures already returned 60 of the 220 PO; payment leaves only 150 outstanding.
 begin perform pay_purchase_invoice_atomic('pay-over','fa000000-0000-4000-8000-000000000001',current_date,151,'Transfer',null,null,null);raise exception 'Debt ceiling ignored';exception when sqlstate '22003' then null;end;
 if (select count(*) from purchase_invoice_payments where invoice_id='fa000000-0000-4000-8000-000000000001')<>1 then raise exception 'Rejected payment persisted';end if;
 begin insert into purchase_invoice_payments(invoice_id,amount) values('fa000000-0000-4000-8000-000000000001',1);raise exception 'Direct write bypass accepted';exception when insufficient_privilege then null;end;
end $$;
reset role;
insert into purchase_advances(id,no_um,jumlah) values('fb000000-0000-4000-8000-000000000001','UM.PAYMENT.TEST',20);
insert into purchase_advances(id,no_um,jumlah) values('fb000000-0000-4000-8000-000000000002','UM.FRACTION.TEST',1.4);
set role authenticated;
do $$ begin
 begin perform pay_purchase_invoice_atomic('pay-fraction-advance','fa000000-0000-4000-8000-000000000001',current_date,2,'Transfer',null,null,'fb000000-0000-4000-8000-000000000002');raise exception 'Fractional advance mismatch accepted';exception when sqlstate '22023' then null;end;
 if (select terpakai from purchase_advances where id='fb000000-0000-4000-8000-000000000002')<>0 then raise exception 'Fractional rejected advance changed';end if;
end $$;
reset role;
insert into approval_rules(jenis,min_nilai,penyetuju_role) values('bayar-faktur',0,'OWNER');
insert into approval_requests(id,jenis,ref_id,nilai,penyetuju_role,status) values('fc000000-0000-4000-8000-000000000001','bayar-faktur','fa000000-0000-4000-8000-000000000001',5,'OWNER','disetujui');
-- Fail the actual journal insertion: approval/advance/payment/request must roll back together.
create function test_payment_journal_failure() returns trigger language plpgsql as $$begin if new.source='purchase-pay' then raise exception 'PAYMENT_JOURNAL_FAILURE';end if;return new;end$$;
create trigger test_payment_journal_failure before insert on journal_entries for each row execute function test_payment_journal_failure();
set role authenticated;
do $$ begin
 begin perform pay_purchase_invoice_atomic('pay-fail','fa000000-0000-4000-8000-000000000001',current_date,5,'Transfer',null,null,'fb000000-0000-4000-8000-000000000001');raise exception 'Journal failure ignored';exception when others then if sqlerrm not like '%PAYMENT_JOURNAL_FAILURE%' then raise;end if;end;
 if (select count(*) from purchase_invoice_payments where invoice_id='fa000000-0000-4000-8000-000000000001')<>1 then raise exception 'Partial payment survived journal failure';end if;
 if (select terpakai from purchase_advances where id='fb000000-0000-4000-8000-000000000001')<>0 then raise exception 'Advance survived journal failure';end if;
 if (select status from approval_requests where id='fc000000-0000-4000-8000-000000000001')<>'disetujui' then raise exception 'Approval consumed on journal failure';end if;
end $$;
reset role;
drop trigger test_payment_journal_failure on journal_entries;
set role authenticated;
do $$ declare r jsonb; begin
 r:=pay_purchase_invoice_atomic('pay-advance','fa000000-0000-4000-8000-000000000001',current_date,5,'Transfer',null,null,'fb000000-0000-4000-8000-000000000001');
 if (select terpakai from purchase_advances where id='fb000000-0000-4000-8000-000000000001')<>5 then raise exception 'Advance not applied';end if;
 if (select status from approval_requests where id='fc000000-0000-4000-8000-000000000001')<>'terpakai' then raise exception 'Approval not consumed';end if;
 if not exists(select 1 from journal_lines l join coa_accounts a on a.id=l.account_id where l.entry_id=(r->>'journal_id')::uuid and a.code='1303' and l.credit=5) then raise exception 'Advance account policy changed';end if;
 r:=pay_purchase_invoice_atomic('pay-advance','fa000000-0000-4000-8000-000000000001',current_date,5,'Transfer',null,null,'fb000000-0000-4000-8000-000000000001');
 if (select terpakai from purchase_advances where id='fb000000-0000-4000-8000-000000000001')<>5 then raise exception 'Replay applied advance twice';end if;
end $$;
reset role;
insert into payment_orders(id,no_pp,status,total) values('fd000000-0000-4000-8000-000000000001','PP.PAYMENT.TEST','disetujui',5);
insert into payment_order_items(order_id,invoice_id,jumlah) values('fd000000-0000-4000-8000-000000000001','fa000000-0000-4000-8000-000000000001',5);
set role authenticated;
do $$ declare r jsonb; again jsonb; begin
 r:=pay_purchase_payment_order_atomic('pp-one','fd000000-0000-4000-8000-000000000001',current_date,'Transfer',null);
 again:=pay_purchase_payment_order_atomic('pp-one','fd000000-0000-4000-8000-000000000001',current_date,'Transfer',null);
 if r<>again or (select status from payment_orders where id='fd000000-0000-4000-8000-000000000001')<>'dibayar' then raise exception 'PP exact recovery failed';end if;
 if (select count(*) from purchase_invoice_payments where payment_order_id='fd000000-0000-4000-8000-000000000001')<>1 then raise exception 'PP duplicate payment';end if;
 if not exists(select 1 from journal_entries where id=(r->>'journal_id')::uuid and source='purchase-pay' and source_ref='PP.PAYMENT.TEST') then raise exception 'Aggregate payment source/ref changed';end if;
end $$;
reset role;
delete from approval_rules where jenis='bayar-faktur';
delete from role_modules where role::text='FINANCE';
insert into auth.users(id,raw_user_meta_data) values('f1000000-0000-4000-8000-000000000003','{"full_name":"Fictional independent admin"}');
update profiles set role='OWNER' where id='f1000000-0000-4000-8000-000000000003';
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000003',true);
update profiles set role='FINANCE' where id='f1000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
set role authenticated;
do $$ begin
 perform pay_purchase_invoice_atomic('pay-finance','fa000000-0000-4000-8000-000000000001',current_date,1,'Transfer',null,null,null);
 begin perform pay_purchase_payment_order_atomic('pp-finance','fd000000-0000-4000-8000-000000000001',current_date,'Transfer',null);raise exception 'FINANCE paid approval order';exception when insufficient_privilege then null;end;
end $$;
reset role;
insert into role_modules(role,module_id) values('FINANCE','pembelian');
set role authenticated;
do $$ begin
 begin perform pay_purchase_invoice_atomic('pay-module-denied','fa000000-0000-4000-8000-000000000001',current_date,1,'Transfer',null,null,null);raise exception 'Explicit module denial ignored';exception when insufficient_privilege then null;end;
end $$;
reset role;
delete from role_modules where role::text='FINANCE';
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000003',true);
update profiles set is_active=false where id='f1000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
set role authenticated;
do $$ begin
 begin perform pay_purchase_invoice_atomic('pay-disabled','fa000000-0000-4000-8000-000000000001',current_date,1,'Transfer',null,null,null);raise exception 'Inactive actor paid';exception when insufficient_privilege then null;end;
end $$;
rollback;
