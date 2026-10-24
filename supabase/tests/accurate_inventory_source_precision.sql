-- Synthetic source structure only; never copy customer workbook rows here.
begin;
insert into auth.users(id) values(md5('source-precision-owner')::uuid);
alter table profiles disable trigger guard_profile_privileges;
update profiles set role='OWNER',is_active=true where id=md5('source-precision-owner')::uuid;
alter table profiles enable trigger guard_profile_privileges;
insert into branches(id,code,name,type) values(md5('source-precision-branch')::uuid,'SRC-PREC','Fiction precision branch','PETSHOP');
insert into warehouses(id,branch_id,code,name,type) values(md5('source-precision-wh')::uuid,md5('source-precision-branch')::uuid,'SRC-PREC-W','Fiction precision warehouse','RETAIL');
insert into coa_accounts(code,name,type,normal_balance,is_header) values
 ('1301','Fiction inventory','ASET','D',false),('3101','Fiction equity','EKUITAS','K',false)
on conflict(code) do update set is_active=true,is_header=false;
insert into items(id,code,name,unit,item_type) values(md5('source-precision-item')::uuid,'SRC-PREC-I','Fiction precision item','PCS','Persediaan');
insert into import_runs(id,kind,source_name,source_hash,branch_id,warehouse_id,as_of_date,created_by,summary)
values(md5('source-fraction-run')::uuid,'initial_stock','fiction-fraction.xlsx','fiction-fraction-hash',md5('source-precision-branch')::uuid,md5('source-precision-wh')::uuid,'2026-01-01',md5('source-precision-owner')::uuid,'{"valid":1}');
insert into import_run_rows(run_id,source_row,status,payload) values(md5('source-fraction-run')::uuid,2,'valid',
 jsonb_build_object('item_id',md5('source-precision-item')::uuid,'warehouse_id',md5('source-precision-wh')::uuid,'base_qty',3,'base_unit_cost',0.333333,'as_of','2026-01-01'));
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('source-precision-owner')::uuid::text,true);
do $$ declare p jsonb; receipt jsonb; equity uuid; begin
 select id into equity from coa_accounts where code='3101';
 p:=preview_accurate_inventory_accounting(md5('source-fraction-run')::uuid,equity);
 if (p->>'can_post')::boolean or not (p->'blockers' @> '["Jumlah/nilai sumber harus positif dan tepat dua desimal; tinjau pembulatan"]'::jsonb) then
  raise exception 'Fractional-cent source unexpectedly became postable';
 end if;
 begin
  perform post_accurate_inventory_accounting(md5('source-fraction-run')::uuid,equity,p,'Fictional explicit precision review');
  raise exception 'Expected precision posting denial';
 exception when sqlstate '22023' then null;
 end;
 if exists(select 1 from stock_moves where source_ref=md5('source-fraction-run')::uuid::text)
 or exists(select 1 from stock_layers where source_ref=md5('source-fraction-run')::uuid::text)
 or exists(select 1 from journal_entries where source_ref=md5('source-fraction-run')::uuid::text)
 or (select status from import_runs where id=md5('source-fraction-run')::uuid)<>'previewed' then
  raise exception 'Denied source precision attempt wrote financial state';
 end if;
 -- A separate, explicitly valid source must still post and retry once.
 insert into import_runs(id,kind,source_name,source_hash,branch_id,warehouse_id,as_of_date,created_by,summary)
 values(md5('source-valid-run')::uuid,'initial_stock','fiction-valid.xlsx','fiction-valid-hash',md5('source-precision-branch')::uuid,md5('source-precision-wh')::uuid,'2026-01-01',md5('source-precision-owner')::uuid,'{"valid":1}');
 insert into import_run_rows(run_id,source_row,status,payload) values(md5('source-valid-run')::uuid,2,'valid',
  jsonb_build_object('item_id',md5('source-precision-item')::uuid,'warehouse_id',md5('source-precision-wh')::uuid,'base_qty',3,'base_unit_cost',12.5,'as_of','2026-01-01'));
 p:=preview_accurate_inventory_accounting(md5('source-valid-run')::uuid,equity);
 if not (p->>'can_post')::boolean then raise exception 'Exact-cent source unexpectedly blocked';end if;
 receipt:=post_accurate_inventory_accounting(md5('source-valid-run')::uuid,equity,p,'Fictional explicit valid source review');
 if receipt is distinct from post_accurate_inventory_accounting(md5('source-valid-run')::uuid,equity,p,'Fictional explicit valid source review') then raise exception 'Retry changed receipt';end if;
 if (select count(*) from journal_entries where source_ref=md5('source-valid-run')::uuid::text)<>1
 or (select qty from stock where warehouse_id=md5('source-precision-wh')::uuid and item_id=md5('source-precision-item')::uuid)<>3
 or (select sum(qty_in*unit_cost) from stock_layers where source_ref=md5('source-valid-run')::uuid::text)<>37.5
 or (select sum(debit) from journal_lines where entry_id=(receipt->>'entry_id')::uuid)<>37.5
 or (select sum(debit-credit) from journal_lines where entry_id=(receipt->>'entry_id')::uuid)<>0 then
  raise exception 'Source qty/value or single balanced journal reconciliation failed';
 end if;
end $$;
rollback;
