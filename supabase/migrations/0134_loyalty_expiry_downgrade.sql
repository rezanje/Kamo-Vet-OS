-- Loyalty PRD §7.2 / §12.3: expiry poin dan downgrade tier configurable.

alter table tier_settings
  add column if not exists points_expiry_enabled boolean not null default false,
  add column if not exists points_expiry_months integer not null default 12
    check (points_expiry_months between 1 and 120),
  add column if not exists tier_downgrade_enabled boolean not null default false,
  add column if not exists tier_downgrade_days integer not null default 180
    check (tier_downgrade_days between 1 and 3650);

alter table customers
  add column if not exists tier_downgraded_at date;

alter table point_ledger
  add column if not exists expires_at timestamptz,
  add column if not exists entry_type varchar(20) not null default 'transaction'
    check (entry_type in ('transaction', 'redeem', 'expiry', 'annual_close', 'adjustment'));

create index if not exists point_ledger_customer_created_idx
  on point_ledger(customer_id, created_at);

-- Poin hasil transaksi baru diberi masa berlaku saat setting expiry aktif.
create or replace function public.set_point_expiry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  aktif boolean;
  bulan integer;
begin
  if new.delta > 0 and new.expires_at is null then
    select points_expiry_enabled, points_expiry_months
      into aktif, bulan
    from public.tier_settings
    where id = 1;
    if coalesce(aktif, false) then
      new.expires_at := coalesce(new.created_at, now()) + make_interval(months => coalesce(bulan, 12));
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists point_ledger_set_expiry on point_ledger;
create trigger point_ledger_set_expiry
  before insert on point_ledger
  for each row execute function public.set_point_expiry();

comment on column point_ledger.expires_at is
  'Batas waktu poin didapat. Null berarti expiry belum diaktifkan saat poin dibuat.';
