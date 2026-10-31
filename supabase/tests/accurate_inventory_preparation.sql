-- Synthetic source structure only; never copy customer workbook rows here.
begin;
insert into auth.users(id) values(md5('source-precision-owner')::uuid),(md5('source-other-owner')::uuid);
alter table profiles disable trigger guard_profile_privileges;
update profiles set role='OWNER',is_active=true where id in(md5('source-precision-owner')::uuid,md5('source-other-owner')::uuid);
alter table profiles enable trigger guard_profile_privileges;
insert into branches(id,code,name,type) values(md5('source-precision-branch')::uuid,'SRC-PREC','Fiction precision branch','PETSHOP');
insert into warehouses(id,branch_id,code,name,type) values(md5('source-precision-wh')::uuid,md5('source-precision-branch')::uuid,'SRC-PREC-W','Fiction precision warehouse','RETAIL');
insert into coa_accounts(code,name,type,normal_balance,is_header) values
 ('170001','Fiction inventory','ASET','D',false),('410001','Fiction equity','EKUITAS','K',false)
on conflict(code) do update set is_active=true,is_header=false;
insert into items(id,code,name,unit,item_type) values(md5('source-precision-item')::uuid,'SRC-PREC-I','Fiction precision item','PCS','Persediaan');
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('source-precision-owner')::uuid::text,true);
do $$ declare run uuid; again uuid; eq uuid; p jsonb; receipt jsonb; rows jsonb; begin
 select id into eq from coa_accounts where code='410001';
 rows:=jsonb_build_array(jsonb_build_object('source_row',2,'source_code','SRC-PREC-I','status','valid','reason',null,
 'payload',jsonb_build_object('item_id',md5('source-precision-item')::uuid,'warehouse_id',md5('source-precision-wh')::uuid,
 'base_qty','1','base_unit_cost','0.333333','as_of','2026-01-01','source_values',jsonb_build_array(jsonb_build_object('qty','1','unit_cost','0.333333','factor','1','unit','PCS')))));
 -- Nonterminating rate allocation must fail atomically, never weaken guards.
 begin
 perform prepare_accurate_initial_stock('fiction-unrepresentable','fiction.xlsx',md5('source-precision-branch')::uuid,md5('source-precision-wh')::uuid,'2026-01-01',
 jsonb_set(rows,'{0,payload,source_values,0,qty}','"3"'),'HALF_UP_BATCH_V1');
 raise exception 'Expected unrepresentable allocation denial';
 exception when sqlstate '22023' then null;end;
 if exists(select 1 from import_runs where source_hash='fiction-unrepresentable') then raise exception 'Failed normalization saved a run';end if;
 -- Case-folded unit collisions must not choose one conversion silently.
 insert into item_units(item_id,unit,factor) values(md5('source-precision-item')::uuid,'BOX',12),(md5('source-precision-item')::uuid,'box',24);
 begin
 perform prepare_accurate_initial_stock('fiction-ambiguous-unit','fiction.xlsx',md5('source-precision-branch')::uuid,md5('source-precision-wh')::uuid,'2026-01-01',
 jsonb_set(jsonb_set(rows,'{0,payload,source_values,0,unit}','"BoX"'),'{0,payload,source_values,0,factor}','"12"'),'HALF_UP_BATCH_V1');
 raise exception 'Expected ambiguous unit denial';exception when sqlstate '22023' then null;end;
 if exists(select 1 from import_runs where source_hash='fiction-ambiguous-unit') then raise exception 'Ambiguous unit saved a run';end if;
 -- Below-half textual precision must never round a 1.004999... batch to1.01.
 declare
  boundary_rows jsonb; boundary_run uuid;
 begin
  boundary_rows:=jsonb_set(rows,'{0,payload,source_values,0,unit_cost}','"1"') ||
   jsonb_build_array(jsonb_set(jsonb_set(rows->0,'{source_row}','3'),'{payload,source_values,0,unit_cost}','"0.004999999999999999999"'));
  boundary_run:=prepare_accurate_initial_stock('fiction-text-boundary','fiction.xlsx',md5('source-precision-branch')::uuid,md5('source-precision-wh')::uuid,'2026-01-01',boundary_rows,'HALF_UP_BATCH_V1');
  if (select summary#>>'{valuation,posted_value}' from import_runs where id=boundary_run)::numeric<>1.00 then raise exception 'Text precision changed normalization target';end if;
 end;
 -- Strict rejection performs no writes, not even a partial saved batch.
 begin
 perform prepare_accurate_initial_stock('fiction-strict','fiction.xlsx',md5('source-precision-branch')::uuid,md5('source-precision-wh')::uuid,'2026-01-01',rows,'STRICT');
 raise exception 'Expected strict precision rejection';
 exception when sqlstate '22023' then null;end;
 if exists(select 1 from import_runs where source_hash='fiction-strict') then raise exception 'Strict failure saved partial run';end if;
 run:=prepare_accurate_initial_stock('fiction-normalized','fiction.xlsx',md5('source-precision-branch')::uuid,md5('source-precision-wh')::uuid,'2026-01-01',rows,'HALF_UP_BATCH_V1');
 again:=prepare_accurate_initial_stock('fiction-normalized','fiction.xlsx',md5('source-precision-branch')::uuid,md5('source-precision-wh')::uuid,'2026-01-01',rows,'HALF_UP_BATCH_V1');
 if run<>again or (select count(*) from import_run_rows where run_id=run)<>1 then raise exception 'Preparation retry duplicated batch';end if;
 if (select summary#>>'{valuation,source_value}' from import_runs where id=run)::numeric<>0.333333
 or (select summary#>>'{valuation,residual}' from import_runs where id=run)::numeric<>-0.003333 then raise exception 'Source audit lost';end if;
 -- A different account cannot recover/reuse the originating account's key.
 perform set_config('request.jwt.claim.sub',md5('source-other-owner')::uuid::text,true);
 begin
 perform prepare_accurate_initial_stock('fiction-normalized','fiction.xlsx',md5('source-precision-branch')::uuid,md5('source-precision-wh')::uuid,'2026-01-01',rows,'HALF_UP_BATCH_V1');
 raise exception 'Expected account denial';exception when sqlstate '42501' then null;end;
 perform set_config('request.jwt.claim.sub',md5('source-precision-owner')::uuid::text,true);
 perform set_config('request.headers',jsonb_build_object('x-kamo-operational-branch',md5('other-branch')::uuid)::text,true);
 begin
 perform prepare_accurate_initial_stock('fiction-wrong-branch','fiction.xlsx',md5('source-precision-branch')::uuid,md5('source-precision-wh')::uuid,'2026-01-01',rows,'HALF_UP_BATCH_V1');
 raise exception 'Expected branch denial';exception when sqlstate '42501' then null;end;
 perform set_config('request.headers','{}',true);
 p:=preview_accurate_inventory_accounting(run,eq);
 if not(p->>'can_post')::boolean then raise exception 'Normalized preview blocked: %',p->'blockers';end if;
 receipt:=post_accurate_inventory_accounting(run,eq,p,'Explicit fictional normalization');
 if receipt is distinct from post_accurate_inventory_accounting(run,eq,p,'Explicit fictional normalization') then raise exception 'Receipt differs on retry';end if;
 if (select sum(qty_in*unit_cost) from stock_layers where source_ref=run::text)<>0.33
 or (select sum(qty*unit_cost) from stock_moves where source_ref=run::text)<>0.33
 or (select sum(debit) from journal_lines where entry_id=(receipt->>'entry_id')::uuid)<>0.33
 or (select sum(debit-credit) from journal_lines where entry_id=(receipt->>'entry_id')::uuid)<>0 then raise exception 'Normalized reconciliation differs';end if;
 if prepare_accurate_initial_stock('fiction-normalized','fiction.xlsx',md5('source-precision-branch')::uuid,md5('source-precision-wh')::uuid,'2026-01-01',rows,'HALF_UP_BATCH_V1')<>run then raise exception 'Posted preparation retry failed';end if;
end $$;
rollback;
