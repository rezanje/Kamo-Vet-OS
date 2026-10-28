-- C05/Q01 follow-up: campaign codes in clinic group payment and POS back-office, and
-- recoverable new-customer quest progress. Fictional data only; everything rolls back.
begin;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is distinct from true then raise exception 'Assertion failed: %', msg; end if; end $$;
create function pg_temp.rejects(stmt text, needle text, msg text) returns void language plpgsql as $$
declare hit boolean := false;
begin
  begin execute stmt; exception when others then
    hit := needle is null or position(needle in sqlerrm) > 0;
    if not hit then raise exception 'Wrong rejection for %: %', msg, sqlerrm; end if;
  end;
  if not hit then raise exception 'Expected rejection: %', msg; end if;
end $$;
grant execute on function pg_temp.ok(boolean, text) to authenticated;
grant execute on function pg_temp.rejects(text, text, text) to authenticated;

-- Structural contract of the recovery migration.
select pg_temp.ok(position('Q01 recovery' in pg_get_functiondef('public.apply_sale_staff_effects(uuid)'::regprocedure)) > 0,
  'quest effects use the sale payment day');
select pg_temp.ok(has_function_privilege('authenticated', 'public.apply_sale_staff_effects(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.apply_sale_staff_effects(uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.apply_sale_staff_effects(uuid)', 'EXECUTE'),
  'apply_sale_staff_effects ACL unchanged');
select pg_temp.ok(has_function_privilege('authenticated', 'public.apply_pending_sale_staff_effects()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.apply_pending_sale_staff_effects()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.apply_pending_sale_staff_effects()', 'EXECUTE')
  and (select prosecdef and proconfig @> array['search_path=""'] from pg_proc
       where oid = 'public.apply_pending_sale_staff_effects()'::regprocedure),
  'repair RPC: signed-in users only, security definer with empty search_path');
select pg_temp.rejects($$select public.apply_pending_sale_staff_effects()$$, 'Akses ditolak', 'repair needs a signed-in user');

insert into auth.users (id) values
  ('d0000000-0000-4000-8000-000000000001'), ('d0000000-0000-4000-8000-000000000002');
update public.profiles set role = 'STAFF', is_active = true where id = 'd0000000-0000-4000-8000-000000000001';
update public.profiles set role = 'OWNER', is_active = true where id = 'd0000000-0000-4000-8000-000000000002';
insert into public.branches (id, code, name, type) values
  ('d0100000-0000-4000-8000-000000000001', 'FUPA', 'Petshop follow-up', 'PETSHOP'),
  ('d0100000-0000-4000-8000-000000000002', 'FUPX', 'Petshop tanpa akses', 'PETSHOP');
insert into public.user_branches (user_id, branch_id) values
  ('d0000000-0000-4000-8000-000000000001', 'd0100000-0000-4000-8000-000000000001');
insert into public.cashier_shifts (id, branch_id, opened_by, shift_type, status) values
  ('d0200000-0000-4000-8000-000000000001', 'd0100000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'petshop', 'open');
insert into public.vouchers (id, code, tipe, nilai) values ('d0300000-0000-4000-8000-000000000001', 'FUPV', 'persen', 10);
insert into public.campaign_codes (code, voucher_id, max_uses) values
  ('ROMBONGAN', 'd0300000-0000-4000-8000-000000000001', 1),
  ('BACKOFFICE', 'd0300000-0000-4000-8000-000000000001', 1);

-- =====================================================================================
-- C05 a. Clinic group payment: one arrival = one use. The code rides on ONE invoice; the
--        other pets' invoices carry the voucher only, so the cap counts the arrival once.
-- =====================================================================================
insert into public.customers (id, name, phone) values ('d0400000-0000-4000-8000-000000000001', 'Pemilik rombongan', '081277770001');
insert into public.pets (id, customer_id, name) values
  ('d0500000-0000-4000-8000-000000000001', 'd0400000-0000-4000-8000-000000000001', 'Alpha'),
  ('d0500000-0000-4000-8000-000000000002', 'd0400000-0000-4000-8000-000000000001', 'Beta'),
  ('d0500000-0000-4000-8000-000000000003', 'd0400000-0000-4000-8000-000000000001', 'Gamma');
insert into public.visits (id, branch_id, customer_id, pet_id) values
  ('d0600000-0000-4000-8000-000000000001', 'd0100000-0000-4000-8000-000000000001', 'd0400000-0000-4000-8000-000000000001', 'd0500000-0000-4000-8000-000000000001'),
  ('d0600000-0000-4000-8000-000000000002', 'd0100000-0000-4000-8000-000000000001', 'd0400000-0000-4000-8000-000000000001', 'd0500000-0000-4000-8000-000000000002'),
  ('d0600000-0000-4000-8000-000000000003', 'd0100000-0000-4000-8000-000000000001', 'd0400000-0000-4000-8000-000000000001', 'd0500000-0000-4000-8000-000000000003');
-- Invoices exactly as bayarRombongan writes them (the code guard runs on every invoice insert).
insert into public.invoices (visit_id, invoice_no, subtotal, discount, tax, total, paid_status, voucher_code, campaign_code)
  values ('d0600000-0000-4000-8000-000000000001', 'INV-FUP-A', 60000, 6000, 0, 54000, 'Lunas', 'FUPV', 'ROMBONGAN');
insert into public.invoices (visit_id, invoice_no, subtotal, discount, tax, total, paid_status, voucher_code)
  values ('d0600000-0000-4000-8000-000000000002', 'INV-FUP-B', 40000, 4000, 0, 36000, 'Lunas', 'FUPV');
select pg_temp.ok(public.campaign_code_used('ROMBONGAN') = 1, 'group of two invoices uses the code once');
-- Next arrival: cap 1 reached, so its carrier invoice is refused before anything is written.
select pg_temp.rejects($$insert into public.invoices (visit_id, invoice_no, subtotal, discount, tax, total, paid_status, voucher_code, campaign_code)
  values ('d0600000-0000-4000-8000-000000000003', 'INV-FUP-C', 50000, 5000, 0, 45000, 'Lunas', 'FUPV', 'ROMBONGAN')$$,
  'sudah mencapai batas pemakaian (1 kali)', 'group carrier respects the cap');
select pg_temp.ok(not exists (select 1 from public.invoices where invoice_no = 'INV-FUP-C'), 'refused carrier left no invoice');
-- Voiding the carrier frees the arrival's use.
set local session_replication_role = replica;   -- fixture only: void a posted invoice
update public.invoices set voided_at = now() where invoice_no = 'INV-FUP-A';
set local session_replication_role = origin;
select pg_temp.ok(public.campaign_code_used('ROMBONGAN') = 0, 'void of the carrier frees the use');

-- =====================================================================================
-- C05 b. POS back-office (/pos/transaksi): no shift, same guard. Only paid receipts count,
--        a void frees the quota.
-- =====================================================================================
create function pg_temp.backoffice(no text) returns uuid language plpgsql as $$
declare doc uuid;
begin
  insert into public.sales (branch_id, customer_id, no_struk, subtotal, total, bayar, cashier_id, shift_id, campaign_code, voucher_code)
  values ('d0100000-0000-4000-8000-000000000001', 'd0400000-0000-4000-8000-000000000001', no, 10000, 9000, 9000,
          'd0000000-0000-4000-8000-000000000002', null, 'BACKOFFICE', 'FUPV') returning id into doc;
  return doc;
end $$;
select pg_temp.backoffice('FUP-BO-1');
select pg_temp.backoffice('FUP-BO-2');
select pg_temp.ok(public.campaign_code_used('BACKOFFICE') = 0, 'unpaid back-office receipts do not use the code');
update public.sales set payments_finalized_at = clock_timestamp() where no_struk = 'FUP-BO-1';
select pg_temp.ok(public.campaign_code_used('BACKOFFICE') = 1, 'paid back-office receipt uses the code');
select pg_temp.rejects($$update public.sales set payments_finalized_at = clock_timestamp() where no_struk = 'FUP-BO-2'$$,
  'sudah mencapai batas pemakaian (1 kali)', 'back-office payment re-checks the cap');
update public.sales set voided_at = now(), void_reason = 'uji follow-up' where no_struk = 'FUP-BO-1';
update public.sales set payments_finalized_at = clock_timestamp() where no_struk = 'FUP-BO-2';
select pg_temp.ok(public.campaign_code_used('BACKOFFICE') = 1, 'void freed the quota for the next paid receipt');

-- =====================================================================================
-- Q01. Failed progress call is repaired by the next checkout, exactly once, in the right period.
-- =====================================================================================
update public.staff_quest_definitions set is_active = false;
update public.quest_settings set streak_bonus_points = 0;
insert into public.staff_quest_definitions (id, quest_type, title, target_kind, target_value, points_reward, created_at) values
  ('d0700000-0000-4000-8000-000000000001', 'daily', 'Customer baru (follow-up)', 'new_customer', 1, 10, now() - interval '3 days');

\set K '''d0000000-0000-4000-8000-000000000001'''
create function pg_temp.paid(no text, customer uuid, branch uuid, shift uuid, at timestamptz) returns uuid language plpgsql as $$
declare doc uuid;
begin
  perform set_config('request.jwt.claim.role', '', true);     -- fixture writes as the database owner
  insert into public.sales (branch_id, customer_id, no_struk, subtotal, total, bayar, cashier_id, shift_id)
  values (branch, customer, no, 50000, 50000, 50000, 'd0000000-0000-4000-8000-000000000001', shift) returning id into doc;
  update public.sales set payments_finalized_at = at where id = doc;
  return doc;
end $$;
create function pg_temp.as_cashier(stmt text) returns jsonb language plpgsql as $$
declare result jsonb;
begin
  perform set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000001', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  execute stmt into result;
  reset role;
  perform set_config('request.jwt.claim.role', '', true);
  return result;
end $$;
create function pg_temp.progress(day date) returns numeric language sql as $$
  select coalesce(sum(current_value), 0) from public.staff_quest_progress
  where staff_id = 'd0000000-0000-4000-8000-000000000001' and quest_definition_id = 'd0700000-0000-4000-8000-000000000001'
    and period_key = to_char(day, 'YYYY-MM-DD') $$;
create temp table fup_today as select (now() at time zone 'Asia/Jakarta')::date as d;
grant select on fup_today to authenticated;

insert into public.customers (id, name, phone, created_at) values
  ('d0800000-0000-4000-8000-000000000001', 'Baru hilang', '081277770011', now()),
  ('d0800000-0000-4000-8000-000000000002', 'Baru kemarin', '081277770012', now() - interval '1 day'),
  ('d0800000-0000-4000-8000-000000000003', 'Baru tanpa akses', '081277770013', now()),
  ('d0800000-0000-4000-8000-000000000004', 'Baru void', '081277770014', now());

-- 1. Payment commits the claim; the progress call is lost (never made).
select pg_temp.paid('FUP-Q-LOST', 'd0800000-0000-4000-8000-000000000001', 'd0100000-0000-4000-8000-000000000001',
  'd0200000-0000-4000-8000-000000000001', now());
select pg_temp.ok(exists (select 1 from public.quest_new_customer_claims where customer_id = 'd0800000-0000-4000-8000-000000000001')
  and pg_temp.progress((select d from fup_today)) = 0, 'claim locked, progress missing (the reported failure)');

-- A voided receipt and one the cashier can no longer access are pending too.
select pg_temp.paid('FUP-Q-VOID', 'd0800000-0000-4000-8000-000000000004', 'd0100000-0000-4000-8000-000000000001',
  'd0200000-0000-4000-8000-000000000001', now());
update public.sales set voided_at = now(), void_reason = 'uji follow-up' where no_struk = 'FUP-Q-VOID';
select pg_temp.paid('FUP-Q-NOACCESS', 'd0800000-0000-4000-8000-000000000003', 'd0100000-0000-4000-8000-000000000002',
  null, now());

-- 2. The next checkout's repair applies it; a bad receipt does not block the good one.
select pg_temp.ok(pg_temp.as_cashier('select public.apply_pending_sale_staff_effects()') = '{"applied":1,"failed":1}'::jsonb,
  'repair applied the lost receipt, skipped the void, isolated the inaccessible one');
select pg_temp.ok(pg_temp.progress((select d from fup_today)) = 1
  and (select total_points from public.staff_points where staff_id = :K) = 10, 'progress and reward recovered');
select pg_temp.ok(not exists (select 1 from public.sale_staff_effects e join public.sales s on s.id = e.sale_id where s.no_struk = 'FUP-Q-VOID'),
  'voided receipt is never repaired');

-- 3. Re-running the repair and the direct call never double count.
select pg_temp.as_cashier('select public.apply_pending_sale_staff_effects()');
select pg_temp.as_cashier($$select public.apply_sale_staff_effects((select id from public.sales where no_struk = 'FUP-Q-LOST'))$$);
select pg_temp.ok(pg_temp.progress((select d from fup_today)) = 1
  and (select total_points from public.staff_points where staff_id = :K) = 10, 'repair is idempotent');

-- 4. A late repair of yesterday's receipt counts in yesterday's period and keeps today's streak.
create temp table fup_streak as select * from public.staff_streaks where staff_id = :K;
select pg_temp.paid('FUP-Q-KEMARIN', 'd0800000-0000-4000-8000-000000000002', 'd0100000-0000-4000-8000-000000000001',
  'd0200000-0000-4000-8000-000000000001', now() - interval '1 day');
select pg_temp.ok(exists (select 1 from public.quest_new_customer_claims c join public.sales s on s.id = c.sale_id where s.no_struk = 'FUP-Q-KEMARIN'),
  'yesterday''s new customer was claimed at payment');
select pg_temp.as_cashier('select public.apply_pending_sale_staff_effects()');
select pg_temp.ok(pg_temp.progress((select d from fup_today) - 1) = 1 and pg_temp.progress((select d from fup_today)) = 1,
  'late repair lands in the sale''s own day');
select pg_temp.ok((select last_active_date = (select d from fup_today) and current_streak_days = (select current_streak_days from fup_streak)
  from public.staff_streaks where staff_id = :K), 'repairing an older day never rewinds the streak');

-- 5. Void after repair still reverses cleanly (latest effect first) and releases the customer.
select public.reverse_sale_staff_effects(s, gen_random_uuid()) from public.sales s where no_struk = 'FUP-Q-KEMARIN';
update public.sales set voided_at = now(), void_reason = 'uji follow-up' where no_struk = 'FUP-Q-KEMARIN';
select pg_temp.ok(pg_temp.progress((select d from fup_today) - 1) = 0
  and not exists (select 1 from public.quest_new_customer_claims where customer_id = 'd0800000-0000-4000-8000-000000000002'),
  'void after a repair reverses progress and releases the claim');

select 'C05/Q01 follow-up: passed';
rollback;
