-- Fictional fixtures are loaded by the disposable runner. No external payments.
create function pg_temp.expect_error(q text, message text) returns void language plpgsql as $$
begin
 begin execute q; exception when others then
  if position(message in sqlerrm)>0 then return;end if;raise;
 end;
 raise exception 'Expected rejection: %',message;
end$$;
set role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"role":"authenticated"}',false);
create temporary table return_results(name text primary key,result jsonb);
insert into return_results values('sale',post_unit_return('sales','f6000000-0000-4000-8000-000000000011','correction-sale',jsonb_build_object('tanggal',current_date-1),'[{"source_line_id":"f7000000-0000-4000-8000-000000000021","item_id":"f5000000-0000-4000-8000-000000000001","qty":5,"satuan":"pcs","kondisi":"baik"}]'));
-- The five recorded units were wrong: signed receipt confirms only three.
insert into return_results select 'corrected',correct_return_record('sales',(result->>'document_id')::uuid,0,'correct-three','Jumlah salah: hanya tiga diterima','Bukti penerimaan TEST-03, dihitung ulang oleh pemilik',
 '[{"source_line_id":"f7000000-0000-4000-8000-000000000021","item_id":"f5000000-0000-4000-8000-000000000001","qty":3,"satuan":"pcs","kondisi":"baik"}]') from return_results where name='sale';
do $$declare original uuid;replacement uuid;begin
 select (result->>'document_id')::uuid into original from return_results where name='sale';
 select (result->>'replacement_id')::uuid into replacement from return_results where name='corrected';
 if (select qty from stock where warehouse_id='f3000000-0000-4000-8000-000000000001' and item_id='f5000000-0000-4000-8000-000000000001')<>33 then raise exception 'Correction invented physical stock';end if;
 if not exists(select 1 from sales_returns where id=original and total=90 and voided_at is not null) then raise exception 'Original return was lost';end if;
 if not exists(select 1 from sales_returns where id=replacement and total=54 and replaces_return_id=original and voided_at is null) then raise exception 'Replacement not linked';end if;
 if (select sum(total) from sales_returns where voided_at is null)<>54 then raise exception 'Active refund incorrect';end if;
 if not exists(select 1 from return_record_corrections where return_id=original and length(physical_evidence)>10 and cardinality(reversal_journal_ids)=2) then raise exception 'Audit/provenance missing';end if;
 if exists(select 1 from journal_entries where source='return-record-void' and tanggal<>current_date-1) or exists(select 1 from stock_moves where source='return-record-void' and tanggal<>current_date-1) then raise exception 'Correction dates do not restate original open date';end if;
end$$;
select pg_temp.expect_error(format('select correct_return_record(''sales'',%L,0,''changed'',''Changed reason'',''TEST evidence'', ''[]'')',result->>'document_id'),'berubah') from return_results where name='sale';
select pg_temp.expect_error(format('select correct_return_record(''sales'',%L,0,''correct-three'',''Different reason'',''TEST evidence'',''[]'')',result->>'document_id'),'berbeda') from return_results where name='sale';
-- Exact retry survives a lost response, despite the original now being void.
do $$declare r jsonb;begin
 select correct_return_record('sales',(result->>'document_id')::uuid,0,'correct-three','Jumlah salah: hanya tiga diterima','Bukti penerimaan TEST-03, dihitung ulang oleh pemilik','[{"source_line_id":"f7000000-0000-4000-8000-000000000021","item_id":"f5000000-0000-4000-8000-000000000001","qty":3,"satuan":"pcs","kondisi":"baik"}]') into r from return_results where name='sale';
 if r<>(select result from return_results where name='corrected') then raise exception 'Retry differs';end if;
end$$;
reset role;
begin;
insert into sales_returns(id,no_retur,sale_id,tanggal,total) values('fc900000-0000-4000-8000-000000000001','RJ.LEGACY.NO.PROVENANCE','f6000000-0000-4000-8000-000000000011',current_date,1);
set local role authenticated;
select pg_temp.expect_error('select correct_return_record(''sales'',''fc900000-0000-4000-8000-000000000001'',0,''legacy-no-proof'',''Wrong quantity'',''TEST signed receipt zero'',''[]'')','provenance');
rollback;
-- Reject unsafe paths without changing any side effect.
set role authenticated;
select pg_temp.expect_error(format('select correct_return_record(''sales'',%L,0,''no-proof'',''Wrong qty'','''',''[]'')',result->>'replacement_id'),'bukti fisik') from return_results where name='corrected';
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000002',false);
select pg_temp.expect_error(format('select correct_return_record(''sales'',%L,0,''forbidden'',''Wrong qty'',''TEST receipt zero'',''[]'')',result->>'replacement_id'),'OWNER') from return_results where name='corrected';
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',false);
select pg_temp.expect_error('update sales_returns set total=1','permission denied');
select pg_temp.expect_error('update return_record_corrections set reason=''forged''','permission denied');
select pg_temp.expect_error('update journal_lines set debit=0 where entry_id in(select id from journal_entries where source=''sales-return'')','jalur koreksi');
reset role;
begin;
update accounting_locks set closed_until=current_date;
set local role authenticated;
select pg_temp.expect_error(format('select correct_return_record(''sales'',%L,0,''closed'',''Wrong qty'',''TEST receipt zero'',''[]'')',result->>'replacement_id'),'ditutup') from return_results where name='corrected';
rollback;
begin;
update branches set is_active=false where id='f2000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.expect_error(format('select correct_return_record(''sales'',%L,0,''inactive-branch'',''Wrong qty'',''TEST receipt zero'',''[]'')',result->>'replacement_id'),'tidak aktif') from return_results where name='corrected';
rollback;
-- A subsequent transfer/sale must block even if other receipts replenish stock.
begin;
insert into stock_moves(tanggal,warehouse_id,item_id,qty,unit_cost,source,source_ref) values(current_date,'f3000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000001',-1,4,'transfer','TEST.DOWNSTREAM');
set local role authenticated;
select pg_temp.expect_error(format('select correct_return_record(''sales'',%L,0,''stock-used'',''Wrong qty'',''TEST receipt zero'',''[]'')',result->>'replacement_id'),'mutasi lanjutan') from return_results where name='corrected';
rollback;
-- Same OWNER but operational branch override outside the source is denied.
set role authenticated;
select set_config('request.headers','{"x-kamo-operational-branch":"f2000000-0000-4000-8000-000000000002"}',false);
select pg_temp.expect_error(format('select correct_return_record(''sales'',%L,0,''branch-denied'',''Wrong qty'',''TEST receipt zero'',''[]'')',result->>'replacement_id'),'Cabang') from return_results where name='corrected';
select set_config('request.headers','{}',false);
reset role;
begin;
insert into bank_reconciliations(tanggal,cash_account_id,bank_coa_code) select current_date,id,'1101' from cash_accounts where coa_code='1101';
set local role authenticated;
select pg_temp.expect_error(format('select correct_return_record(''sales'',%L,0,''reconciled'',''Wrong qty'',''TEST receipt zero'',''[]'')',result->>'replacement_id'),'Rekonsiliasi bank') from return_results where name='corrected';
rollback;
begin;
update journal_lines set debit=debit+1 where entry_id in(select id from journal_entries where source='sales-return' and source_ref=(select no_retur from sales_returns where id=(select (result->>'replacement_id')::uuid from return_results where name='corrected'))) and debit>0;
set local role authenticated;
select pg_temp.expect_error(format('select correct_return_record(''sales'',%L,0,''journal-mismatch'',''Wrong qty'',''TEST receipt zero'',''[]'')',result->>'replacement_id'),'Provenance jurnal') from return_results where name='corrected';
rollback;
set role authenticated;
select pg_temp.expect_error(format('select revise_expense_atomic(''wrong-editor'',%L,0,''void'',''{}'',''Wrong amount'')',snapshot->'refunds'->0->>'id'),'bersama catatan retur') from return_record_postings where return_id=(select (result->>'replacement_id')::uuid from return_results where name='corrected');
reset role;
-- Forced failure at the FINAL audit insert rolls back original void, refund,
-- exact stock reversal, replacement rows, journals, and durable request key.
begin;
create function public.return_test_fail_audit() returns trigger language plpgsql as $$begin raise exception 'forced final audit failure';end$$;
create trigger return_test_audit before insert on return_record_corrections for each row execute function public.return_test_fail_audit();
set local role authenticated;
select pg_temp.expect_error(format('select correct_return_record(''sales'',%L,0,''rollback-final'',''Wrong qty'',''TEST receipt zero'',''[]'')',result->>'replacement_id'),'forced final audit failure') from return_results where name='corrected';
do $$begin
 if (select qty from stock where warehouse_id='f3000000-0000-4000-8000-000000000001' and item_id='f5000000-0000-4000-8000-000000000001')<>33
  or (select count(*) from sales_returns where voided_at is null)<>1 or (select count(*) from expenses where voided_at is null)<>1 then raise exception 'Partial effects after failure';end if;
end$$;
rollback;
set role authenticated;
insert into return_results select 'cancelled',correct_return_record('sales',(result->>'replacement_id')::uuid,0,'cancel-zero','Tidak ada penerimaan fisik','Bukti TEST-ZERO: penerimaan salah input, fisik nol','[]') from return_results where name='corrected';
do $$begin
 if (select qty from stock where warehouse_id='f3000000-0000-4000-8000-000000000001' and item_id='f5000000-0000-4000-8000-000000000001')<>30
  or exists(select 1 from sales_returns where voided_at is null) or exists(select 1 from expenses where voided_at is null) then raise exception 'Cancellation stock/refund incorrect';end if;
 if (select sum(l.debit-l.credit) from journal_lines l join journal_entries e on e.id=l.entry_id join coa_accounts a on a.id=l.account_id where a.code='1301' and e.source in('sales-return-hpp','return-record-void'))<>0 then raise exception 'Cancellation HPP not exactly reversed';end if;
end$$;
-- Unpaid supplier return: reduce four incorrectly recorded units to two.
insert into return_results values('purchase',post_unit_return('purchase','f6000000-0000-4000-8000-000000000010','purchase-four',jsonb_build_object('tanggal',current_date),'[{"source_line_id":"f7000000-0000-4000-8000-000000000010","item_id":"f5000000-0000-4000-8000-000000000001","qty":4,"satuan":"pcs"}]'));
insert into return_results select 'purchase-corrected',correct_return_record('purchase',(result->>'document_id')::uuid,0,'purchase-two','Jumlah kirim hanya dua','Surat jalan TEST-SJ2: dua terkirim, dua tetap di gudang','[{"source_line_id":"f7000000-0000-4000-8000-000000000010","item_id":"f5000000-0000-4000-8000-000000000001","qty":2,"satuan":"pcs"}]') from return_results where name='purchase';
do $$begin
 if (select qty from stock where warehouse_id='f3000000-0000-4000-8000-000000000001' and item_id='f5000000-0000-4000-8000-000000000001')<>28 or (select sum(total) from purchase_returns where voided_at is null)<>20 then raise exception 'Unpaid purchase correction incorrect';end if;
 if (select sum(-qty) from return_record_effective_stock_moves where source='retur-beli')<>2 or exists(select 1 from return_record_effective_stock_moves where source='return-record-void') then raise exception 'Usage counts paperwork reversals or superseded returns';end if;
 if (select sum(l.debit-l.credit) from journal_lines l join journal_entries e on e.id=l.entry_id join coa_accounts a on a.id=l.account_id where a.code='2101' and e.source in('purchase-return','return-record-void'))<>20 then raise exception 'AP ledger differs from active return';end if;
end$$;
reset role;
-- Partpaid before return is supported, but later payments block correction.
insert into purchase_invoices(id,no_faktur,po_id,tanggal,jatuh_tempo,total) values('fc000000-0000-4000-8000-000000000001','RETURN.TEST.INV','f6000000-0000-4000-8000-000000000010',current_date,current_date,220);
insert into purchase_invoice_payments(invoice_id,tanggal,amount,metode) values('fc000000-0000-4000-8000-000000000001',current_date,50,'Transfer');
set role authenticated;
-- A payment added after the return blocks restoring its liability.
select pg_temp.expect_error(format('select correct_return_record(''purchase'',%L,0,''payment-after'',''Wrong qty'',''TEST supplier receipt zero'',''[]'')',result->>'replacement_id'),'Pembayaran faktur berubah') from return_results where name='purchase-corrected';
insert into return_results values('partpaid',post_unit_return('purchase','f6000000-0000-4000-8000-000000000010','partpaid-return',jsonb_build_object('tanggal',current_date),'[{"source_line_id":"f7000000-0000-4000-8000-000000000011","item_id":"f5000000-0000-4000-8000-000000000001","qty":2,"satuan":"pcs"}]'));
insert into return_results select 'partpaid-corrected',correct_return_record('purchase',(result->>'document_id')::uuid,0,'partpaid-one','Hanya satu terkirim','TEST-SJ1: satu fisik terkirim, satu tetap tersimpan','[{"source_line_id":"f7000000-0000-4000-8000-000000000011","item_id":"f5000000-0000-4000-8000-000000000001","qty":1,"satuan":"pcs"}]') from return_results where name='partpaid';
do $$begin
 if (select sum(total) from purchase_returns where voided_at is null)<>40 then raise exception 'Partpaid return ceiling ignored cancelled original';end if;
end$$;
reset role;
-- Fully paid sources require a supplier credit/refund flow which does not
-- exist in KAMO yet. Reject; never manufacture a cash receipt or negative AP.
begin;
insert into purchase_invoice_payments(invoice_id,tanggal,amount,metode) values('fc000000-0000-4000-8000-000000000001',current_date,130,'Transfer');
set local role authenticated;
select pg_temp.expect_error('select post_unit_return(''purchase'',''f6000000-0000-4000-8000-000000000010'',''paid-block'',jsonb_build_object(''tanggal'',current_date),''[{"source_line_id":"f7000000-0000-4000-8000-000000000011","item_id":"f5000000-0000-4000-8000-000000000001","qty":1,"satuan":"pcs"}]'')','sisa hutang');
rollback;
