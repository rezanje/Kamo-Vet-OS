-- Fictional committed fixtures only, run by the owned disposable DB runner.
create function public.wholesale_test_assert(ok boolean,message text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'ASSERT: %',message;end if;
end$$;
set role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',false);
select sales_create_delivery('f6000000-0000-4000-8000-000000000001','wholesale-delivery',jsonb_build_object('tanggal',current_date),
 '[{"order_item_id":"f7000000-0000-4000-8000-000000000001","qty":1}]');
select sales_create_invoice('f6000000-0000-4000-8000-000000000001','wholesale-invoice',jsonb_build_object('tanggal',current_date,'jatuh_tempo',current_date+30),
 '[{"order_item_id":"f7000000-0000-4000-8000-000000000001","qty":1}]');
do $$declare inv uuid; line uuid; r jsonb; payload jsonb; begin
 select id into inv from sales_invoices where order_id='f6000000-0000-4000-8000-000000000001';
 select id into line from sales_invoice_items where invoice_id=inv;
 payload:=jsonb_build_object('tanggal',current_date,'jatuh_tempo',current_date+20,'items',jsonb_build_array(jsonb_build_object('id',line,'harga',100)));
 r:=correct_wholesale_invoice(inv,0,'wholesale-unpaid','replace','Harga salah catat',payload);
 perform wholesale_test_assert(r->>'replacement_id' is not null,'linked replacement missing');
 perform wholesale_test_assert((select total=111 and carried_paid=0 from sales_invoices where id=(r->>'replacement_id')::uuid),'unpaid amount');
 perform wholesale_test_assert((select status='batal' and total=122 from sales_invoices where id=inv),'original invoice retained');
 perform wholesale_test_assert(correct_wholesale_invoice(inv,0,'wholesale-unpaid','replace','Harga salah catat',payload)=r,'identical retry');
 perform wholesale_test_assert((select qty=18 from stock where warehouse_id='f3000000-0000-4000-8000-000000000001'),'invoice correction changed physical stock');
 perform wholesale_test_assert((select qty_kirim=1 and qty_faktur=1 from sales_order_items where id='f7000000-0000-4000-8000-000000000001'),'counters');
end$$;
reset role;
create table public.wholesale_test_state(name text primary key, invoice_id uuid, line_id uuid);
grant select on public.wholesale_test_state to authenticated;
insert into wholesale_test_state select 'active',replacement_id,(select id from sales_invoice_items where invoice_id=c.replacement_id) from wholesale_invoice_corrections c;
create function public.wholesale_test_snapshot() returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('invoices',(select jsonb_agg(to_jsonb(t) order by id) from public.sales_invoices t),
 'lines',(select jsonb_agg(to_jsonb(t) order by id) from public.sales_invoice_items t),
 'allocations',(select jsonb_agg(to_jsonb(t) order by invoice_item_id,delivery_item_id) from public.sales_invoice_delivery_allocations t),
 'receipts',(select jsonb_agg(to_jsonb(t) order by id) from public.sales_receipts t),
 'advances',(select jsonb_agg(to_jsonb(t) order by id) from public.sales_advances t),
 'orders',(select jsonb_agg(to_jsonb(t) order by id) from public.sales_orders t),
 'order_lines',(select jsonb_agg(to_jsonb(t) order by id) from public.sales_order_items t),
 'journal',(select jsonb_agg(to_jsonb(t) order by id) from public.journal_entries t),
 'journal_lines',(select jsonb_agg(to_jsonb(t) order by id) from public.journal_lines t),
 'stock',(select jsonb_agg(to_jsonb(t) order by warehouse_id,item_id) from public.stock t),
 'layers',(select jsonb_agg(to_jsonb(t) order by id) from public.stock_layers t),
 'moves',(select jsonb_agg(to_jsonb(t) order by id) from public.stock_moves t),
 'audit',(select jsonb_agg(to_jsonb(t) order by id) from public.wholesale_invoice_corrections t),
 'epochs',(select jsonb_agg(to_jsonb(t) order by periode) from public.wholesale_payroll_epochs t),
 'requests',(select jsonb_agg(to_jsonb(t) order by actor_id,kind,request_key) from public.wholesale_operation_requests t));
$$;
create function public.wholesale_test_reject(statement text,expected text) returns void language plpgsql as $$
declare before jsonb:=public.wholesale_test_snapshot();begin
 begin execute statement;raise exception 'UNEXPECTED ACCEPT: %',statement;
 exception when others then
  if sqlerrm like 'UNEXPECTED ACCEPT:%' or position(expected in sqlerrm)=0 then raise;end if;
 end;
 perform public.wholesale_test_assert(before=public.wholesale_test_snapshot(),'rejection leaked partial data: '||statement);
end$$;
set role authenticated;
-- Receipt retry and conflicting/stale writes; all effects rollback together.
do $$declare inv uuid;line uuid; r jsonb;again jsonb;payload jsonb;begin
 select invoice_id,line_id into inv,line from wholesale_test_state where name='active';
 r:=receive_wholesale_payment('part-pay',inv,current_date,40,'Transfer',null,null,null);
 again:=receive_wholesale_payment('part-pay',inv,current_date,40,'Transfer',null,null,null);
 perform wholesale_test_assert(r=again and r->>'journal_id' is not null,'receipt retry');
 perform wholesale_test_assert(get_wholesale_operation(inv,'receipt','part-pay')=r,'receipt lost response recovery');
 perform wholesale_test_reject(format('select receive_wholesale_payment(%L,%L,current_date,41,''Transfer'',null,null,null)','part-pay',inv),'rincian berbeda');
 payload:=jsonb_build_object('tanggal',current_date,'jatuh_tempo',current_date+20,'items',jsonb_build_array(jsonb_build_object('id',line,'harga',80)));
 perform wholesale_test_reject(format('select correct_wholesale_invoice(%L,0,''stale'',''replace'',''Harga dikoreksi'',%L)',inv,payload),'sudah berubah');
 r:=correct_wholesale_invoice(inv,1,'part-paid-correct','replace','Harga dikoreksi',payload);
 inv:=(r->>'replacement_id')::uuid;
 perform wholesale_test_assert((select total=89 and carried_paid=40 and status='berjalan' from sales_invoices where id=inv),'part-paid carried balance');
 perform wholesale_test_assert((select count(*)=1 and sum(jumlah)=40 from sales_receipts),'original receipt preserved exactly');
 perform wholesale_test_assert((select sum(l.debit-l.credit)=49 from journal_lines l join coa_accounts a on a.id=l.account_id where a.code='1201'),'AR ledger after part-paid replacement');
 perform receive_wholesale_payment('part-pay-again',inv,current_date,35,'Transfer',null,null,null);
 select id into line from sales_invoice_items where invoice_id=inv;
 payload:=jsonb_build_object('tanggal',current_date,'jatuh_tempo',current_date+20,'items',jsonb_build_array(jsonb_build_object('id',line,'harga',50)));
 r:=correct_wholesale_invoice(inv,1,'overpaid-correct','replace','Harga turun ke nilai benar',payload);
 inv:=(r->>'replacement_id')::uuid;
 perform wholesale_test_assert((r->>'customer_credit')::numeric=19,'overpayment credit');
 perform wholesale_test_assert((select total=56 and carried_paid=56 and status='lunas' from sales_invoices where id=inv),'fully paid replacement');
 perform wholesale_test_assert((select sum(l.debit-l.credit)=0 from journal_lines l join coa_accounts a on a.id=l.account_id where a.code='1201'),'AR not negative after credit');
 perform wholesale_test_assert((select sum(l.credit-l.debit)=19 from journal_lines l join coa_accounts a on a.id=l.account_id where a.code='2103'),'credit liability 19');
 perform wholesale_test_assert((select sum(l.debit-l.credit)=75 from journal_lines l join coa_accounts a on a.id=l.account_id where a.code='1102'),'cash retained 75');
 perform wholesale_test_reject(format('select receive_wholesale_payment(''already-paid'',%L,current_date,1,''Transfer'',null,null,null)',inv),'melebihi sisa');
 r:=correct_wholesale_invoice(inv,0,'cancel-with-paid','cancel','Tagihan tercatat ganda',jsonb_build_object('tanggal',current_date));
 perform wholesale_test_assert((r->>'customer_credit')::numeric=56,'cancellation preserves paid credit');
 perform wholesale_test_assert((select count(*)=2 and sum(jumlah)=75 from sales_receipts),'all original payments retained');
 perform wholesale_test_assert((select sum(customer_credit)=75 from wholesale_invoice_corrections),'credits total match cash');
 perform wholesale_test_assert((select qty_kirim=1 and qty_faktur=0 from sales_order_items where id='f7000000-0000-4000-8000-000000000001'),'cancel opens billing only');
 perform wholesale_test_assert((select sum(l.debit-l.credit)=0 from journal_lines l join coa_accounts a on a.id=l.account_id where a.code='1201'),'cancelled AR zero');
 perform wholesale_test_reject(format('select receive_wholesale_payment(''cancelled'',%L,current_date,1,''Transfer'',null,null,null)',inv),'dibatalkan');
end$$;
-- Retained cancelled allocations must not block legitimate re-invoicing.
select sales_create_invoice('f6000000-0000-4000-8000-000000000001','rebill',jsonb_build_object('tanggal',current_date,'jatuh_tempo',current_date+30),
 '[{"order_item_id":"f7000000-0000-4000-8000-000000000001","qty":1}]');
select wholesale_test_assert((select sum(hpp)=26 from sales_invoice_items ii join sales_invoices si on si.id=ii.invoice_id where si.status<>'batal'),'active rebill HPP does not duplicate historical allocation');
select wholesale_test_assert((select qty=18 from stock where warehouse_id='f3000000-0000-4000-8000-000000000001'),'all corrections left physical stock unchanged');
select wholesale_test_assert((select sum(qty_left)=18 from stock_layers where warehouse_id='f3000000-0000-4000-8000-000000000001'),'no fictitious FIFO replenishment');
select wholesale_test_assert((select count(*)=1 from stock_moves where source='sales-delivery'),'no invoice stock movement');
reset role;
update wholesale_test_state set invoice_id=si.id,line_id=ii.id from sales_invoices si join sales_invoice_items ii on ii.invoice_id=si.id where si.status<>'batal';
-- Force final durable-result failure after reversal, credit, audit and counters.
create function public.wholesale_fail_final_write() returns trigger language plpgsql as $$begin raise exception 'forced final request failure';end$$;
create trigger wholesale_injected_failure before insert on wholesale_operation_requests for each row execute function wholesale_fail_final_write();
set role authenticated;
select wholesale_test_reject(format('select correct_wholesale_invoice(%L,0,''atomic-failure'',''cancel'',''Salah pencatatan'',jsonb_build_object(''tanggal'',current_date))',invoice_id),'forced final request failure') from wholesale_test_state;
select wholesale_test_reject(format('select receive_wholesale_payment(''atomic-receipt-failure'',%L,current_date,10,''Transfer'',null,null,null)',invoice_id),'forced final request failure') from wholesale_test_state;
reset role;
drop trigger wholesale_injected_failure on wholesale_operation_requests;
-- Dependencies and closed periods fail closed with no leaked reversal.
update accounting_locks set closed_until=current_date;
set role authenticated;
select wholesale_test_reject(format('select correct_wholesale_invoice(%L,0,''period'',''cancel'',''Salah pencatatan'',jsonb_build_object(''tanggal'',current_date))',invoice_id),'ditutup') from wholesale_test_state;
reset role;
update accounting_locks set closed_until=null;
-- A malformed legacy delivery counter cannot be used as physical stock evidence.
update sales_order_items set qty_kirim=2 where id='f7000000-0000-4000-8000-000000000001';
set role authenticated;
select wholesale_test_reject(format('select correct_wholesale_invoice(%L,0,''delivery-dependency'',''cancel'',''Salah pencatatan'',jsonb_build_object(''tanggal'',current_date))',invoice_id),'pengiriman fisik') from wholesale_test_state;
reset role;
update sales_order_items set qty_kirim=1 where id='f7000000-0000-4000-8000-000000000001';
-- Never silently accept a qty change through a price correction payload.
set role authenticated;
select wholesale_test_reject(format('select correct_wholesale_invoice(%L,0,''qty-change'',''replace'',''Qty salah'',%L)',invoice_id,jsonb_build_object('tanggal',current_date,'jatuh_tempo',current_date+1,'items',jsonb_build_array(jsonb_build_object('id',line_id,'harga',100,'qty',0.5)))),'retur fisik') from wholesale_test_state;
-- Database grants/guards, including attempts to mutate original money and journal.
select wholesale_test_reject('update sales_receipts set jumlah=1','permission denied');
select wholesale_test_reject('delete from sales_receipts','permission denied');
select wholesale_test_reject('update sales_invoices set carried_paid=999 where status<>''batal''','Dokumen grosir terlindungi');
select wholesale_test_reject('update sales_order_items set qty_kirim=0','Dokumen grosir terlindungi');
select wholesale_test_reject('update journal_lines set debit=1 where entry_id=(select id from journal_entries where source=''sales-invoice'' limit 1)','Jurnal grosir');
select wholesale_test_assert(not has_function_privilege('anon','public.correct_wholesale_invoice(uuid,integer,text,text,text,jsonb)','EXECUTE'),'anonymous correction grant');
select wholesale_test_assert(not has_function_privilege('authenticated','public.wholesale_access(uuid,boolean)','EXECUTE'),'private helper grant');
select wholesale_test_assert(not has_table_privilege('authenticated','public.wholesale_operation_requests','SELECT'),'private requests exposed');
-- Non-OWNER despite sales access cannot correct.
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000002',false);
select wholesale_test_reject(format('select correct_wholesale_invoice(%L,0,''doctor-denied'',''cancel'',''Salah pencatatan'',jsonb_build_object(''tanggal'',current_date))',invoice_id),'OWNER') from wholesale_test_state;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',false);
-- Payroll is read as a downstream dependency only. No payroll business logic changed.
reset role;
insert into employees(id,nik,nama) values('fb000000-0000-4000-8000-000000000001','B2B-FICTION','Fictional commission employee');
insert into payrolls(employee_id,periode,wholesale_source_epoch) values('fb000000-0000-4000-8000-000000000001',to_char(current_date,'YYYY-MM'),(select epoch from wholesale_payroll_epochs where periode=to_char(current_date,'YYYY-MM')));
set role authenticated;
select wholesale_test_reject(format('select correct_wholesale_invoice(%L,0,''payroll-dependency'',''cancel'',''Salah pencatatan'',jsonb_build_object(''tanggal'',current_date))',invoice_id),'Penggajian') from wholesale_test_state;
reset role;
delete from payrolls where employee_id='fb000000-0000-4000-8000-000000000001';
-- Receipt-backed legacy accounting: tampering fails closed without inference.
set role authenticated;
select receive_wholesale_payment('dependency-payment',invoice_id,current_date,5,'Transfer',null,null,null) from wholesale_test_state;
reset role;
update journal_lines set debit=debit+1 where entry_id=(select journal_id from sales_receipts where no_terima=(select result->>'document_no' from wholesale_operation_requests where request_key='dependency-payment')) and debit>0;
set role authenticated;
select wholesale_test_reject(format('select correct_wholesale_invoice(%L,1,''bad-source-journal'',''cancel'',''Salah pencatatan'',jsonb_build_object(''tanggal'',current_date))',invoice_id),'nilai jurnal') from wholesale_test_state;
reset role;
update journal_lines set debit=debit-1 where entry_id=(select journal_id from sales_receipts where no_terima=(select result->>'document_no' from wholesale_operation_requests where request_key='dependency-payment')) and debit>0;
insert into bank_reconciliations(tanggal,cash_account_id,bank_coa_code) values(current_date,(select id from cash_accounts where coa_code='1102'),'1102');
set role authenticated;
select wholesale_test_reject(format('select correct_wholesale_invoice(%L,1,''bank-dependency'',''cancel'',''Salah pencatatan'',jsonb_build_object(''tanggal'',current_date))',invoice_id),'direkonsiliasi bank') from wholesale_test_state;
select wholesale_test_reject(format('select receive_wholesale_payment(''frozen-bank-date'',%L,current_date,1,''Transfer'',null,null,null)',invoice_id),'membekukan') from wholesale_test_state;
reset role;
delete from bank_reconciliations;
create trigger wholesale_injected_failure before insert on wholesale_operation_requests for each row execute function wholesale_fail_final_write();
set role authenticated;
select wholesale_test_reject(format('select correct_wholesale_invoice(%L,1,''atomic-credit-failure'',''cancel'',''Salah pencatatan'',jsonb_build_object(''tanggal'',current_date))',invoice_id),'forced final request failure') from wholesale_test_state;
reset role;
drop trigger wholesale_injected_failure on wholesale_operation_requests;
-- Advance is consumed atomically but standalone advance creation/correction is outside this work.
insert into sales_advances(id,no_um,customer_id,order_id,tanggal,jumlah) values
 ('fb100000-0000-4000-8000-000000000001','UJ.B2B.TEST','f4000000-0000-4000-8000-000000000001','f6000000-0000-4000-8000-000000000001',current_date,20);
set role authenticated;
select wholesale_test_reject(format('select receive_wholesale_payment(''unproved-advance'',%L,current_date,10,''Transfer'',null,''fb100000-0000-4000-8000-000000000001'',null)',invoice_id),'Jurnal uang muka belum lengkap') from wholesale_test_state;
reset role;
select sales_write_journal(current_date,'f2000000-0000-4000-8000-000000000001','sales-advance','UJ.B2B.TEST','Fiction advance deposit','[{"code":"1102","debit":20,"credit":0},{"code":"2103","debit":0,"credit":20}]');
set role authenticated;
select receive_wholesale_payment('advance-payment',invoice_id,current_date,10,'Transfer',null,'fb100000-0000-4000-8000-000000000001',null) from wholesale_test_state;
select wholesale_test_assert((select terpakai=10 from sales_advances where id='fb100000-0000-4000-8000-000000000001'),'advance allocation');
select wholesale_test_reject('update sales_advances set terpakai=0 where id=''fb100000-0000-4000-8000-000000000001''','hanya melalui');
select wholesale_test_reject('delete from stock_moves where source=''sales-delivery''','Mutasi pengiriman grosir');
-- A used advance, including its usage counter, cannot leak on a final-step failure.
reset role;
create trigger wholesale_injected_failure before insert on wholesale_operation_requests for each row execute function wholesale_fail_final_write();
set role authenticated;
select wholesale_test_reject(format('select receive_wholesale_payment(''advance-failure'',%L,current_date,5,''Transfer'',null,''fb100000-0000-4000-8000-000000000001'',null)',invoice_id),'forced final request failure') from wholesale_test_state;
select wholesale_test_assert((select terpakai=10 from sales_advances where id='fb100000-0000-4000-8000-000000000001'),'advance counter rollback');
reset role;
drop trigger wholesale_injected_failure on wholesale_operation_requests;
-- Consuming an already physically issued item elsewhere cannot create stock here.
-- This is an ordinary stock adjustment in test fixtures, never an invoice reversal.
update stock set qty=qty-1 where warehouse_id='f3000000-0000-4000-8000-000000000001' and item_id='f5000000-0000-4000-8000-000000000001';
update stock_layers set qty_left=qty_left-1 where id=(select id from stock_layers where warehouse_id='f3000000-0000-4000-8000-000000000001' and qty_left>0 order by id limit 1);
set role authenticated;
do $$declare inv uuid;line uuid;r jsonb;begin
 select invoice_id,line_id into inv,line from wholesale_test_state;
 r:=correct_wholesale_invoice(inv,2,'consumed-stock-price-only','replace','Harga saja; barang telah keluar',jsonb_build_object('tanggal',current_date,'jatuh_tempo',current_date+20,'items',jsonb_build_array(jsonb_build_object('id',line,'harga',100))));
 perform wholesale_test_assert((select qty=17 from stock where warehouse_id='f3000000-0000-4000-8000-000000000001'),'price correction invented stock after physical consumption');
 perform wholesale_test_assert((select sum(qty_left)=17 from stock_layers where warehouse_id='f3000000-0000-4000-8000-000000000001'),'price correction invented layers');
end$$;

reset role;
update wholesale_test_state set invoice_id=si.id,line_id=ii.id from sales_invoices si join sales_invoice_items ii on ii.invoice_id=si.id where si.status<>'batal';
insert into bank_reconciliations(tanggal,cash_account_id,bank_coa_code) values(current_date,(select id from cash_accounts where coa_code='1102'),'1102');
set role authenticated;
select wholesale_test_reject(format('select correct_wholesale_invoice(%L,0,''ancestor-bank-dependency'',''cancel'',''Salah pencatatan'',jsonb_build_object(''tanggal'',current_date))',invoice_id),'direkonsiliasi bank') from wholesale_test_state;
reset role;
delete from bank_reconciliations;
-- Payroll calculations that captured epoch0 before these corrections cannot commit.
set role authenticated;
select wholesale_test_assert(get_wholesale_payroll_epoch('2000-01')=0,'missing payroll epoch is zero');
select wholesale_test_reject(format('insert into payrolls(employee_id,periode,wholesale_source_epoch) values(''fb000000-0000-4000-8000-000000000001'',%L,0)',to_char(current_date,'YYYY-MM')),'Sumber komisi grosir berubah');
select wholesale_test_reject('update journal_lines set debit=0 where entry_id=(select id from journal_entries where source=''sales-advance'' and source_ref=''UJ.B2B.TEST'')','Jurnal grosir');
select wholesale_test_reject('update sales_advances set no_um=''UJ.RENAMED'' where id=''fb100000-0000-4000-8000-000000000001''','hanya melalui');
select wholesale_test_reject('update sales_advances set tanggal=tanggal-1 where id=''fb100000-0000-4000-8000-000000000001''','hanya melalui');
-- Legacy advance-funded receipts with valid receipt journals still require funding proof.
reset role;
begin;
insert into sales_advances(id,no_um,customer_id,order_id,tanggal,jumlah,terpakai) values('fb400000-0000-4000-8000-000000000001','UJ.LEGACY.UNPROVED','f4000000-0000-4000-8000-000000000001','f6000000-0000-4000-8000-000000000001',current_date,20,10);
update sales_receipts set advance_id='fb400000-0000-4000-8000-000000000001',journal_id=null where advance_id='fb100000-0000-4000-8000-000000000001';
set local role authenticated;
select wholesale_test_reject(format('select correct_wholesale_invoice(%L,0,''legacy-advance-proof'',''cancel'',''Salah pencatatan'',jsonb_build_object(''tanggal'',current_date))',invoice_id),'pendanaan uang muka penerimaan lama') from wholesale_test_state;
rollback;
-- J01 (28 Okt 2026): FINANCE may correct a paid B2B invoice; receipts stay. ADMIN/STAFF/DOCTOR still cannot.
-- FINANCE still needs the Penjualan module (Akses Grup), exactly like wholesale receipts today.
reset role;
begin;
alter table profiles disable trigger guard_profile_privileges;
update profiles set role='FINANCE' where id='f1000000-0000-4000-8000-000000000002';
alter table profiles enable trigger guard_profile_privileges;
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000002',true);
select wholesale_test_reject(format('select correct_wholesale_invoice(%L,%s,''j01-finance-no-module'',''cancel'',''Salah pencatatan'',jsonb_build_object(''tanggal'',current_date))',s.invoice_id,si.revision),'tidak dapat diakses')
 from wholesale_test_state s join sales_invoices si on si.id=s.invoice_id;
reset role;
insert into role_modules(role,module_id) values('FINANCE','penjualan');
set local role authenticated;
do $$declare inv uuid;line uuid;rev int;paid numeric;receipts jsonb;r jsonb;begin
 select invoice_id,line_id into inv,line from wholesale_test_state;
 select revision,coalesce(carried_paid,0)+coalesce((select sum(jumlah) from sales_receipts where invoice_id=inv),0) into rev,paid from sales_invoices where id=inv;
 select jsonb_agg(to_jsonb(t) order by id) into receipts from sales_receipts t;
 perform wholesale_test_assert(paid>0,'J01 fixture invoice must already be (partly) paid');
 r:=correct_wholesale_invoice(inv,rev,'j01-finance','replace','Harga dikoreksi oleh finance',
  jsonb_build_object('tanggal',current_date,'jatuh_tempo',current_date+20,'items',jsonb_build_array(jsonb_build_object('id',line,'harga',95))));
 perform wholesale_test_assert((select created_by='f1000000-0000-4000-8000-000000000002' and paid_preserved=paid from wholesale_invoice_corrections where id=(r->>'correction_id')::uuid),'J01 finance correction audited with paid amount preserved');
 perform wholesale_test_assert((select jsonb_agg(to_jsonb(t) order by id) from sales_receipts t)=receipts,'J01 receipts unchanged');
 perform wholesale_test_assert((select carried_paid=paid and harga=95 from sales_invoices si join sales_invoice_items ii on ii.invoice_id=si.id where si.id=(r->>'replacement_id')::uuid),'J01 replacement carries payment and new price');
 perform wholesale_test_assert(get_wholesale_operation(inv,'correction','j01-finance')=r,'J01 finance reads own correction result');
end$$;
rollback;
reset role;
begin;
alter table profiles disable trigger guard_profile_privileges;
update profiles set role='ADMIN' where id='f1000000-0000-4000-8000-000000000002';
alter table profiles enable trigger guard_profile_privileges;
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000002',true);
select wholesale_test_reject(format('select correct_wholesale_invoice(%L,%s,''j01-admin'',''replace'',''Harga dikoreksi'',%L)',s.invoice_id,si.revision,
 jsonb_build_object('tanggal',current_date,'jatuh_tempo',current_date+20,'items',jsonb_build_array(jsonb_build_object('id',s.line_id,'harga',95)))),'OWNER/FINANCE')
 from wholesale_test_state s join sales_invoices si on si.id=s.invoice_id;
select wholesale_test_reject(format('select get_wholesale_operation(%L,''correction'',''j01-admin'')',invoice_id),'OWNER/FINANCE') from wholesale_test_state;
rollback;
reset role;
begin;
alter table profiles disable trigger guard_profile_privileges;
update profiles set role='STAFF' where id='f1000000-0000-4000-8000-000000000002';
alter table profiles enable trigger guard_profile_privileges;
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000002',true);
select wholesale_test_reject(format('select correct_wholesale_invoice(%L,%s,''j01-staff'',''cancel'',''Salah pencatatan'',jsonb_build_object(''tanggal'',current_date))',s.invoice_id,si.revision),'OWNER/FINANCE')
 from wholesale_test_state s join sales_invoices si on si.id=s.invoice_id;
rollback;
