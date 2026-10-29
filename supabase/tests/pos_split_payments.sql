-- Fictional transaction fixtures only; disposable PostgreSQL runner, never production.
begin;
create function pg_temp.assert_ok(ok boolean,message text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'Assertion failed: %',message;end if;end$$;
create function pg_temp.reject(statement text,message text) returns void language plpgsql as $$declare failed boolean:=false;begin
 begin execute statement;exception when others then failed:=true;end;
 if not failed then raise exception 'Expected rejection: %',message;end if;end$$;
select pg_temp.assert_ok(to_regclass('public.sale_payments') is not null,'Split payment allocation storage missing');
insert into auth.users(id,raw_user_meta_data) values
('e1100000-0000-4000-8000-000000000001','{"full_name":"Split cashier"}'),('e1100000-0000-4000-8000-000000000002','{"full_name":"Other cashier"}');
update profiles set role='STAFF',is_active=true where id in('e1100000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000002');
-- Diskon manual (migrasi 20261031220000): fixture ini sengaja memasang potongan,
-- jadi peran STAFF diberi hak diskon manual supaya yang diuji tetap jalur aslinya.
insert into public.role_capabilities(role,manual_discount) values('STAFF',true)
 on conflict(role) do update set manual_discount=true;
insert into role_modules(role,module_id) values('STAFF','pos') on conflict do nothing;
insert into branches(id,code,name,type) values('e2200000-0000-4000-8000-000000000001','SPLITTEST','Split test','PETSHOP'),('e2200000-0000-4000-8000-000000000002','SPLITOTHER','Other test','PETSHOP');
insert into user_branches(user_id,branch_id) values('e1100000-0000-4000-8000-000000000001','e2200000-0000-4000-8000-000000000001'),('e1100000-0000-4000-8000-000000000002','e2200000-0000-4000-8000-000000000002');
insert into warehouses(id,branch_id,code,name,type) values('e3300000-0000-4000-8000-000000000001','e2200000-0000-4000-8000-000000000001','SPLITWH','Split warehouse','RETAIL');
insert into cashier_shifts(id,branch_id,opened_by,shift_type) values('e4400000-0000-4000-8000-000000000001','e2200000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000001','petshop');
insert into items(id,code,name,unit,item_type) values('e5500000-0000-4000-8000-000000000001','SPLITSERVICE','Split service','pcs','Jasa'),('e5500000-0000-4000-8000-000000000002','SPLITSTOCK','Split stock','pcs','Persediaan');
insert into coa_accounts(code,name,type,normal_balance,is_header) values
('1111','Split cash','ASET','D',false),('1112','Split bank','ASET','D',false),('1113','Other bank','ASET','D',false),('1114','Changed bank','ASET','D',false),('4101','Sales','PENDAPATAN','K',false),('4102','Discount','PENDAPATAN','D',false),('2201','VAT','LIABILITAS','K',false),('5101','COGS','BEBAN','D',false),('1301','Inventory','ASET','D',false),('5902','Loss','BEBAN','D',false)
on conflict(code) do update set is_active=true,is_header=false;
insert into cash_accounts(id,nama,jenis,coa_code) values('e6600000-0000-4000-8000-000000000001','Split cash','Kas','1111'),('e6600000-0000-4000-8000-000000000002','Split bank','Bank','1112'),('e6600000-0000-4000-8000-000000000003','Global bank','Bank','1113'),('e6600000-0000-4000-8000-000000000004','Changed bank','Bank','1114');
insert into payment_account_map(metode,branch_id,cash_account_id) values('Tunai','e2200000-0000-4000-8000-000000000001','e6600000-0000-4000-8000-000000000001'),('Transfer','e2200000-0000-4000-8000-000000000001','e6600000-0000-4000-8000-000000000002'),('Transfer',null,'e6600000-0000-4000-8000-000000000003') on conflict do nothing;
update accounting_locks set closed_until=null;
update company_settings set mode_pkp=false,ppn_rate=11;
create function pg_temp.sale(ref text,plan jsonb default '[{"method":"Tunai","amount":20000},{"method":"Transfer","amount":80000}]',total numeric default 100000,gross numeric default 100000,tender numeric default 100000,change numeric default 0,method text default 'Split') returns uuid language plpgsql as $$declare doc uuid;begin
 insert into sales(branch_id,no_struk,subtotal,discount,total,metode_bayar,bayar,kembali,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint) values('e2200000-0000-4000-8000-000000000001',ref,gross,gross-total,total,method,tender,change,auth.uid(),'e4400000-0000-4000-8000-000000000001',plan,'sql:'||ref,repeat('a',64)) returning id into doc;return doc;end$$;
create function pg_temp.lines(doc uuid,gross numeric default 100000,cost numeric default 0,item uuid default 'e5500000-0000-4000-8000-000000000001') returns uuid language plpgsql as $$declare line uuid;begin
 insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp) values(doc,item,'Split line',2,gross/2,'pcs',1,cost) returning id into line;return line;end$$;
create function pg_temp.balance(ref text,source_kind text,code text) returns numeric language sql as $$select coalesce(sum(l.debit-l.credit),0) from journal_lines l join journal_entries e on e.id=l.entry_id join coa_accounts a on a.id=l.account_id where e.source=$2 and e.source_ref=$1 and a.code=$3$$;
create function pg_temp.refund(ref text,key text,qty numeric) returns jsonb language sql as $$select post_unit_return('sales',(select id from sales where no_struk=ref),key,jsonb_build_object('tanggal',(now() at time zone 'Asia/Jakarta')::date,'dari','kasir'),jsonb_build_array(jsonb_build_object('source_line_id',(select i.id from sale_items i join sales s on s.id=i.sale_id where s.no_struk=ref),'item_id','e5500000-0000-4000-8000-000000000001','qty',qty,'satuan','pcs','kondisi','baik')))$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select pg_temp.sale('SPLIT.ACCEPT');
select pg_temp.assert_ok((select count(*)=1 and sum(total)=100000 from sales where no_struk='SPLIT.ACCEPT'),'one sale, full total');
select pg_temp.assert_ok((select count(*)=2 and sum(amount)=100000 from sale_payments where sale_id=(select id from sales where no_struk='SPLIT.ACCEPT')),'two allocations, full amount');
select pg_temp.assert_ok((select count(*)=0 from journal_entries where source_ref='SPLIT.ACCEPT'),'pending checkout has no financial journal');
select pg_temp.reject($q$update cashier_shifts set status='closed' where id='e4400000-0000-4000-8000-000000000001'$q$,'pending checkout blocks shift close');
select pg_temp.lines((select id from sales where no_struk='SPLIT.ACCEPT'));
select finalize_pos_sale((select id from sales where no_struk='SPLIT.ACCEPT'));
select finalize_pos_sale((select id from sales where no_struk='SPLIT.ACCEPT'));
select pg_temp.assert_ok((select payments_finalized_at is not null from sales where no_struk='SPLIT.ACCEPT'),'finalization metadata');
select pg_temp.assert_ok((select count(*)=1 from journal_entries where source='sale' and source_ref='SPLIT.ACCEPT'),'idempotent finalization, no duplicate revenue');
select pg_temp.assert_ok(pg_temp.balance('SPLIT.ACCEPT','sale','4101')=-100000,'one revenue total');
-- A close read before finalization must not save an outdated target or omit
-- noncash parts; legacy NULL-plan header money participates in the same sum.
select pg_temp.sale('CLOSE.LEGACY.CASH',null,2500,2500,2500,0,'Tunai');
select pg_temp.sale('CLOSE.LEGACY.BANK',null,7500,7500,7500,0,'Transfer');
select pg_temp.reject($q$update cashier_shifts set status='closed',expected_cash=0,closing_breakdown='{"Tunai":0,"Transfer":0,"Debit":0,"Kredit":0,"QRIS":0,"E-Wallet":0}' where id='e4400000-0000-4000-8000-000000000001'$q$,'stale cash target rejected after finalization');
select pg_temp.reject($q$update cashier_shifts set status='closed',expected_cash=22500,closing_breakdown='{"Tunai":22500,"Transfer":0,"Debit":0,"Kredit":0,"QRIS":0,"E-Wallet":0}' where id='e4400000-0000-4000-8000-000000000001'$q$,'stale noncash breakdown rejected even when cash target matches');
insert into expenses(branch_id,tanggal,kategori,deskripsi,jumlah,metode_bayar,shift_id,created_by) values
 ('e2200000-0000-4000-8000-000000000001',current_date,'Operasional','Fictional close cash expense',2000,'Tunai','e4400000-0000-4000-8000-000000000001',auth.uid()),
 ('e2200000-0000-4000-8000-000000000001',current_date,'Operasional','Fictional close bank expense',1000,'Transfer','e4400000-0000-4000-8000-000000000001',auth.uid());
select pg_temp.reject($q$update cashier_shifts set status='closed',expected_cash=22500,closing_breakdown='{"Tunai":22500,"Transfer":87500,"Debit":0,"Kredit":0,"QRIS":0,"E-Wallet":0}' where id='e4400000-0000-4000-8000-000000000001'$q$,'new cash expense invalidates a previously read cash target');
update cashier_shifts set status='closed',expected_cash=20500,closing_breakdown='{"Tunai":22500,"Transfer":87500,"Debit":0,"Kredit":0,"QRIS":0,"E-Wallet":0}' where id='e4400000-0000-4000-8000-000000000001';
update cashier_shifts set status='open' where id='e4400000-0000-4000-8000-000000000001';
select pg_temp.assert_ok(pg_temp.balance('SPLIT.ACCEPT','sale','1111')=20000 and pg_temp.balance('SPLIT.ACCEPT','sale','1112')=80000,'branch-specific accounts, 20/80 split');
select pg_temp.reject($q$update sales set checkout_key='other-key' where no_struk='SPLIT.ACCEPT'$q$,'checkout identity immutable');
select pg_temp.reject($q$update sales set checkout_fingerprint=repeat('b',64) where no_struk='SPLIT.ACCEPT'$q$,'checkout fingerprint immutable');
select pg_temp.reject($q$update sales set total=1 where no_struk='SPLIT.ACCEPT'$q$,'financial snapshot');
select pg_temp.reject($q$update sales set payments_finalized_at=null where no_struk='SPLIT.ACCEPT'$q$,'metadata');
select pg_temp.reject($q$update sale_payments set amount=1$q$,'direct allocation update');
select pg_temp.reject($q$delete from sale_payments$q$,'direct allocation delete');
select pg_temp.reject($q$insert into sale_payments(sale_id,method,amount,coa_code,account_snapshot) select id,'QRIS',1,'1112','{}' from sales where no_struk='SPLIT.ACCEPT'$q$,'direct allocation insert');
select pg_temp.reject($q$update sale_items set harga=1 where sale_id=(select id from sales where no_struk='SPLIT.ACCEPT')$q$,'posted line');
select pg_temp.reject($q$delete from sales where no_struk='SPLIT.ACCEPT'$q$,'posted deletion');
select pg_temp.reject($q$select pg_temp.sale('BAD.SUM','[{"method":"Tunai","amount":20000},{"method":"Transfer","amount":79999}]')$q$,'underpaid');
select pg_temp.reject($q$select pg_temp.sale('BAD.OVER','[{"method":"Tunai","amount":20000},{"method":"Transfer","amount":80001}]')$q$,'overallocated');
select pg_temp.reject($q$select pg_temp.sale('BAD.DUP','[{"method":"Tunai","amount":20000},{"method":"Tunai","amount":80000}]')$q$,'duplicate method');
select pg_temp.reject($q$select pg_temp.sale('BAD.ZERO','[{"method":"Tunai","amount":0},{"method":"Transfer","amount":100000}]')$q$,'zero amount');
select pg_temp.reject($q$select pg_temp.sale('BAD.NEG','[{"method":"Tunai","amount":-1},{"method":"Transfer","amount":100001}]')$q$,'negative amount');
select pg_temp.reject($q$select pg_temp.sale('BAD.NAN','[{"method":"Tunai","amount":"NaN"},{"method":"Transfer","amount":80000}]')$q$,'non-finite amount');
select pg_temp.reject($q$select pg_temp.sale('BAD.CENT','[{"method":"Tunai","amount":20000.001},{"method":"Transfer","amount":79999.999}]')$q$,'sub-cent amount');
select pg_temp.reject($q$select pg_temp.sale('BAD.METHOD','[{"method":"Bitcoin","amount":20000},{"method":"Transfer","amount":80000}]')$q$,'method');
select pg_temp.reject($q$select pg_temp.sale('BAD.HEADER',method=>'Tunai')$q$,'header method');
select pg_temp.reject($q$select pg_temp.sale('BAD.NOCASH','[{"method":"Transfer","amount":100000}]',tender=>100001,change=>1,method=>'Transfer')$q$,'noncash change');
select pg_temp.reject($q$select pg_temp.sale('BAD.TENDER',tender=>100001)$q$,'tender identity');
select pg_temp.assert_ok((select count(*)=0 from sales where no_struk like 'BAD.%'),'invalid inserts rolled back');
select pg_temp.assert_ok((select count(*)=0 from journal_entries where source_ref like 'BAD.%'),'invalid insert journals rolled back');
select pg_temp.reject($q$insert into sales(branch_id,no_struk,subtotal,total,metode_bayar,bayar,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint) select branch_id,'DUP.KEY',subtotal,total,metode_bayar,bayar,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint from sales where no_struk='SPLIT.ACCEPT'$q$,'same intent key cannot insert a second header');
select pg_temp.sale('SPLIT.CHANGE',tender=>110000,change=>10000);
select pg_temp.assert_ok((select amount=20000 from sale_payments where method='Tunai' and sale_id=(select id from sales where no_struk='SPLIT.CHANGE')),'change excluded from money received');
select pg_temp.lines((select id from sales where no_struk='SPLIT.CHANGE'));
select finalize_pos_sale((select id from sales where no_struk='SPLIT.CHANGE'));
select pg_temp.sale('SPLIT.FAIL');
select pg_temp.lines((select id from sales where no_struk='SPLIT.FAIL'));
select pg_temp.reject($q$update sales set payment_plan='[]' where no_struk='SPLIT.FAIL'$q$,'pending plan immutable');
delete from sales where no_struk='SPLIT.FAIL';
select pg_temp.assert_ok((select count(*)=0 from journal_entries where source_ref='SPLIT.FAIL'),'pending cleanup cancels payment journal');
update cashier_shifts set status='closed',expected_cash=40500,closing_breakdown='{"Tunai":42500,"Transfer":167500,"Debit":0,"Kredit":0,"QRIS":0,"E-Wallet":0}' where id='e4400000-0000-4000-8000-000000000001';
update cashier_shifts set status='open' where id='e4400000-0000-4000-8000-000000000001';
select pg_temp.sale('SPLIT.HPP');
select pg_temp.reject($q$select finalize_pos_sale((select id from sales where no_struk='SPLIT.HPP'))$q$,'no detail');
select pg_temp.lines((select id from sales where no_struk='SPLIT.HPP'),90000,40000,'e5500000-0000-4000-8000-000000000002');
select pg_temp.reject($q$select finalize_pos_sale((select id from sales where no_struk='SPLIT.HPP'))$q$,'detail sum');
update sale_items set harga=50000 where sale_id=(select id from sales where no_struk='SPLIT.HPP');
select finalize_pos_sale((select id from sales where no_struk='SPLIT.HPP'));
select finalize_pos_sale((select id from sales where no_struk='SPLIT.HPP'));
select pg_temp.assert_ok(pg_temp.balance('SPLIT.HPP','sale-hpp','5101')=40000 and pg_temp.balance('SPLIT.HPP','sale-hpp','1301')=-40000,'FIFO HPP posted once');
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000002',true);
select pg_temp.assert_ok((select count(*)=0 from sale_payments),'allocation RLS');
select pg_temp.reject($q$select finalize_pos_sale((select id from sales where no_struk='SPLIT.ACCEPT'))$q$,'foreign finalization');
select pg_temp.reject($q$select pg_temp.sale('BAD.BRANCH')$q$,'branch write');
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
reset role;
update coa_accounts set is_active=false where code='1112';
set local role authenticated;
select pg_temp.reject($q$select pg_temp.sale('BAD.ACCOUNT')$q$,'unavailable mapped account');
reset role;
update coa_accounts set is_active=true where code='1112';
update accounting_locks set closed_until=(now() at time zone 'Asia/Jakarta')::date;
set local role authenticated;
select pg_temp.reject($q$select pg_temp.sale('BAD.PERIOD')$q$,'period lock');
reset role;
update accounting_locks set closed_until=null;
update profiles set is_active=false where id='e1100000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.reject($q$select pg_temp.sale('BAD.ACTOR')$q$,'inactive actor');
reset role;
update profiles set is_active=true where id='e1100000-0000-4000-8000-000000000001';
update cashier_shifts set status='closed',expected_cash=60500,closing_breakdown='{"Tunai":62500,"Transfer":247500,"Debit":0,"Kredit":0,"QRIS":0,"E-Wallet":0}' where id='e4400000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.reject($q$select pg_temp.sale('BAD.SHIFT')$q$,'closed shift');
reset role;
update cashier_shifts set status='open' where id='e4400000-0000-4000-8000-000000000001';
update company_settings set mode_pkp=true,ppn_rate=11;
set local role authenticated;
select pg_temp.sale('SPLIT.TAX',gross=>111000);
select pg_temp.lines((select id from sales where no_struk='SPLIT.TAX'),111000);
select finalize_pos_sale((select id from sales where no_struk='SPLIT.TAX'));
select pg_temp.assert_ok(pg_temp.balance('SPLIT.TAX','sale','4101')=-100000 and pg_temp.balance('SPLIT.TAX','sale','4102')=9909.91 and pg_temp.balance('SPLIT.TAX','sale','2201')=-9909.91,'gross revenue, discount DPP, net VAT');
reset role;
update payment_account_map set cash_account_id='e6600000-0000-4000-8000-000000000004' where metode='Transfer' and branch_id='e2200000-0000-4000-8000-000000000001';
update company_settings set mode_pkp=false,ppn_rate=12;
set local role authenticated;
select pg_temp.refund('SPLIT.ACCEPT','split-return-1',1);
select pg_temp.assert_ok((select sum(r.amount)=50000 and sum(r.amount) filter(where p.method='Tunai')=10000 and sum(r.amount) filter(where p.method='Transfer')=40000 from sale_payment_refunds r join sale_payments p on p.id=r.sale_payment_id where p.sale_id=(select id from sales where no_struk='SPLIT.ACCEPT')),'partial refund 10/40');
select pg_temp.assert_ok((select sum(jumlah)=50000 and sum(jumlah) filter(where metode_bayar='Tunai' and shift_id='e4400000-0000-4000-8000-000000000001')=10000 from expenses where deskripsi like '%(struk SPLIT.ACCEPT)%'),'refund expenses per method and cash shift');
select pg_temp.refund('SPLIT.ACCEPT','split-return-2',1);
select pg_temp.assert_ok((select bool_and(refunded=amount) from(select p.id,p.amount,coalesce(sum(r.amount),0) refunded from sale_payments p left join sale_payment_refunds r on r.sale_payment_id=p.id where p.sale_id=(select id from sales where no_struk='SPLIT.ACCEPT') group by p.id) q),'full refund exact cap per payment');
select pg_temp.assert_ok((select sum(l.credit) filter(where a.code='1112')=80000 and coalesce(sum(l.credit) filter(where a.code='1114'),0)=0 from journal_lines l join journal_entries e on e.id=l.entry_id join coa_accounts a on a.id=l.account_id where e.source='sales-return' and e.source_ref in(select no_retur from sales_returns where sale_id=(select id from sales where no_struk='SPLIT.ACCEPT'))),'original bank survives changed mapping');
select pg_temp.reject($q$select pg_temp.refund('SPLIT.ACCEPT','split-return-over',1)$q$,'source refund ceiling');
select pg_temp.refund('SPLIT.TAX','split-tax-return',2);
select pg_temp.assert_ok((select sum(l.debit) filter(where a.code='4101')=100000 and sum(l.credit) filter(where a.code='4102')=9909.91 and sum(l.debit) filter(where a.code='2201')=9909.91 from journal_lines l join journal_entries e on e.id=l.entry_id join coa_accounts a on a.id=l.account_id where e.source='sales-return' and e.source_ref in(select no_retur from sales_returns where sale_id=(select id from sales where no_struk='SPLIT.TAX'))),'original VAT and discount reverse exactly');
-- Sealed zero-total sales retain stock cost, and their source details freeze.
select pg_temp.sale('FREE.NEW','[]',0,100000,10000,10000,'Tunai');
select pg_temp.lines((select id from sales where no_struk='FREE.NEW'),100000,40000,'e5500000-0000-4000-8000-000000000002');
select pg_temp.assert_ok((finalize_pos_sale((select id from sales where no_struk='FREE.NEW'))->>'finalized')::boolean,'free sale finalizes');
select pg_temp.assert_ok((select count(*)=0 from sale_payments where sale_id=(select id from sales where no_struk='FREE.NEW')),'free sale has no payment allocations');
select pg_temp.assert_ok((select count(*)=0 from journal_entries where source='sale' and source_ref='FREE.NEW'),'free sale has no money journal');
select pg_temp.assert_ok(pg_temp.balance('FREE.NEW','sale-hpp','5101')=40000,'free stock retains FIFO HPP');
select pg_temp.reject($q$update sale_items set harga=1 where sale_id=(select id from sales where no_struk='FREE.NEW')$q$,'free finalized source immutable');
select pg_temp.reject($q$select pg_temp.sale('BAD.FREE','[]',0,100000,0,0,'Split')$q$,'free split forbidden');
select pg_temp.sale('SPLIT.ONE','[{"method":"Tunai","amount":100000}]');
select pg_temp.lines((select id from sales where no_struk='SPLIT.ONE'));
select finalize_pos_sale((select id from sales where no_struk='SPLIT.ONE'));
-- Authorized backoffice checkout may have no shift; all actor/branch checks remain.
insert into sales(branch_id,no_struk,subtotal,total,metode_bayar,bayar,cashier_id,payment_plan,checkout_key,checkout_fingerprint)
 values('e2200000-0000-4000-8000-000000000001','BACKOFFICE',100,100,'Transfer',100,auth.uid(),'[{"method":"Transfer","amount":100}]','sql:BACKOFFICE',repeat('a',64));
select pg_temp.lines((select id from sales where no_struk='BACKOFFICE'),100);
select finalize_pos_sale((select id from sales where no_struk='BACKOFFICE'));
-- No API caller can replace source/payment metadata or mutate posted cash lines.
select pg_temp.reject($q$update journal_entries set source='sale-pending' where source='sale' and source_ref='SPLIT.ACCEPT'$q$,'journal header immutable');
select pg_temp.reject($q$update journal_lines set debit=1 where entry_id=(select id from journal_entries where source='sale' and source_ref='SPLIT.ACCEPT')$q$,'journal lines immutable');
select pg_temp.reject($q$delete from journal_entries where source='sale' and source_ref='SPLIT.ACCEPT'$q$,'journal deletion immutable');
select pg_temp.reject($q$select pos_sale_refund_targets((select id from sales where no_struk='SPLIT.ACCEPT'),100)$q$,'internal refund helper not exposed');
select pg_temp.reject($q$update sale_payment_refunds set amount=1$q$,'refund snapshots immutable');
-- A late account failure rolls finalization back completely; pending cleanup works.
select pg_temp.sale('SPLIT.LATEFAIL');
select pg_temp.lines((select id from sales where no_struk='SPLIT.LATEFAIL'));
reset role;
update coa_accounts set is_active=false where code='4101';
set local role authenticated;
select pg_temp.reject($q$select finalize_pos_sale((select id from sales where no_struk='SPLIT.LATEFAIL'))$q$,'late account failure');
select pg_temp.assert_ok((select payments_finalized_at is null from sales where no_struk='SPLIT.LATEFAIL'),'late failure does not seal');
select pg_temp.assert_ok((select count(*)=0 from journal_entries where source_ref='SPLIT.LATEFAIL'),'late failure leaves no journal');
delete from sales where no_struk='SPLIT.LATEFAIL';
reset role;
update coa_accounts set is_active=true where code='4101';
set local role authenticated;
-- Small cent amounts never produce a negative VAT or over-refund a method.
reset role;
update company_settings set mode_pkp=true,ppn_rate=11;
set local role authenticated;
select pg_temp.sale('TINY.TAX','[{"method":"Tunai","amount":0.56}]',0.56,0.56,0.56,0,'Tunai');
select pg_temp.lines((select id from sales where no_struk='TINY.TAX'),0.56);
select finalize_pos_sale((select id from sales where no_struk='TINY.TAX'));
select pg_temp.assert_ok(pg_temp.balance('TINY.TAX','sale','4101')=-0.50 and pg_temp.balance('TINY.TAX','sale','2201')=-0.06,'tiny VAT remains positive and balances');
select pg_temp.refund('TINY.TAX','tiny-return-1',1);
select pg_temp.refund('TINY.TAX','tiny-return-2',1);
reset role;
update company_settings set mode_pkp=false;
set local role authenticated;
select pg_temp.sale('SIX.CENTS','[{"method":"Tunai","amount":0.01},{"method":"Transfer","amount":0.02},{"method":"Debit","amount":0.03},{"method":"Kredit","amount":0.04},{"method":"QRIS","amount":0.05},{"method":"E-Wallet","amount":0.06}]',0.21,0.21,0.21);
select pg_temp.lines((select id from sales where no_struk='SIX.CENTS'),0.21);
select finalize_pos_sale((select id from sales where no_struk='SIX.CENTS'));
reset role;
select pg_temp.assert_ok((select bool_and(amount>=coalesce(prior,0) and amount<=source_amount) from(select t.amount,p.amount source_amount,lag(t.amount) over(partition by t.sale_payment_id order by n) prior from generate_series(0,21) n cross join lateral pos_sale_refund_targets((select id from sales where no_struk='SIX.CENTS'),n/100::numeric) t join sale_payments p on p.id=t.sale_payment_id) q),'every cumulative cent target is monotonic and capped');
set local role authenticated;
select pg_temp.refund('SIX.CENTS','six-cent-return-1',1);
select pg_temp.refund('SIX.CENTS','six-cent-return-2',1);
select pg_temp.assert_ok((select bool_and(refunded=amount) from(select p.id,p.amount,coalesce(sum(r.amount),0) refunded from sale_payments p left join sale_payment_refunds r on r.sale_payment_id=p.id where p.sale_id=(select id from sales where no_struk='SIX.CENTS') group by p.id) q),'six-method cent refunds exhaust original sources exactly');
-- Lost-response finalizer retries apply loyalty exactly once.
insert into customers(id,name,phone,points) values('e9900000-0000-4000-8000-000000000001','Loyalty test','000-split-loyalty',50);
set local role authenticated;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
insert into sales(id,branch_id,customer_id,no_struk,subtotal,discount,total,metode_bayar,bayar,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint,poin_earned,poin_digunakan) values('e7700000-0000-4000-8000-000000000090','e2200000-0000-4000-8000-000000000001','e9900000-0000-4000-8000-000000000001','POINTS.ATOMIC',120000,20000,100000,'Split',100000,auth.uid(),'e4400000-0000-4000-8000-000000000001','[{"method":"Tunai","amount":20000},{"method":"Transfer","amount":80000}]','points-key',repeat('a',64),100,20);
insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp) values('e7700000-0000-4000-8000-000000000090','e5500000-0000-4000-8000-000000000001','Points line',2,60000,'pcs',1,0);
select finalize_pos_sale('e7700000-0000-4000-8000-000000000090');
select finalize_pos_sale('e7700000-0000-4000-8000-000000000090');
select pg_temp.assert_ok((select points=130 from customers where id='e9900000-0000-4000-8000-000000000001'),'atomic loyalty counter, idempotent retry');
select pg_temp.assert_ok((select count(*)=2 and sum(delta)=80 and min(saldo)=30 and max(saldo)=130 from point_ledger where ref='POINTS.ATOMIC'),'redeem then earn ledger exactly once');
insert into sales(id,branch_id,customer_id,no_struk,subtotal,discount,total,metode_bayar,bayar,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint,poin_digunakan) values('e7700000-0000-4000-8000-000000000091','e2200000-0000-4000-8000-000000000001','e9900000-0000-4000-8000-000000000001','POINTS.INSUFFICIENT',120000,20000,100000,'Split',100000,auth.uid(),'e4400000-0000-4000-8000-000000000001','[{"method":"Tunai","amount":20000},{"method":"Transfer","amount":80000}]','points-insufficient-key',repeat('a',64),1000);
select pg_temp.lines('e7700000-0000-4000-8000-000000000091',120000);
select pg_temp.reject($q$select finalize_pos_sale('e7700000-0000-4000-8000-000000000091')$q$,'insufficient loyalty balance');
select pg_temp.assert_ok((select points=130 from customers where id='e9900000-0000-4000-8000-000000000001'),'failed loyalty debit does not change balance');
select pg_temp.assert_ok((select count(*)=0 from journal_entries where source_ref='POINTS.INSUFFICIENT'),'failed loyalty debit creates no money');
delete from sales where id='e7700000-0000-4000-8000-000000000091';
select pg_temp.sale('SINGLE.NEW','[{"method":"Transfer","amount":100000}]',method=>'Transfer');
select pg_temp.lines((select id from sales where no_struk='SINGLE.NEW'));
select finalize_pos_sale((select id from sales where no_struk='SINGLE.NEW'));
select pg_temp.assert_ok((select count(*)=1 from sale_payments where sale_id=(select id from sales where no_struk='SINGLE.NEW')),'new single allocation');
select pg_temp.sale('SINGLE.LEGACY',null,method=>'Tunai');
select pg_temp.assert_ok((select count(*)=0 from sale_payments where sale_id=(select id from sales where no_struk='SINGLE.LEGACY')),'legacy allocations unchanged');
select pg_temp.assert_ok((select count(*)=0 from journal_entries where source_ref='SINGLE.LEGACY'),'legacy JS posting unchanged');
-- Existing service-role cron/manual accounting remains writable for unrelated
-- journals, while a service API client still cannot rewrite protected POS money.
reset role;
set local role service_role;
insert into journal_entries(id,no_jurnal,tanggal,branch_id,source,source_ref,deskripsi)
 values('e8800000-0000-4000-8000-000000000001','SPLIT-SERVICE-LEGACY',(now() at time zone 'Asia/Jakarta')::date,'e2200000-0000-4000-8000-000000000001','depreciation','fictional-service-test','Fictional legacy service journal');
insert into journal_lines(entry_id,account_id,debit,credit) select 'e8800000-0000-4000-8000-000000000001',id,10,0 from coa_accounts where code='5101';
insert into journal_lines(entry_id,account_id,debit,credit) select 'e8800000-0000-4000-8000-000000000001',id,0,10 from coa_accounts where code='1301';
select pg_temp.assert_ok((select sum(debit)=10 and sum(credit)=10 from journal_lines where entry_id='e8800000-0000-4000-8000-000000000001'),'legacy service-role journal still posts');
select pg_temp.reject($q$update journal_entries set deskripsi='tampered' where source='sale' and source_ref='SPLIT.ACCEPT'$q$,'service API cannot rewrite protected POS');
delete from journal_entries where id='e8800000-0000-4000-8000-000000000001';
rollback;
