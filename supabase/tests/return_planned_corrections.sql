-- Runs after the fictional merchant-fee fixture prelude in one rolled-back DB session.
update profiles set role='OWNER' where id='e1100000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select pg_temp.fee_sale('CORRECT.SPLIT.FEE');
select pg_temp.lines((select id from sales where no_struk='CORRECT.SPLIT.FEE'));
select finalize_pos_sale((select id from sales where no_struk='CORRECT.SPLIT.FEE'));
create temporary table planned_results(name text,result jsonb);
insert into planned_results values('original',pg_temp.refund('CORRECT.SPLIT.FEE','return-eighty-percent',1.6));
insert into planned_results select 'corrected',correct_return_record('sales',(result->>'document_id')::uuid,0,'return-sixty-percent','Correct count from 80 to 60 percent','TEST confirmed receipt 1.2 of two source units',jsonb_build_array(jsonb_build_object('source_line_id',(select i.id from sale_items i join sales s on s.id=i.sale_id where s.no_struk='CORRECT.SPLIT.FEE'),'item_id','e5500000-0000-4000-8000-000000000001','qty',1.2,'satuan','pcs','kondisi','baik'))) from planned_results where name='original';
select pg_temp.assert_ok((select sum(total) from sales_returns where voided_at is null)=60960,'active 60% return');
select pg_temp.assert_ok((select sum(jumlah) from expenses where voided_at is null)=60960,'all method refunds corrected');
select pg_temp.assert_ok((select count(*) from expenses where voided_at is not null)=2,'both original expenses retained and void');
select pg_temp.assert_ok((select count(*) from sale_payment_refunds)=4,'original and replacement allocations immutable');
select pg_temp.assert_ok((select sum(f.amount) from sale_payment_refunds f join sales_returns r on r.id=f.sales_return_id where r.voided_at is null)=60960,'active refund allocations match');
-- Any method's reconciliation blocks the whole correction.
savepoint bank_dependency;
reset role;
insert into bank_reconciliations(tanggal,cash_account_id,bank_coa_code) values(current_date,'e6600000-0000-4000-8000-000000000002','1112');
set local role authenticated;
select pg_temp.reject(format('select correct_return_record(''sales'',%L,0,''reconciled-method'',''Wrong quantity'',''TEST zero receipt proof'',''[]'')',result->>'replacement_id'),'reconciled method blocks correction') from planned_results where name='corrected';
rollback to bank_dependency;
-- Employee-linked corrections fail closed while payroll generation is not atomic.
savepoint commission_dependency;
reset role;
insert into employees(nama,profile_id) values('Fictional commission employee','e1100000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.reject(format('select correct_return_record(''sales'',%L,0,''employee-link'',''Wrong quantity'',''TEST zero receipt proof'',''[]'')',result->>'replacement_id'),'employee/commission linkage blocks even before payroll exists') from planned_results where name='corrected';
rollback to commission_dependency;
insert into planned_results select 'cancelled',correct_return_record('sales',(result->>'replacement_id')::uuid,0,'cancel-planned','No goods actually returned','TEST verified zero goods and source retained','[]') from planned_results where name='corrected';
select pg_temp.assert_ok((select count(*) from expenses where voided_at is null)=0,'all split refund expenses cancelled');
-- Retained historical allocations cannot poison subsequent proportional targets.
insert into planned_results values('new-full',pg_temp.refund('CORRECT.SPLIT.FEE','return-full-after-cancel',2));
select pg_temp.assert_ok((select sum(total) from sales_returns where voided_at is null)=101600,'full return ceiling reopens after cancellation');
select pg_temp.assert_ok((select sum(jumlah) from expenses where voided_at is null)=101600,'new full refund exactly matches gross paid bill including fee');
select pg_temp.assert_ok((select sum(l.credit-l.debit) from journal_lines l join journal_entries e on e.id=l.entry_id join coa_accounts a on a.id=l.account_id where a.code='810004' and e.source in('sales-return','return-record-void'))=-1600,'merchant fee reversed once');
rollback;
