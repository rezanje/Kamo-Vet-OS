-- Q01 new-customer staff quest. Fictional data only; everything rolls back.
begin;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is distinct from true then raise exception 'Assertion failed: %', msg; end if; end $$;
grant execute on function pg_temp.ok(boolean, text) to authenticated;

-- Paid POS receipt: inserted, then finalized (the finalizer sets payments_finalized_at).
create function pg_temp.paid(no text, customer uuid, cashier uuid, total numeric) returns uuid language plpgsql as $$
declare doc uuid; shift uuid; branch uuid;
begin
  perform set_config('request.jwt.claim.role', '', true);       -- fixture writes as the database owner
  select s.id, s.branch_id into shift, branch from public.cashier_shifts s where s.opened_by = cashier and s.status = 'open';
  insert into public.sales (branch_id, customer_id, no_struk, subtotal, total, bayar, cashier_id, shift_id)
  values (branch, customer, no, total, total, total, cashier, shift) returning id into doc;
  update public.sales set payments_finalized_at = clock_timestamp() where id = doc;
  return doc;
end $$;
-- Reward hook as the signed-in cashier (same call the checkout makes after payment).
create function pg_temp.reward(no text) returns void language plpgsql as $$
declare doc uuid; cashier uuid;
begin
  select id, cashier_id into doc, cashier from public.sales where no_struk = no;
  perform set_config('request.jwt.claim.sub', cashier::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  perform public.apply_sale_staff_effects(doc);
  reset role;
  perform set_config('request.jwt.claim.role', '', true);
end $$;
create function pg_temp.progress(staff uuid) returns numeric language sql as $$
  select coalesce(sum(current_value), 0) from public.staff_quest_progress
  where staff_id = staff and quest_definition_id = 'b1400000-0000-4000-8000-000000000001' $$;
create function pg_temp.claimed(no text) returns boolean language sql as $$
  select exists (select 1 from public.quest_new_customer_claims c join public.sales s on s.id = c.sale_id where s.no_struk = no) $$;

select pg_temp.ok(public.quest_customer_phone_key('+62 857-1234-5678') = '085712345678'
  and public.quest_customer_phone_key('0857 1234 5678') = '085712345678'
  and public.quest_customer_phone_key('00000000') is null
  and public.quest_customer_phone_key('123') is null, 'phone identity normalizes +62 and rejects placeholders');
select pg_temp.ok(not has_table_privilege('authenticated', 'public.quest_new_customer_claims', 'SELECT')
  and not has_table_privilege('authenticated', 'public.quest_new_customer_claims', 'INSERT')
  and not has_function_privilege('authenticated', 'public.quest_claim_new_customer()', 'EXECUTE'),
  'claims are private and written only by the finalizer trigger');
select pg_temp.ok(has_function_privilege('authenticated', 'public.apply_sale_staff_effects(uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.apply_sale_staff_effects(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.apply_sale_staff_effects(uuid)', 'EXECUTE'),
  'reward hook ACL unchanged; no service-role worker path');

insert into auth.users (id) values
  ('b1100000-0000-4000-8000-000000000001'), ('b1100000-0000-4000-8000-000000000002');
update public.profiles set role = 'STAFF', is_active = true
  where id in ('b1100000-0000-4000-8000-000000000001', 'b1100000-0000-4000-8000-000000000002');
insert into public.branches (id, code, name, type) values
  ('b1200000-0000-4000-8000-000000000001', 'Q01A', 'Petshop Q01 A', 'PETSHOP'),
  ('b1200000-0000-4000-8000-000000000002', 'Q01B', 'Petshop Q01 B', 'PETSHOP');
insert into public.user_branches (user_id, branch_id) values
  ('b1100000-0000-4000-8000-000000000001', 'b1200000-0000-4000-8000-000000000001'),
  ('b1100000-0000-4000-8000-000000000002', 'b1200000-0000-4000-8000-000000000002');
insert into public.cashier_shifts (id, branch_id, opened_by, shift_type, status) values
  ('b1300000-0000-4000-8000-000000000001', 'b1200000-0000-4000-8000-000000000001', 'b1100000-0000-4000-8000-000000000001', 'petshop', 'open'),
  ('b1300000-0000-4000-8000-000000000002', 'b1200000-0000-4000-8000-000000000002', 'b1100000-0000-4000-8000-000000000002', 'petshop', 'open');
update public.staff_quest_definitions set is_active = false;
update public.quest_settings set streak_bonus_points = 0;

-- Configuration guard: whole customers only, no item reference.
do $$ begin
  begin
    insert into public.staff_quest_definitions (quest_type, title, target_kind, target_value, points_reward)
      values ('daily', 'Setengah customer', 'new_customer', 1.5, 1);
    raise exception 'fractional customer target accepted';
  exception when check_violation then null; end;
end $$;
insert into public.staff_quest_definitions (id, quest_type, title, target_kind, target_value, points_reward) values
  ('b1400000-0000-4000-8000-000000000001', 'daily', 'Customer baru hari ini', 'new_customer', 1, 10),
  ('b1400000-0000-4000-8000-000000000002', 'daily', 'Omzet harian', 'total_sales_amount', 1000000, 5);

\set A '''b1100000-0000-4000-8000-000000000001'''
\set B '''b1100000-0000-4000-8000-000000000002'''
insert into public.customers (id, name, phone, created_at) values
  ('b1500000-0000-4000-8000-000000000001', 'Baru', '+62 857-1234-5678', now()),
  ('b1500000-0000-4000-8000-000000000002', 'Kartu lama', '0812-3456-7890', now() - interval '40 days'),
  ('b1500000-0000-4000-8000-000000000003', 'Kartu dobel', '085712345678', now() + interval '1 second'),
  ('b1500000-0000-4000-8000-000000000004', 'Baru juga', '0813-0000-1111', now()),
  ('b1500000-0000-4000-8000-000000000005', 'Retur penuh', '0813-0000-2222', now());

-- 1. Rp0 receipt never claims; the customer's next paid receipt does.
select pg_temp.paid('Q01-NOL', 'b1500000-0000-4000-8000-000000000001', :A, 0);
select pg_temp.ok(not pg_temp.claimed('Q01-NOL'), 'Rp0 receipt does not count as a new customer');
select pg_temp.reward('Q01-NOL');
select pg_temp.ok(pg_temp.progress(:A) = 0, 'Rp0 receipt adds no new-customer progress');
select pg_temp.paid('Q01-FIRST', 'b1500000-0000-4000-8000-000000000001', :A, 100000);
select pg_temp.ok(pg_temp.claimed('Q01-FIRST'), 'first paid receipt claims the customer inside the finalizer');
select pg_temp.reward('Q01-FIRST');
select pg_temp.reward('Q01-FIRST');                                   -- replay is idempotent
select pg_temp.ok(pg_temp.progress(:A) = 1, 'cashier A gets exactly one new customer');
select pg_temp.ok((select total_points from public.staff_points where staff_id = :A) = 10, 'quest reward paid once');

-- 2. The same person again (same card, other branch, or duplicate card) is never new again.
select pg_temp.paid('Q01-AGAIN', 'b1500000-0000-4000-8000-000000000001', :B, 50000);
select pg_temp.paid('Q01-DUP', 'b1500000-0000-4000-8000-000000000003', :B, 50000);
select pg_temp.reward('Q01-AGAIN');
select pg_temp.reward('Q01-DUP');
select pg_temp.ok(not pg_temp.claimed('Q01-AGAIN') and not pg_temp.claimed('Q01-DUP') and pg_temp.progress(:B) = 0,
  'repeat purchase and duplicate card (same phone) do not count');

-- 3. A card created before the quest period is not new, even on its first purchase.
select pg_temp.paid('Q01-OLDCARD', 'b1500000-0000-4000-8000-000000000002', :B, 50000);
select pg_temp.reward('Q01-OLDCARD');
select pg_temp.ok(pg_temp.progress(:B) = 0, 'card created before the quest period is not a new customer');

-- 3b. A card created before the quest was set up (e.g. a bulk import) is not new either.
insert into public.customers (id, name, phone, created_at) values
  ('b1500000-0000-4000-8000-000000000006', 'Impor', '0813-0000-3333', now() - interval '1 second');
update public.staff_quest_definitions set created_at = now() where id = 'b1400000-0000-4000-8000-000000000001';
select pg_temp.paid('Q01-IMPORT', 'b1500000-0000-4000-8000-000000000006', :B, 50000);
select pg_temp.reward('Q01-IMPORT');
select pg_temp.ok(pg_temp.progress(:B) = 0, 'card created before the quest existed is not a new customer');

-- 4. A customer with an earlier paid receipt (before Q01 existed) is not new.
insert into public.sales (branch_id, customer_id, no_struk, subtotal, total, bayar, quest_effects_tracked)
  values ('b1200000-0000-4000-8000-000000000002', 'b1500000-0000-4000-8000-000000000004', 'Q01-LEGACY', 10000, 10000, 10000, false);
select pg_temp.paid('Q01-AFTER-LEGACY', 'b1500000-0000-4000-8000-000000000004', :B, 50000);
select pg_temp.ok(not pg_temp.claimed('Q01-AFTER-LEGACY'), 'legacy paid receipt makes the customer not new');

-- 4b. A card from the bulk import is not new (and the import mark cannot be removed).
insert into public.customers (id, name, phone, created_at, imported_at) values
  ('b1500000-0000-4000-8000-000000000007', 'Impor massal', '0813-0000-4444', now(), now());
select pg_temp.paid('Q01-IMPORTED', 'b1500000-0000-4000-8000-000000000007', :B, 50000);
select pg_temp.ok(not pg_temp.claimed('Q01-IMPORTED'), 'imported customer card is not a new customer');
do $$ begin
  begin
    update public.customers set imported_at = null where id = 'b1500000-0000-4000-8000-000000000007';
    raise exception 'import mark was cleared';
  exception when insufficient_privilege then null; end;
end $$;

-- 4c. A paid clinic invoice means the customer is not new at the petshop counter.
insert into public.customers (id, name, phone, created_at) values
  ('b1500000-0000-4000-8000-000000000008', 'Pasien klinik', '0813-0000-5555', now());
insert into public.pets (id, customer_id, name) values ('b1600000-0000-4000-8000-000000000001', 'b1500000-0000-4000-8000-000000000008', 'Anabul');
insert into public.visits (id, branch_id, customer_id, pet_id) values
  ('b1700000-0000-4000-8000-000000000001', 'b1200000-0000-4000-8000-000000000001', 'b1500000-0000-4000-8000-000000000008', 'b1600000-0000-4000-8000-000000000001');
set local session_replication_role = replica;   -- fixture only: a posted, paid clinic invoice
insert into public.invoices (visit_id, invoice_no, subtotal, discount, tax, total, paid_status)
  values ('b1700000-0000-4000-8000-000000000001', 'INV-Q01-1', 150000, 0, 0, 150000, 'Lunas');
set local session_replication_role = origin;
select pg_temp.paid('Q01-AFTER-CLINIC', 'b1500000-0000-4000-8000-000000000008', :B, 50000);
select pg_temp.ok(not pg_temp.claimed('Q01-AFTER-CLINIC'), 'customer with a paid clinic invoice is not new');
select pg_temp.ok(pg_temp.progress(:B) = 0, 'no progress from imported or clinic customers');

-- 5. Full return without void keeps the claim (returns never touch voided_at).
select pg_temp.paid('Q01-RETUR', 'b1500000-0000-4000-8000-000000000005', :B, 75000);
select pg_temp.reward('Q01-RETUR');
select pg_temp.ok(pg_temp.claimed('Q01-RETUR') and pg_temp.progress(:B) = 1, 'cashier B acquires a new customer');
update public.sales set total = total where no_struk = 'Q01-RETUR';   -- unrelated header write
select pg_temp.ok(pg_temp.claimed('Q01-RETUR'), 'claim survives writes other than a void');
select pg_temp.ok(position('voided_at' in pg_get_triggerdef((select oid from pg_trigger where tgname = 'q01_release_new_customer'))) > 0,
  'only a void releases a claim');

-- 6. Void: the approved cancellation reverses the reward and releases the customer, so the
--    replacement receipt (same customer) earns it again.
select public.reverse_sale_staff_effects(s, gen_random_uuid()) from public.sales s where no_struk = 'Q01-RETUR';
update public.sales set voided_at = now(), void_reason = 'uji Q01' where no_struk = 'Q01-RETUR';
select pg_temp.ok(not pg_temp.claimed('Q01-RETUR') and pg_temp.progress(:B) = 0, 'void releases claim and progress');
select pg_temp.paid('Q01-PENGGANTI', 'b1500000-0000-4000-8000-000000000005', :B, 75000);
select pg_temp.reward('Q01-PENGGANTI');
select pg_temp.ok(pg_temp.claimed('Q01-PENGGANTI') and pg_temp.progress(:B) = 1, 'replacement receipt after void earns the customer');

-- 7. Other quest kinds keep working through the patched function.
select pg_temp.ok((select current_value from public.staff_quest_progress
  where staff_id = :A and quest_definition_id = 'b1400000-0000-4000-8000-000000000002') = 100000,
  'total-sales quest still accumulates');

select 'Q01 new customer quest: passed';
rollback;
