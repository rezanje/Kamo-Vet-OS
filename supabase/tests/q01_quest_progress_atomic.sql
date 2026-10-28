-- Q01 follow-up: quest progress is written inside the payment finalizer, atomically with the
-- new-customer claim, for /kasir (open shift) and /pos/transaksi (back office, no shift) alike.
-- The runner prepends the fictional pos_merchant_fees.sql prelude (inside its transaction);
-- fictional data only, everything rolls back.
update profiles set role='OWNER' where id='e1100000-0000-4000-8000-000000000001';
insert into user_branches(user_id,branch_id) values('e1100000-0000-4000-8000-000000000002','e2200000-0000-4000-8000-000000000001');
update staff_quest_definitions set is_active=false;
update quest_settings set streak_bonus_points=0;
insert into staff_quest_definitions(id,quest_type,title,target_kind,target_value,points_reward) values
 ('ec100000-0000-4000-8000-000000000001','daily','Customer baru (atomik)','new_customer',2,10),
 ('ec100000-0000-4000-8000-000000000002','daily','Omzet (atomik)','total_sales_amount',100000000,5);
insert into customers(id,name,phone) values
 ('ec200000-0000-4000-8000-000000000001','Atomik satu','0819-1000-0001'),
 ('ec200000-0000-4000-8000-000000000002','Atomik dua','0819-1000-0002'),
 ('ec200000-0000-4000-8000-000000000003','Atomik tiga','0819-1000-0003');

-- Receipt as the signed-in user, finalized the way both checkout screens do it.
create function pg_temp.pos(ref text,customer uuid,shift uuid) returns uuid language plpgsql as $$declare doc uuid;begin
 insert into sales(branch_id,customer_id,no_struk,subtotal,total,metode_bayar,bayar,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint)
  values('e2200000-0000-4000-8000-000000000001',customer,ref,50000,50000,'Tunai',50000,auth.uid(),shift,'[{"method":"Tunai","amount":50000}]','q01a:'||ref,repeat('c',64)) returning id into doc;
 perform pg_temp.lines(doc,50000);
 return doc;end$$;
create function pg_temp.finalize(ref text) returns jsonb language sql as $$select finalize_pos_sale((select id from sales where no_struk=ref))$$;
create function pg_temp.progress(staff uuid,quest text) returns numeric language sql as $$
 select coalesce(sum(current_value),0) from staff_quest_progress where staff_id=staff and quest_definition_id=('ec100000-0000-4000-8000-00000000000'||quest)::uuid$$;
create function pg_temp.claimed(ref text) returns boolean language sql security definer as $$
 select exists(select 1 from quest_new_customer_claims c join sales s on s.id=c.sale_id where s.no_struk=ref)$$;
create function pg_temp.effects(ref text) returns bigint language sql security definer as $$
 select count(*) from sale_staff_effects e join sales s on s.id=e.sale_id where s.no_struk=ref and e.reversed_at is null$$;
create function pg_temp.orphans() returns bigint language sql security definer as $$
 select count(*) from quest_new_customer_claims c join sales s on s.id=c.sale_id
 where s.no_struk like 'Q01A.%' and not exists(select 1 from sale_staff_effects e where e.sale_id=c.sale_id and e.reversed_at is null)$$;
grant execute on all functions in schema pg_temp to authenticated;

-- Test-only fault injection: fail the very last write of the staff effects (after the claim and the
-- progress rows exist) for one receipt, to prove nothing of that payment survives.
create function public.q01_test_fail_effects() returns trigger language plpgsql as $$begin
 if (select no_struk from public.sales where id=new.sale_id)='Q01A.FAIL' then
  if exists(select 1 from public.quest_new_customer_claims where sale_id=new.sale_id)
     and exists(select 1 from public.staff_quest_progress where staff_id=new.staff_id
                and quest_definition_id='ec100000-0000-4000-8000-000000000001' and current_value=2) then
   raise exception 'Q01 injected: claim and progress written, effects failing';
  end if;
  raise exception 'Q01 injected: claim or progress missing at failure point';
 end if;
 return new;end$$;
create trigger q01_test_fail_effects before insert on sale_staff_effects for each row execute function public.q01_test_fail_effects();

set local role authenticated;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);

-- 1. /kasir: the finalizer alone records claim + progress; no separate call is needed.
select pg_temp.pos('Q01A.KASIR','ec200000-0000-4000-8000-000000000001','e4400000-0000-4000-8000-000000000001');
select pg_temp.finalize('Q01A.KASIR');
select pg_temp.assert_ok(pg_temp.claimed('Q01A.KASIR') and pg_temp.effects('Q01A.KASIR')=1,'kasir payment writes claim and staff effects together');
select pg_temp.assert_ok(pg_temp.progress(auth.uid(),'1')=1 and pg_temp.progress(auth.uid(),'2')=50000,'kasir progress counted without the client hook');

-- 2. Idempotent re-apply: client RPC replay, finalizer replay and the internal call add nothing.
select pg_temp.assert_ok(apply_sale_staff_effects((select id from sales where no_struk='Q01A.KASIR'))->>'applied'='true','RPC replay reports applied');
select apply_sale_staff_effects((select id from sales where no_struk='Q01A.KASIR'));
select pg_temp.finalize('Q01A.KASIR');
reset role;
select sale_staff_effects_apply((select id from sales where no_struk='Q01A.KASIR'));
set local role authenticated;
select pg_temp.assert_ok(pg_temp.progress(auth.uid(),'1')=1 and pg_temp.progress(auth.uid(),'2')=50000 and pg_temp.effects('Q01A.KASIR')=1,
 're-apply never double counts');

-- 3. Atomicity: when the staff effects fail, the payment, the claim and the progress all roll back.
select pg_temp.pos('Q01A.FAIL','ec200000-0000-4000-8000-000000000002','e4400000-0000-4000-8000-000000000001');
do $$begin
 perform pg_temp.finalize('Q01A.FAIL');
 raise exception 'finalization unexpectedly succeeded';
exception when others then
 if sqlerrm<>'Q01 injected: claim and progress written, effects failing' then raise; end if;
end$$;
select pg_temp.assert_ok((select payments_finalized_at is null from sales where no_struk='Q01A.FAIL'),'failed effects keep the receipt unpaid');
select pg_temp.assert_ok(not pg_temp.claimed('Q01A.FAIL') and pg_temp.effects('Q01A.FAIL')=0,'failed effects leave no claim behind');
select pg_temp.assert_ok(pg_temp.progress(auth.uid(),'1')=1 and pg_temp.progress(auth.uid(),'2')=50000,'failed effects leave progress untouched');
select pg_temp.assert_ok(not exists(select 1 from journal_entries where source_ref='Q01A.FAIL'),'failed effects post no money');
reset role;
drop trigger q01_test_fail_effects on sale_staff_effects;
set local role authenticated;
select pg_temp.finalize('Q01A.FAIL');
select pg_temp.assert_ok(pg_temp.claimed('Q01A.FAIL') and pg_temp.effects('Q01A.FAIL')=1 and pg_temp.progress(auth.uid(),'1')=2,
 'retried payment claims and counts together');

-- 4. /pos/transaksi: back-office receipt without a cashier shift counts for its own cashier.
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000002',true);
select pg_temp.pos('Q01A.BACKOFFICE','ec200000-0000-4000-8000-000000000003',null);
select pg_temp.finalize('Q01A.BACKOFFICE');
select pg_temp.assert_ok(pg_temp.claimed('Q01A.BACKOFFICE') and pg_temp.effects('Q01A.BACKOFFICE')=1,'back-office payment writes claim and staff effects');
select pg_temp.assert_ok(pg_temp.progress(auth.uid(),'1')=1 and pg_temp.progress(auth.uid(),'2')=50000,'back-office sale counts for the quest');
-- Same claim rules: a repeat customer at the back office is not new again.
select pg_temp.pos('Q01A.BACKOFFICE.REPEAT','ec200000-0000-4000-8000-000000000001',null);
select pg_temp.finalize('Q01A.BACKOFFICE.REPEAT');
select pg_temp.assert_ok(not pg_temp.claimed('Q01A.BACKOFFICE.REPEAT') and pg_temp.effects('Q01A.BACKOFFICE.REPEAT')=1
 and pg_temp.progress(auth.uid(),'1')=1 and pg_temp.progress(auth.uid(),'2')=100000,'repeat customer adds sales, not a new customer');
select pg_temp.assert_ok(pg_temp.orphans()=0,'no claim exists without its staff effects');

-- 5. Void (Super Admin) reverses progress and releases the claim, latest receipt first as before.
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select pg_temp.reject($q$select cancel_posted_sale((select id from sales where no_struk='Q01A.BACKOFFICE'),0,'q01a-early','Uji urutan')$q$,
 'earlier back-office effect cannot be reversed while a later one is active');
select cancel_posted_sale((select id from sales where no_struk='Q01A.BACKOFFICE.REPEAT'),0,'q01a-repeat','Uji Q01 atomik');
select cancel_posted_sale((select id from sales where no_struk='Q01A.BACKOFFICE'),0,'q01a-backoffice','Uji Q01 atomik');
select pg_temp.assert_ok(not pg_temp.claimed('Q01A.BACKOFFICE') and pg_temp.effects('Q01A.BACKOFFICE')=0
 and pg_temp.progress('e1100000-0000-4000-8000-000000000002','1')=0 and pg_temp.progress('e1100000-0000-4000-8000-000000000002','2')=0,
 'back-office void releases claim and progress');
select cancel_posted_sale((select id from sales where no_struk='Q01A.FAIL'),0,'q01a-fail','Uji Q01 atomik');
select pg_temp.assert_ok(not pg_temp.claimed('Q01A.FAIL') and pg_temp.progress(auth.uid(),'1')=1 and pg_temp.progress(auth.uid(),'2')=50000,
 'kasir void releases claim and progress');
-- The released customer is new again on the replacement receipt, in the same transaction as its payment.
select pg_temp.pos('Q01A.PENGGANTI','ec200000-0000-4000-8000-000000000002','e4400000-0000-4000-8000-000000000001');
select pg_temp.finalize('Q01A.PENGGANTI');
select pg_temp.assert_ok(pg_temp.claimed('Q01A.PENGGANTI') and pg_temp.progress(auth.uid(),'1')=2
 and (select total_points from staff_points where staff_id=auth.uid())=10,'replacement receipt earns the customer and the quest reward once');
select pg_temp.assert_ok(pg_temp.orphans()=0,'still no claim without staff effects');

-- 6. Shape: internal function and trigger are private; claim is written before progress reads it.
reset role;
select pg_temp.assert_ok(not has_function_privilege('authenticated','public.sale_staff_effects_apply(uuid)','EXECUTE')
 and not has_function_privilege('authenticated','public.apply_sale_staff_effects_on_finalize()','EXECUTE')
 and has_function_privilege('authenticated','public.apply_sale_staff_effects(uuid)','EXECUTE')
 and not has_function_privilege('service_role','public.apply_sale_staff_effects(uuid)','EXECUTE'),
 'internal effect function and trigger are private; client RPC ACL unchanged');
select pg_temp.assert_ok((select array_agg(tgname::text order by tgname) from pg_trigger
  where tgrelid='public.sales'::regclass and tgname in('q01_claim_new_customer','q01_staff_effects'))='{q01_claim_new_customer,q01_staff_effects}',
 'claim trigger fires before the staff effects trigger');

select 'Q01 atomic quest progress: passed';
rollback;
