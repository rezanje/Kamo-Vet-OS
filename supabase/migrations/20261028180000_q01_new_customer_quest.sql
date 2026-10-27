-- Q01: staff quest "customer baru" (supersedes draft #197 / 20261025111000).
--
-- Business rules (docs/reports/2026-10-28-keputusan-default.md, Q01):
--   * the cashier who closes a customer's FIRST paid POS receipt claims that customer once;
--   * Rp0 receipts never claim (total minus merchant fee must be > 0);
--   * a customer card created before the quest period (day/month of the sale, WIB) is not new,
--     nor is a card created before the quest itself was set up (protects against bulk imports);
--   * a duplicate card with the same phone as an older card is not new;
--   * a card created by the bulk customer import (customers.imported_at) is not new;
--   * an earlier paid clinic invoice (same card or phone) means the customer is not new;
--   * a full return without void keeps the claim; a void (cancel_posted_sale) releases it and
--     the existing staff-effect reversal removes the quest progress, as for every other quest.
--
-- Design: the claim is decided inside the payment finalizer transaction by a trigger on
-- sales.payments_finalized_at, so two concurrent receipts can never both claim the same
-- customer and no queue/worker/service-role path is needed. Quest progress keeps using the
-- existing apply_sale_staff_effects call; it only reads the claim row.

alter table public.staff_quest_definitions
  drop constraint if exists staff_quest_definitions_target_kind_check;
alter table public.staff_quest_definitions
  add constraint staff_quest_definitions_target_kind_check
  check (target_kind in ('product_qty','category_qty','total_sales_amount','new_customer'));
alter table public.staff_quest_definitions
  drop constraint if exists staff_quest_new_customer_count_check;
alter table public.staff_quest_definitions
  add constraint staff_quest_new_customer_count_check
  check (target_kind <> 'new_customer'
    or (target_value >= 1 and target_value = trunc(target_value) and target_ref_id is null));

-- One global identity per phone: "0812-xxx", "+62812xxx" and "62812xxx" are the same person.
create or replace function public.quest_customer_phone_key(p_phone text) returns text
language plpgsql immutable strict set search_path = '' as $$
declare digits text := regexp_replace(p_phone, '[^0-9]', '', 'g');
begin
  if left(digits, 2) = '62' and length(digits) > 9 then digits := '0' || substr(digits, 3); end if;
  -- Placeholder numbers (too short, or one repeated digit) never identify anyone.
  if length(digits) < 8 or length(replace(digits, left(digits, 1), '')) = 0 then return null; end if;
  return digits;
end $$;
revoke all on function public.quest_customer_phone_key(text) from public, anon, authenticated, service_role;
-- Expression-index maintenance runs as the customer writer; this pure formatter needs EXECUTE.
grant execute on function public.quest_customer_phone_key(text) to authenticated, service_role;
create index if not exists customers_quest_phone_key_idx
  on public.customers (public.quest_customer_phone_key(phone));

-- Cards created by the bulk import (Pengaturan > Impor) are existing customers, never "new".
alter table public.customers add column if not exists imported_at timestamptz;
comment on column public.customers.imported_at is
  'Q01: set by the bulk customer import; such cards never count as a new customer. Immutable once set.';
create or replace function public.guard_customer_imported_at() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.imported_at is not null and new.imported_at is distinct from old.imported_at then
    raise exception 'Penanda impor pelanggan tidak boleh diubah' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_customer_imported_at() from public, anon, authenticated, service_role;
drop trigger if exists q01_customer_imported_at on public.customers;
create trigger q01_customer_imported_at before update of imported_at on public.customers
  for each row execute function public.guard_customer_imported_at();

create table if not exists public.quest_new_customer_claims (
  customer_id uuid primary key references public.customers(id) on delete cascade,
  sale_id uuid not null unique references public.sales(id) on delete cascade,
  staff_id uuid not null references public.profiles(id),
  branch_id uuid not null references public.branches(id),
  phone_key text,
  claimed_at timestamptz not null default now()
);
create index if not exists quest_new_customer_claims_phone_idx
  on public.quest_new_customer_claims (phone_key) where phone_key is not null;
alter table public.quest_new_customer_claims enable row level security;
revoke all on public.quest_new_customer_claims from public, anon, authenticated, service_role;
comment on table public.quest_new_customer_claims is
  'Q01: one row per customer acquired by a cashier. Written only by the payment finalizer trigger; removed when that sale is voided.';

create or replace function public.quest_claim_new_customer() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_phone text; v_created timestamptz; v_imported timestamptz;
begin
  if old.payments_finalized_at is not null or new.payments_finalized_at is null
     or new.channel is not null or not new.quest_effects_tracked
     or new.customer_id is null or new.cashier_id is null or new.voided_at is not null
     or coalesce(new.total, 0) - coalesce(new.merchant_fee_total, 0) <= 0 then
    return null;                                   -- Rp0 receipts never claim
  end if;
  select public.quest_customer_phone_key(c.phone), c.created_at, c.imported_at into v_phone, v_created, v_imported
    from public.customers c where c.id = new.customer_id;
  if not found or v_imported is not null then return null; end if;   -- imported cards are not new
  -- Serialize all claims for one identity (card or phone) inside this transaction.
  perform pg_advisory_xact_lock(hashtextextended('vetos:q01:' || coalesce(v_phone, new.customer_id::text), 0));
  if exists (select 1 from public.quest_new_customer_claims c
             where c.customer_id = new.customer_id or (v_phone is not null and c.phone_key = v_phone)) then
    return null;
  end if;
  -- A newer card for a phone that already has an older card is a duplicate, not a new customer.
  if v_phone is not null and exists (
       select 1 from public.customers o
       where o.id <> new.customer_id and public.quest_customer_phone_key(o.phone) = v_phone
         and (o.created_at, o.id) < (v_created, new.customer_id)) then
    return null;
  end if;
  -- Any earlier paid, non-void, non-zero receipt for this identity means the customer is not new.
  -- Legacy rows (quest_effects_tracked=false) predate payment finalization and count as paid.
  if exists (
       select 1 from public.sales p
       join public.customers o on o.id = p.customer_id
       where p.id <> new.id and p.voided_at is null
         and (p.payments_finalized_at is not null or not p.quest_effects_tracked)
         and coalesce(p.total, 0) - coalesce(p.merchant_fee_total, 0) > 0
         and (o.id = new.customer_id or (v_phone is not null and public.quest_customer_phone_key(o.phone) = v_phone))) then
    return null;
  end if;
  -- A paid (Lunas/DP), non-void, non-zero clinic invoice for this identity also means not new.
  if exists (
       select 1 from public.invoices i
       join public.visits vi on vi.id = i.visit_id
       join public.customers o on o.id = vi.customer_id
       where i.voided_at is null and i.paid_status in ('Lunas', 'DP') and coalesce(i.total, 0) > 0
         and (o.id = new.customer_id or (v_phone is not null and public.quest_customer_phone_key(o.phone) = v_phone))) then
    return null;
  end if;
  insert into public.quest_new_customer_claims (customer_id, sale_id, staff_id, branch_id, phone_key, claimed_at)
  values (new.customer_id, new.id, new.cashier_id, new.branch_id, v_phone, new.payments_finalized_at)
  on conflict do nothing;
  return null;
end $$;
revoke all on function public.quest_claim_new_customer() from public, anon, authenticated, service_role;
drop trigger if exists q01_claim_new_customer on public.sales;
create trigger q01_claim_new_customer after update of payments_finalized_at on public.sales
  for each row execute function public.quest_claim_new_customer();

-- Void releases the claim; a return (no void) leaves it untouched.
create or replace function public.quest_release_new_customer() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.voided_at is null and new.voided_at is not null then
    delete from public.quest_new_customer_claims where sale_id = new.id;
  end if;
  return null;
end $$;
revoke all on function public.quest_release_new_customer() from public, anon, authenticated, service_role;
drop trigger if exists q01_release_new_customer on public.sales;
create trigger q01_release_new_customer after update of voided_at on public.sales
  for each row execute function public.quest_release_new_customer();

-- Quest progress: a 'new_customer' quest gains 1 when this sale holds a claim whose customer
-- card was created in the same quest period (daily = WIB date, monthly = WIB month) and not
-- before the quest definition existed.
-- Anchored, counted patch of the existing effect function (same pattern as K02/K10);
-- every other quest kind, the snapshot and the reversal contract stay byte-identical.
do $patch$
declare
  signature regprocedure := 'public.apply_sale_staff_effects(uuid)'::regprocedure;
  definition text := pg_get_functiondef(signature);
  old_text text := E'  if q.target_kind=''total_sales_amount'' then amount:=s.total-coalesce(s.merchant_fee_total,0);';
  new_text text := E'  if q.target_kind=''new_customer'' then\n'
    || E'   select count(*) into amount from public.quest_new_customer_claims nc join public.customers nc_c on nc_c.id=nc.customer_id\n'
    || E'    where nc.sale_id=s.id and nc_c.created_at>=q.created_at and to_char(nc_c.created_at at time zone ''Asia/Jakarta'',case when q.quest_type=''daily'' then ''YYYY-MM-DD'' else ''YYYY-MM'' end)\n'
    || E'     =to_char(d,case when q.quest_type=''daily'' then ''YYYY-MM-DD'' else ''YYYY-MM'' end);\n'
    || E'  elsif q.target_kind=''total_sales_amount'' then amount:=s.total-coalesce(s.merchant_fee_total,0);';
begin
  if position('quest_new_customer_claims' in definition) > 0 then
    return;                                        -- already applied (idempotent re-run)
  end if;
  if (length(definition) - length(replace(definition, old_text, ''))) / length(old_text) <> 1 then
    raise exception 'Q01_QUEST_FUNCTION_DRIFT: apply_sale_staff_effects changed; review before release';
  end if;
  execute replace(definition, old_text, new_text);
end
$patch$;
