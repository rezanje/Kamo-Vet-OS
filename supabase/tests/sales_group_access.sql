-- Preserve Akses Grup: DOCTOR defaults to all modules, then obeys overrides.
begin;
insert into auth.users(id,raw_user_meta_data)values('ef100000-0000-4000-8000-000000000001','{"full_name":"Fiction group actor"}');
update profiles set role='DOCTOR',is_active=true where id='ef100000-0000-4000-8000-000000000001';
delete from role_modules where role='DOCTOR';
insert into branches(id,code,name,type)values
('ef200000-0000-4000-8000-000000000001','GROUP-A','Fiction group A','KLINIK'),
('ef200000-0000-4000-8000-000000000002','GROUP-B','Fiction group B','KLINIK');
insert into user_branches(user_id,branch_id)values('ef100000-0000-4000-8000-000000000001','ef200000-0000-4000-8000-000000000001');
insert into sales_quotations(id,no_penawaran,branch_id,total)values
('ef300000-0000-4000-8000-000000000001','SQ.GROUP.OWN','ef200000-0000-4000-8000-000000000001',20),
('ef300000-0000-4000-8000-000000000002','SQ.GROUP.OTHER','ef200000-0000-4000-8000-000000000002',20);
insert into sales_quotation_items(quotation_id,nama,qty,harga)values
('ef300000-0000-4000-8000-000000000001','Fiction service',1,20),
('ef300000-0000-4000-8000-000000000002','Fiction service',1,20);
set local role authenticated;
select set_config('request.jwt.claim.sub','ef100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"ef100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$ declare result jsonb; begin
 result:=sales_convert_quotation('ef300000-0000-4000-8000-000000000001');
 if result->>'order_id' is null then raise exception 'Authorized group actor did not convert quotation';end if;
 if sales_get_posting_result((result->>'order_id')::uuid,'delivery','missing-key') is not null then raise exception 'Recovery invented result';end if;
 begin
  perform sales_convert_quotation('ef300000-0000-4000-8000-000000000002');
  raise exception 'Group actor accessed another branch';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
insert into role_modules(role,module_id)values('DOCTOR','klinik');
set local role authenticated;
do $$ begin
 begin
  perform sales_convert_quotation('ef300000-0000-4000-8000-000000000001');
  raise exception 'Custom group without sales could recover conversion';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
delete from role_modules where role='DOCTOR';
update profiles set is_active=false where id='ef100000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin
 begin
  perform sales_convert_quotation('ef300000-0000-4000-8000-000000000001');
  raise exception 'Disabled group actor could post';
 exception when insufficient_privilege then null;end;
end $$;
rollback;
