-- Fixture-only setting changes: never call this suite on a shared database.
begin;
create function pg_temp.expect_composition_rejection(statement text) returns void
language plpgsql as $$begin
 begin execute statement;
 exception when others then
  if sqlerrm like '%Koreksi historis FIFO tidak tersedia saat HPP average aktif%' then return;end if;
  raise;
 end;
 raise exception 'Expected FIFO correction guard';
end$$;
update inventory_costing_settings set method='moving_average',activated_at=now() where id;
-- Reject before acquiring document/ledger/stock locks or writing anything.
select pg_temp.expect_composition_rejection($q$select preview_stock_document_correction('adjustment',null,'[]')$q$);
select pg_temp.expect_composition_rejection($q$select correct_stock_document('adjustment',null,'[]','Correction reason','fixture-average','token')$q$);
select pg_temp.expect_composition_rejection($q$select correct_return_record('sales',null,0,'fixture-average','Correction reason','Fictional receipt evidence','[]')$q$);
insert into auth.users(id) values(md5('remaining-average-owner')::uuid);
alter table profiles disable trigger guard_profile_privileges;
update profiles set role='OWNER',is_active=true where id=md5('remaining-average-owner')::uuid;
alter table profiles enable trigger guard_profile_privileges;
update accounting_locks set closed_until=null where id;
insert into coa_accounts(code,name,type,normal_balance)
values('119950','Fictional monetary opening','ASET','D'),('410001','Owner equity','EKUITAS','K') on conflict do nothing;
select set_config('request.jwt.claim.sub',md5('remaining-average-owner')::uuid::text,true);
set local role authenticated;
do $$begin
 begin
  perform create_opening_balance_atomic('avg-inventory-opening',current_date,'[{"code":"170001","nilai":100,"sisi":"D"}]');
  raise exception 'Expected inventory opening rejection';
 exception when others then
  if sqlerrm not like '%Saldo awal persediaan average harus melalui impor resmi%' then raise;end if;
 end;
 perform create_opening_balance_atomic('avg-monetary-opening',current_date,'[{"code":"119950","nilai":100,"sisi":"D"}]');
end$$;
reset role;
do $$begin
 if (select method from inventory_costing_settings where id)<>'moving_average' then raise exception 'Correction changed costing method';end if;
 if exists(select 1 from opening_balance_create_requests where request_key='avg-inventory-opening') then raise exception 'Rejected opening wrote request';end if;
end$$;
-- This is independent of costing activation: the ordinary mode is unchanged.
rollback;
