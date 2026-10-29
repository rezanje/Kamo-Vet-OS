-- Synthetic source structure only; never copy customer workbook rows here.
-- M04/M01: per-line whole-rupiah rounding, rounding difference recorded, posting unchanged.
begin;
insert into auth.users(id) values(md5('line-round-owner')::uuid);
alter table profiles disable trigger guard_profile_privileges;
update profiles set role='OWNER',is_active=true where id=md5('line-round-owner')::uuid;
alter table profiles enable trigger guard_profile_privileges;
insert into branches(id,code,name,type) values(md5('line-round-branch')::uuid,'LINE-RND','Fiction rounding branch','PETSHOP');
insert into warehouses(id,branch_id,code,name,type) values(md5('line-round-wh')::uuid,md5('line-round-branch')::uuid,'LINE-RND-W','Fiction rounding warehouse','RETAIL');
insert into coa_accounts(code,name,type,normal_balance,is_header) values
 ('1301','Fiction inventory','ASET','D',false),('3101','Fiction equity','EKUITAS','K',false)
on conflict(code) do update set is_active=true,is_header=false;
-- 40 fictional items; every 5th is stocked in BOX(12) to exercise conversion.
insert into items(id,code,name,unit,item_type)
select md5('line-round-item-'||g)::uuid,'LR-'||g,'Fiction rounding item '||g,'PCS','Persediaan' from generate_series(1,40) g;
insert into item_units(item_id,unit,factor) select md5('line-round-item-'||g)::uuid,'BOX',12 from generate_series(5,40,5) g;
create temp table line_fixture on commit drop as
select g source_row,md5('line-round-item-'||g)::uuid item_id,
 case when g%5=0 then 'BOX' else 'PCS' end unit,
 case when g%5=0 then 12::numeric else 1::numeric end factor,
 -- fractional cents and sub-cent precision; qty 3/7/11 make value/qty non-terminating
 (array[3,7,11,2,1,4,6,9])[1+g%8]::numeric qty,
 (array[3333.3333,1234.5678,99.995,0.004999,12500.125,7.777777,15000.5,2499.49])[1+g%8]::numeric+g/1000.0 unit_cost
from generate_series(1,40) g;
grant select on line_fixture to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('line-round-owner')::uuid::text,true);
do $$ declare run uuid; again uuid; eq uuid; p jsonb; receipt jsonb; rows jsonb; v jsonb;
 expected_source numeric; expected_posted numeric; parts int; begin
 select id into eq from coa_accounts where code='3101';
 select jsonb_agg(jsonb_build_object('source_row',source_row+1,'source_code','LR-'||source_row,'status','valid','reason',null,
  'payload',jsonb_build_object('item_id',item_id,'warehouse_id',md5('line-round-wh')::uuid,'base_qty',(qty*factor)::text,
  'base_unit_cost',(unit_cost/factor)::text,'as_of','2026-01-01',
  'source_values',jsonb_build_array(jsonb_build_object('qty',qty::text,'unit_cost',unit_cost::text,'factor',factor::text,'unit',unit))))
  order by source_row),
  sum(qty*unit_cost),sum(round(qty*unit_cost,0))
 into rows,expected_source,expected_posted from line_fixture;
 if expected_source=round(expected_source,2) or expected_posted=expected_source then raise exception 'Fixture must carry fractional cents';end if;
 -- Strict still refuses the same file without writing anything.
 begin
  perform prepare_accurate_initial_stock('fiction-line-strict','fiction-lines.xlsx',md5('line-round-branch')::uuid,md5('line-round-wh')::uuid,'2026-01-01',rows,'STRICT');
  raise exception 'Expected strict precision rejection';
 exception when sqlstate '22023' then null;end;
 -- The previous batch policy cannot carry a non-terminating residual; the line policy can.
 begin
  perform prepare_accurate_initial_stock('fiction-line-batch','fiction-lines.xlsx',md5('line-round-branch')::uuid,md5('line-round-wh')::uuid,'2026-01-01',rows,'HALF_UP_BATCH_V1');
 exception when sqlstate '22023' then null;end;
 begin
  perform prepare_accurate_initial_stock('fiction-line-unknown','fiction-lines.xlsx',md5('line-round-branch')::uuid,md5('line-round-wh')::uuid,'2026-01-01',rows,'ROUND_LINE_RUPIAH_V2');
  raise exception 'Expected unknown policy rejection';
 exception when sqlstate '22023' then null;end;
 run:=prepare_accurate_initial_stock('fiction-line-round','fiction-lines.xlsx',md5('line-round-branch')::uuid,md5('line-round-wh')::uuid,'2026-01-01',rows,'ROUND_LINE_RUPIAH_V1');
 again:=prepare_accurate_initial_stock('fiction-line-round','fiction-lines.xlsx',md5('line-round-branch')::uuid,md5('line-round-wh')::uuid,'2026-01-01',rows,'ROUND_LINE_RUPIAH_V1');
 if run<>again then raise exception 'Retry created another batch';end if;
 select summary->'valuation' into v from import_runs where id=run;
 if v->>'policy'<>'ROUND_LINE_RUPIAH_V1' or (v->>'source_value')::numeric<>expected_source
 or (v->>'posted_value')::numeric<>expected_posted or (v->>'residual')::numeric<>expected_posted-expected_source
 or (v->>'rounding_difference')::numeric<>expected_posted-expected_source or (v->>'source_lines')::int<>40
 or v#>>'{line_rounding,unit}'<>'1' or (v#>>'{line_rounding,split_lines}')::int<1 then
  raise exception 'Rounding evidence wrong: % expected source % posted %',v,expected_source,expected_posted;end if;
 -- Every source line carries exactly its own whole-rupiah value, split or not.
 if exists(select 1 from line_fixture f left join lateral (
   select sum((r.payload->>'base_qty')::numeric*(r.payload->>'base_unit_cost')::numeric) value,sum((r.payload->>'base_qty')::numeric) qty,count(*) parts,
    min(r.payload->>'line_value') line_value
   from import_run_rows r where r.run_id=run and r.source_row=f.source_row+1) x on true
  where x.value is distinct from round(f.qty*f.unit_cost,0) or x.qty<>f.qty*f.factor or x.line_value::numeric<>round(f.qty*f.unit_cost,0)
   or x.parts not in (1,2)) then raise exception 'A line does not carry its rounded value exactly';end if;
 select count(*) into parts from import_run_rows where run_id=run and status='valid';
 if parts<>40+(v#>>'{line_rounding,split_lines}')::int or (select (summary->>'valid')::int from import_runs where id=run)<>parts then
  raise exception 'Split rows are not counted consistently';end if;
 -- Split layers use cent rates r+0.01 and r, never a non-terminating rate.
 if exists(select 1 from import_run_rows where run_id=run and payload ? 'line_part'
  and (payload->>'base_unit_cost')::numeric<>round((payload->>'base_unit_cost')::numeric,2)) then raise exception 'Split rate is not in cents';end if;
 p:=preview_accurate_inventory_accounting(run,eq);
 if not (p->>'can_post')::boolean then raise exception 'Rounded preview blocked: %',p->'blockers';end if;
 if (p->>'original_value')::numeric<>expected_posted then raise exception 'Preview value is not the rounded total';end if;
 receipt:=post_accurate_inventory_accounting(run,eq,p,'Fictional owner decision: per-line rupiah rounding');
 if receipt is distinct from post_accurate_inventory_accounting(run,eq,p,'Fictional owner decision: per-line rupiah rounding') then raise exception 'Retry changed receipt';end if;
 if (select sum(qty_in*unit_cost) from stock_layers where source_ref=run::text)<>expected_posted
 or (select sum(qty*unit_cost) from stock_moves where source_ref=run::text)<>expected_posted
 or (select sum(debit) from journal_lines where entry_id=(receipt->>'entry_id')::uuid)<>expected_posted
 or (select sum(debit-credit) from journal_lines where entry_id=(receipt->>'entry_id')::uuid)<>0
 or (select count(*) from journal_lines where entry_id=(receipt->>'entry_id')::uuid)<>2
 or (receipt->>'amount')::numeric<>expected_posted then raise exception 'Posted stock/journal does not reconcile to rounded total';end if;
 if exists(select 1 from line_fixture f where (select qty from stock s where s.warehouse_id=md5('line-round-wh')::uuid and s.item_id=f.item_id)<>f.qty*f.factor) then
  raise exception 'Physical quantity changed by rounding';end if;
 -- The posted report still shows source, posted and rounding difference.
 p:=preview_accurate_inventory_accounting(run,eq);
 if (p#>>'{evidence,summary,valuation,rounding_difference}')::numeric<>expected_posted-expected_source
 or (p#>>'{evidence,summary,valuation,source_value}')::numeric<>expected_source or p->'receipt' is null then
  raise exception 'Posted report lost the rounding evidence';end if;
 -- Lock unchanged: posted provenance cannot be rewritten.
 begin
  update import_run_rows set payload=payload||'{"line_value":"-1"}' where run_id=run;
 exception when sqlstate '42501' then null;end;
 if exists(select 1 from import_run_rows where run_id=run and payload->>'line_value'='-1') then raise exception 'Posted provenance was rewritten';end if;
end $$;
reset role;
-- The receipt row (not readable by app roles) keeps the reviewed rounding evidence.
do $$ begin
 if (select (a.preview#>>'{evidence,summary,valuation,rounding_difference}')::numeric
  -((a.preview#>>'{evidence,summary,valuation,posted_value}')::numeric-(a.preview#>>'{evidence,summary,valuation,source_value}')::numeric)
  from accurate_inventory_accounting a join import_runs r on r.id=a.run_id where r.source_hash='fiction-line-round')<>0 then
  raise exception 'Posting receipt lost the rounding difference';end if;
 if not exists(select 1 from accurate_inventory_accounting a join import_runs r on r.id=a.run_id where r.source_hash='fiction-line-round'
  and a.preview#>>'{evidence,summary,valuation,policy}'='ROUND_LINE_RUPIAH_V1') then raise exception 'Posting receipt missing';end if;
end $$;
rollback;
