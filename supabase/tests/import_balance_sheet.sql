-- Fictional data only. The runner applies all migrations in a disposable DB.
begin;
create function pg_temp.assert_ok(ok boolean,message text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'Assertion failed: %',message;end if;end$$;
create function pg_temp.reject(statement text,message text) returns void language plpgsql as $$declare failed boolean:=false;begin
 begin execute statement;exception when others then failed:=true;end;
 if not failed then raise exception 'Expected rejection: %',message;end if;end$$;
insert into auth.users(id,raw_user_meta_data) values
 ('ed100000-0000-4000-8000-000000000001','{"full_name":"Import owner"}'),
 ('ed100000-0000-4000-8000-000000000002','{"full_name":"Import staff"}');
update profiles set role='OWNER',is_active=true where id='ed100000-0000-4000-8000-000000000001';
update profiles set role='STAFF',is_active=true where id='ed100000-0000-4000-8000-000000000002';
insert into branches(id,code,name,type) values
 ('ed200000-0000-4000-8000-000000000001','IMPORT-A','Import A','PETSHOP'),
 ('ed200000-0000-4000-8000-000000000002','IMPORT-B','Import B','PETSHOP');
insert into warehouses(id,branch_id,code,name,type) values
 ('ed300000-0000-4000-8000-000000000001','ed200000-0000-4000-8000-000000000001','IMPORT-WA','Import warehouse A','RETAIL'),
 ('ed300000-0000-4000-8000-000000000002','ed200000-0000-4000-8000-000000000002','IMPORT-WB','Import warehouse B','RETAIL');
insert into coa_accounts(code,name,type,normal_balance,is_header) values
 ('1301','Import inventory','ASET','D',false),('3101','Import capital','EKUITAS','K',false)
on conflict(code) do update set is_active=true,is_header=false;
update accounting_locks set closed_until=null;
create function pg_temp.batch(qty numeric default 3,cost numeric default 12.3456) returns uuid
language plpgsql as $$declare run uuid:=gen_random_uuid(); item uuid:=gen_random_uuid();begin
 insert into items(id,code,name,unit,item_type,buy_price) values(item,'IMP-'||left(item::text,8),'Import stock','pcs','Persediaan',999999);
 insert into import_runs(id,kind,source_name,source_hash,branch_id,warehouse_id,as_of_date,created_by)
 values(run,'initial_stock','fictional.xlsx',run::text,'ed200000-0000-4000-8000-000000000001','ed300000-0000-4000-8000-000000000001','2026-10-01',auth.uid());
 insert into import_run_rows(run_id,source_row,status,payload) values(run,2,'valid',jsonb_build_object('item_id',item,'warehouse_id','ed300000-0000-4000-8000-000000000001','as_of','2026-10-01','base_qty',qty,'base_unit_cost',cost));
 return run;
end $$;
create function pg_temp.balance(run uuid,code text) returns numeric language sql as $$
 select coalesce(sum(l.debit-l.credit),0) from journal_lines l
 join journal_entries e on e.id=l.entry_id join coa_accounts a on a.id=l.account_id
 where e.source='saldo-awal-accurate' and e.source_ref=run::text and a.code=$2;
$$;
create function pg_temp.assert_unposted(run uuid) returns void language plpgsql as $$begin
 perform pg_temp.assert_ok((select status='previewed' from import_runs where id=run),'failed batch stays previewed');
 perform pg_temp.assert_ok(not exists(select 1 from stock_moves where source_ref=run::text),'failed batch leaves no movements');
 perform pg_temp.assert_ok(not exists(select 1 from stock where item_id in (select (payload->>'item_id')::uuid from import_run_rows where run_id=run and status='valid')),'failed batch leaves no stock aggregate');
 perform pg_temp.assert_ok(not exists(select 1 from stock_layers where source_ref=run::text),'failed batch leaves no layers');
 perform pg_temp.assert_ok(not exists(select 1 from journal_entries where source_ref=run::text),'failed batch leaves no journal');
end $$;
-- Deliberate journal failure proves rollback even after stock rows were written.
create function pg_temp.fail_import_journal() returns trigger language plpgsql as $$begin
 if new.source='saldo-awal-accurate' and current_setting('test.fail_import_journal',true)='on' then
   raise exception 'Simulated journal insertion failure';
 end if;
 return new;
end $$;
create trigger test_import_journal_failure before insert on public.journal_entries for each row execute function pg_temp.fail_import_journal();
-- Deliberately inconsistent legacy evidence is fixture-only, never an API write.
create function pg_temp.fixture_existing_import_journal(run uuid) returns uuid language plpgsql security definer set search_path='' as $$declare entry uuid;begin
 insert into public.journal_entries(tanggal,source,source_ref,branch_id) values('2026-10-01','saldo-awal-accurate',run::text,'ed200000-0000-4000-8000-000000000001') returning id into entry;
 return entry;
end$$;
create function pg_temp.fixture_remove_import_journal(entry uuid) returns void language sql security definer set search_path='' as $$delete from public.journal_entries where id=entry$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','ed100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
do $$declare run uuid:=pg_temp.batch(); result jsonb; begin
 result:=post_accurate_initial_stock(run);
 perform pg_temp.assert_ok(pg_temp.balance(run,'1301')=37.0368,'imported source cost debits inventory in ledger/neraca');
 perform pg_temp.assert_ok(pg_temp.balance(run,'3101')=-37.0368,'opening capital balances exact source value');
 perform pg_temp.assert_ok((select tanggal='2026-10-01' and branch_id='ed200000-0000-4000-8000-000000000001' from journal_entries where source='saldo-awal-accurate' and source_ref=run::text),'journal retains source date and branch');
 perform pg_temp.assert_ok((select sum(qty_left*unit_cost)=37.0368 from stock_layers where source_ref=run::text),'journal agrees with initial stock layers');
 perform pg_temp.assert_ok((select sum(qty*unit_cost)=37.0368 from stock_moves where source_ref=run::text),'journal agrees with stock card');
 perform pg_temp.assert_ok((select status='posted' from import_runs where id=run),'batch posted atomically');
 perform pg_temp.reject(format('select post_accurate_initial_stock(%L)',run),'same batch must not duplicate opening journal');
 perform pg_temp.assert_ok((select count(*)=1 from journal_entries where source='saldo-awal-accurate' and source_ref=run::text),'single linked journal');
end $$;
-- A zero source cost stays zero even when master buy_price is nonzero.
do $$declare run uuid:=pg_temp.batch(2,0);begin
 perform post_accurate_initial_stock(run);
 perform pg_temp.assert_ok(not exists(select 1 from journal_entries where source_ref=run::text),'zero-valued import does not invent capital or inventory value');
 perform pg_temp.assert_ok((select sum(qty_left)=2 and sum(qty_left*unit_cost)=0 from stock_layers where source_ref=run::text),'zero-valued physical stock retained');
end $$;
-- Multiple lots of the same SKU and rejected rows: only accepted source values count.
do $$declare run uuid:=pg_temp.batch(2,10); item uuid;begin
 select (payload->>'item_id')::uuid into item from import_run_rows where run_id=run;
 insert into import_run_rows(run_id,source_row,status,payload)
 select run,3,'valid',payload||'{"base_qty":1,"base_unit_cost":20,"batch_no":"LOT2"}'::jsonb from import_run_rows where run_id=run;
 insert into import_run_rows(run_id,source_row,status,payload) values(run,4,'rejected','{"base_qty":1000,"base_unit_cost":1000}');
 perform post_accurate_initial_stock(run);
 perform pg_temp.assert_ok(pg_temp.balance(run,'1301')=40,'sum accepted lots only');
 perform pg_temp.assert_ok((select qty=3 from stock where item_id=item),'same SKU lots aggregate correctly');
end $$;
-- RPC payloads cannot diverge from batch scope or inject absent/negative costs.
do $$declare run uuid; entry uuid;begin
 run:=pg_temp.batch();
 perform set_config('request.headers','{"x-kamo-operational-branch":"ed200000-0000-4000-8000-000000000002"}',true);
 perform pg_temp.reject(format('select post_accurate_initial_stock(%L)',run),'operational branch scope cannot be bypassed');
 perform set_config('request.headers','{}',true);perform pg_temp.assert_unposted(run);
 run:=pg_temp.batch();update import_run_rows set payload=payload||'{"as_of":"2026-09-30"}' where run_id=run;
 perform pg_temp.reject(format('select post_accurate_initial_stock(%L)',run),'payload date mismatch');perform pg_temp.assert_unposted(run);
 run:=pg_temp.batch();update import_runs set warehouse_id='ed300000-0000-4000-8000-000000000002' where id=run;update import_run_rows set payload=payload||'{"warehouse_id":"ed300000-0000-4000-8000-000000000002"}' where run_id=run;
 perform pg_temp.reject(format('select post_accurate_initial_stock(%L)',run),'warehouse belongs to a different branch');perform pg_temp.assert_unposted(run);
 run:=pg_temp.batch();update import_run_rows set payload=payload-'base_unit_cost' where run_id=run;
 perform pg_temp.reject(format('select post_accurate_initial_stock(%L)',run),'missing source cost');perform pg_temp.assert_unposted(run);
 run:=pg_temp.batch();update import_run_rows set payload=payload||'{"base_unit_cost":null}' where run_id=run;
 perform pg_temp.reject(format('select post_accurate_initial_stock(%L)',run),'null source cost');perform pg_temp.assert_unposted(run);
 run:=pg_temp.batch();update import_run_rows set payload=payload||'{"base_unit_cost":""}' where run_id=run;
 perform pg_temp.reject(format('select post_accurate_initial_stock(%L)',run),'blank source cost');perform pg_temp.assert_unposted(run);
 run:=pg_temp.batch();update import_run_rows set payload=payload||'{"base_unit_cost":"   "}' where run_id=run;
 perform pg_temp.reject(format('select post_accurate_initial_stock(%L)',run),'whitespace source cost');perform pg_temp.assert_unposted(run);
 run:=pg_temp.batch(-1,10);perform pg_temp.reject(format('select post_accurate_initial_stock(%L)',run),'negative qty');perform pg_temp.assert_unposted(run);
 run:=pg_temp.batch(1,-10);perform pg_temp.reject(format('select post_accurate_initial_stock(%L)',run),'negative cost');perform pg_temp.assert_unposted(run);
 run:=pg_temp.batch(1,'NaN');perform pg_temp.reject(format('select post_accurate_initial_stock(%L)',run),'nonfinite cost');perform pg_temp.assert_unposted(run);
 -- Accounting failure must roll back stock, lots, movement and batch state.
 run:=pg_temp.batch();perform set_config('test.fail_import_journal','on',true);
 perform pg_temp.reject(format('select post_accurate_initial_stock(%L)',run),'late journal failure');perform pg_temp.assert_unposted(run);
 perform set_config('test.fail_import_journal','off',true);
 run:=pg_temp.batch();update coa_accounts set is_active=false where code='3101';
 perform pg_temp.reject(format('select post_accurate_initial_stock(%L)',run),'inactive capital account');perform pg_temp.assert_unposted(run);
 update coa_accounts set is_active=true where code='3101';
 run:=pg_temp.batch();update accounting_locks set closed_until='2026-10-01';
 perform pg_temp.reject(format('select post_accurate_initial_stock(%L)',run),'closed import date');perform pg_temp.assert_unposted(run);
 update accounting_locks set closed_until=null;
 -- Existing source-linked journals must never be duplicated, even if run state was changed.
 run:=pg_temp.batch();entry:=pg_temp.fixture_existing_import_journal(run);
 perform pg_temp.reject(format('select post_accurate_initial_stock(%L)',run),'preexisting source journal');
 perform pg_temp.assert_ok(not exists(select 1 from stock_moves where source_ref=run::text),'existing journal does not cause more stock');
 perform pg_temp.fixture_remove_import_journal(entry);
end $$;
-- A manually entered inventory opening could already include the import: require reconciliation.
do $$declare run uuid:=pg_temp.batch(); entry uuid;begin
 insert into journal_entries(tanggal,source,source_ref) values('2026-10-01','saldo-awal','import-manual-test') returning id into entry;
 insert into journal_lines(entry_id,account_id,debit,credit) select entry,id,100,0 from coa_accounts where code='1301';
 perform pg_temp.reject(format('select post_accurate_initial_stock(%L)',run),'manual inventory opening must not be duplicated');perform pg_temp.assert_unposted(run);
 delete from journal_entries where id=entry;
end $$;
-- Staff cannot post an owner's batch; no elevated write context is introduced.
do $$declare run uuid:=pg_temp.batch();begin
 perform set_config('test.import_run',run::text,true);
end $$;
select set_config('request.jwt.claim.sub','ed100000-0000-4000-8000-000000000002',true);
select pg_temp.reject(format('select post_accurate_initial_stock(%L)',current_setting('test.import_run')),'staff cannot post');
reset role;
rollback;
