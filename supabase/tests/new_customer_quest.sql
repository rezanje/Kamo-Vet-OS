-- Fictional customers and sales; this runner uses disposable PostgreSQL only.
begin;
create function pg_temp.assert_ok(ok boolean, message text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'Assertion failed: %',message;end if;end$$;
create function pg_temp.reject(statement text, message text) returns void language plpgsql as $$
declare rejected boolean:=false;begin
 begin execute statement;exception when others then rejected:=true;end;
 if not rejected then raise exception 'Expected rejection: %',message;end if;
end$$;
create function pg_temp.explain_plan(statement text) returns jsonb language plpgsql as $$
declare plan jsonb;begin execute 'explain (format json) '||statement into plan;return plan;end$$;
create function pg_temp.paid_sale(ref text,customer uuid,branch uuid,cashier uuid,shift uuid) returns uuid language plpgsql as $$
declare doc uuid;begin
 insert into public.sales(branch_id,customer_id,no_struk,subtotal,total,bayar,cashier_id,shift_id)
 values(branch,customer,ref,100,100,100,cashier,shift) returning id into doc;
 update public.sales set payments_finalized_at=clock_timestamp() where id=doc;
 return doc;
end$$;
select pg_temp.assert_ok(public.quest_customer_phone_key('+62 857-1234-5678')='085712345678'
 and public.quest_customer_phone_key('085712345678')='085712345678'
 and public.quest_customer_phone_key('+62 0000-0000') is null,
 'Country prefix normalizes once and rejects repeated placeholder digits');
insert into auth.users(id) values
 ('a1100000-0000-4000-8000-000000000001'),('a1100000-0000-4000-8000-000000000002');
update public.profiles set role='STAFF',is_active=true where id in
 ('a1100000-0000-4000-8000-000000000001','a1100000-0000-4000-8000-000000000002');
insert into public.branches(id,code,name,type) values
 ('a2200000-0000-4000-8000-000000000001','Q01A','Fictional A','PETSHOP'),
 ('a2200000-0000-4000-8000-000000000002','Q01B','Fictional B','PETSHOP');
insert into public.user_branches(user_id,branch_id) values
 ('a1100000-0000-4000-8000-000000000001','a2200000-0000-4000-8000-000000000001'),
 ('a1100000-0000-4000-8000-000000000002','a2200000-0000-4000-8000-000000000002');
insert into public.cashier_shifts(id,branch_id,opened_by,shift_type) values
 ('a3300000-0000-4000-8000-000000000001','a2200000-0000-4000-8000-000000000001','a1100000-0000-4000-8000-000000000001','petshop'),
 ('a3300000-0000-4000-8000-000000000002','a2200000-0000-4000-8000-000000000002','a1100000-0000-4000-8000-000000000002','petshop');
update public.staff_quest_definitions set is_active=false;
update public.quest_settings set streak_bonus_points=0;
insert into public.staff_quest_definitions(id,quest_type,title,target_kind,target_value,points_reward)
 values('a4400000-0000-4000-8000-000000000001','daily','First paid POS customer','new_customer',1,10);
insert into public.customers(id,name,phone) values
 ('a5500000-0000-4000-8000-000000000001','New customer','+62 857-1234-5678');
set local enable_seqscan=off;
select pg_temp.assert_ok(pg_temp.explain_plan($q$select id from public.customers
 where public.quest_customer_phone_key(phone)='085712345678'$q$)::text like '%customers_quest_phone_key_idx%',
 'Global canonical phone lookup can use its expression index');
reset enable_seqscan;
insert into public.sales(id,branch_id,customer_id,no_struk,subtotal,total,bayar,cashier_id,shift_id)
 values('a6600000-0000-4000-8000-000000000001','a2200000-0000-4000-8000-000000000001','a5500000-0000-4000-8000-000000000001','Q01-FIRST',100,100,100,'a1100000-0000-4000-8000-000000000001','a3300000-0000-4000-8000-000000000001');
update public.sales set payments_finalized_at=(select created_at+interval '3 seconds' from public.customers where id=customer_id)
 where no_struk='Q01-FIRST';
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"a1100000-0000-4000-8000-000000000001"}',true);
select public.apply_sale_staff_effects('a6600000-0000-4000-8000-000000000001');
select public.apply_sale_staff_effects('a6600000-0000-4000-8000-000000000001');
select pg_temp.assert_ok((select current_value=1 and status='completed' from public.staff_quest_progress
 where staff_id='a1100000-0000-4000-8000-000000000001' and quest_definition_id='a4400000-0000-4000-8000-000000000001'),
 'First paid POS sale must complete new-customer quest');
select pg_temp.assert_ok((select total_points=10 from public.staff_points where staff_id='a1100000-0000-4000-8000-000000000001')
 and (select count(*)=1 from public.staff_points_ledger where staff_id='a1100000-0000-4000-8000-000000000001'
  and source_type='quest_completion' and branch_id='a2200000-0000-4000-8000-000000000001'),
 'First cashier receives one branch-attributed reward on replay');
reset role;
select set_config('request.jwt.claims','{}',true);
insert into public.sales(id,branch_id,customer_id,no_struk,subtotal,total,bayar,cashier_id,shift_id,created_at)
 select 'a6600000-0000-4000-8000-000000000002','a2200000-0000-4000-8000-000000000002',
  'a5500000-0000-4000-8000-000000000001','Q01-CROSS-BRANCH',100,100,100,
  'a1100000-0000-4000-8000-000000000002','a3300000-0000-4000-8000-000000000002',created_at-interval '2 seconds'
 from public.sales where no_struk='Q01-FIRST';
update public.sales set payments_finalized_at=(select payments_finalized_at-interval '1 second' from public.sales where no_struk='Q01-FIRST')
 where no_struk='Q01-CROSS-BRANCH';
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"a1100000-0000-4000-8000-000000000002"}',true);
select public.apply_sale_staff_effects('a6600000-0000-4000-8000-000000000002');
select pg_temp.assert_ok(not exists(select 1 from public.staff_quest_progress
 where staff_id='a1100000-0000-4000-8000-000000000002' and quest_definition_id='a4400000-0000-4000-8000-000000000001'),
 'A late effect cannot award the same phone at another branch, even with earlier finalize timestamp');
reset role;
select set_config('request.jwt.claims','{}',true);
insert into public.customers(id,name,phone,created_at) values
 ('a5500000-0000-4000-8000-000000000002','Old master','0812-3456-7890',now()-interval '40 days'),
 ('a5500000-0000-4000-8000-000000000003','Duplicate card','085712345678',now()),
 ('a5500000-0000-4000-8000-000000000004','Invalid phone','00000000',now());
select pg_temp.paid_sale('Q01-OLD','a5500000-0000-4000-8000-000000000002',
 'a2200000-0000-4000-8000-000000000002','a1100000-0000-4000-8000-000000000002','a3300000-0000-4000-8000-000000000002');
select pg_temp.paid_sale('Q01-DUPLICATE','a5500000-0000-4000-8000-000000000003',
 'a2200000-0000-4000-8000-000000000002','a1100000-0000-4000-8000-000000000002','a3300000-0000-4000-8000-000000000002');
select pg_temp.paid_sale('Q01-INVALID','a5500000-0000-4000-8000-000000000004',
 'a2200000-0000-4000-8000-000000000002','a1100000-0000-4000-8000-000000000002','a3300000-0000-4000-8000-000000000002');
select pg_temp.paid_sale('Q01-ANONYMOUS',null,
 'a2200000-0000-4000-8000-000000000002','a1100000-0000-4000-8000-000000000002','a3300000-0000-4000-8000-000000000002');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"a1100000-0000-4000-8000-000000000002"}',true);
select public.apply_sale_staff_effects((select id from public.sales where no_struk='Q01-OLD'));
select public.apply_sale_staff_effects((select id from public.sales where no_struk='Q01-DUPLICATE'));
select public.apply_sale_staff_effects((select id from public.sales where no_struk='Q01-INVALID'));
select public.apply_sale_staff_effects((select id from public.sales where no_struk='Q01-ANONYMOUS'));
select pg_temp.assert_ok(not exists(select 1 from public.staff_quest_progress
 where staff_id='a1100000-0000-4000-8000-000000000002' and quest_definition_id='a4400000-0000-4000-8000-000000000001'),
 'Old, duplicate, invalid and anonymous customers cannot create new-customer progress');
reset role;
select set_config('request.jwt.claims','{}',true);
select public.reverse_sale_staff_effects(s,gen_random_uuid()) from public.sales s where no_struk='Q01-FIRST';
select pg_temp.assert_ok(not exists(select 1 from public.staff_quest_progress
 where staff_id='a1100000-0000-4000-8000-000000000001' and quest_definition_id='a4400000-0000-4000-8000-000000000001')
 and coalesce((select total_points from public.staff_points where staff_id='a1100000-0000-4000-8000-000000000001'),0)=0
 and (select coalesce(sum(points_delta),0)=0 from public.staff_points_ledger
  where staff_id='a1100000-0000-4000-8000-000000000001'),
 'Cancellation reversal restores exact quest progress and reward balance');
insert into public.staff_quest_definitions(id,quest_type,title,target_kind,target_value,points_reward,created_at)
 values('a4400000-0000-4000-8000-000000000002','daily','Delayed yesterday acquisition','new_customer',1,3,
  (date_trunc('day',now() at time zone 'Asia/Jakarta')-interval '1 day') at time zone 'Asia/Jakarta');
insert into public.staff_quest_definitions(id,quest_type,title,target_kind,target_value,points_reward)
 values('a4400000-0000-4000-8000-000000000003','daily','Created after yesterday sale','new_customer',1,3);
insert into public.customers(id,name,phone,created_at)
 values('a5500000-0000-4000-8000-000000000005','Yesterday customer','0813 2468 1357',
  (date_trunc('day',now() at time zone 'Asia/Jakarta')-interval '1 day'+interval '23 hours') at time zone 'Asia/Jakarta');
insert into public.sales(id,branch_id,customer_id,no_struk,subtotal,total,bayar,cashier_id,shift_id,created_at)
 select 'a6600000-0000-4000-8000-000000000003','a2200000-0000-4000-8000-000000000002',
  id,'Q01-DELAYED',100,100,100,'a1100000-0000-4000-8000-000000000002',
  'a3300000-0000-4000-8000-000000000002',created_at+interval '10 minutes'
 from public.customers where id='a5500000-0000-4000-8000-000000000005';
update public.sales set payments_finalized_at=created_at+interval '20 minutes' where no_struk='Q01-DELAYED';
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"a1100000-0000-4000-8000-000000000002"}',true);
select public.apply_sale_staff_effects('a6600000-0000-4000-8000-000000000003');
select pg_temp.assert_ok((select period_key=to_char((now() at time zone 'Asia/Jakarta')::date-1,'YYYY-MM-DD')
 from public.staff_quest_progress where staff_id='a1100000-0000-4000-8000-000000000002'
  and quest_definition_id='a4400000-0000-4000-8000-000000000002'),
 'Delayed effect records the sale completion day in WIB, not the retry day');
select pg_temp.assert_ok(not exists(select 1 from public.staff_quest_progress
 where quest_definition_id='a4400000-0000-4000-8000-000000000003'),
 'A newly created quest cannot retroactively reward an earlier paid sale');
select pg_temp.assert_ok((select count(*)>=1 from public.staff_quest_definitions where target_kind='new_customer'),
 'Staff may still read new customer quests');
insert into public.customers(id,name,phone) values
 ('a5500000-0000-4000-8000-000000000007','Authenticated index-write test','0899 4321 1234');
select pg_temp.assert_ok((select count(*)=1 from public.customers
 where id='a5500000-0000-4000-8000-000000000007'),
 'Staff customer creation still maintains the normalized-phone index');
select pg_temp.reject($q$insert into public.staff_quest_definitions(quest_type,title,target_kind,target_value,points_reward)
 values('daily','Forged staff reward','new_customer',1,999999)$q$,
 'Staff cannot create a direct reward definition');
select pg_temp.assert_ok(public.quest_customer_phone_key('+62 857-1234-5678')='085712345678',
 'Staff customer writes may execute the pure phone normalizer');
update public.staff_quest_definitions set points_reward=999999 where id='a4400000-0000-4000-8000-000000000001';
delete from public.staff_quest_definitions where id='a4400000-0000-4000-8000-000000000001';
select pg_temp.assert_ok((select points_reward=10 from public.staff_quest_definitions
 where id='a4400000-0000-4000-8000-000000000001'),
 'Staff cannot change or delete reward definitions directly');
reset role;
select set_config('request.jwt.claims','{}',true);
update public.profiles set role='OWNER' where id='a1100000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"a1100000-0000-4000-8000-000000000001"}',true);
insert into public.staff_quest_definitions(quest_type,title,target_kind,target_value,points_reward)
 values('daily','Owner reward','new_customer',1,2);
reset role;
select set_config('request.jwt.claims','{}',true);
update public.profiles set role='ADMIN' where id='a1100000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"a1100000-0000-4000-8000-000000000001"}',true);
insert into public.staff_quest_definitions(quest_type,title,target_kind,target_value,points_reward)
 values('monthly','Admin reward','new_customer',2,2);
select pg_temp.reject($q$insert into public.staff_quest_definitions(quest_type,title,target_kind,target_value,points_reward)
 values('daily','Half customer','new_customer',0.5,2)$q$,
 'A customer target must be a whole positive count');
select pg_temp.reject($q$insert into public.staff_quest_definitions(quest_type,title,target_kind,target_value,points_reward)
 values('daily','Not a number customer','new_customer','NaN'::numeric,2)$q$,
 'A non-finite numeric target must not bypass the customer count check');
select pg_temp.reject($q$insert into public.staff_quest_definitions(quest_type,title,target_kind,target_ref_id,target_value,points_reward)
 values('daily','Product customer','new_customer','a5500000-0000-4000-8000-000000000001',1,2)$q$,
 'Customer quest cannot bind a product reference');
reset role;
select set_config('request.jwt.claims','{}',true);
update public.profiles set is_active=false where id='a1100000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"a1100000-0000-4000-8000-000000000001"}',true);
select pg_temp.reject($q$insert into public.staff_quest_definitions(quest_type,title,target_kind,target_value,points_reward)
 values('daily','Inactive owner reward','new_customer',1,2)$q$,
 'Inactive owner cannot create reward definitions');
reset role;
select set_config('request.jwt.claims','{}',true);
update public.profiles set role='STAFF',is_active=true where id='a1100000-0000-4000-8000-000000000001';
commit;
