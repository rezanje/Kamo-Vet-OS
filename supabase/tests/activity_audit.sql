begin;
do $$begin
 if exists(select 1 from activity_log_sources s cross join unnest(value_keys) k where not exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=s.entity and c.column_name=k)) then raise exception 'Registry contains nonexistent fields';end if;
end$$;
-- Fictional fixtures, never a shared database.
insert into auth.users(id,raw_user_meta_data) values
(md5('a01-owner')::uuid,'{"full_name":"Audit Owner"}'),
(md5('a01-admin')::uuid,'{"full_name":"Audit Admin"}'),
(md5('a01-staff')::uuid,'{"full_name":"Audit Staff"}');
update profiles set role='OWNER',is_active=true where id=md5('a01-owner')::uuid;
update profiles set role='ADMIN',is_active=true where id=md5('a01-admin')::uuid;
update profiles set role='STAFF',is_active=true where id=md5('a01-staff')::uuid;
insert into role_capabilities(role,all_branches) values('ADMIN',false) on conflict(role) do update set all_branches=false;
insert into branches(id,code,name,type) values(md5('a01-a')::uuid,'A01-A','Fictional A','PETSHOP'),(md5('a01-b')::uuid,'A01-B','Fictional B','PETSHOP');
insert into user_branches(user_id,branch_id) values(md5('a01-admin')::uuid,md5('a01-a')::uuid);
insert into coa_accounts(code,name,type,normal_balance) values('1171','A01 source','ASET','D'),('1172','A01 destination','ASET','D') on conflict(code) do nothing;
insert into cash_accounts(id,nama,jenis,coa_code,branch_id) values(md5('a01-account-a')::uuid,'A01 source','Bank','1171',md5('a01-a')::uuid),(md5('a01-account-b')::uuid,'A01 destination','Bank','1172',md5('a01-a')::uuid);
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',md5('a01-owner')::uuid::text,true);
-- Exercise real atomic posting, with header B and both accounts in A.
select set_config('a01.test_transfer',mutate_cash_transfer('a01-transfer','create',null,null,
 jsonb_build_object('tanggal',current_date,'from_account_id',md5('a01-account-a')::uuid,'to_account_id',md5('a01-account-b')::uuid,'branch_id',md5('a01-b')::uuid,'jumlah',100,'biaya_admin',0),null)::text,true);
do $$declare count_before bigint;replayed jsonb;begin
 select count(*) into count_before from activity_log;
 replayed:=mutate_cash_transfer('a01-transfer','create',null,null,jsonb_build_object('tanggal',current_date,'from_account_id',md5('a01-account-a')::uuid,'to_account_id',md5('a01-account-b')::uuid,'branch_id',md5('a01-b')::uuid,'jumlah',100,'biaya_admin',0),null);
 if replayed<>current_setting('a01.test_transfer')::jsonb or (select count(*) from activity_log)<>count_before then raise exception 'Official retry duplicated business or audit mutation';end if;
 if not exists(select 1 from activity_log where entity='cash_transfers' and branch_ids @> array[md5('a01-a')::uuid,md5('a01-b')::uuid]) then raise exception 'Transfer dropped header or account scope';end if;
end$$;
insert into customers(id,name,phone,email,address) values(md5('a01-customer')::uuid,'PRIVATE NAME','PRIVATE PHONE','PRIVATE EMAIL','PRIVATE ADDRESS');
update customers set name='PRIVATE NEW NAME',phone='PRIVATE NEW PHONE',tier='Silver' where id=md5('a01-customer')::uuid;
do $$begin
 if (select count(*) from public.activity_log where entity='customers' and entity_id=md5('a01-customer')::uuid::text)<>2 then raise exception 'Expected create and update events'; end if;
 if exists(select 1 from public.activity_log where entity='customers' and (before_state::text||after_state::text||object_label) like '%PRIVATE%') then raise exception 'PII retained';end if;
 if not exists(select 1 from public.activity_log where entity='customers' and action='update' and changed_fields @> array['name','phone','tier'] and after_state->>'tier'='Silver') then raise exception 'Missing redacted field changes / safe values';end if;
 if exists(select 1 from public.activity_log where entity='customers' and (actor_id is distinct from md5('a01-owner')::uuid or actor_name<>'Audit Owner' or occurred_at is null)) then raise exception 'Missing server attribution';end if;
end$$;
insert into items(id,code,name) values(md5('a01-item')::uuid,'A01-ITEM','PRIVATE ITEM NAME');
update customers set tier='SECRET-TIER' where id=md5('a01-customer')::uuid;
do $$begin
 if exists(select 1 from activity_log where entity='items' and after_state ? 'name') then raise exception 'Arbitrary item name retained';end if;
 if exists(select 1 from activity_log where entity='customers' and after_state->>'tier'='SECRET-TIER') then raise exception 'Unrecognized status retained';end if;
end$$;
update customers set tier='Silver' where id=md5('a01-customer')::uuid;
-- Same-value retries produce no new activity. A changed payload is a new event.
update customers set tier='Silver' where id=md5('a01-customer')::uuid;
do $$begin if (select count(*) from activity_log where entity='customers')<>4 then raise exception 'No-op duplicated event';end if;end$$;
insert into sales_quotations(id,no_penawaran,branch_id,total,created_by,catatan) values
(md5('a01-qa')::uuid,'A01-QUOTE-A',md5('a01-a')::uuid,10,md5('a01-staff')::uuid,'PRIVATE NOTE'),
(md5('a01-qb')::uuid,'A01-QUOTE-B',md5('a01-b')::uuid,20,md5('a01-staff')::uuid,'PRIVATE NOTE');
insert into sales_quotation_items(id,quotation_id,nama,qty,harga) values(md5('a01-line')::uuid,md5('a01-qa')::uuid,'PRIVATE LINE',1,10);
update sales_quotation_items set quotation_id=md5('a01-qb')::uuid,qty=2 where id=md5('a01-line')::uuid;
do $$begin
 if not exists(select 1 from activity_log where row_id=md5('a01-line')::uuid::text and action='update'
  and entity_ids @> array[md5('a01-qa')::uuid::text,md5('a01-qb')::uuid::text]
  and branch_ids @> array[md5('a01-a')::uuid,md5('a01-b')::uuid]) then raise exception 'Reparent association/scope lost';end if;
end$$;
insert into sales_quotation_items(id,quotation_id,nama,qty,harga) values(md5('a01-cascade-line')::uuid,md5('a01-qa')::uuid,'PRIVATE CASCADE',3,30);
-- Supplied business creator and arbitrary client context are never audit actors.
select set_config('kamo.audit_actor',md5('a01-staff')::uuid::text,true);
update sales_quotations set total=15 where id=md5('a01-qa')::uuid;
delete from sales_quotations where id=md5('a01-qa')::uuid;
-- Existing application customer-delete policy is unchanged (no deletion).
reset role;
delete from customers where id=md5('a01-customer')::uuid;
set local role authenticated;
do $$begin
 if not exists(select 1 from activity_log where entity='sales_quotations' and entity_id=md5('a01-qa')::uuid::text and action='delete' and object_label='A01-QUOTE-A' and (before_state->>'total')::numeric=15 and actor_id=md5('a01-owner')::uuid) then raise exception 'Deleted transaction evidence lost or actor spoofed';end if;
 if not exists(select 1 from activity_log where entity='customers' and action='delete') then raise exception 'Deleted customer evidence lost';end if;
 if has_function_privilege('authenticated','public.capture_activity_log()','execute')
  or has_function_privilege('authenticated','public.activity_log_context(text,text)','execute')
  or has_function_privilege('authenticated','public.activity_log_scope(text,jsonb)','execute') then raise exception 'Private audit helper exposed';end if;
 begin insert into activity_log(entity,entity_id,module_id,action,object_label,scope,branch_ids,changed_fields,before_state,after_state) values('customers','fake','crm','create','fake','global','{}','{}','{}','{}');raise exception 'Expected insert denial';exception when insufficient_privilege then null;end;
 begin update activity_log set object_label='forged';raise exception 'Expected update denial';exception when insufficient_privilege then null;end;
 begin delete from activity_log;raise exception 'Expected delete denial';exception when insufficient_privilege then null;end;
 begin truncate activity_log;raise exception 'Expected truncate denial';exception when insufficient_privilege then null;end;
end$$;
select set_config('request.jwt.claim.sub',md5('a01-admin')::uuid::text,true);
do $$begin
 if exists(select 1 from activity_log where entity='cash_transfers') then raise exception 'Transfer header branch disclosure';end if;
 if exists(select 1 from activity_log where entity_id=md5('a01-qb')::uuid::text or row_id=md5('a01-line')::uuid::text and action='update') then raise exception 'Cross branch disclosure';end if;
 if not exists(select 1 from activity_log where entity_id=md5('a01-qa')::uuid::text and action='delete') then raise exception 'Authorized deleted history absent';end if;
 if not exists(select 1 from activity_log where row_id=md5('a01-cascade-line')::uuid::text and action='delete') then raise exception 'Cascade evidence inaccessible to original branch';end if;
end$$;
reset role;
delete from user_branches where user_id=md5('a01-admin')::uuid;
set local role authenticated;
do $$begin if exists(select 1 from activity_log where entity='sales_quotations') then raise exception 'Revoked branch disclosure';end if;end$$;
reset role;
insert into user_branches(user_id,branch_id) values(md5('a01-admin')::uuid,md5('a01-a')::uuid);
delete from role_modules where role='ADMIN';
insert into role_modules(role,module_id) values('ADMIN','crm');
set local role authenticated;
do $$begin if exists(select 1 from activity_log where module_id='penjualan') then raise exception 'Revoked module disclosure';end if;end$$;
select set_config('request.jwt.claim.sub',md5('a01-staff')::uuid::text,true);
do $$begin if exists(select 1 from activity_log) then raise exception 'Staff audit disclosure';end if;end$$;
select set_config('request.jwt.claim.sub',md5('a01-owner')::uuid::text,true);
select set_config('request.headers',jsonb_build_object('x-kamo-operational-branch',md5('a01-b')::uuid::text)::text,true);
do $$begin if exists(select 1 from activity_log where entity_id=md5('a01-qa')::uuid::text) then raise exception 'Selected branch disclosure';end if;end$$;
select set_config('request.headers','{}',true);
reset role;
update profiles set is_active=false where id=md5('a01-owner')::uuid;
set local role authenticated;
do $$begin if exists(select 1 from activity_log) then raise exception 'Inactive actor disclosure';end if;end$$;
reset role;
set local role anon;
do $$begin begin perform * from activity_log;raise exception 'Expected anonymous denial';exception when insufficient_privilege then null;end;end$$;
reset role;
-- Real source mutation must roll back when its audit append fails.
create function pg_temp.fail_a01_append() returns trigger language plpgsql as $$begin raise exception 'A01 injected audit failure';end$$;
create trigger a01_fail_append before insert on activity_log for each row execute function pg_temp.fail_a01_append();
do $$begin
 begin insert into customers(id,name,phone) values(md5('a01-rollback')::uuid,'Fiction rollback','fiction');raise exception 'Expected rollback';exception when others then if sqlerrm<>'A01 injected audit failure' then raise;end if;end;
 if exists(select 1 from customers where id=md5('a01-rollback')::uuid) then raise exception 'Source survived audit failure';end if;
 begin update sales_quotations set total=999 where id=md5('a01-qb')::uuid;raise exception 'Expected update rollback';exception when others then if sqlerrm<>'A01 injected audit failure' then raise;end if;end;
 if (select total from sales_quotations where id=md5('a01-qb')::uuid)<>20 then raise exception 'Update survived audit failure';end if;
 begin delete from sales_quotations where id=md5('a01-qb')::uuid;raise exception 'Expected delete rollback';exception when others then if sqlerrm<>'A01 injected audit failure' then raise;end if;end;
 if not exists(select 1 from sales_quotations where id=md5('a01-qb')::uuid) then raise exception 'Delete survived audit failure';end if;
end$$;
rollback;
