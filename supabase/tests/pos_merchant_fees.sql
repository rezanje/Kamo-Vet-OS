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

select pg_temp.assert_ok(exists(select 1 from information_schema.columns where table_schema='public' and table_name='sales' and column_name='merchant_fee_total'),'merchant fee header storage missing');
insert into coa_accounts(code,name,type,normal_balance,is_header) values('4303','Customer merchant fee','PENDAPATAN','K',false) on conflict(code) do update set is_active=true,is_header=false,type='PENDAPATAN',normal_balance='K';
insert into payment_account_map(metode,branch_id,cash_account_id) select m,'e2200000-0000-4000-8000-000000000001'::uuid,'e6600000-0000-4000-8000-000000000002'::uuid from unnest(array['Debit','Kredit','QRIS','E-Wallet']) m on conflict do nothing;
create function pg_temp.fee_sale(ref text,plan jsonb default '[{"method":"Tunai","amount":20000},{"method":"Debit","amount":81600,"fee_percent":2,"fee_amount":1600}]',fee numeric default 1600,goods numeric default 100000,gross numeric default 100000,method text default 'Split') returns uuid language plpgsql as $$declare doc uuid;begin
 insert into sales(branch_id,no_struk,subtotal,discount,total,merchant_fee_total,metode_bayar,bayar,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint) values('e2200000-0000-4000-8000-000000000001',ref,gross,gross-goods,goods+fee,fee,method,goods+fee,auth.uid(),'e4400000-0000-4000-8000-000000000001',plan,'fee:'||ref,repeat('f',64)) returning id into doc;return doc;end$$;
create function pg_temp.return_balance(ref text,code text) returns numeric language sql as $$select coalesce(sum(l.debit-l.credit),0) from sales_returns r join journal_entries e on e.source='sales-return' and e.source_ref=r.no_retur join journal_lines l on l.entry_id=e.id join coa_accounts a on a.id=l.account_id where r.sale_id=(select id from sales where no_struk=$1) and a.code=$2$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select pg_temp.fee_sale('FEE.SPLIT');
select pg_temp.assert_ok((select total=101600 and merchant_fee_total=1600 and subtotal=100000 and discount=0 from sales where no_struk='FEE.SPLIT'),'customer fee adds to merchandise bill');
select pg_temp.assert_ok((select sum(amount)=101600 and sum(fee_amount)=1600 and max(fee_percent)=2 and sum(amount-fee_amount)=100000 from sale_payments where sale_id=(select id from sales where no_struk='FEE.SPLIT')),'gross payment and fee snapshots');
select pg_temp.assert_ok((select count(*)=0 from journal_entries where source_ref='FEE.SPLIT'),'no money posted before finalization');
select pg_temp.reject($q$update sales set merchant_fee_total=0 where no_struk='FEE.SPLIT'$q$,'pending header fee immutable');
select pg_temp.reject($q$update sale_payments set fee_amount=0 where sale_id=(select id from sales where no_struk='FEE.SPLIT')$q$,'payment fee immutable');
select pg_temp.lines((select id from sales where no_struk='FEE.SPLIT'));
select finalize_pos_sale((select id from sales where no_struk='FEE.SPLIT'));
select finalize_pos_sale((select id from sales where no_struk='FEE.SPLIT'));
select pg_temp.assert_ok(pg_temp.balance('FEE.SPLIT','sale','1111')=20000 and pg_temp.balance('FEE.SPLIT','sale','1112')=81600 and pg_temp.balance('FEE.SPLIT','sale','4101')=-100000 and pg_temp.balance('FEE.SPLIT','sale','4303')=-1600,'gross cash bank, goods revenue and separate fee income once');
select pg_temp.fee_sale('FEE.SINGLE','[{"method":"Debit","amount":102000,"fee_percent":2,"fee_amount":2000}]',2000,method=>'Debit');
select pg_temp.lines((select id from sales where no_struk='FEE.SINGLE'),100000,40000,'e5500000-0000-4000-8000-000000000002');
select finalize_pos_sale((select id from sales where no_struk='FEE.SINGLE'));
select pg_temp.assert_ok(pg_temp.balance('FEE.SINGLE','sale','4303')=-2000 and pg_temp.balance('FEE.SINGLE','sale-hpp','5101')=40000,'single fee preserves HPP');
select pg_temp.fee_sale('FEE.SIX','[{"method":"Tunai","amount":1},{"method":"Transfer","amount":1.01,"fee_percent":1,"fee_amount":0.01},{"method":"Debit","amount":1.02,"fee_percent":2,"fee_amount":0.02},{"method":"Kredit","amount":1.03,"fee_percent":3,"fee_amount":0.03},{"method":"QRIS","amount":1.04,"fee_percent":4,"fee_amount":0.04},{"method":"E-Wallet","amount":1.05,"fee_percent":5,"fee_amount":0.05}]',0.15,6,6);
select pg_temp.lines((select id from sales where no_struk='FEE.SIX'),6);
select finalize_pos_sale((select id from sales where no_struk='FEE.SIX'));
select pg_temp.assert_ok(pg_temp.balance('FEE.SIX','sale','4303')=-0.15,'six methods independently assessed');
select pg_temp.reject($q$select pg_temp.fee_sale('BAD.CASH','[{"method":"Tunai","amount":101600,"fee_percent":1.6,"fee_amount":1600}]')$q$,'cash fees forbidden');
select pg_temp.reject($q$select pg_temp.fee_sale('BAD.CASHPCT','[{"method":"Tunai","amount":100000,"fee_percent":0.01}]',0)$q$,'cash nonzero rate forbidden even when round zero');
select pg_temp.reject($q$select pg_temp.fee_sale('BAD.FORMULA','[{"method":"Debit","amount":101600,"fee_percent":2,"fee_amount":1600}]')$q$,'fee uses base receipt less fee');
select pg_temp.reject($q$select pg_temp.fee_sale('BAD.HEADER',fee=>1601)$q$,'fee aggregate must match header');
select pg_temp.reject($q$select pg_temp.fee_sale('BAD.RATE','[{"method":"Debit","amount":101600,"fee_percent":100.01,"fee_amount":1600}]')$q$,'rate range');
select pg_temp.reject($q$select pg_temp.fee_sale('BAD.RATECENT','[{"method":"Debit","amount":101600,"fee_percent":2.001,"fee_amount":1600}]')$q$,'rate precision');
select pg_temp.reject($q$select pg_temp.fee_sale('BAD.RATENAN','[{"method":"Debit","amount":101600,"fee_percent":"NaN","fee_amount":1600}]')$q$,'rate number finite');
select pg_temp.reject($q$select pg_temp.fee_sale('BAD.FEECENT','[{"method":"Debit","amount":101600,"fee_percent":2,"fee_amount":1600.001}]')$q$,'fee precision');
select pg_temp.reject($q$select pg_temp.fee_sale('BAD.FEEZEROBASE','[{"method":"Debit","amount":1600,"fee_percent":100,"fee_amount":1600}]',1600,0,0)$q$,'base must be positive');
select pg_temp.reject($q$select pg_temp.fee_sale('BAD.FEENULL','[{"method":"Debit","amount":101600,"fee_percent":null,"fee_amount":1600}]')$q$,'explicit null fee invalid');
select pg_temp.reject($q$select pg_temp.fee_sale('BAD.NOPLAN',null)$q$,'legacy cannot claim fee');
reset role;
update coa_accounts set is_active=false where code='4303';
set local role authenticated;
select pg_temp.reject($q$select pg_temp.fee_sale('BAD.ACCOUNT')$q$,'missing active fee income before line stage');
select pg_temp.fee_sale('FEE.ZERO','[{"method":"Debit","amount":1,"fee_percent":0.01,"fee_amount":0}]',0,1,1,'Debit');
select pg_temp.lines((select id from sales where no_struk='FEE.ZERO'),1);
select finalize_pos_sale((select id from sales where no_struk='FEE.ZERO'));
select pg_temp.assert_ok((select fee_percent=0.01 and fee_amount=0 from sale_payments where sale_id=(select id from sales where no_struk='FEE.ZERO')),'positive rate rounding to zero remains valid without fee account');
reset role;
update coa_accounts set is_active=true,type='ASET' where code='4303';
set local role authenticated;
select pg_temp.reject($q$select pg_temp.fee_sale('BAD.ACCOUNTTYPE')$q$,'fee account requires income normal credit');
reset role;
update coa_accounts set type='ASET',normal_balance='D' where code='4303';
set local role authenticated;
select pg_temp.reject($q$select pg_temp.fee_sale('BAD.ACCOUNTNORMAL')$q$,'fee account normal credit');
reset role;
update coa_accounts set type='PENDAPATAN',normal_balance='K' where code='4303';
update company_settings set mode_pkp=true,ppn_rate=11;
set local role authenticated;
select pg_temp.fee_sale('FEE.TAX',goods=>100000,gross=>111000);
select pg_temp.lines((select id from sales where no_struk='FEE.TAX'),111000);
select finalize_pos_sale((select id from sales where no_struk='FEE.TAX'));
select pg_temp.assert_ok(pg_temp.balance('FEE.TAX','sale','4101')=-100000 and pg_temp.balance('FEE.TAX','sale','4102')=9909.91 and pg_temp.balance('FEE.TAX','sale','2201')=-9909.91 and pg_temp.balance('FEE.TAX','sale','4303')=-1600,'fee excluded from embedded merchandise tax and discount');
select pg_temp.fee_sale('FEE.FROZEN');
select pg_temp.lines((select id from sales where no_struk='FEE.FROZEN'));
reset role;
update company_settings set mode_pkp=false,ppn_rate=12;
update payment_account_map set cash_account_id='e6600000-0000-4000-8000-000000000004' where metode='Debit' and branch_id='e2200000-0000-4000-8000-000000000001';
set local role authenticated;
select finalize_pos_sale((select id from sales where no_struk='FEE.FROZEN'));
select pg_temp.assert_ok(pg_temp.balance('FEE.FROZEN','sale','1112')=81600 and pg_temp.balance('FEE.FROZEN','sale','1114')=0 and pg_temp.balance('FEE.FROZEN','sale','2201')=-9909.91 and pg_temp.balance('FEE.FROZEN','sale','4303')=-1600,'header freezes original mapping tax and fee before finalization');
select pg_temp.refund('FEE.SPLIT','fee-half',1);
select pg_temp.assert_ok(pg_temp.return_balance('FEE.SPLIT','4303')=800 and pg_temp.return_balance('FEE.SPLIT','4101')=50000 and pg_temp.return_balance('FEE.SPLIT','1111')=-10000 and pg_temp.return_balance('FEE.SPLIT','1112')=-40800,'half refund separates original fee and gross payment snapshots: '||jsonb_build_object('fee',pg_temp.return_balance('FEE.SPLIT','4303'),'goods',pg_temp.return_balance('FEE.SPLIT','4101'),'cash',pg_temp.return_balance('FEE.SPLIT','1111'),'bank',pg_temp.return_balance('FEE.SPLIT','1112'))::text);
select pg_temp.refund('FEE.SPLIT','fee-half',1);
select pg_temp.assert_ok(pg_temp.return_balance('FEE.SPLIT','4303')=800,'repeated return key reverses fee once');
select pg_temp.refund('FEE.SPLIT','fee-rest',1);
select pg_temp.assert_ok(pg_temp.return_balance('FEE.SPLIT','4303')=1600 and pg_temp.return_balance('FEE.SPLIT','4101')=100000,'full refund exhausts original fee');
select pg_temp.refund('FEE.TAX','fee-tax-full',2);
select pg_temp.assert_ok(pg_temp.return_balance('FEE.TAX','4303')=1600 and pg_temp.return_balance('FEE.TAX','2201')=9909.91 and pg_temp.return_balance('FEE.TAX','4102')=-9909.91,'tax setting changes preserve source fee VAT discount');
select pg_temp.refund('FEE.SIX','fee-cent-a',1);
select pg_temp.assert_ok(pg_temp.return_balance('FEE.SIX','4303')=0.08,'cumulative half-cent fee rounds positive');
select pg_temp.refund('FEE.SIX','fee-cent-b',1);
select pg_temp.assert_ok(pg_temp.return_balance('FEE.SIX','4303')=0.15,'cumulative cent refunds exhaust fee');
select pg_temp.assert_ok((select bool_and(refunded=amount) from(select p.id,p.amount,coalesce(sum(r.amount),0) refunded from sale_payments p left join sale_payment_refunds r on r.sale_payment_id=p.id where p.sale_id=(select id from sales where no_struk='FEE.SIX') group by p.id) q),'fee cents exhaust every gross payment');
select pg_temp.assert_ok((select count(*)=0 from sales where no_struk like 'BAD.%'),'invalid fee inserts rolled back entirely');

-- Two independently rounded half-cent fee/VAT components must never consume
-- more than a one-cent refund; cumulative allocation exhausts both at the end.
reset role;
update company_settings set mode_pkp=true,ppn_rate=100;
set local role authenticated;
select pg_temp.fee_sale('FEE.TINYVAT','[{"method":"Debit","amount":0.06,"fee_percent":50,"fee_amount":0.02}]',0.02,0.04,0.04,'Debit');
insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp) select id,'e5500000-0000-4000-8000-000000000001','Tiny fee VAT',6,0.04/6,'pcs',1,0 from sales where no_struk='FEE.TINYVAT';
select finalize_pos_sale((select id from sales where no_struk='FEE.TINYVAT'));
select pg_temp.refund('FEE.TINYVAT','tiny-fee-'||n,1) from generate_series(1,6) n;
select pg_temp.assert_ok(pg_temp.return_balance('FEE.TINYVAT','4303')=0.02 and pg_temp.return_balance('FEE.TINYVAT','2201')=0.02 and pg_temp.return_balance('FEE.TINYVAT','4101')=0.02,'one-cent fee VAT refunds remain balanced and exhaust original income');
-- Finalization rolls fee/HPP/loyalty and the seal back together on late failure.
reset role;
update company_settings set mode_pkp=false,ppn_rate=11;
insert into customers(id,name,phone,points) values('e9900000-0000-4000-8000-000000000002','Fee loyalty test','000-fee-loyalty',50);
set local role authenticated;
insert into sales(id,branch_id,customer_id,no_struk,subtotal,total,merchant_fee_total,metode_bayar,bayar,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint,poin_earned,poin_digunakan) values('e7700000-0000-4000-8000-000000000092','e2200000-0000-4000-8000-000000000001','e9900000-0000-4000-8000-000000000002','FEE.POINTS',100000,102000,2000,'Debit',102000,auth.uid(),'e4400000-0000-4000-8000-000000000001','[{"method":"Debit","amount":102000,"fee_percent":2,"fee_amount":2000}]','fee-points-key',repeat('a',64),100,20);
select pg_temp.lines('e7700000-0000-4000-8000-000000000092',100000,40000,'e5500000-0000-4000-8000-000000000002');
reset role;
update coa_accounts set is_active=false where code='4303';
set local role authenticated;
select pg_temp.reject($q$select finalize_pos_sale('e7700000-0000-4000-8000-000000000092')$q$,'late fee account failure rolls finalization back');
select pg_temp.assert_ok((select points=50 from customers where id='e9900000-0000-4000-8000-000000000002'),'failed fee journal rolls loyalty back');
select pg_temp.assert_ok((select count(*)=0 from journal_entries where source_ref='FEE.POINTS'),'failed fee journal leaves no money or HPP');
select pg_temp.assert_ok((select payments_finalized_at is null from sales where no_struk='FEE.POINTS'),'failed fee journal leaves sale pending');
reset role;
update coa_accounts set is_active=true where code='4303';
set local role authenticated;
select finalize_pos_sale('e7700000-0000-4000-8000-000000000092');
select finalize_pos_sale('e7700000-0000-4000-8000-000000000092');
select pg_temp.assert_ok((select points=130 from customers where id='e9900000-0000-4000-8000-000000000002'),'fee loyalty earns merchandise amount once');
select pg_temp.assert_ok((select count(*)=2 and sum(delta)=80 from point_ledger where ref='FEE.POINTS'),'fee loyalty ledger once');
select pg_temp.assert_ok(pg_temp.balance('FEE.POINTS','sale','4303')=-2000 and pg_temp.balance('FEE.POINTS','sale-hpp','5101')=40000,'fee money and HPP once');
-- A later linked WA order must not put fee income or pending POS plans back
-- into the customer's merchandise spending and tier qualification.
reset role;
insert into warehouses(id,branch_id,code,name,type) values('e3300000-0000-4000-8000-000000000002','e2200000-0000-4000-8000-000000000001','FEEONLINE','Fee online test','ONLINE');
insert into role_modules(role,module_id) values('STAFF','penjualan') on conflict do nothing;
update tier_settings set bronze_min=102000 where id=1;
set local role authenticated;
insert into sales(branch_id,customer_id,no_struk,subtotal,total,merchant_fee_total,metode_bayar,bayar,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint) values('e2200000-0000-4000-8000-000000000001','e9900000-0000-4000-8000-000000000002','FEE.PENDING.TIER',100000,102000,2000,'Debit',102000,auth.uid(),'e4400000-0000-4000-8000-000000000001','[{"method":"Debit","amount":102000,"fee_percent":2,"fee_amount":2000}]','fee-pending-tier',repeat('b',64));
insert into sales(branch_id,customer_id,no_struk,subtotal,total,metode_bayar,bayar,cashier_id) values('e2200000-0000-4000-8000-000000000001','e9900000-0000-4000-8000-000000000002','FEE.LEGACY.TIER',50,50,'Tunai',50,auth.uid());
select post_online_order('fee-wa-tier',jsonb_build_object('warehouse_id','e3300000-0000-4000-8000-000000000002','channel','WA','customer_id','e9900000-0000-4000-8000-000000000002','tanggal',(now() at time zone 'Asia/Jakarta')::date),jsonb_build_array(jsonb_build_object('item_id','e5500000-0000-4000-8000-000000000001','qty',1,'harga',1000,'satuan','pcs')));
select pg_temp.assert_ok((select total_spending=101050 and tier='New' and points=131 from customers where id='e9900000-0000-4000-8000-000000000002'),'linked WA tier includes finalized merchandise and legacy, excludes merchant fees and pending POS');
reset role;
select pg_temp.assert_ok(has_function_privilege('authenticated','public.pos_sale_journal_protected(uuid)','EXECUTE') and has_function_privilege('service_role','public.pos_sale_journal_protected(uuid)','EXECUTE'),'existing journal trigger helper grants retained');
select pg_temp.assert_ok(has_function_privilege('authenticated','public.finalize_pos_sale(uuid)','EXECUTE') and not has_function_privilege('service_role','public.finalize_pos_sale(uuid)','EXECUTE'),'finalizer ACL retained');
select pg_temp.assert_ok(not has_function_privilege('authenticated','public.pos_sale_post_refund(public.sales,uuid,text,date,numeric)','EXECUTE') and not has_function_privilege('service_role','public.pos_sale_record_payments()','EXECUTE'),'private fee staging and refund ACL retained');
rollback;
