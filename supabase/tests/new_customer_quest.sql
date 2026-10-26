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
insert into public.sales(id,branch_id,no_struk,subtotal,total,bayar)
 values('a6600000-0000-4000-8000-000000000009','a2200000-0000-4000-8000-000000000001','Q01-NON-CASHIER',0,0,0);
update public.sales set payments_finalized_at=now() where no_struk='Q01-NON-CASHIER';
select pg_temp.assert_ok(not exists(select 1 from public.quest_staff_effect_jobs
 where sale_id='a6600000-0000-4000-8000-000000000009'),
 'A non-cashier sale finalizes without a staff reward job');
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
select pg_temp.assert_ok((select sale_id='a6600000-0000-4000-8000-000000000001'
 and cashier_id='a1100000-0000-4000-8000-000000000001'
 and branch_id='a2200000-0000-4000-8000-000000000001'
 from public.quest_customer_first_sales where phone_key='085712345678'),
 'First-sale owner is captured in the payment finalization transaction');
select pg_temp.assert_ok((select status='pending' and paid_at is not null
 and definitions_snapshot @> '[{"id":"a4400000-0000-4000-8000-000000000001"}]'::jsonb
 and settings_snapshot ? 'streak_bonus_every_days'
 from public.quest_staff_effect_jobs where sale_id='a6600000-0000-4000-8000-000000000001'),
 'Reward job and active-rule snapshot are durable before the later hook');
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
select pg_temp.reject($q$select public.process_pending_quest_jobs(1)$q$,
 'Cashier cannot invoke the privileged reward retry worker');
select set_config('request.jwt.claims','{"role":"service_role","sub":"a1100000-0000-4000-8000-000000000001"}',true);
select pg_temp.reject($q$select public.apply_sale_staff_effects('a6600000-0000-4000-8000-000000000001')$q$,
 'An authenticated SQL role cannot gain worker access by spoofing a service JWT claim');
select pg_temp.reject($q$select public.process_pending_quest_jobs(1)$q$,
 'An authenticated SQL role cannot drain jobs by spoofing a service JWT claim');
reset role;
select set_config('request.jwt.claims','{}',true);
select pg_temp.assert_ok((select status='applied' from public.quest_staff_effect_jobs
 where sale_id='a6600000-0000-4000-8000-000000000001'),
 'Immediate cashier hook atomically completes its durable job');
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
update public.sales set voided_at=now() where no_struk='Q01-FIRST';
select pg_temp.assert_ok((select sale_id='a6600000-0000-4000-8000-000000000001'
 from public.quest_customer_first_sales where phone_key='085712345678')
 and (select status='voided' from public.quest_staff_effect_jobs
  where sale_id='a6600000-0000-4000-8000-000000000001'),
 'Cancellation reverses reward and leaves the first-customer claim consumed');
insert into public.sales(id,branch_id,customer_id,no_struk,subtotal,total,bayar,cashier_id,shift_id) values
 ('a6600000-0000-4000-8000-000000000020','a2200000-0000-4000-8000-000000000002',
  'a5500000-0000-4000-8000-000000000001','Q01-AFTER-VOID',100,100,100,
  'a1100000-0000-4000-8000-000000000002','a3300000-0000-4000-8000-000000000002');
update public.sales set payments_finalized_at=now() where no_struk='Q01-AFTER-VOID';
select pg_temp.assert_ok((select eligible_new_identity=false from public.quest_staff_effect_jobs
 where sale_id='a6600000-0000-4000-8000-000000000020'),
 'A later sale after cancellation cannot re-earn consumed acquisition credit');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"a1100000-0000-4000-8000-000000000002"}',true);
select public.apply_sale_staff_effects('a6600000-0000-4000-8000-000000000020');
reset role;
select set_config('request.jwt.claims','{}',true);
select pg_temp.assert_ok(not exists(select 1 from public.staff_quest_progress
 where staff_id='a1100000-0000-4000-8000-000000000002'
  and quest_definition_id='a4400000-0000-4000-8000-000000000001'),
 'Canceled first sale does not transfer Q01 points to a later cashier');
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
select pg_temp.assert_ok((select (created_at at time zone 'Asia/Jakarta')::date=
 ((now() at time zone 'Asia/Jakarta')::date-1)
 from public.staff_points_ledger where staff_id='a1100000-0000-4000-8000-000000000002'
  and source_id='a4400000-0000-4000-8000-000000000002' and source_type='quest_completion'),
 'Delayed quest reward ledger belongs to the original WIB completion day');
select pg_temp.assert_ok(not exists(select 1 from public.staff_quest_progress
 where quest_definition_id='a4400000-0000-4000-8000-000000000003'),
 'A newly created quest cannot retroactively reward an earlier paid sale');
select pg_temp.assert_ok((select count(*)>=1 from public.staff_quest_definitions where target_kind='new_customer'),
 'Staff may still read new customer quests');
select pg_temp.assert_ok(not has_table_privilege('authenticated','public.staff_quest_definitions','TRUNCATE')
 and not has_table_privilege('anon','public.staff_quest_definitions','TRUNCATE'),
 'Staff and anonymous users cannot bypass reward RLS through TRUNCATE');
select pg_temp.assert_ok(not has_table_privilege('authenticated','public.quest_customer_first_sales','SELECT')
 and not has_table_privilege('authenticated','public.quest_staff_effect_jobs','SELECT')
 and not has_table_privilege('service_role','public.quest_staff_effect_jobs','SELECT')
 and has_function_privilege('service_role','public.process_pending_quest_jobs(integer)','EXECUTE')
 and not has_function_privilege('authenticated','public.process_pending_quest_jobs(integer)','EXECUTE'),
 'Private jobs are reachable only through the bounded service worker');
select pg_temp.reject($q$truncate public.staff_quest_definitions$q$,
 'Staff cannot clear reward definitions with TRUNCATE');
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
-- A failed best-effort hook leaves two paid jobs. The service worker drains them
-- in cashier order after the shift closes, without a second acquisition reward.
insert into auth.users(id) values('a1100000-0000-4000-8000-000000000003');
update public.profiles set role='STAFF',is_active=true where id='a1100000-0000-4000-8000-000000000003';
insert into public.user_branches(user_id,branch_id) values
 ('a1100000-0000-4000-8000-000000000003','a2200000-0000-4000-8000-000000000001');
insert into public.cashier_shifts(id,branch_id,opened_by,shift_type) values
 ('a3300000-0000-4000-8000-000000000003','a2200000-0000-4000-8000-000000000001',
  'a1100000-0000-4000-8000-000000000003','petshop');
insert into public.customers(id,name,phone) values
 ('a5500000-0000-4000-8000-000000000008','Retry customer','0817 7654 3210');
insert into public.sales(id,branch_id,customer_id,no_struk,subtotal,total,bayar,cashier_id,shift_id) values
 ('a6600000-0000-4000-8000-000000000010','a2200000-0000-4000-8000-000000000001',
  'a5500000-0000-4000-8000-000000000008','Q01-RETRY-1',100,100,100,
  'a1100000-0000-4000-8000-000000000003','a3300000-0000-4000-8000-000000000003'),
 ('a6600000-0000-4000-8000-000000000011','a2200000-0000-4000-8000-000000000001',
  'a5500000-0000-4000-8000-000000000008','Q01-RETRY-2',100,100,100,
  'a1100000-0000-4000-8000-000000000003','a3300000-0000-4000-8000-000000000003');
update public.sales set payments_finalized_at=(select created_at+interval '1 second' from public.customers where id=customer_id)
 where no_struk='Q01-RETRY-1';
update public.sales set payments_finalized_at=(select created_at+interval '2 seconds' from public.customers where id=customer_id)
 where no_struk='Q01-RETRY-2';
select pg_temp.assert_ok((select count(*)=2 from public.quest_staff_effect_jobs
 where staff_id='a1100000-0000-4000-8000-000000000003' and status='pending'),
 'Paid checkout persists both reward attempts despite a missed application callback');
select pg_temp.assert_ok((select eligible_new_identity from public.quest_staff_effect_jobs
 where sale_id='a6600000-0000-4000-8000-000000000010'),
 'Another new tracked sale still pending payment cannot block the first completed purchase');
update public.staff_quest_definitions set is_active=false
 where id='a4400000-0000-4000-8000-000000000001';
update public.quest_settings set streak_bonus_every_days=1,streak_bonus_points=999 where id=1;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"a1100000-0000-4000-8000-000000000003"}',true);
select pg_temp.reject($q$select public.apply_sale_staff_effects('a6600000-0000-4000-8000-000000000011')$q$,
 'A later same-cashier sale cannot overtake its pending predecessor');
reset role;
select set_config('request.jwt.claims','{}',true);
update public.cashier_shifts set status='closed' where id='a3300000-0000-4000-8000-000000000003';
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select public.process_pending_quest_jobs(20);
reset role;
select set_config('request.jwt.claims','{}',true);
create temp table q01_retry_points as select total_points from public.staff_points
 where staff_id='a1100000-0000-4000-8000-000000000003';
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select public.process_pending_quest_jobs(20);
reset role;
select set_config('request.jwt.claims','{}',true);
select pg_temp.assert_ok((select count(*)=2 from public.quest_staff_effect_jobs
 where staff_id='a1100000-0000-4000-8000-000000000003' and status='applied')
 and (select current_value=1 from public.staff_quest_progress
  where staff_id='a1100000-0000-4000-8000-000000000003'
   and quest_definition_id='a4400000-0000-4000-8000-000000000001')
 and (select total_points=(select total_points from pg_temp.q01_retry_points) from public.staff_points
  where staff_id='a1100000-0000-4000-8000-000000000003')
 and (select count(*)=1 from public.staff_points_ledger
  where staff_id='a1100000-0000-4000-8000-000000000003'
   and source_id='a4400000-0000-4000-8000-000000000001' and points_delta=10),
 'Service retry after shift closure applies ordered jobs once without duplicate acquisition points: '
 ||jsonb_build_object(
  'jobs',(select jsonb_agg(jsonb_build_object('sale',sale_id,'status',status)) from public.quest_staff_effect_jobs
   where staff_id='a1100000-0000-4000-8000-000000000003'),
  'progress',(select jsonb_agg(jsonb_build_object('quest',quest_definition_id,'value',current_value)) from public.staff_quest_progress
   where staff_id='a1100000-0000-4000-8000-000000000003'),
  'points',(select total_points from public.staff_points where staff_id='a1100000-0000-4000-8000-000000000003'))::text);
update public.staff_quest_definitions set is_active=true
 where id='a4400000-0000-4000-8000-000000000001';
update public.quest_settings set streak_bonus_points=0 where id=1;
insert into public.customers(id,name,phone) values
 ('a5500000-0000-4000-8000-000000000009','Canceled pending reward','0818 2468 1357');
insert into public.sales(id,branch_id,customer_id,no_struk,subtotal,total,bayar,cashier_id,shift_id) values
 ('a6600000-0000-4000-8000-000000000012','a2200000-0000-4000-8000-000000000002',
  'a5500000-0000-4000-8000-000000000009','Q01-PENDING-VOID',100,100,100,
  'a1100000-0000-4000-8000-000000000002','a3300000-0000-4000-8000-000000000002');
update public.sales set payments_finalized_at=(select created_at+interval '1 second' from public.customers where id=customer_id)
 where no_struk='Q01-PENDING-VOID';
update public.sales set voided_at=now() where no_struk='Q01-PENDING-VOID';
select pg_temp.assert_ok((select status='voided' from public.quest_staff_effect_jobs
 where sale_id='a6600000-0000-4000-8000-000000000012')
 and not exists(select 1 from public.sale_staff_effects where sale_id='a6600000-0000-4000-8000-000000000012'),
 'Cancellation before reward processing voids the pending job without points');
-- Disable only this disposable trigger to model a paid POS sale from before deployment.
alter table public.sales disable trigger quest_capture_first_customer_sale;
insert into public.customers(id,name,phone) values
 ('a5500000-0000-4000-8000-000000000010','Pre-migration paid customer','0819 9753 2468');
insert into public.sales(id,branch_id,customer_id,no_struk,subtotal,total,bayar,cashier_id,shift_id) values
 ('a6600000-0000-4000-8000-000000000013','a2200000-0000-4000-8000-000000000002',
  'a5500000-0000-4000-8000-000000000010','Q01-HISTORICAL',100,100,100,
  'a1100000-0000-4000-8000-000000000002','a3300000-0000-4000-8000-000000000002');
update public.sales set payments_finalized_at=(select created_at+interval '1 second' from public.customers where id=customer_id)
 where no_struk='Q01-HISTORICAL';
alter table public.sales enable trigger quest_capture_first_customer_sale;
insert into public.sales(id,branch_id,customer_id,no_struk,subtotal,total,bayar,cashier_id,shift_id) values
 ('a6600000-0000-4000-8000-000000000014','a2200000-0000-4000-8000-000000000002',
  'a5500000-0000-4000-8000-000000000010','Q01-AFTER-MIGRATION',100,100,100,
  'a1100000-0000-4000-8000-000000000002','a3300000-0000-4000-8000-000000000002');
update public.sales set payments_finalized_at=(select created_at+interval '2 seconds' from public.customers where id=customer_id)
 where no_struk='Q01-AFTER-MIGRATION';
select pg_temp.assert_ok((select eligible_new_identity=false from public.quest_staff_effect_jobs
 where sale_id='a6600000-0000-4000-8000-000000000014'),
 'Earlier paid POS sale before deployment blocks a false new-customer reward');
insert into public.customers(id,name,phone) values
 ('a5500000-0000-4000-8000-000000000012','Legacy pre-tracking customer','0827 4567 1234');
insert into public.sales(id,branch_id,customer_id,no_struk,subtotal,total,bayar,cashier_id,shift_id,quest_effects_tracked) values
 ('a6600000-0000-4000-8000-000000000016','a2200000-0000-4000-8000-000000000002',
  'a5500000-0000-4000-8000-000000000012','Q01-LEGACY-PAID',100,100,100,
  'a1100000-0000-4000-8000-000000000002','a3300000-0000-4000-8000-000000000002',false);
insert into public.sales(id,branch_id,customer_id,no_struk,subtotal,total,bayar,cashier_id,shift_id) values
 ('a6600000-0000-4000-8000-000000000017','a2200000-0000-4000-8000-000000000002',
  'a5500000-0000-4000-8000-000000000012','Q01-LEGACY-REPEAT',100,100,100,
  'a1100000-0000-4000-8000-000000000002','a3300000-0000-4000-8000-000000000002');
update public.sales set payments_finalized_at=(select created_at+interval '2 seconds' from public.customers where id=customer_id)
 where no_struk='Q01-LEGACY-REPEAT';
select pg_temp.assert_ok((select eligible_new_identity=false from public.quest_staff_effect_jobs
 where sale_id='a6600000-0000-4000-8000-000000000017'),
 'Legacy paid sale without finalization timestamp still blocks a repeat acquisition');
insert into public.customers(id,name,phone) values
 ('a5500000-0000-4000-8000-000000000013','Pending split payment customer','0831 4567 1234');
alter table public.sales disable trigger pos_sale_record_payments;
insert into public.sales(id,branch_id,customer_id,no_struk,subtotal,total,bayar,cashier_id,shift_id,
 payment_plan,checkout_key,checkout_fingerprint) values
 ('a6600000-0000-4000-8000-000000000018','a2200000-0000-4000-8000-000000000002',
  'a5500000-0000-4000-8000-000000000013','Q01-PENDING-SPLIT',100,100,100,
  'a1100000-0000-4000-8000-000000000002','a3300000-0000-4000-8000-000000000002',
  '[{"method":"Tunai","amount":100}]','q01-fictional-pending',repeat('a',64));
alter table public.sales enable trigger pos_sale_record_payments;
insert into public.sales(id,branch_id,customer_id,no_struk,subtotal,total,bayar,cashier_id,shift_id) values
 ('a6600000-0000-4000-8000-000000000019','a2200000-0000-4000-8000-000000000002',
  'a5500000-0000-4000-8000-000000000013','Q01-PENDING-OTHER',100,100,100,
  'a1100000-0000-4000-8000-000000000002','a3300000-0000-4000-8000-000000000002');
update public.sales set payments_finalized_at=(select created_at+interval '2 seconds' from public.customers where id=customer_id)
 where no_struk='Q01-PENDING-OTHER';
select pg_temp.assert_ok((select eligible_new_identity from public.quest_staff_effect_jobs
 where sale_id='a6600000-0000-4000-8000-000000000019'),
 'An unfinished split-payment sale does not block a completed sale by the same phone');

insert into auth.users(id) values('a1100000-0000-4000-8000-000000000004');
update public.profiles set role='STAFF',is_active=true where id='a1100000-0000-4000-8000-000000000004';
insert into public.user_branches(user_id,branch_id) values
 ('a1100000-0000-4000-8000-000000000004','a2200000-0000-4000-8000-000000000001');
insert into public.cashier_shifts(id,branch_id,opened_by,shift_type) values
 ('a3300000-0000-4000-8000-000000000004','a2200000-0000-4000-8000-000000000001',
  'a1100000-0000-4000-8000-000000000004','petshop');
insert into public.customers(id,name,phone) values
 ('a5500000-0000-4000-8000-000000000011','Phone edited after payment','0821 1234 5678');
insert into public.sales(id,branch_id,customer_id,no_struk,subtotal,total,bayar,cashier_id,shift_id) values
 ('a6600000-0000-4000-8000-000000000015','a2200000-0000-4000-8000-000000000001',
  'a5500000-0000-4000-8000-000000000011','Q01-FROZEN-PHONE',100,100,100,
  'a1100000-0000-4000-8000-000000000004','a3300000-0000-4000-8000-000000000004');
update public.sales set payments_finalized_at=(select created_at+interval '1 second' from public.customers where id=customer_id)
 where no_struk='Q01-FROZEN-PHONE';
update public.customers set phone='0821 9999 9999' where id='a5500000-0000-4000-8000-000000000011';
update public.profiles set is_active=false where id='a1100000-0000-4000-8000-000000000004';
select pg_temp.assert_ok((select phone_key='082112345678' and eligible_new_identity
 from public.quest_staff_effect_jobs where sale_id='a6600000-0000-4000-8000-000000000015'),
 'Finalizer freezes the original customer identity before a phone edit');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select public.process_pending_quest_jobs(20);
reset role;
select set_config('request.jwt.claims','{}',true);
select pg_temp.assert_ok((select current_value=1 from public.staff_quest_progress
 where staff_id='a1100000-0000-4000-8000-000000000004'
 and quest_definition_id='a4400000-0000-4000-8000-000000000001')
 and not exists(select 1 from public.sale_staff_effects e,
   jsonb_array_elements(e.after_value->'progress') progress
  where e.sale_id in('a6600000-0000-4000-8000-000000000014'::uuid,
   'a6600000-0000-4000-8000-000000000017'::uuid)
   and progress->>'quest_definition_id'='a4400000-0000-4000-8000-000000000001'),
 'Delayed worker credits frozen phone after cashier deactivation while rejecting the historical repeat');
commit;
