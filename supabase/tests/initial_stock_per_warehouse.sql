-- Synthetic data only. Opening stock is decided per warehouse:
-- daily 1301 journals elsewhere do not block, items with history are skipped,
-- and a warehouse never receives a second Accurate opening.
begin;
insert into auth.users(id) values(md5('pw-owner')::uuid);
alter table profiles disable trigger guard_profile_privileges;
update profiles set role='OWNER',is_active=true where id=md5('pw-owner')::uuid;
alter table profiles enable trigger guard_profile_privileges;
insert into branches(id,code,name,type) values(md5('pw-branch')::uuid,'PW-B','Fiction opening branch','PETSHOP'),(md5('pw-other')::uuid,'PW-O','Fiction trading branch','PETSHOP');
insert into warehouses(id,branch_id,code,name,type) values(md5('pw-wh')::uuid,md5('pw-branch')::uuid,'PW-W','Fiction opening warehouse','RETAIL'),
 (md5('pw-other-wh')::uuid,md5('pw-other')::uuid,'PW-OW','Fiction trading warehouse','RETAIL');
insert into coa_accounts(code,name,type,normal_balance,is_header) values
 ('170001','Fiction inventory','ASET','D',false),('311001','Fiction payable','LIABILITAS','K',false),('410001','Fiction equity','EKUITAS','K',false)
on conflict(code) do update set is_active=true,is_header=false;
insert into items(id,code,name,unit,item_type) values
 (md5('pw-fresh')::uuid,'PW-FRESH','Fiction fresh item','PCS','Persediaan'),
 (md5('pw-used')::uuid,'PW-USED','Fiction item with history','PCS','Persediaan'),
 (md5('pw-late')::uuid,'PW-LATE','Fiction late item','PCS','Persediaan');
-- Normal trading elsewhere touches 1301; it must not block this warehouse's opening.
insert into journal_entries(id,no_jurnal,tanggal,source,source_ref,branch_id) values(md5('pw-purchase')::uuid,'PW.PURCHASE','2026-01-02','purchase','PW-PO',md5('pw-other')::uuid);
insert into journal_lines(entry_id,account_id,debit,credit) select md5('pw-purchase')::uuid,id,case when code='170001' then 50 else 0 end,case when code='311001' then 50 else 0 end from coa_accounts where code in('170001','311001');
-- One imported item already moved in the target warehouse.
insert into stock_moves(tanggal,warehouse_id,item_id,qty,unit_cost,source,source_ref) values('2026-01-02',md5('pw-wh')::uuid,md5('pw-used')::uuid,1,10,'purchase','PW-PO');
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('pw-owner')::uuid::text,true);
do $$ declare run uuid; eq uuid; p jsonb; rows jsonb;
 function_row jsonb:=jsonb_build_object('source_row',2,'source_code','PW-FRESH','status','valid','reason',null,
  'payload',jsonb_build_object('item_id',md5('pw-fresh')::uuid,'warehouse_id',md5('pw-wh')::uuid,'base_qty','2','base_unit_cost','10','as_of','2026-01-01',
  'source_values',jsonb_build_array(jsonb_build_object('qty','2','unit_cost','10','factor','1','unit','PCS'))));
begin
 select id into eq from coa_accounts where code='410001';
 rows:=jsonb_build_array(function_row,
  jsonb_set(jsonb_set(jsonb_set(function_row,'{source_row}','3'),'{source_code}','"PW-USED"'),'{payload,item_id}',to_jsonb(md5('pw-used')::uuid)));
 run:=prepare_accurate_initial_stock('pw-first','fiction.xlsx',md5('pw-branch')::uuid,md5('pw-wh')::uuid,'2026-01-01',rows,'STRICT');
 if (select summary->>'valid' from import_runs where id=run)<>'1' or (select summary->>'skipped' from import_runs where id=run)<>'1' then
  raise exception 'Item with history was not skipped: %',(select summary from import_runs where id=run);end if;
 if (select status||':'||coalesce(reason,'') from import_run_rows where run_id=run and source_code='PW-USED') not like 'skipped:%Stok Opname%' then
  raise exception 'Skipped row lost its reason';end if;
 p:=preview_accurate_inventory_accounting(run,eq);
 if not (p->>'can_post')::boolean then raise exception 'Daily 1301 journal elsewhere still blocks: %',p->'blockers';end if;
 perform post_accurate_inventory_accounting(run,eq,p,'Fiction opening per warehouse');
 if (select coalesce(sum(qty_in),0) from stock_layers where source_ref=run::text and item_id=md5('pw-fresh')::uuid)<>2
 or exists(select 1 from stock_layers where source_ref=run::text and item_id=md5('pw-used')::uuid) then raise exception 'Posted stock differs from selected rows';end if;
 -- Re-importing the same items: everything has history now, explain instead of a blank batch.
 begin
  perform prepare_accurate_initial_stock('pw-again','fiction.xlsx',md5('pw-branch')::uuid,md5('pw-wh')::uuid,'2026-01-01',rows,'STRICT');
  raise exception 'Expected re-import denial';
 exception when sqlstate '22023' then
  if sqlerrm not like 'Semua barang%' then raise;end if;
 end;
 if exists(select 1 from import_runs where source_hash='pw-again') then raise exception 'Denied re-import saved a run';end if;
 -- A new item for a warehouse that already has its opening is prepared but cannot post.
 run:=prepare_accurate_initial_stock('pw-late-item','fiction.xlsx',md5('pw-branch')::uuid,md5('pw-wh')::uuid,'2026-01-01',
  jsonb_build_array(jsonb_set(jsonb_set(function_row,'{source_code}','"PW-LATE"'),'{payload,item_id}',to_jsonb(md5('pw-late')::uuid))),'STRICT');
 p:=preview_accurate_inventory_accounting(run,eq);
 if (p->>'can_post')::boolean or not (p->'blockers') ? 'Gudang ini sudah punya saldo awal; koreksi jumlahnya lewat Stok Opname' then
  raise exception 'Second opening for one warehouse not blocked: %',p->'blockers';end if;
end $$;
rollback;
