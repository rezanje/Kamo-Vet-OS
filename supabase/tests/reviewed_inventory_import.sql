-- Runner prepends the reviewed main-branch fixture in a disposable transaction.
create function pg_temp.assert_import(ok boolean,message text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'Assertion failed: %',message;end if;end$$;
create function pg_temp.reject_import(command text,message text) returns void language plpgsql as $$declare failed boolean:=false;begin
 begin execute command;exception when others then failed:=true;end;
 if not failed then raise exception 'Expected rejection: %',message;end if;end$$;
create function pg_temp.reviewed_import_run(label text) returns uuid language plpgsql as $$declare run uuid:=gen_random_uuid();item uuid:=gen_random_uuid();begin
 insert into items(id,code,name,unit,item_type) values(item,'RI-'||left(item::text,8),'Reviewed import fixture','pcs','Persediaan');
 insert into import_runs(id,kind,source_name,source_hash,branch_id,warehouse_id,as_of_date,created_by,summary)
 values(run,'initial_stock','fiction.xlsx',run::text,md5('ai-branch')::uuid,md5('ai-wh')::uuid,'2026-01-01',auth.uid(),'{"valid":1}');
 insert into import_run_rows(run_id,source_row,status,payload) values(run,1,'valid',jsonb_build_object('item_id',item,'warehouse_id',md5('ai-wh')::uuid,'base_qty',10,'base_unit_cost',12.5,'as_of','2026-01-01'));
 return run;
end$$;
create function pg_temp.assert_import_unposted(run uuid) returns void language plpgsql as $$begin
 perform pg_temp.assert_import((select status='previewed' from import_runs where id=run),'failed batch stays previewed');
 perform pg_temp.assert_import(not exists(select 1 from stock_moves where source_ref=run::text),'failed batch leaves no movement');
 perform pg_temp.assert_import(not exists(select 1 from stock_layers where source_ref=run::text),'failed batch leaves no layer');
 perform pg_temp.assert_import(not exists(select 1 from journal_entries where source_ref=run::text),'failed batch leaves no journal');
 perform pg_temp.assert_import(not exists(select 1 from stock where item_id in(select (payload->>'item_id')::uuid from import_run_rows where run_id=run and status='valid')),'failed batch leaves no aggregate');
end$$;
insert into coa_accounts(code,name,type,normal_balance,is_header) values('3199','Explicit reviewed equity','EKUITAS','K',false);
update import_runs set summary='{"valid":2}' where id=md5('ai-run')::uuid;
update import_run_rows set payload=payload||'{"base_qty":2,"base_unit_cost":100,"batch_no":"FIRST"}' where run_id=md5('ai-run')::uuid and status='valid';
insert into import_run_rows(run_id,source_row,status,payload)
 select run_id,3,'valid',payload||'{"base_qty":3,"base_unit_cost":200,"batch_no":"SECOND"}' from import_run_rows where run_id=md5('ai-run')::uuid and status='valid';
do $$declare preview jsonb;result jsonb;equity uuid;begin
 select id into equity from coa_accounts where code='3199';
 preview:=preview_accurate_inventory_accounting(md5('ai-run')::uuid,equity);
 perform pg_temp.assert_import((preview->>'can_post')::boolean,'selected-equity reviewed preview allows valid mixed lots');
 perform pg_temp.assert_import((preview->>'original_value')::numeric=800,'preview source value is 2*100 + 3*200');
 result:=post_accurate_inventory_accounting(md5('ai-run')::uuid,equity,preview,'Owner reviewed explicit equity choice');
 perform pg_temp.assert_import((select count(*)=1 from journal_entries where source_ref=md5('ai-run')::uuid::text),'exactly one opening journal across every source');
 perform pg_temp.assert_import((select sum(l.debit)=800 and sum(l.credit)=0 from journal_lines l join coa_accounts a on a.id=l.account_id where l.entry_id=(result->>'entry_id')::uuid and a.code='170001'),'source value reaches inventory ledger once');
 perform pg_temp.assert_import((select credit=800 and debit=0 from journal_lines where entry_id=(result->>'entry_id')::uuid and account_id=equity),'reviewed selected equity is preserved');
 perform pg_temp.assert_import(not exists(select 1 from journal_lines l join coa_accounts a on a.id=l.account_id where l.entry_id=(result->>'entry_id')::uuid and a.code='410001'),'no automatic replacement of selected equity');
 perform pg_temp.assert_import(result=post_accurate_inventory_accounting(md5('ai-run')::uuid,equity,preview,'Owner reviewed explicit equity choice'),'exact reviewed retry returns receipt');
 perform pg_temp.assert_import((select qty=5 and (case when public.inventory_is_average() then average_cost=160 else average_cost is null end) from stock where item_id=md5('ai-item')::uuid),'mixed lots initialize the correct carrying value in the active method');
 perform pg_temp.assert_import((select sum(qty_left*unit_cost)=800 and sum(qty_left)=5 from stock_layers where source_ref=md5('ai-run')::uuid::text),'physical original costs remain unchanged');
 if public.inventory_is_average() then
  perform pg_temp.assert_import((select count(*)=2 and sum(value_delta)=800 from inventory_cost_events where source_ref=md5('ai-run')::uuid::text),'average receives exactly two source-valued events');
 end if;
 perform pg_temp.reject_import(format('select post_accurate_initial_stock(%L)',md5('ai-run')::uuid),'old direct poster is disabled');
 perform pg_temp.reject_import(format('select accurate_initial_stock_internal(%L)',md5('ai-run')::uuid),'private writer cannot bypass owner review');
end$$;
-- Raw RPC payloads preserve unknown vs explicit zero price; no master fallback.
do $$declare run uuid;cost jsonb;preview jsonb;equity uuid;begin
 select id into equity from coa_accounts where code='3199';
 foreach cost in array array['null'::jsonb,'""'::jsonb,'"   "'::jsonb] loop
  run:=pg_temp.reviewed_import_run('unknown');
  update import_run_rows set payload=jsonb_set(payload,'{base_unit_cost}',cost) where run_id=run;
  preview:=preview_accurate_inventory_accounting(run,equity);
  perform pg_temp.assert_import(not (preview->>'can_post')::boolean,'unknown source HPP blocks reviewed import');
  perform pg_temp.reject_import(format('select post_accurate_inventory_accounting(%L,%L,%L::jsonb,%L)',run,equity,preview,'Owner reviewed unknown cost fixture'),'unknown source HPP cannot post');
  perform pg_temp.assert_import_unposted(run);
 end loop;
end$$;
-- The inventory closing cutoff is visible in the same reviewed evidence as the
-- accounting cutoff, before the internal writer attempts any stock mutation.
reset role;
update inventory_costing_settings set closed_through='2026-01-31' where id and method='moving_average';
set local role authenticated;
do $$declare run uuid;preview jsonb;equity uuid;begin
 if public.inventory_is_average() then
  select id into equity from coa_accounts where code='3199';
  run:=pg_temp.reviewed_import_run('closed');
  preview:=preview_accurate_inventory_accounting(run,equity);
  perform pg_temp.assert_import(not (preview->>'can_post')::boolean,'inventory closing cutoff blocks preview');
  perform pg_temp.assert_import(preview#>>'{evidence,inventory_closed_through}'='2026-01-31','review records inventory closing cutoff');
  perform pg_temp.reject_import(format('select post_accurate_inventory_accounting(%L,%L,%L::jsonb,%L)',run,equity,preview,'Owner reviewed closed fixture'),'closed inventory date cannot post');
  perform pg_temp.assert_import_unposted(run);
 end if;
end$$;
rollback;
