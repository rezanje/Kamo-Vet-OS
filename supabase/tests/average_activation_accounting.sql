-- Owned fictional PostgreSQL only. Activation failure must have no side effects.
begin;
insert into auth.users(id) values(md5('ag-owner')::uuid),(md5('ag-admin')::uuid);
alter table profiles disable trigger guard_profile_privileges;
update profiles set role=case when id=md5('ag-owner')::uuid then 'OWNER'::user_role else 'ADMIN'::user_role end,is_active=true where id in(md5('ag-owner')::uuid,md5('ag-admin')::uuid);
alter table profiles enable trigger guard_profile_privileges;
insert into branches(id,code,name,type) values(md5('ag-branch')::uuid,'AG-B','Fiction first branch','PETSHOP'),(md5('ag-branch2')::uuid,'AG-C','Fiction second branch','PETSHOP');
insert into warehouses(id,branch_id,code,name,type) values(md5('ag-wh')::uuid,md5('ag-branch')::uuid,'AG-W','Fiction first warehouse','RETAIL'),(md5('ag-wh2')::uuid,md5('ag-branch2')::uuid,'AG-X','Fiction second warehouse','RETAIL');
insert into items(id,code,name,unit,item_type,buy_price) values(md5('ag-item')::uuid,'AG-I','Fiction mixed-price item','pcs','Persediaan',999999),(md5('ag-orphan')::uuid,'AG-O','Fiction orphan item','pcs','Persediaan',777777);
insert into coa_accounts(code,name,type,normal_balance,is_header) values('1301','Fiction inventory','ASET','D',false),('3101','Fiction explicitly designated test equity','EKUITAS','K',false) on conflict(code) do update set is_active=true,is_header=false;
select set_config('request.jwt.claim.sub',md5('ag-owner')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
create function pg_temp.activation_state() returns jsonb language sql as $$select jsonb_build_object(
 'settings',(select to_jsonb(s) from inventory_costing_settings s where id),
 'stock',(select jsonb_agg(to_jsonb(s) order by id) from stock s),
 'layers',(select jsonb_agg(to_jsonb(l) order by id) from stock_layers l),
 'moves',(select jsonb_agg(to_jsonb(m) order by id) from stock_moves m),
 'events',(select jsonb_agg(to_jsonb(e) order by id) from inventory_cost_events e),
 'journals',(select jsonb_agg(to_jsonb(j) order by id) from journal_entries j),
 'lines',(select jsonb_agg(to_jsonb(l) order by id) from journal_lines l))$$;
create function pg_temp.activation_denied(expected text) returns void language plpgsql as $$
declare before_state jsonb:=pg_temp.activation_state();failed boolean:=false;begin
 begin perform activate_moving_average();exception when check_violation then
  if position(expected in sqlerrm)=0 then raise;end if;failed:=true;
 end;
 if not failed then raise exception 'Expected activation denial: %',expected;end if;
 if pg_temp.activation_state() is distinct from before_state then raise exception 'Denied activation changed stock, valuation, history or GL';end if;
end$$;
create function pg_temp.activation_gl(branch uuid,amount numeric,ref text) returns void language plpgsql as $$begin
 perform sales_write_journal(current_date,branch,'manual',ref,'Fiction explicitly audited opening',jsonb_build_array(jsonb_build_object('code','1301','debit',greatest(amount,0),'credit',greatest(-amount,0)),jsonb_build_object('code','3101','debit',greatest(-amount,0),'credit',greatest(amount,0))));
end$$;
-- FUNCTIONAL CASES
-- Empty inventory/GL is a valid prospective starting point.
do $$begin
 begin
  perform activate_moving_average();
  if not inventory_is_average() then raise exception 'Empty reconciled inventory did not activate';end if;
  raise exception 'Roll back only successful fixture probe' using errcode='P9001';
 exception when sqlstate 'P9001' then null;end;
end$$;
select stock_in_fifo(md5('ag-wh')::uuid,md5('ag-item')::uuid,4,10,'manual','ag-seed-a',current_date-2,current_date+100);
select stock_in_fifo(md5('ag-wh')::uuid,md5('ag-item')::uuid,6,20,'manual','ag-seed-b',current_date-1,current_date+200);
select stock_in_fifo(md5('ag-wh2')::uuid,md5('ag-item')::uuid,4,30,'manual','ag-seed-c',current_date-1,current_date+300);
set local role authenticated;
-- Missing historical/PDRY GL blocks adoption; never infer an opening journal.
select pg_temp.activation_denied('rekonsiliasi');
reset role;
savepoint wrong_allocation;
select pg_temp.activation_gl(null,280,'ag-unallocated');
set local role authenticated;
select pg_temp.activation_denied('rekonsiliasi');
reset role;
rollback to wrong_allocation;
select pg_temp.activation_gl(md5('ag-branch')::uuid,180,'ag-wrong-b');
select pg_temp.activation_gl(md5('ag-branch2')::uuid,100,'ag-wrong-c');
set local role authenticated;
select pg_temp.activation_denied('rekonsiliasi');
reset role;
rollback to wrong_allocation;
-- Activation is global: a reconciled branch cannot opt in while another
-- branch still has an unmatched opening value.
select pg_temp.activation_gl(md5('ag-branch')::uuid,160,'ag-only-first-branch');
set local role authenticated;
select pg_temp.activation_denied('rekonsiliasi');
-- An operational branch filter does not turn the global RPC into branch adoption.
select set_config('request.headers',jsonb_build_object('x-kamo-operational-branch',md5('ag-branch')::uuid::text)::text,true);
do $$begin
 begin perform activate_moving_average();raise exception 'Branch filter bypassed global activation';exception when insufficient_privilege then null;end;
end$$;
select set_config('request.headers','{}',true);
reset role;
rollback to wrong_allocation;
-- Correct global AND branch amounts, with balanced fictional source journals.
select pg_temp.activation_gl(md5('ag-branch')::uuid,160,'ag-correct-b');
select pg_temp.activation_gl(md5('ag-branch2')::uuid,120,'ag-correct-c');
savepoint invalid_evidence;
insert into stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source) values(md5('ag-wh')::uuid,md5('ag-orphan')::uuid,current_date,1,1,10,'manual');
set local role authenticated;
select pg_temp.activation_denied('lapisan');
reset role;
rollback to invalid_evidence;
insert into stock(warehouse_id,item_id,qty) values(md5('ag-wh')::uuid,md5('ag-orphan')::uuid,-1);
set local role authenticated;
select pg_temp.activation_denied('negatif');
reset role;
rollback to invalid_evidence;
-- Even a sub-cent difference larger than arithmetic noise is a mismatch.
select pg_temp.activation_gl(md5('ag-branch')::uuid,0.001,'ag-small-gap');
set local role authenticated;
select pg_temp.activation_denied('rekonsiliasi');
reset role;
rollback to invalid_evidence;
-- A balanced future-dated inventory entry must not mask the cutover basis.
select pg_temp.activation_gl(md5('ag-branch')::uuid,1,'ag-future');
update journal_entries set tanggal=current_date+1 where source_ref='ag-future';
set local role authenticated;
select pg_temp.activation_denied('masa depan');
reset role;
rollback to invalid_evidence;
insert into journal_entries(id,tanggal,source,source_ref,branch_id) values(md5('ag-invalid')::uuid,current_date,'manual','ag-invalid',md5('ag-branch')::uuid);
insert into journal_lines(entry_id,account_id,debit,credit) select md5('ag-invalid')::uuid,id,1,0 from coa_accounts where code='1301';
set local role authenticated;
select pg_temp.activation_denied('seimbang');
reset role;
rollback to invalid_evidence;
insert into journal_entries(id,tanggal,source,source_ref,branch_id) values(md5('ag-invalid')::uuid,current_date,'manual','ag-invalid',md5('ag-branch')::uuid);
insert into journal_lines(entry_id,account_id,debit,credit) select md5('ag-invalid')::uuid,id,'NaN',0 from coa_accounts where code='1301';
set local role authenticated;
select pg_temp.activation_denied('sah');
reset role;
rollback to invalid_evidence;
-- Current authorization remains authoritative.
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('ag-admin')::uuid::text,true);
do $$begin
 begin perform activate_moving_average();raise exception 'Admin activated costing';exception when insufficient_privilege then null;end;
end$$;
select set_config('request.jwt.claim.sub',md5('ag-owner')::uuid::text,true);
-- The private guard cannot become an alternate public mutation/read API.
do $$begin
 if has_function_privilege('authenticated','public.inventory_assert_average_activation_accounting()','EXECUTE') or has_function_privilege('anon','public.inventory_assert_average_activation_accounting()','EXECUTE') then raise exception 'Private activation guard is externally callable';end if;
end$$;
reset role;
create function pg_temp.activation_seed_fault() returns trigger language plpgsql as $$begin
 if new.source='average-activation' then raise exception 'AG_SEED_FAULT';end if;
 return new;
end$$;
create trigger activation_seed_fault before insert on inventory_cost_events for each row execute function pg_temp.activation_seed_fault();
set local role authenticated;
do $$declare before_state jsonb:=pg_temp.activation_state();begin
 begin perform activate_moving_average();raise exception 'Seed failure accepted';exception when raise_exception then if sqlerrm<>'AG_SEED_FAULT' then raise;end if;end;
 if pg_temp.activation_state() is distinct from before_state then raise exception 'Final seed failure leaked partial activation';end if;
end$$;
reset role;
drop trigger activation_seed_fault on inventory_cost_events;
set local role authenticated;
-- Reconciled activation preserves carrying value and all historical proof.
do $$declare before_layers jsonb;before_moves jsonb;before_gl jsonb;r jsonb;begin
 select jsonb_agg(to_jsonb(l) order by id) into before_layers from stock_layers l;
 select jsonb_agg(to_jsonb(m) order by id) into before_moves from stock_moves m;
 select jsonb_agg(to_jsonb(l) order by id) into before_gl from journal_lines l;
 r:=activate_moving_average();
 if not inventory_is_average() or (r->>'already_active')::boolean then raise exception 'Reconciled activation failed';end if;
 if not exists(select 1 from stock where warehouse_id=md5('ag-wh')::uuid and qty=10 and average_cost=16) or not exists(select 1 from stock where warehouse_id=md5('ag-wh2')::uuid and qty=4 and average_cost=30) then raise exception 'Wrong audited remaining average';end if;
 if (select sum(value_after) from inventory_cost_events where source='average-activation')<>280 then raise exception 'Carrying value changed';end if;
 if (select jsonb_agg(to_jsonb(l) order by id) from stock_layers l) is distinct from before_layers or (select jsonb_agg(to_jsonb(m) order by id) from stock_moves m) is distinct from before_moves or (select jsonb_agg(to_jsonb(l) order by id) from journal_lines l) is distinct from before_gl then raise exception 'Activation rewrote historical stock or GL';end if;
 r:=activate_moving_average();
 if not(r->>'already_active')::boolean or (select count(*) from inventory_cost_events where source='average-activation')<>2 then raise exception 'Activation retry duplicated seeds';end if;
end$$;
rollback;
