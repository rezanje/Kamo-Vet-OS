-- Fictional multi-item opening stock. This test runs only in an owned, isolated database.
begin;
insert into auth.users(id) values(md5('m01-owner')::uuid);
alter table profiles disable trigger guard_profile_privileges;
update profiles set role='OWNER',is_active=true where id=md5('m01-owner')::uuid;
alter table profiles enable trigger guard_profile_privileges;
insert into branches(id,code,name,type) values(md5('m01-branch')::uuid,'M01-A','Fiction M01 A','PETSHOP');
insert into warehouses(id,branch_id,code,name,type) values(md5('m01-wh')::uuid,md5('m01-branch')::uuid,'M01-W','Fiction M01 warehouse','RETAIL');
insert into coa_accounts(code,name,type,normal_balance,is_header) values
 ('170001','Fiction inventory','ASET','D',false),('410001','Fiction equity','EKUITAS','K',false)
 on conflict(code) do update set is_active=true,is_header=false;
insert into items(id,code,name,unit,item_type) values
 (md5('m01-item-a')::uuid,'M01-A','Fiction item A','TAB','Persediaan'),
 (md5('m01-item-b')::uuid,'M01-B','Fiction item B','TAB','Persediaan');
insert into import_runs(id,kind,source_name,source_hash,branch_id,warehouse_id,as_of_date,created_by,summary)
 values(md5('m01-run')::uuid,'initial_stock','fiction-multi-unit.xlsx','fiction-m01-hash',md5('m01-branch')::uuid,md5('m01-wh')::uuid,'2026-01-01',md5('m01-owner')::uuid,'{"valid":3}');
-- 2 BOX * 12 TAB + 3 STRIP * 10 TAB + 5 TAB = 59 TAB and Rp590,000.
insert into import_run_rows(run_id,source_row,status,source_code,payload) values
 (md5('m01-run')::uuid,2,'valid','M01-A',jsonb_build_object('item_id',md5('m01-item-a')::uuid,'warehouse_id',md5('m01-wh')::uuid,'base_qty',24,'base_unit_cost',10000,'batch_no','B-BOX','as_of','2026-01-01')),
 (md5('m01-run')::uuid,3,'valid','M01-A',jsonb_build_object('item_id',md5('m01-item-a')::uuid,'warehouse_id',md5('m01-wh')::uuid,'base_qty',30,'base_unit_cost',10000,'batch_no','B-STRIP','as_of','2026-01-01')),
 (md5('m01-run')::uuid,4,'valid','M01-B',jsonb_build_object('item_id',md5('m01-item-b')::uuid,'warehouse_id',md5('m01-wh')::uuid,'base_qty',5,'base_unit_cost',10000,'as_of','2026-01-01'));
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('m01-owner')::uuid::text,true);
do $$
declare p jsonb; receipt jsonb; eq uuid;
begin
 select id into eq from coa_accounts where code='410001';
 p:=preview_accurate_inventory_accounting(md5('m01-run')::uuid,eq);
 if not (p->>'can_post')::boolean or (p->>'original_qty')::numeric<>59 or (p->>'original_value')::numeric<>590000 then
  raise exception 'Multi-unit preview diverged: %',p;
 end if;
 receipt:=post_accurate_inventory_accounting(md5('m01-run')::uuid,eq,p,'Fictional multi-unit accounting decision');
 if receipt is distinct from post_accurate_inventory_accounting(md5('m01-run')::uuid,eq,p,'Fictional multi-unit accounting decision') then
  raise exception 'Exact retry changed receipt';
 end if;
 if (select count(*) from journal_entries where source='accurate-stock-opening' and source_ref=md5('m01-run')::uuid::text)<>1 then
  raise exception 'Duplicate journal';
 end if;
 if exists(
  (select (payload->>'item_id')::uuid item_id,(payload->>'warehouse_id')::uuid warehouse_id,
      sum((payload->>'base_qty')::numeric) qty,
      sum((payload->>'base_qty')::numeric*(payload->>'base_unit_cost')::numeric) value
   from import_run_rows where run_id=md5('m01-run')::uuid group by 1,2
   except select item_id,warehouse_id,sum(qty_in),sum(qty_in*unit_cost)
   from stock_layers where source='saldo-awal-accurate' and source_ref=md5('m01-run')::uuid::text group by 1,2)
  union all
  (select (payload->>'item_id')::uuid,(payload->>'warehouse_id')::uuid,
      sum((payload->>'base_qty')::numeric),sum((payload->>'base_qty')::numeric*(payload->>'base_unit_cost')::numeric)
   from import_run_rows where run_id=md5('m01-run')::uuid group by 1,2
   except select item_id,warehouse_id,sum(qty),sum(qty*unit_cost)
   from stock_moves where source='saldo-awal-accurate' and source_ref=md5('m01-run')::uuid::text group by 1,2)
  union all
  (select item_id,warehouse_id,sum(qty_in),sum(qty_in*unit_cost)
   from stock_layers where source='saldo-awal-accurate' and source_ref=md5('m01-run')::uuid::text group by 1,2
   except select (payload->>'item_id')::uuid,(payload->>'warehouse_id')::uuid,
      sum((payload->>'base_qty')::numeric),sum((payload->>'base_qty')::numeric*(payload->>'base_unit_cost')::numeric)
   from import_run_rows where run_id=md5('m01-run')::uuid group by 1,2)
  union all
  (select item_id,warehouse_id,sum(qty),sum(qty*unit_cost)
   from stock_moves where source='saldo-awal-accurate' and source_ref=md5('m01-run')::uuid::text group by 1,2
   except select (payload->>'item_id')::uuid,(payload->>'warehouse_id')::uuid,
      sum((payload->>'base_qty')::numeric),sum((payload->>'base_qty')::numeric*(payload->>'base_unit_cost')::numeric)
   from import_run_rows where run_id=md5('m01-run')::uuid group by 1,2)
 ) then raise exception 'Per-item/warehouse source, layer or move mismatch';end if;
 if exists(select 1 from stock s join
   (select (payload->>'item_id')::uuid item_id,sum((payload->>'base_qty')::numeric) qty
    from import_run_rows where run_id=md5('m01-run')::uuid group by 1) expected on expected.item_id=s.item_id
    where s.warehouse_id=md5('m01-wh')::uuid and s.qty<>expected.qty)
 then raise exception 'Current stock after posting differs from source';end if;
 if not exists(
  select 1 from journal_entries j join journal_lines l on l.entry_id=j.id
  where j.id=(receipt->>'entry_id')::uuid and j.branch_id=md5('m01-branch')::uuid and j.tanggal='2026-01-01'
  group by j.id having count(*)=2 and sum(l.debit)=590000 and sum(l.credit)=590000 and sum(l.debit-l.credit)=0
 ) then raise exception 'Branch journal not balanced to source';end if;
 if not exists(
  select 1 from journal_entries j join journal_lines l on l.entry_id=j.id join coa_accounts a on a.id=l.account_id
  where j.id=(receipt->>'entry_id')::uuid
  group by j.id having count(*) filter(where a.code='170001' and l.debit=590000 and l.credit=0)=1
    and count(*) filter(where a.code='410001' and l.credit=590000 and l.debit=0)=1
 ) then raise exception 'Inventory/equity account mapping differs from source';end if;
end $$;
rollback;
