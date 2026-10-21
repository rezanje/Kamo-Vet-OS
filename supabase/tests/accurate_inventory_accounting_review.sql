-- Entirely fictional fixtures; runner owns an isolated network-none database.
begin;
insert into auth.users(id) values(md5('ai-owner')::uuid),(md5('ai-admin')::uuid);
alter table profiles disable trigger guard_profile_privileges;
update profiles set role=case when id=md5('ai-owner')::uuid then 'OWNER'::user_role else 'ADMIN'::user_role end,is_active=true where id in(md5('ai-owner')::uuid,md5('ai-admin')::uuid);
alter table profiles enable trigger guard_profile_privileges;
insert into branches(id,code,name,type) values(md5('ai-branch')::uuid,'AI-A','Fiction A','PETSHOP'),(md5('ai-other')::uuid,'AI-B','Fiction B','PETSHOP');
insert into warehouses(id,branch_id,code,name,type) values(md5('ai-wh')::uuid,md5('ai-branch')::uuid,'AI-W','Fiction W','RETAIL');
insert into coa_accounts(code,name,type,normal_balance,is_header) values('1301','Fiction inventory','ASET','D',false),('3101','Fiction equity','EKUITAS','K',false) on conflict(code) do update set is_active=true,is_header=false;
insert into items(id,code,name,unit,item_type) values(md5('ai-item')::uuid,'AI-I','Fiction item','pcs','Persediaan');
insert into import_runs(id,kind,source_name,source_hash,branch_id,warehouse_id,as_of_date,created_by,summary) values(md5('ai-run')::uuid,'initial_stock','fiction.xlsx','fiction-hash',md5('ai-branch')::uuid,md5('ai-wh')::uuid,'2026-01-01',md5('ai-owner')::uuid,'{"valid":1}');
insert into import_run_rows(run_id,source_row,status,payload) values(md5('ai-run')::uuid,1,'valid',jsonb_build_object('item_id',md5('ai-item')::uuid,'warehouse_id',md5('ai-wh')::uuid,'base_qty',10,'base_unit_cost',12.5,'as_of','2026-01-01')),(md5('ai-run')::uuid,2,'rejected','{"base_qty":999,"base_unit_cost":999}');
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('ai-owner')::uuid::text,true);
-- Establish one valid batch receipt for source/history guards.
do $$ declare p jsonb; eq uuid; begin
 select id into eq from coa_accounts where code='3101';
 p:=preview_accurate_inventory_accounting(md5('ai-run')::uuid,eq);
 perform post_accurate_inventory_accounting(md5('ai-run')::uuid,eq,p,'Fiction explicit equity approval');
end $$;
-- A direct source spoof cannot create an untracked bridge journal.
do $$ begin
 begin
  insert into journal_entries(no_jurnal,tanggal,source,source_ref,branch_id)
   values('AI-SPOOF','2026-01-01','accurate-stock-opening',md5('ai-spoof')::uuid::text,md5('ai-branch')::uuid);
  raise exception 'Expected bridge source spoof denial';
 exception when insufficient_privilege then null;end;
end $$;
-- Checking only line inserts is insufficient: changing an existing header source
-- must also prevent a second global inventory opening after a bridge receipt.
insert into journal_entries(id,no_jurnal,tanggal,source,source_ref,branch_id)
 values(md5('ai-forged')::uuid,'AI-FORGED','2026-01-01','manual','AI-FORGED',null);
insert into journal_lines(entry_id,account_id,debit,credit)
 select md5('ai-forged')::uuid,id,case when code='1301' then 125 else 0 end,case when code='3101' then 125 else 0 end
 from coa_accounts where code in('1301','3101');
do $$ begin
 begin
  update journal_entries set source='saldo-awal' where id=md5('ai-forged')::uuid;
  raise exception 'Expected global-opening header-source denial';
 exception when insufficient_privilege then null;end;
end $$;
delete from journal_entries where id=md5('ai-forged')::uuid;
-- A second clean batch has no blockers except the intentionally missing period
-- configuration. An absent singleton must never mean an open period.
insert into items(id,code,name,unit,item_type) values(md5('ai-item-2')::uuid,'AI-I2','Fiction item 2','pcs','Persediaan');
insert into import_runs(id,kind,source_name,source_hash,branch_id,warehouse_id,as_of_date,created_by,summary)
 values(md5('ai-run-2')::uuid,'initial_stock','fiction2.xlsx','fiction-hash2',md5('ai-branch')::uuid,md5('ai-wh')::uuid,'2026-01-01',md5('ai-owner')::uuid,'{"valid":1}');
insert into import_run_rows(run_id,source_row,status,payload)
 values(md5('ai-run-2')::uuid,1,'valid',jsonb_build_object('item_id',md5('ai-item-2')::uuid,'warehouse_id',md5('ai-wh')::uuid,'base_qty',10,'base_unit_cost',12.5,'as_of','2026-01-01'));
delete from accounting_locks;
do $$ declare p jsonb; begin
 p:=preview_accurate_inventory_accounting(md5('ai-run-2')::uuid,(select id from coa_accounts where code='3101'));
 if (p->>'can_post')::boolean then raise exception 'Missing accounting lock row was treated as open';end if;
 if exists(select 1 from stock_moves where source_ref=md5('ai-run-2')::uuid::text) then raise exception 'Missing-lock preview wrote stock';end if;
end $$;
insert into accounting_locks(id) values(true);
update import_runs set as_of_date='-infinity' where id=md5('ai-run-2')::uuid;
update import_run_rows set payload=jsonb_set(payload,'{as_of}','"-infinity"') where run_id=md5('ai-run-2')::uuid;
do $$ declare p jsonb; begin
 p:=preview_accurate_inventory_accounting(md5('ai-run-2')::uuid,(select id from coa_accounts where code='3101'));
 if (p->>'can_post')::boolean then raise exception 'Nonfinite date was allowed in accounting preview';end if;
end $$;
rollback;
