-- C05 + Q01 rollback. WRITES. Run only if the owner decides to undo the release.
-- Restores both patched functions byte-for-byte, then removes every object the two migrations added.
-- Campaign codes typed on receipts/invoices (campaign_code columns) and Q01 claims are dropped with them.
begin;

do $restore$
declare
  d text := pg_get_functiondef('public.apply_sale_staff_effects(uuid)'::regprocedure);
  patched text := E'  if q.target_kind=''new_customer'' then\n'
    || E'   select count(*) into amount from public.quest_new_customer_claims nc join public.customers nc_c on nc_c.id=nc.customer_id\n'
    || E'    where nc.sale_id=s.id and nc_c.created_at>=q.created_at and to_char(nc_c.created_at at time zone ''Asia/Jakarta'',case when q.quest_type=''daily'' then ''YYYY-MM-DD'' else ''YYYY-MM'' end)\n'
    || E'     =to_char(d,case when q.quest_type=''daily'' then ''YYYY-MM-DD'' else ''YYYY-MM'' end);\n'
    || E'  elsif q.target_kind=''total_sales_amount'' then amount:=s.total-coalesce(s.merchant_fee_total,0);';
  original text := E'  if q.target_kind=''total_sales_amount'' then amount:=s.total-coalesce(s.merchant_fee_total,0);';
begin
  if position(patched in d) > 0 then execute replace(d, patched, original); end if;
  d := pg_get_functiondef('public.clinic_post_invoice(uuid,text,jsonb,jsonb)'::regprocedure);
  d := replace(d, 'paid_status, metode_bayar, paid_at, shift_id, voucher_code, salesperson_id, service_pricing_version, campaign_code',
                  'paid_status, metode_bayar, paid_at, shift_id, voucher_code, salesperson_id, service_pricing_version');
  d := replace(d, E', nullif(p_invoice->>''campaign_code'','''')', '');
  execute d;
end
$restore$;

-- Quests of the new kind are deactivated (history kept): the restored function would otherwise
-- treat an unknown kind like "qty of all products".
update public.staff_quest_definitions set is_active = false where target_kind = 'new_customer';

drop trigger if exists q01_claim_new_customer on public.sales;
drop trigger if exists q01_release_new_customer on public.sales;
drop function if exists public.quest_claim_new_customer();
drop function if exists public.quest_release_new_customer();
drop table if exists public.quest_new_customer_claims;
drop index if exists public.customers_quest_phone_key_idx;
drop function if exists public.quest_customer_phone_key(text);

drop trigger if exists c05_sale_campaign_code on public.sales;
drop trigger if exists c05_invoice_campaign_code on public.invoices;
drop trigger if exists c05_campaign_code_collision on public.campaign_codes;
drop trigger if exists c05_voucher_code_collision on public.vouchers;
drop function if exists public.guard_campaign_code_use();
drop function if exists public.guard_campaign_code_collision();
drop function if exists public.campaign_code_usage();
drop index if exists public.sales_campaign_code_idx;
drop index if exists public.invoices_campaign_code_idx;
alter table public.sales drop column if exists campaign_code;
alter table public.invoices drop column if exists campaign_code;
drop table if exists public.campaign_codes;

-- The new_customer constraint stays only while such definitions exist; otherwise restore the original.
do $c$
begin
  if not exists (select 1 from public.staff_quest_definitions where target_kind = 'new_customer') then
    alter table public.staff_quest_definitions drop constraint if exists staff_quest_new_customer_count_check;
    alter table public.staff_quest_definitions drop constraint if exists staff_quest_definitions_target_kind_check;
    alter table public.staff_quest_definitions add constraint staff_quest_definitions_target_kind_check
      check (target_kind in ('product_qty','category_qty','total_sales_amount'));
  end if;
end
$c$;

commit;
