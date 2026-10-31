-- I02 atomic inventory adjustment. Fictional fixtures only, in a disposable database.
-- Run after all migrations (scripts/test-coa-mechanism-native-postgres.py).
alter table profiles disable trigger guard_profile_privileges;
alter table profiles disable trigger profiles_prevent_self_role_change;
insert into auth.users(id) values('e1100000-0000-4000-8000-000000000001'),('e1100000-0000-4000-8000-000000000002'),('e1100000-0000-4000-8000-000000000003');
update profiles set role='OWNER',is_active=true where id='e1100000-0000-4000-8000-000000000001';
update profiles set role='ADMIN',is_active=true where id='e1100000-0000-4000-8000-000000000002';
update profiles set role='STAFF',is_active=true where id='e1100000-0000-4000-8000-000000000003';
alter table profiles enable trigger guard_profile_privileges;
alter table profiles enable trigger profiles_prevent_self_role_change;
insert into branches(id,code,name,type) values('e1200000-0000-4000-8000-000000000001','ADJ','Adjustment fiction','PETSHOP'),('e1200000-0000-4000-8000-000000000002','ADJ2','Other fiction','PETSHOP');
insert into warehouses(id,branch_id,code,name,type) values('e1300000-0000-4000-8000-000000000001','e1200000-0000-4000-8000-000000000001','ADJ','Gudang fiksi','RETAIL');
insert into items(id,code,name,unit,item_type,buy_price) values
 ('e1400000-0000-4000-8000-00000000000a','ADJ-A','Barang A fiksi','pcs','Persediaan',100),
 ('e1400000-0000-4000-8000-00000000000b','ADJ-B','Barang B fiksi','pcs','Persediaan',250.5),
 ('e1400000-0000-4000-8000-00000000000c','ADJ-C','Barang C fiksi','pcs','Persediaan',40);
insert into coa_accounts(code,name,type,normal_balance) values('170001','Persediaan','ASET','D'),('720010','Selisih persediaan','BEBAN','D')
 on conflict(code) do update set is_active=true,is_header=false;
update accounting_locks set closed_until=null;
-- Opening layers: A = 10 @ 80 then 5 @ 120 (FIFO), B = 4 @ 250.5. C has no stock row.
select stock_in_fifo('e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-00000000000a',10,80,'saldo-awal','ADJ-BASE-1',current_date-2);
select stock_in_fifo('e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-00000000000a',5,120,'saldo-awal','ADJ-BASE-2',current_date-1);
select stock_in_fifo('e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-00000000000b',4,250.5,'saldo-awal','ADJ-BASE-3',current_date-1);

create function pg_temp.ok(ok boolean,msg text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'Assertion failed: %',msg;end if;end$$;
create function pg_temp.reject(statement text,expected text) returns void language plpgsql as $$declare blocked boolean:=false;begin
 begin execute statement;exception when others then blocked:=true;
  if position(expected in sqlerrm)=0 then raise exception 'Wrong rejection (expected %): %',expected,sqlerrm;end if;end;
 if not blocked then raise exception 'Expected rejection containing %: %',expected,statement;end if;
end$$;
create function pg_temp.post(key text,rows text,tanggal date default current_date,wh uuid default 'e1300000-0000-4000-8000-000000000001') returns jsonb language sql as $$
 select post_inventory_adjustment_atomic(key,wh,tanggal,'hilang','uji fiksi',rows::jsonb)
$$;
create function pg_temp.counts() returns text language sql as $$
 select format('%s/%s/%s/%s/%s',(select count(*) from inventory_adjustments),(select count(*) from inventory_adjustment_items),
  (select count(*) from stock_moves where source='penyesuaian'),(select count(*) from journal_entries where source='penyesuaian'),
  (select string_agg(item_id::text||'='||qty::text,',' order by item_id) from stock where warehouse_id='e1300000-0000-4000-8000-000000000001'))
$$;

-- 1. OWNER: A 15 -> 3 (kurang 12, FIFO 10@80 + 2@120 = 1040), B 4 -> 6 (lebih 2 @ 250.5 = 501).
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
do $$declare r jsonb;again jsonb;doc uuid;je uuid;before text;begin
 r:=pg_temp.post('adj-1','[{"item_id":"e1400000-0000-4000-8000-00000000000a","qty_baru":3},{"item_id":"e1400000-0000-4000-8000-00000000000b","qty_baru":6}]');
 doc:=(r->>'adjustment_id')::uuid;je:=(r->>'journal_id')::uuid;
 perform pg_temp.ok((r->>'already_posted')::boolean=false and r->>'no_adj' like 'PS.'||to_char(current_date,'YYYY.MM.')||'%','fresh receipt with PS number');
 perform pg_temp.ok((select qty from stock where item_id='e1400000-0000-4000-8000-00000000000a')=3 and (select qty from stock where item_id='e1400000-0000-4000-8000-00000000000b')=6,'stock moved to new counts');
 perform pg_temp.ok((select nilai_masuk=501 and nilai_keluar=1040 and created_by=auth.uid() from inventory_adjustments where id=doc),'header value: in at buy price, out at FIFO cost');
 perform pg_temp.ok((select string_agg(selisih::text||':'||nilai::text,',' order by item_id) from inventory_adjustment_items where adjustment_id=doc)='-12:1040.00,2:501.00','line snapshots and values');
 perform pg_temp.ok((select count(*)=1 from journal_entries where source='penyesuaian' and source_ref=r->>'no_adj' and id=je and branch_id='e1200000-0000-4000-8000-000000000001'),'one journal, traceable to document and branch');
 perform pg_temp.ok((select sum(debit)=sum(credit) and sum(debit)=1541 from journal_lines where entry_id=je),'journal balanced');
 perform pg_temp.ok((select sum(l.debit-l.credit) from journal_lines l join coa_accounts a on a.id=l.account_id where l.entry_id=je and a.code='170001')=-539
  and (select sum(l.debit-l.credit) from journal_lines l join coa_accounts a on a.id=l.account_id where l.entry_id=je and a.code='720010')=539,'1301 net = in - out; 5902 is the only counter account');
 perform pg_temp.ok((select sum(qty_left*unit_cost) from stock_layers where warehouse_id='e1300000-0000-4000-8000-000000000001')=(0*80+3*120+6*250.5),'layers after FIFO issue and receipt');
 reset role;
 perform pg_temp.ok(exists(select 1 from stock_document_issue_proofs where kind='adjustment' and document_id=doc),'FIFO issue proof kept for later correction');
 set local role authenticated;
 -- 2. Identical retry: same receipt, nothing new.
 before:=pg_temp.counts();
 again:=pg_temp.post('adj-1','[{"item_id":"e1400000-0000-4000-8000-00000000000b","qty_baru":6},{"item_id":"e1400000-0000-4000-8000-00000000000a","qty_baru":3}]');
 perform pg_temp.ok((again->>'already_posted')::boolean and again->>'adjustment_id'=r->>'adjustment_id' and pg_temp.counts()=before,'retry returns first receipt without double posting');
 -- 3. Same key, different content.
 perform pg_temp.reject($q$select pg_temp.post('adj-1','[{"item_id":"e1400000-0000-4000-8000-00000000000a","qty_baru":2}]')$q$,'rincian berbeda');
 perform pg_temp.ok(pg_temp.counts()=before,'conflicting retry writes nothing');
 -- 4. Posted journal and document cannot be edited through the API.
 perform pg_temp.reject(format('delete from journal_lines where entry_id=%L',je),'sudah tetap');
 perform pg_temp.reject(format('update journal_lines set debit=debit+1 where entry_id=%L and debit>0',je),'sudah tetap');
 perform pg_temp.reject(format('update journal_entries set tanggal=tanggal-1 where id=%L',je),'sudah tetap');
 perform pg_temp.reject(format('insert into journal_lines(entry_id,account_id,debit,credit) select %L,id,1,0 from coa_accounts where code=''170001''',je),'sudah tetap');
 perform pg_temp.reject(format('update inventory_adjustments set nilai_keluar=0 where id=%L',doc),'permission denied');
 perform pg_temp.reject(format('delete from inventory_adjustment_items where adjustment_id=%L',doc),'permission denied');
 perform pg_temp.reject($q$insert into inventory_adjustments(no_adj,warehouse_id,alasan) values('PS-DIRECT','e1300000-0000-4000-8000-000000000001','hilang')$q$,'permission denied');
 -- 5. Nothing to adjust / unknown stock row.
 perform pg_temp.reject($q$select pg_temp.post('adj-same','[{"item_id":"e1400000-0000-4000-8000-00000000000a","qty_baru":3}]')$q$,'Tidak ada selisih');
 perform pg_temp.reject($q$select pg_temp.post('adj-nostock','[{"item_id":"e1400000-0000-4000-8000-00000000000c","qty_baru":3}]')$q$,'belum punya saldo');
 perform pg_temp.reject($q$select pg_temp.post('adj-future','[{"item_id":"e1400000-0000-4000-8000-00000000000a","qty_baru":4}]',current_date+1)$q$,'masa depan');
 perform pg_temp.ok(pg_temp.counts()=before,'rejected requests write nothing');
end$$;
rollback;

-- 6. Gain-only and loss-only documents produce one balanced pair each; the
--    correction planner accepts a document created by the new path.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
do $$declare r jsonb;plan jsonb;begin
 r:=pg_temp.post('adj-gain','[{"item_id":"e1400000-0000-4000-8000-00000000000a","qty_baru":17}]');
 perform pg_temp.ok((select count(*)=2 and sum(debit)=200 and sum(credit)=200 from journal_lines where entry_id=(r->>'journal_id')::uuid),'gain: Dr 1301 / Cr 5902 at buy price');
 plan:=preview_stock_document_correction('adjustment',(r->>'adjustment_id')::uuid,'[{"item_id":"e1400000-0000-4000-8000-00000000000a","qty":16}]'::jsonb);
 perform pg_temp.ok((plan->>'value_before')::numeric=200 and (plan->>'value_after')::numeric=100,'official correction reads the atomic document');
end$$;
rollback;

-- 7. Authorisation, branch scope, closed period, missing account: rejected before any write.
begin;
set local role authenticated;
do $$declare before text;begin
 reset role;before:=pg_temp.counts();set local role authenticated;
 perform set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000003',true);
 perform pg_temp.reject($q$select pg_temp.post('adj-staff','[{"item_id":"e1400000-0000-4000-8000-00000000000a","qty_baru":1}]')$q$,'Hanya owner/admin');
 perform set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000002',true);
 perform set_config('request.headers','{"x-kamo-operational-branch":"e1200000-0000-4000-8000-000000000002"}',true);
 perform pg_temp.reject($q$select pg_temp.post('adj-branch','[{"item_id":"e1400000-0000-4000-8000-00000000000a","qty_baru":1}]')$q$,'tidak dapat diakses');
 perform set_config('request.headers','',true);
 reset role;
 update accounting_locks set closed_until=current_date;
 set local role authenticated;
 perform pg_temp.reject($q$select pg_temp.post('adj-closed','[{"item_id":"e1400000-0000-4000-8000-00000000000a","qty_baru":1}]')$q$,'ditutup');
 reset role;
 update accounting_locks set closed_until=null;
 update coa_accounts set is_active=false where code='720010';
 set local role authenticated;
 perform pg_temp.reject($q$select pg_temp.post('adj-noaccount','[{"item_id":"e1400000-0000-4000-8000-00000000000a","qty_baru":1}]')$q$,'belum tersedia atau tidak aktif');
 reset role;
 perform pg_temp.ok(pg_temp.counts()=before,'no document, stock or journal after any rejection');
end$$;
rollback;

-- 8. A failure at the journal step rolls back document AND stock (old app path
--    left stock moved without a journal).
create function pg_temp.fail_journal() returns trigger language plpgsql as $$begin
 if current_setting('test.fail_adj_journal',true)='on' then raise exception 'forced journal failure';end if;return new;end$$;
create trigger test_fail_adj_journal before insert on journal_lines for each row execute function pg_temp.fail_journal();
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000002',true);
do $$declare before text:=pg_temp.counts();begin
 perform set_config('test.fail_adj_journal','on',true);
 perform pg_temp.reject($q$select pg_temp.post('adj-fail','[{"item_id":"e1400000-0000-4000-8000-00000000000a","qty_baru":1},{"item_id":"e1400000-0000-4000-8000-00000000000b","qty_baru":9}]')$q$,'forced journal failure');
 reset role;
 perform pg_temp.ok(pg_temp.counts()=before and not exists(select 1 from stock_document_issue_proofs where kind='adjustment'),'journal failure leaves no partial stock or document');
 set local role authenticated;
 perform set_config('test.fail_adj_journal','off',true);
 -- ADMIN with branch access may post (same rule as the screen).
 perform pg_temp.post('adj-fail','[{"item_id":"e1400000-0000-4000-8000-00000000000a","qty_baru":1},{"item_id":"e1400000-0000-4000-8000-00000000000b","qty_baru":9}]');
 perform pg_temp.ok((select qty from stock where item_id='e1400000-0000-4000-8000-00000000000a')=1,'same key succeeds once the failure is gone');
end$$;
rollback;
drop trigger test_fail_adj_journal on journal_lines;
