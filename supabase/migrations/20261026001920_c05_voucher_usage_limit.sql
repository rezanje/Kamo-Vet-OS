-- C05: optional lifetime cap for the already-supported transaction voucher.
-- A redemption is one posted sale/invoice document bearing the code, including
-- later voided documents. Existing NULL caps preserve current behavior.
-- SECURITY CHANGE: review and approve before applying to Production.
alter table public.vouchers add column max_uses integer
  constraint vouchers_max_uses_positive check (max_uses is null or max_uses > 0);

create or replace function public.guard_voucher_cap_write()
returns trigger language plpgsql security definer
set search_path = '' as $$
begin
  if (tg_op = 'INSERT' and new.max_uses is not null)
     or (tg_op = 'UPDATE' and new.max_uses is distinct from old.max_uses) then
    if not exists (select 1 from public.profiles p where p.id = (select auth.uid())
                   and p.role in ('OWNER', 'ADMIN')) then
      raise exception 'C05_VOUCHER_CAP_MANAGER_REQUIRED' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_voucher_cap_write() from public, anon, authenticated;
create trigger c05_voucher_cap_write before insert or update of max_uses
  on public.vouchers for each row execute function public.guard_voucher_cap_write();

create or replace function public.guard_voucher_usage_limit()
returns trigger language plpgsql security definer
set search_path = '' as $$
declare allowed integer; used bigint;
begin
  if new.voucher_code is null or new.voucher_code = ''
     or (tg_op = 'UPDATE' and new.voucher_code is not distinct from old.voucher_code) then
    return new;
  end if;

  -- Serializes competing checkouts of the same code. Missing/expired voucher
  -- validation remains in the existing server checkout path.
  select v.max_uses into allowed from public.vouchers v
    where v.code = new.voucher_code for update;
  if allowed is null then return new; end if;

  select (select count(*) from public.sales s where s.voucher_code = new.voucher_code)
       + (select count(*) from public.invoices i where i.voucher_code = new.voucher_code)
    into used;
  if used >= allowed then
    raise exception 'VOUCHER_USAGE_LIMIT_REACHED' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_voucher_usage_limit() from public, anon, authenticated;
create trigger c05_sale_voucher_usage_limit before insert or update of voucher_code
  on public.sales for each row execute function public.guard_voucher_usage_limit();
create trigger c05_invoice_voucher_usage_limit before insert or update of voucher_code
  on public.invoices for each row execute function public.guard_voucher_usage_limit();
