\set ON_ERROR_STOP on
\ir hris_attendance_review_setup.sql
insert into cash_advances(id,employee_id,jumlah,status,disbursed_at)values('97000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000001',100,'Disetujui',statement_timestamp());
set local role authenticated;
create function pg_temp.deny_payroll(q text,label text)returns void language plpgsql as $$begin begin execute q;exception when others then if sqlerrm like 'HRIS:%'or sqlstate='42501' then return;end if;raise;end;raise exception 'FAIL: % accepted',label;end$$;
select pg_temp.deny_payroll('insert into cash_advance_installments(advance_id,periode,jumlah)values(''97000000-0000-0000-0000-000000000001'',''2026-10'',50)','raw settlement even owner requires atomic finalization');
select pg_temp.deny_payroll('insert into payrolls(employee_id,periode,status,total)values(''92000000-0000-0000-0000-000000000001'',''2026-10'',''final'',50)','raw final without source snapshot');
rollback;
-- A fresh fictional run checks actual transactional settlement, not mocked calls.
\ir hris_attendance_review_setup.sql
update employees set gaji_pokok=100;
insert into coa_accounts(code,name,type,normal_balance)values('5201','Fiction salary expense','BEBAN','D')on conflict(code)do nothing;
insert into cash_advances(id,employee_id,jumlah,status,disbursed_at)values('97000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000001',100,'Disetujui',statement_timestamp());
insert into reimbursements(id,employee_id,kategori,jumlah,status)values('97100000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000001','Fiction transport',20,'Disetujui');
create function pg_temp.fixture_row(e uuid,first boolean)returns jsonb language sql as $$
 with r as(select jsonb_build_object('gajiPokok',100,'tunjangan',0,'upahLembur',0,'reimburse',case when first then 20 else 0 end,'komisi',0,'potonganTetap',0,'potonganTelat',0,'potonganBolos',0,'cicilanKasbon',case when first then 50 else 0 end,'penyesuaian',case when first then -70 else 0 end,'total',case when first then 0 else 100 end,'hariKerja',0,'hariHadir',0,'hariBolos',0,'menitTelat',0,'jamLembur',0)val)
 select jsonb_build_object('employeeId',e,'rincian',r.val,'sourceSnapshot',jsonb_build_object('rincian',r.val,'period','2026-10','input',jsonb_build_object('gajiPokok',100)),'cicilanKasbon',case when first then '[{"id":"97000000-0000-0000-0000-000000000001","jumlah":50}]'::jsonb else '[]'::jsonb end,'reimburseIds',case when first then '["97100000-0000-0000-0000-000000000001"]'::jsonb else '[]'::jsonb end,'catatan',case when first then 'Fiction correction reduces debt capacity'else ''end)from r
$$;
create function pg_temp.prepare(v int)returns int language sql as $$select hris_prepare_payroll('2026-10',(hris_payroll_source_state('2026-10')->>'revision')::bigint,v,jsonb_build_array(pg_temp.fixture_row('92000000-0000-0000-0000-000000000001',true),pg_temp.fixture_row('92000000-0000-0000-0000-000000000002',false)),'Fiction complete source calculation')$$;
create function pg_temp.deny_payroll(q text,label text)returns void language plpgsql as $$begin begin execute q;exception when others then if sqlerrm like 'HRIS:%'or sqlstate='42501' then return;end if;raise;end;raise exception 'FAIL: % accepted',label;end$$;
update coa_accounts set is_active=false where code='5201';
set local role authenticated;
select pg_temp.prepare(0);
select pg_temp.check_it((select count(*)from payrolls where draft_version=1 and source_snapshot is not null)=2,'two complete snapshot slips');
select pg_temp.deny_payroll('select pg_temp.prepare(0)','stale draft version');
select pg_temp.deny_payroll('select hris_finalize_payroll(''2026-10'',1,null,''Fiction final approval'')','missing journal account');
select pg_temp.check_it((select count(*)from cash_advance_installments)=0,'journal failure changes no installments');
select pg_temp.check_it((select status from reimbursements)='Disetujui','journal failure marks no reimburse paid');
select pg_temp.check_it((select count(*)from payrolls where status='draft')=2,'journal failure leaves every slip draft');
select pg_temp.check_it((select count(*)from journal_entries where source='payroll')=0,'journal failure removes header and lines');
reset role;
update coa_accounts set is_active=true where code='5201';
set local role authenticated;
select pg_temp.deny_payroll('select hris_finalize_payroll(''2026-10'',1,null,''Fiction source changed'')','source changed since draft');
select pg_temp.prepare(1);
reset role;
create function pg_temp.break_final_audit()returns trigger language plpgsql as $$begin if new.kind='finalize'then raise exception 'FICTION final audit failure';end if;return new;end$$;
create trigger fiction_final_audit before insert on hris_payroll_events for each row execute function pg_temp.break_final_audit();
set local role authenticated;
do $$begin begin perform hris_finalize_payroll('2026-10',2,null,'Fiction final approval');exception when others then if sqlerrm='FICTION final audit failure'then return;end if;raise;end;raise exception 'FAIL: expected final audit failure';end$$;
select pg_temp.check_it((select count(*)from cash_advance_installments)=0,'last audit failure rolls installments back');
select pg_temp.check_it((select status from reimbursements)='Disetujui','last audit failure rolls reimburse back');
select pg_temp.check_it((select count(*)from journal_entries)=0,'last audit failure rolls all journal back');
select pg_temp.check_it((select count(*)from payrolls where status='draft')=2,'last audit failure rolls every final slip back');
reset role;
drop trigger fiction_final_audit on hris_payroll_events;
set local role authenticated;
select hris_finalize_payroll('2026-10',2,null,'Fiction confirmed final approval');
select pg_temp.check_it((select jumlah from cash_advance_installments)=50,'saved adjusted capacity settles 50 instead of recalculated 100');
select pg_temp.check_it((select status from cash_advances)='Disetujui','insufficient pay does not falsely clear remaining debt');
select pg_temp.check_it((select status='Dibayar'and paid_periode='2026-10'from reimbursements),'reimburse linked to exact settled period');
select pg_temp.check_it((select count(*)from payrolls where status='final')=2,'whole run final together');
select pg_temp.check_it((select count(*)from journal_entries where source='payroll')=1,'one run journal');
select pg_temp.check_it((select sum(debit)=150 and sum(credit)=150 from journal_lines),'net 100 plus debt 50 balance exactly');
select pg_temp.deny_payroll('select hris_finalize_payroll(''2026-10'',2,null,''Fiction repeated final'')','repeat finalization');
select pg_temp.deny_payroll('update payrolls set total=999','final amounts protected from raw edit');
select pg_temp.deny_payroll('insert into journal_entries(no_jurnal,tanggal,source,source_ref)values(''FIC-RAW-PAY'',''2026-10-31'',''payroll'',''forged'')','raw private payroll journal');
select pg_temp.deny_payroll('delete from employees','employee removal cannot destroy final salary history');
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000001',true);
select pg_temp.check_it((select count(*)from payrolls)=1,'staff can read own immutable finalized slip');
select pg_temp.deny_payroll('select hris_payroll_source_state(''2026-10'')','staff cannot get company source state');
select pg_temp.deny_payroll('select hris_finalize_payroll(''2026-10'',2,null,''Fiction staff final'')','staff cannot finalize');
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000003',true);
select pg_temp.deny_payroll('select pg_temp.prepare(2)','branch admin cannot prepare company');
reset role;
select pg_temp.deny_payroll('update payrolls set total=999','final snapshot immutable even privileged accidental edits');
select pg_temp.deny_payroll('update journal_entries set deskripsi=''Fiction changed final''','final journal immutable');
rollback;
