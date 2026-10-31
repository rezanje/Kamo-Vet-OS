-- Fictional fixtures in the runner's owned network-isolated database only.
alter table profiles disable trigger guard_profile_privileges;
alter table profiles disable trigger profiles_prevent_self_role_change;
insert into auth.users(id) values('ef100000-0000-4000-8000-000000000001'),('ef100000-0000-4000-8000-000000000002'),('ef100000-0000-4000-8000-000000000003');
update profiles set role='OWNER',is_active=true where id='ef100000-0000-4000-8000-000000000001';
update profiles set role='ADMIN',is_active=true where id='ef100000-0000-4000-8000-000000000002';
update profiles set role='OWNER',is_active=false where id='ef100000-0000-4000-8000-000000000003';
alter table profiles enable trigger guard_profile_privileges;
alter table profiles enable trigger profiles_prevent_self_role_change;
insert into branches(id,code,name,type) values('ef200000-0000-4000-8000-000000000001','SC','Stock correction fiction','KLINIK');
insert into warehouses(id,branch_id,code,name,type) values('ef300000-0000-4000-8000-000000000001','ef200000-0000-4000-8000-000000000001','SC','Fictional warehouse','VET');
insert into items(id,code,name,unit,item_type,buy_price) values('ef400000-0000-4000-8000-000000000001','SC','Fictional goods','pcs','Persediaan',100);
insert into coa_accounts(code,name,type,normal_balance) values('170001','Inventory','ASET','D'),('720010','Variance','BEBAN','D') on conflict(code) do update set is_active=true,is_header=false;

create function test_stock_source(kind text, ref text, qty numeric, baseline numeric default 0) returns uuid language plpgsql security definer as $$
declare doc uuid:=gen_random_uuid();ord uuid:=gen_random_uuid();je uuid:=gen_random_uuid();begin
 if kind='adjustment' then
  insert into inventory_adjustments(id,no_adj,warehouse_id,tanggal,alasan,nilai_masuk,nilai_keluar) values(doc,ref,'ef300000-0000-4000-8000-000000000001',current_date,'temuan',greatest(qty*100,0),greatest(-qty*100,0));
  insert into inventory_adjustment_items(adjustment_id,item_id,nama,qty_sistem,qty_baru,selisih,nilai) values(doc,'ef400000-0000-4000-8000-000000000001','Fictional goods',baseline,baseline+qty,qty,abs(qty*100));
 else
  insert into opname_orders(id,no_opname,warehouse_id,penanggung_jawab,status) values(ord,'OPO.'||ref,'ef300000-0000-4000-8000-000000000001','Fictional','Selesai');
  insert into opname_results(id,no_hasil,order_id,tanggal) values(doc,ref,ord,current_date);
  insert into opname_result_items(result_id,item_id,qty_sistem,qty_fisik,selisih) values(doc,'ef400000-0000-4000-8000-000000000001',baseline,baseline+qty,qty);
 end if;
 if baseline>0 then perform stock_in_fifo('ef300000-0000-4000-8000-000000000001','ef400000-0000-4000-8000-000000000001',baseline,100,'saldo-awal','BASE.'||ref,current_date);end if;
 if qty>0 then perform stock_in_fifo('ef300000-0000-4000-8000-000000000001','ef400000-0000-4000-8000-000000000001',qty,100,case kind when 'adjustment' then 'penyesuaian' else 'opname' end,ref,current_date);
 elsif qty<0 then perform stock_out_fifo('ef300000-0000-4000-8000-000000000001','ef400000-0000-4000-8000-000000000001',-qty,case kind when 'adjustment' then 'penyesuaian' else 'opname' end,ref,current_date);end if;
 insert into journal_entries(id,no_jurnal,tanggal,source,source_ref,branch_id,deskripsi) values(je,'SC.'||ref,current_date,case kind when 'adjustment' then 'penyesuaian' else 'opname' end,ref,'ef200000-0000-4000-8000-000000000001','Fictional stock source');
 insert into journal_lines(entry_id,account_id,debit,credit) select je,id,case code when '170001' then greatest(qty*100,0) else greatest(-qty*100,0) end,case code when '720010' then greatest(qty*100,0) else greatest(-qty*100,0) end from coa_accounts where code in('170001','720010');
 return doc;
end $$;

create function pg_temp.reject(query text,message text) returns void language plpgsql as $$begin
 begin execute query;exception when others then if sqlerrm like '%'||message||'%' then return;end if;raise;end;
 raise exception 'Expected rejection containing %: %',message,query;
end$$;

begin;
create function pg_temp.assert_true(ok boolean,msg text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception '%',msg;end if;end$$;
select set_config('request.jwt.claim.sub','ef100000-0000-4000-8000-000000000001',true);
do $$declare doc uuid;plan jsonb;result jsonb;retry jsonb;rows jsonb:='[{"item_id":"ef400000-0000-4000-8000-000000000001","qty":3}]';before_doc jsonb;begin
 doc:=test_stock_source('adjustment','SUCCESS',5);
 update stock_layers set exp_date=current_date+30 where source_ref='SUCCESS';
 select to_jsonb(d) into before_doc from inventory_adjustments d where id=doc;
 set local role authenticated;
 plan:=preview_stock_document_correction('adjustment',doc,rows);
 perform pg_temp.assert_true((plan->'lines'->0->>'stock_after')::numeric=3,'Preview must show current stock + correction delta');
 perform pg_temp.assert_true((select qty from stock where item_id='ef400000-0000-4000-8000-000000000001')=5,'Preview mutated stock');
 result:=correct_stock_document('adjustment',doc,rows,'Fix incorrect count','success-key',plan->>'token');
 retry:=correct_stock_document('adjustment',doc,rows,'Fix incorrect count','success-key',plan->>'token');
 perform pg_temp.assert_true(result=retry,'Retry changed result');
 perform pg_temp.assert_true((select qty from stock where item_id='ef400000-0000-4000-8000-000000000001')=3,'Correction qty incorrect');
 perform pg_temp.assert_true((select to_jsonb(d) from inventory_adjustments d where id=doc)=before_doc,'Original document changed');
 perform pg_temp.assert_true((select sum(qty*unit_cost) from stock_moves)=300,'Stock card value mismatch');
 perform pg_temp.assert_true((select sum(qty_left*unit_cost) from stock_layers)=300,'FIFO value mismatch');
 perform pg_temp.assert_true((select exp_date from stock_layers where source='stock-correction')=current_date+30,'Incoming replacement lost source expiry');
 perform pg_temp.assert_true((select sum(l.debit-l.credit) from journal_lines l join coa_accounts a on a.id=l.account_id where a.code='170001')=300,'Inventory journal mismatch');
 begin perform correct_stock_document('adjustment',doc,rows,'Different reason','success-key',plan->>'token');raise exception 'expected key conflict';exception when others then if sqlerrm='expected key conflict' or sqlerrm not like '%Identitas%' then raise;end if;end;
 reset role;
end$$;
rollback;

begin;
select set_config('request.jwt.claim.sub','ef100000-0000-4000-8000-000000000001',true);
do $$declare doc uuid:=gen_random_uuid();ord uuid:=gen_random_uuid();je uuid:=gen_random_uuid();plan jsonb;rows jsonb:='[{"item_id":"ef400000-0000-4000-8000-000000000001","qty":9}]';begin
 perform stock_in_fifo('ef300000-0000-4000-8000-000000000001','ef400000-0000-4000-8000-000000000001',10,100,'saldo-awal','OP-NEG-BASE',current_date);
 insert into opname_orders(id,no_opname,warehouse_id,penanggung_jawab,status) values(ord,'OPO.NEW-NEG','ef300000-0000-4000-8000-000000000001','Fictional','Selesai');
 insert into opname_results(id,no_hasil,order_id,tanggal,created_by) values(doc,'OPR.NEW-NEG',ord,current_date,auth.uid());
 insert into opname_result_items(result_id,item_id,qty_sistem,qty_fisik,selisih) values(doc,'ef400000-0000-4000-8000-000000000001',10,8,-2);
 set local role authenticated;
 perform issue_stock_document_recorded('opname',doc,'ef400000-0000-4000-8000-000000000001');
 reset role;
 insert into journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id) values(je,'OPR.NEW-NEG',current_date,'Fiction','opname','OPR.NEW-NEG','ef200000-0000-4000-8000-000000000001');
 insert into journal_lines(entry_id,account_id,debit,credit) select je,id,case code when '720010' then 200 else 0 end,case code when '170001' then 200 else 0 end from coa_accounts where code in('170001','720010');
 set local role authenticated;
 plan:=preview_stock_document_correction('opname',doc,rows);
 perform correct_stock_document('opname',doc,rows,'Correct recorded opname shortage','op-negative-proof',plan->>'token');
 if (select qty from stock where item_id='ef400000-0000-4000-8000-000000000001')<>9 then raise exception 'Outgoing opname correction failed';end if;
 if (select qty_fisik from opname_result_items where result_id=doc)<>8 then raise exception 'Original opname count changed';end if;
 reset role;
end$$;
rollback;

-- Future outgoing source documents retain exact mixed-cost/expiry allocations;
-- a later correction restores the original lots before consuming the replacement.
begin;
create function pg_temp.fail_source_proof() returns trigger language plpgsql as $$begin
 if current_setting('test.fail_source_proof',true)='on' then raise exception 'forced source proof failure';end if;return new;
end$$;
create trigger test_source_proof_failure before insert on stock_document_issue_proofs for each row execute function pg_temp.fail_source_proof();
select set_config('request.jwt.claim.sub','ef100000-0000-4000-8000-000000000001',true);
do $$declare doc uuid:=gen_random_uuid();je uuid:=gen_random_uuid();issue jsonb;plan jsonb;rows jsonb:='[{"item_id":"ef400000-0000-4000-8000-000000000001","qty":5}]';begin
 perform stock_in_fifo('ef300000-0000-4000-8000-000000000001','ef400000-0000-4000-8000-000000000001',8,100,'saldo-awal','PROOF-BASE',current_date,current_date+30);
 perform stock_in_fifo('ef300000-0000-4000-8000-000000000001','ef400000-0000-4000-8000-000000000001',2,200,'saldo-awal','PROOF-BASE',current_date,current_date+60);
 insert into inventory_adjustments(id,no_adj,warehouse_id,tanggal,alasan,nilai_keluar,created_by) values(doc,'NEW-NEGATIVE','ef300000-0000-4000-8000-000000000001',current_date,'hilang',1000,auth.uid());
 insert into inventory_adjustment_items(adjustment_id,item_id,nama,qty_sistem,qty_baru,selisih,nilai) values(doc,'ef400000-0000-4000-8000-000000000001','Fictional goods',10,1,-9,1000);
 set local role authenticated;
 perform set_config('request.jwt.claim.sub','ef100000-0000-4000-8000-000000000002',true);
 perform pg_temp.reject(format('select issue_stock_document_recorded(%L,%L,%L)','adjustment',doc,'ef400000-0000-4000-8000-000000000001'),'ditolak');
 perform set_config('request.jwt.claim.sub','ef100000-0000-4000-8000-000000000001',true);
 perform set_config('test.fail_source_proof','on',true);
 perform pg_temp.reject(format('select issue_stock_document_recorded(%L,%L,%L)','adjustment',doc,'ef400000-0000-4000-8000-000000000001'),'forced source proof failure');
 if (select qty from stock where item_id='ef400000-0000-4000-8000-000000000001')<>10 or exists(select 1 from stock_moves where source_ref='NEW-NEGATIVE') then raise exception 'Failed proof left partial stock issuance';end if;
 perform set_config('test.fail_source_proof','off',true);
 issue:=issue_stock_document_recorded('adjustment',doc,'ef400000-0000-4000-8000-000000000001');
 if issue is distinct from issue_stock_document_recorded('adjustment',doc,'ef400000-0000-4000-8000-000000000001') then raise exception 'Issuance retry changed';end if;
 reset role;
 insert into journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id) values(je,'NEW-NEGATIVE',current_date,'Fiction','penyesuaian','NEW-NEGATIVE','ef200000-0000-4000-8000-000000000001');
 insert into journal_lines(entry_id,account_id,debit,credit) select je,id,case code when '720010' then 1000 else 0 end,case code when '170001' then 1000 else 0 end from coa_accounts where code in('170001','720010');
 set local role authenticated;
 plan:=preview_stock_document_correction('adjustment',doc,rows);
 perform correct_stock_document('adjustment',doc,rows,'Correct recorded shortage','mixed-proof',plan->>'token');
 if (select sum(qty_left*unit_cost) from stock_layers)<>700 or (select qty from stock where item_id='ef400000-0000-4000-8000-000000000001')<>5 then raise exception 'Mixed-cost/expiry FIFO correction failed';end if;
 if (select sum(qty_left) from stock_layers where unit_cost=200)<>2 then raise exception 'Original expensive lot not restored';end if;
 reset role;
end$$;
rollback;

begin;
select set_config('request.jwt.claim.sub','ef100000-0000-4000-8000-000000000001',true);
do $$declare doc uuid;rows jsonb:='[{"item_id":"ef400000-0000-4000-8000-000000000001","qty":3}]';begin
 -- The count snapshot preceded sales, so the recorded physical amount exceeds
 -- current stock even though its incoming correction layer remains untouched.
 doc:=test_stock_source('adjustment','INSUFFICIENT',5,5);
 update inventory_adjustment_items set qty_sistem=10,qty_baru=15 where adjustment_id=doc;
 set local role authenticated;
 perform pg_temp.reject(format('select preview_stock_document_correction(%L,%L,%L)','adjustment',doc,rows),'Stok tidak cukup');
 reset role;
end$$;
rollback;

begin;
select set_config('request.jwt.claim.sub','ef100000-0000-4000-8000-000000000001',true);
do $$declare doc uuid;plan jsonb;rows jsonb:='[{"item_id":"ef400000-0000-4000-8000-000000000001","qty":3}]';begin
 doc:=test_stock_source('opname','RETURN-DEP',5);
 set local role authenticated;
 plan:=preview_stock_document_correction('opname',doc,rows);
 perform correct_stock_document('opname',doc,rows,'Correct before return','before-return',plan->>'token');
 reset role;
 perform stock_in_fifo('ef300000-0000-4000-8000-000000000001','ef400000-0000-4000-8000-000000000001',1,100,'retur-jual','DEPENDENT-RETURN',current_date);
 set local role authenticated;
 rows:='[{"item_id":"ef400000-0000-4000-8000-000000000001","qty":4}]';
 perform pg_temp.reject(format('select preview_stock_document_correction(%L,%L,%L)','opname',doc,rows),'diretur');
 reset role;
end$$;
rollback;

-- Exact FIFO reversal of a newly recorded negative replacement, cancellation to
-- the source baseline, fractional quantities, and immutable ledger/audit history.
begin;
select set_config('request.jwt.claim.sub','ef100000-0000-4000-8000-000000000001',true);
do $$declare doc uuid;plan jsonb;result jsonb;rows jsonb;begin
 doc:=test_stock_source('adjustment','SIGN',5,10);
 update inventory_adjustments set created_at=now()-interval '1 day' where id=doc;
 update stock_layers set exp_date=current_date+30 where source_ref='SIGN';
 rows:='[{"item_id":"ef400000-0000-4000-8000-000000000001","qty":8}]';
 set local role authenticated;
 plan:=preview_stock_document_correction('adjustment',doc,rows);
 result:=correct_stock_document('adjustment',doc,rows,'Correct to shortage','sign-negative',plan->>'token');
 if (select qty from stock where item_id='ef400000-0000-4000-8000-000000000001')<>8 then raise exception 'Negative replacement failed';end if;
 rows:='[{"item_id":"ef400000-0000-4000-8000-000000000001","qty":9.5}]';
 plan:=preview_stock_document_correction('adjustment',doc,rows);
 perform correct_stock_document('adjustment',doc,rows,'Correct fractional count','sign-restore',plan->>'token');
 if (select qty from stock where item_id='ef400000-0000-4000-8000-000000000001')<>9.5 then raise exception 'Exact negative FIFO reversal failed';end if;
 rows:='[{"item_id":"ef400000-0000-4000-8000-000000000001","qty":10}]';
 plan:=preview_stock_document_correction('adjustment',doc,rows);
 perform correct_stock_document('adjustment',doc,rows,'Cancel original stock effect','sign-cancel',plan->>'token');
 if (select sum(qty_left*unit_cost) from stock_layers)<>1000 then raise exception 'Cancellation did not restore original layers';end if;
 if (select sum(l.debit-l.credit) from journal_lines l join coa_accounts a on a.id=l.account_id where a.code='170001')<>0 then raise exception 'Cancellation journal net is not zero';end if;
 rows:='[{"item_id":"ef400000-0000-4000-8000-000000000001","qty":11}]';
 plan:=preview_stock_document_correction('adjustment',doc,rows);
 perform correct_stock_document('adjustment',doc,rows,'Correct after zero-effect cancellation','after-zero',plan->>'token');
 if (select qty from stock where item_id='ef400000-0000-4000-8000-000000000001')<>11 then raise exception 'Correction after zero-effect replacement failed';end if;
 if (select exp_date from stock_layers where source='stock-correction' and qty_left>0) is distinct from current_date+30 then raise exception 'Cancellation chain lost known source expiry';end if;
 if (get_stock_document_correction_result('adjustment',doc,'sign-negative')->>'correction_id') is distinct from result->>'correction_id' then raise exception 'Recovery did not preserve original result';end if;
 begin update inventory_adjustments set keterangan='tamper' where id=doc;raise exception 'source tamper accepted';exception when insufficient_privilege then null;end;
 begin delete from stock_moves where source='stock-correction';raise exception 'stock ledger delete accepted';exception when insufficient_privilege then null;end;
 begin update journal_lines set debit=0 where entry_id in(select id from journal_entries where source='stock-correction');raise exception 'journal tamper accepted';exception when insufficient_privilege then null;end;
 begin select * from stock_document_correction_requests;raise exception 'private retry table exposed';exception when insufficient_privilege then null;end;
 reset role;
end$$;
rollback;

begin;
select set_config('request.jwt.claim.sub','ef100000-0000-4000-8000-000000000001',true);
do $$declare doc uuid;plan jsonb;rows jsonb:='[{"item_id":"ef400000-0000-4000-8000-000000000001","qty":3}]';begin
 doc:=test_stock_source('adjustment','GUARDS',5);
 set local role authenticated;
 perform set_config('request.jwt.claim.sub','ef100000-0000-4000-8000-000000000002',true);
 perform pg_temp.reject(format('select preview_stock_document_correction(%L,%L,%L)','adjustment',doc,rows),'Super Admin');
 perform pg_temp.reject(format('select correct_stock_document(%L,%L,%L,%L,%L,%L)','adjustment',doc,rows,'Denied','denied','token'),'Super Admin');
 perform set_config('request.jwt.claim.sub','ef100000-0000-4000-8000-000000000003',true);
 perform pg_temp.reject(format('select get_stock_document_correction_result(%L,%L,%L)','adjustment',doc,'key'),'Super Admin');
 perform set_config('request.jwt.claim.sub','ef100000-0000-4000-8000-000000000001',true);
 perform pg_temp.reject(format('select preview_stock_document_correction(%L,%L,%L)','adjustment',doc,rows||rows),'seluruh barang');
 perform pg_temp.reject(format('select preview_stock_document_correction(%L,%L,%L)','adjustment',doc,'[{"item_id":"ef400000-0000-4000-8000-000000000001","qty":"NaN"}]'),'seluruh barang');
 plan:=preview_stock_document_correction('adjustment',doc,rows);
 reset role;
 update items set buy_price=101 where id='ef400000-0000-4000-8000-000000000001';
 set local role authenticated;
 perform pg_temp.reject(format('select correct_stock_document(%L,%L,%L,%L,%L,%L)','adjustment',doc,rows,'Stale price','stale',plan->>'token'),'Preview berubah');
 reset role;
 update items set buy_price=100 where id='ef400000-0000-4000-8000-000000000001';
 update accounting_locks set closed_until=current_date where id;
 set local role authenticated;
 perform pg_temp.reject(format('select preview_stock_document_correction(%L,%L,%L)','adjustment',doc,rows),'ditutup');
 reset role;
 update accounting_locks set closed_until=null where id;
 perform stock_out_fifo('ef300000-0000-4000-8000-000000000001','ef400000-0000-4000-8000-000000000001',1,'transfer','DEPENDENT',current_date);
 set local role authenticated;
 perform pg_temp.reject(format('select preview_stock_document_correction(%L,%L,%L)','adjustment',doc,rows),'terpakai');
 reset role;
end$$;
rollback;

begin;
select set_config('request.jwt.claim.sub','ef100000-0000-4000-8000-000000000001',true);
do $$declare doc uuid;inv uuid;rows jsonb:='[{"item_id":"ef400000-0000-4000-8000-000000000001","qty":3}]';begin
 doc:=test_stock_source('opname','TAGIHAN',5);
 insert into sales_invoices(no_faktur,tanggal,branch_id,kategori,dpp,ppn,total) values('FJS.TEST',current_date,'ef200000-0000-4000-8000-000000000001','selisih_stok',100,0,100) returning id into inv;
 update opname_results set invoice_id=inv where id=doc;
 set local role authenticated;
 perform pg_temp.reject(format('select preview_stock_document_correction(%L,%L,%L)','opname',doc,rows),'faktur tagihan');
 reset role;
end$$;
rollback;

begin;
select set_config('request.jwt.claim.sub','ef100000-0000-4000-8000-000000000001',true);
do $$declare doc uuid;rows jsonb:='[{"item_id":"ef400000-0000-4000-8000-000000000001","qty":9}]';begin
 doc:=test_stock_source('adjustment','LEGACY-NEGATIVE',-2,10);
 set local role authenticated;
 perform pg_temp.reject(format('select preview_stock_document_correction(%L,%L,%L)','adjustment',doc,rows),'Bukti FIFO');
 reset role;
end$$;
rollback;

-- A failure after stock reversal/replacement AND reversal journals must leave
-- documents, FIFO, ledger, audit, and durable retry storage byte-for-byte intact.
begin;
create function pg_temp.fail_stock_replacement() returns trigger language plpgsql as $$begin
 if exists(select 1 from public.journal_entries where id=new.entry_id and source='stock-correction') then raise exception 'forced replacement journal failure';end if;return new;
end$$;
create trigger test_stock_replacement_failure before insert on journal_lines for each row execute function pg_temp.fail_stock_replacement();
create function pg_temp.snapshot_stock_correction() returns jsonb language sql as $$select jsonb_build_object(
 'docs',(select jsonb_agg(to_jsonb(t) order by id) from inventory_adjustments t),
 'items',(select jsonb_agg(to_jsonb(t) order by id) from inventory_adjustment_items t),
 'stock',(select jsonb_agg(to_jsonb(t) order by id) from stock t),
 'layers',(select jsonb_agg(to_jsonb(t) order by id) from stock_layers t),
 'moves',(select jsonb_agg(to_jsonb(t) order by id) from stock_moves t),
 'entries',(select jsonb_agg(to_jsonb(t) order by id) from journal_entries t),
 'lines',(select jsonb_agg(to_jsonb(t) order by id) from journal_lines t),
 'audit',(select jsonb_agg(to_jsonb(t) order by id) from stock_document_corrections t),
 'requests',(select jsonb_agg(to_jsonb(t) order by actor_id,request_key) from stock_document_correction_requests t));$$;
select set_config('request.jwt.claim.sub','ef100000-0000-4000-8000-000000000001',true);
do $$declare doc uuid;plan jsonb;before_state jsonb;rows jsonb:='[{"item_id":"ef400000-0000-4000-8000-000000000001","qty":3}]';begin
 doc:=test_stock_source('adjustment','ROLLBACK',5);
 before_state:=pg_temp.snapshot_stock_correction();
 set local role authenticated;
 plan:=preview_stock_document_correction('adjustment',doc,rows);
 perform pg_temp.reject(format('select correct_stock_document(%L,%L,%L,%L,%L,%L)','adjustment',doc,rows,'Forced rollback','fail-key',plan->>'token'),'forced replacement');
 reset role;
 if before_state is distinct from pg_temp.snapshot_stock_correction() then raise exception 'Partial stock/journal/audit effects leaked after failure';end if;
end$$;
rollback;

begin;
select set_config('request.jwt.claim.sub','ef100000-0000-4000-8000-000000000001',true);
do $$declare doc uuid;plan jsonb;rows jsonb:='[{"item_id":"ef400000-0000-4000-8000-000000000001","qty":2}]';begin
 doc:=test_stock_source('opname','OPNAME',4);
 set local role authenticated;
 plan:=preview_stock_document_correction('opname',doc,rows);
 perform correct_stock_document('opname',doc,rows,'Correct physical count','opname-key',plan->>'token');
 if (select qty from stock where item_id='ef400000-0000-4000-8000-000000000001')<>2 then raise exception 'Opname correction failed';end if;
 if (get_stock_document_correction('opname',doc)->'rows'->0->>'qty')::numeric<>2 then raise exception 'Effective result reader stale';end if;
 reset role;
end$$;
rollback;
