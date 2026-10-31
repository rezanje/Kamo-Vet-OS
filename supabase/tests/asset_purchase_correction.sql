begin;
insert into auth.users(id,email) values('ac000000-0000-4000-8000-000000000001','asset-owner@example.invalid');
update profiles set role='OWNER',is_active=true where id='ac000000-0000-4000-8000-000000000001';
insert into branches(id,code,name,type) values('ac100000-0000-4000-8000-000000000001','FA','Fictional asset branch','OFFICE');
insert into coa_accounts(code,name,type,normal_balance) values('110299','Fictional asset bank','ASET','D');
insert into cash_accounts(id,nama,jenis,coa_code,branch_id) values('ac200000-0000-4000-8000-000000000001','Fictional bank','Bank','110299','ac100000-0000-4000-8000-000000000001');
create temporary table asset_test_result(name text primary key, value jsonb);
grant all on asset_test_result to authenticated;
create function pg_temp.expect_error(q text, expected text) returns void language plpgsql as $$
begin
 begin execute q; exception when others then
  if position(expected in sqlerrm)=0 then raise exception 'Expected %, got %',expected,sqlerrm;end if;
  return;
 end;
 raise exception 'Expected rejection: %',q;
end$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','ac000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
insert into asset_test_result select 'asset',to_jsonb(create_fixed_asset_purchase('Fictional machine',(select id from asset_categories where nama='Peralatan'),current_date,100000000,0,48,'ac100000-0000-4000-8000-000000000001','Bank','110299','initial-asset'));
-- RED: this API must preview and commit a full, linked reversal/replacement.
insert into asset_test_result select 'preview',preview_fixed_asset_correction((value#>>'{}')::uuid,0,current_date,10000000,'Wrong amount') from asset_test_result where name='asset';
do $$begin
 if (select value->>'monthly_after' from asset_test_result where name='preview')<>'208333' then raise exception 'Monthly depreciation changed policy';end if;
 if (select value->>'allowed' from asset_test_result where name='preview')<>'true' then raise exception 'Safe correction unexpectedly blocked';end if;
end$$;
insert into asset_test_result select 'corrected',correct_fixed_asset_purchase((value#>>'{}')::uuid,0,current_date,10000000,'Wrong amount','correct-once') from asset_test_result where name='asset';
do $$declare r jsonb;again jsonb;begin
 select value into r from asset_test_result where name='corrected';
 select correct_fixed_asset_purchase((value#>>'{}')::uuid,0,current_date,10000000,'Wrong amount','correct-once') into again from asset_test_result where name='asset';
 if r is distinct from again then raise exception 'Retry changed result';end if;
 if (select harga_perolehan from fixed_assets where id=(r->>'asset_id')::uuid)<>10000000 then raise exception 'Asset value not corrected';end if;
 if (select sum(l.debit-l.credit) from journal_lines l join journal_entries e on e.id=l.entry_id join coa_accounts a on a.id=l.account_id where a.code='200008')<>10000000 then raise exception 'Asset ledger inconsistent';end if;
 if (select count(*) from journal_entries where source='asset-purchase')<>1 or (select count(*) from fixed_asset_corrections)<>1 then raise exception 'History overwritten or retry duplicated';end if;
 if exists(select 1 from journal_lines group by entry_id having sum(debit)<>sum(credit)) then raise exception 'Unbalanced journal';end if;
end$$;
select pg_temp.expect_error(format('select correct_fixed_asset_purchase(%L,0,current_date,1,%L,%L)',value#>>'{}','Wrong amount','correct-once'),'rincian berbeda') from asset_test_result where name='asset';
select pg_temp.expect_error(format('select correct_fixed_asset_purchase(%L,0,current_date,1,%L,%L)',value#>>'{}','Wrong amount','stale'),'berubah') from asset_test_result where name='asset';
select pg_temp.expect_error(format('update fixed_assets set harga_perolehan=1 where id=%L',value#>>'{}'),'jalur koreksi') from asset_test_result where name='asset';
select pg_temp.expect_error('update fixed_asset_corrections set reason=''forged''','permission denied');
select pg_temp.expect_error('update journal_lines set debit=1 where entry_id in(select id from journal_entries where source=''asset-purchase'')','jalur aset');
-- Successful date-only correction reverses the current replacement, preserving
-- all earlier journals; no assumed useful-life or residual-value change.
savepoint date_correction;
insert into asset_test_result select 'date',correct_fixed_asset_purchase((value#>>'{}')::uuid,1,current_date-1,10000000,'Wrong date','date-only') from asset_test_result where name='asset' and extract(day from current_date)>1;
do $$declare r jsonb;begin
 if extract(day from current_date)=1 then
  perform pg_temp.expect_error(format('select correct_fixed_asset_purchase(%L,1,current_date-1,10000000,%L,%L)',(select value#>>'{}' from asset_test_result where name='asset'),'Wrong date','date-only'),'bulan selesai');
  return;
 end if;
 select value into r from asset_test_result where name='date';
 if (select tanggal_perolehan from fixed_assets where id=(r->>'asset_id')::uuid)<>current_date-1 then raise exception 'Date not corrected';end if;
 if (select count(*) from journal_entries)<>5 then raise exception 'Date correction rewrote history';end if;
 if (select umur_bulan<>48 or nilai_sisa<>0 from fixed_assets where id=(r->>'asset_id')::uuid) then raise exception 'Policy changed';end if;
end$$;
rollback to date_correction;
savepoint fractional_acquisition;
select correct_fixed_asset_purchase((value#>>'{}')::uuid,1,current_date,10000000.125,'Exact acquisition nominal','fractional') from asset_test_result where name='asset';
do $$begin
 if (select harga_perolehan from fixed_assets)<>10000000.125 or (select sum(l.debit-l.credit) from journal_lines l join coa_accounts c on c.id=l.account_id where c.code='200008')<>10000000.125 then raise exception 'Correction introduced silent rounding';end if;
end$$;
rollback to fractional_acquisition;

-- Every known downstream dependency produces an actionable preview and a hard
-- commit rejection. Even nonzero journal-less historical depreciation is blocked.
savepoint dep_dependency;
insert into asset_depreciations(asset_id,periode,amount) select (value#>>'{}')::uuid,to_char(current_date,'YYYY-MM'),208333 from asset_test_result where name='asset';
select pg_temp.expect_error(format('select correct_fixed_asset_purchase(%L,1,current_date,9000000,%L,%L)',value#>>'{}','Wrong amount','has-dep'),'penyusutan') from asset_test_result where name='asset';
select pg_temp.expect_error('delete from asset_depreciations','Riwayat dependensi');
rollback to dep_dependency;
savepoint disposal_dependency;
insert into asset_disposals(asset_id,jenis,harga_perolehan) select (value#>>'{}')::uuid,'hapus',10000000 from asset_test_result where name='asset';
select pg_temp.expect_error(format('select correct_fixed_asset_purchase(%L,1,current_date,9000000,%L,%L)',value#>>'{}','Wrong amount','has-disposal'),'dilepas') from asset_test_result where name='asset';
rollback to disposal_dependency;
savepoint change_dependency;
insert into asset_changes(asset_id,jenis,umur_lama,umur_baru) select (value#>>'{}')::uuid,'umur',48,60 from asset_test_result where name='asset';
select pg_temp.expect_error(format('select correct_fixed_asset_purchase(%L,1,current_date,9000000,%L,%L)',value#>>'{}','Wrong amount','has-change'),'perubahan nilai/umur') from asset_test_result where name='asset';
rollback to change_dependency;
savepoint stale_consumers;
select pg_temp.expect_error(format('insert into asset_depreciations(asset_id,periode,amount) values(%L,%L,2083333)',value#>>'{}',to_char(current_date,'YYYY-MM')),'hitung ulang penyusutan') from asset_test_result where name='asset';
select pg_temp.expect_error(format('insert into asset_disposals(asset_id,jenis,harga_perolehan) values(%L,%L,100000000)',value#>>'{}','hapus'),'hitung ulang pelepasan') from asset_test_result where name='asset';
rollback to stale_consumers;

reset role;
savepoint bank_dependency;
insert into bank_reconciliations(tanggal,cash_account_id,bank_coa_code) values(current_date,'ac200000-0000-4000-8000-000000000001','110299');
set local role authenticated;
select pg_temp.expect_error(format('select correct_fixed_asset_purchase(%L,1,current_date,9000000,%L,%L)',value#>>'{}','Wrong amount','has-recon'),'Rekonsiliasi bank') from asset_test_result where name='asset';
reset role;
rollback to bank_dependency;
savepoint period_dependency;
update accounting_locks set closed_until=current_date;
set local role authenticated;
select pg_temp.expect_error(format('select correct_fixed_asset_purchase(%L,1,current_date,9000000,%L,%L)',value#>>'{}','Wrong amount','closed'),'ditutup') from asset_test_result where name='asset';
-- Recovery is read-only and still returns the committed receipt after closing.
do $$declare r jsonb;begin
 select get_fixed_asset_correction_result((value#>>'{}')::uuid,'correct-once') into r from asset_test_result where name='asset';
 if r is distinct from (select value from asset_test_result where name='corrected') then raise exception 'Read-only recovery lost committed correction';end if;
end$$;
reset role;
rollback to period_dependency;
savepoint replacement_period;
update accounting_locks set closed_until=current_date-2;
set local role authenticated;
select pg_temp.expect_error(format('select correct_fixed_asset_purchase(%L,1,current_date-3,9000000,%L,%L)',value#>>'{}','Wrong date','new-closed'),'ditutup') from asset_test_result where name='asset';
reset role;
rollback to replacement_period;

-- Inject failures after the reversal and replacement have been created. Nothing
-- may survive, including the updated asset, request receipt, or audit record.
create function public.asset_correction_test_fail() returns trigger language plpgsql as $$begin raise exception 'Injected audit failure';end$$;
create trigger asset_test_fail before insert on public.fixed_asset_corrections for each row execute function public.asset_correction_test_fail();
set local role authenticated;
select pg_temp.expect_error(format('select correct_fixed_asset_purchase(%L,1,current_date,9000000,%L,%L)',value#>>'{}','Wrong amount','rollback-all'),'Injected audit failure') from asset_test_result where name='asset';
do $$begin
 if (select count(*) from journal_entries)<>3 or (select count(*) from fixed_asset_corrections)<>1 or (select harga_perolehan from fixed_assets)<>10000000 or (select correction_revision from fixed_assets)<>1 then raise exception 'Partial effects survived failed audit';end if;
end$$;
reset role;
drop trigger asset_test_fail on public.fixed_asset_corrections;

-- Exact original payment proof is required, never infer a bank from today's
-- payment mapping. Legacy/AP/opening assets and damaged source journals block.
savepoint damaged_journal;
update journal_lines set credit=credit+1 where entry_id=(select (value->>'replacement_journal_id')::uuid from asset_test_result where name='corrected') and credit>0;
set local role authenticated;
select pg_temp.expect_error(format('select correct_fixed_asset_purchase(%L,1,current_date,9000000,%L,%L)',value#>>'{}','Wrong amount','bad-journal'),'jurnal pembayaran tidak cocok') from asset_test_result where name='asset';
reset role;
rollback to damaged_journal;
savepoint legacy_asset;
insert into fixed_assets(nama,tanggal_perolehan,harga_perolehan,nilai_sisa,umur_bulan) values('Fictional legacy',current_date,100,0,48);
set local role authenticated;
select pg_temp.expect_error(format('select correct_fixed_asset_purchase(%L,0,current_date,90,%L,%L)',id,'Wrong amount','legacy'),'tautan jurnal') from fixed_assets where nama='Fictional legacy';
reset role;
rollback to legacy_asset;
savepoint historical_missing_depreciation;
set local role authenticated;
insert into asset_test_result select 'historical',to_jsonb(create_fixed_asset_purchase('Fictional historical',(select id from asset_categories where nama='Peralatan'),(date_trunc('month',current_date)-interval '1 month')::date,1000,0,48,'ac100000-0000-4000-8000-000000000001','Bank','110299','historical-purchase'));
select pg_temp.expect_error(format('select correct_fixed_asset_purchase(%L,0,current_date,900,%L,%L)',value#>>'{}','Wrong date','missing-historical-dep'),'bulan selesai') from asset_test_result where name='historical';
reset role;
rollback to historical_missing_depreciation;
savepoint inactive_bank;
update cash_accounts set is_active=false where coa_code='110299';
set local role authenticated;
select pg_temp.expect_error(format('select correct_fixed_asset_purchase(%L,1,current_date,9000000,%L,%L)',value#>>'{}','Wrong amount','inactive-bank'),'Rekening pembayaran') from asset_test_result where name='asset';
reset role;
rollback to inactive_bank;
savepoint unpaid_asset;
update purchase_operations set payload=jsonb_set(payload,'{funding}','"Hutang"') where kind='asset';
set local role authenticated;
select pg_temp.expect_error(format('select correct_fixed_asset_purchase(%L,1,current_date,9000000,%L,%L)',value#>>'{}','Wrong amount','unpaid'),'Sumber pembayaran') from asset_test_result where name='asset';
reset role;
rollback to unpaid_asset;
savepoint transferred_asset;
insert into asset_transfers(asset_id,dari_branch_id,ke_branch_id) select (value#>>'{}')::uuid,'ac100000-0000-4000-8000-000000000001','ac100000-0000-4000-8000-000000000001' from asset_test_result where name='asset';
set local role authenticated;
select pg_temp.expect_error(format('select correct_fixed_asset_purchase(%L,1,current_date,9000000,%L,%L)',value#>>'{}','Wrong amount','transferred'),'perpindahan') from asset_test_result where name='asset';
reset role;
rollback to transferred_asset;

-- A failed replacement line rolls back the already-created reversal as well.
create function public.asset_line_test_fail() returns trigger language plpgsql as $$begin
 if exists(select 1 from public.journal_entries where id=new.entry_id and source='asset-purchase-fix') then raise exception 'Injected replacement failure';end if;
 return new;
end$$;
create trigger asset_line_test before insert on public.journal_lines for each row execute function public.asset_line_test_fail();
set local role authenticated;
select pg_temp.expect_error(format('select correct_fixed_asset_purchase(%L,1,current_date,9000000,%L,%L)',value#>>'{}','Wrong amount','replacement-failure'),'Injected replacement failure') from asset_test_result where name='asset';
do $$begin if (select count(*) from journal_entries)<>3 or (select harga_perolehan from fixed_assets)<>10000000 then raise exception 'Replacement failure left partial effects';end if;end$$;
reset role;
drop trigger asset_line_test on public.journal_lines;

set local role authenticated;
select pg_temp.expect_error(format('select correct_fixed_asset_purchase(%L,1,current_date,''NaN''::numeric,%L,%L)',value#>>'{}','Wrong amount','nan'),'Nominal') from asset_test_result where name='asset';
select pg_temp.expect_error(format('select correct_fixed_asset_purchase(%L,1,''infinity''::date,9000000,%L,%L)',value#>>'{}','Wrong date','infinite'),'Tanggal') from asset_test_result where name='asset';
select pg_temp.expect_error(format('select correct_fixed_asset_purchase(%L,1,current_date+1,9000000,%L,%L)',value#>>'{}','Wrong date','future'),'Tanggal') from asset_test_result where name='asset';
select pg_temp.expect_error(format('select correct_fixed_asset_purchase(%L,1,current_date,9000000,%L,%L)',value#>>'{}','','empty-reason'),'Alasan') from asset_test_result where name='asset';
select pg_temp.expect_error(format('select correct_fixed_asset_purchase(%L,1,current_date,0,%L,%L)',value#>>'{}','Wrong amount','zero'),'Nominal') from asset_test_result where name='asset';
-- Cross-branch operational context also applies to current OWNER and replay.
select set_config('request.headers','{"x-kamo-operational-branch":"ac100000-0000-4000-8000-000000000099"}',true);
select pg_temp.expect_error(format('select get_fixed_asset_correction_result(%L,%L)',value#>>'{}','correct-once'),'Cabang') from asset_test_result where name='asset';
do $$begin if exists(select 1 from fixed_asset_corrections) then raise exception 'Cross-branch audit leaked';end if;end$$;
select set_config('request.headers','{}',true);
reset role;
savepoint revoked_owner;
update profiles set is_active=false where id='ac000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.expect_error(format('select correct_fixed_asset_purchase(%L,0,current_date,10000000,%L,%L)',value#>>'{}','Wrong amount','correct-once'),'OWNER aktif') from asset_test_result where name='asset';
select pg_temp.expect_error(format('select get_fixed_asset_correction_result(%L,%L)',value#>>'{}','correct-once'),'OWNER aktif') from asset_test_result where name='asset';
reset role;
rollback to revoked_owner;
savepoint lower_roles;
do $$declare r text;begin
 foreach r in array array['ADMIN','FINANCE','STAFF','DOCTOR'] loop
  perform set_config('request.jwt.claim.sub','',true);
  update profiles set role=r::user_role where id='ac000000-0000-4000-8000-000000000001';
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','ac000000-0000-4000-8000-000000000001',true);
  perform pg_temp.expect_error(format('select preview_fixed_asset_correction(%L,1,current_date,9000000,%L)',(select value#>>'{}' from asset_test_result where name='asset'),'Wrong amount'),'OWNER aktif');
  if exists(select 1 from fixed_asset_corrections) then raise exception 'Audit leaked to %',r;end if;
  reset role;
 end loop;
end$$;
rollback to lower_roles;

-- Capitalization retains its established behavior but cannot leave partial
-- asset/history/journal effects after the acquisition write guard is enabled.
set local role authenticated;
savepoint addition;
insert into asset_test_result select 'addition',add_fixed_asset_value_atomic((value#>>'{}')::uuid,current_date,1000000,'110299','Fictional repair','value-once') from asset_test_result where name='asset';
do $$declare r jsonb;begin
 select add_fixed_asset_value_atomic((value#>>'{}')::uuid,current_date,1000000,'110299','Fictional repair','value-once') into r from asset_test_result where name='asset';
 if r is distinct from (select value from asset_test_result where name='addition') or (select harga_perolehan from fixed_assets)<>11000000 or (select count(*) from asset_changes)<>1 then raise exception 'Capitalization retry corrupted asset';end if;
end$$;
select pg_temp.expect_error(format('select correct_fixed_asset_purchase(%L,2,current_date,9000000,%L,%L)',value#>>'{}','Wrong amount','after-addition'),'perubahan nilai/umur') from asset_test_result where name='asset';
rollback to addition;
reset role;
-- The capitalization helper shares the same atomic rollback guarantee.
create trigger asset_addition_test before insert on public.asset_changes for each row execute function public.asset_correction_test_fail();
set local role authenticated;
select pg_temp.expect_error(format('select add_fixed_asset_value_atomic(%L,current_date,1000000,%L,%L,%L)',value#>>'{}','110299','Repair','failed-addition'),'Injected audit failure') from asset_test_result where name='asset';
do $$begin if (select count(*) from journal_entries)<>3 or (select harga_perolehan from fixed_assets)<>10000000 then raise exception 'Capitalization failure left partial effects';end if;end$$;
select pg_temp.expect_error('select fixed_asset_correction_plan(null,0,current_date,1,''test'')','permission denied');
reset role;
do $$begin
 if has_function_privilege('anon','public.correct_fixed_asset_purchase(uuid,integer,date,numeric,text,text)','execute') or has_function_privilege('service_role','public.correct_fixed_asset_purchase(uuid,integer,date,numeric,text,text)','execute') then raise exception 'Non-user correction grant leaked';end if;
end$$;
rollback;
