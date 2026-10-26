-- C05 configuration only. No checkout consumes these rows until a separately
-- approved redemption contract exists; legacy promo/voucher behavior is intact.
-- SECURITY SCOPE: approval required before Production application.
create table public.campaign_code_bindings (
  id uuid primary key default gen_random_uuid(),
  code varchar(24) not null unique,
  binding_type text not null check (binding_type in ('transaction_voucher','product_promo')),
  voucher_id uuid references public.vouchers(id) on delete restrict,
  promo_id uuid references public.promos(id) on delete restrict,
  calculation_mode text check (calculation_mode in ('existing_voucher','existing_promo')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaign_binding_target check (
    (binding_type='transaction_voucher' and voucher_id is not null and promo_id is null
       and calculation_mode is distinct from 'existing_promo')
    or
    (binding_type='product_promo' and promo_id is not null and voucher_id is null
       and calculation_mode is distinct from 'existing_voucher')
  )
);
comment on table public.campaign_code_bindings is
  'Configuration-only C05 alias. Checkout never redeems these aliases until approved runtime policy.';
alter table public.campaign_code_bindings enable row level security;
grant select,insert,update,delete on public.campaign_code_bindings to authenticated;
create policy campaign_binding_manager_select on public.campaign_code_bindings
  for select to authenticated using (
    exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.is_active and p.role in ('OWNER','ADMIN'))
  );
create policy campaign_binding_manager_insert on public.campaign_code_bindings
  for insert to authenticated with check (
    exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.is_active and p.role in ('OWNER','ADMIN'))
  );
create policy campaign_binding_manager_update on public.campaign_code_bindings
  for update to authenticated using (
    exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.is_active and p.role in ('OWNER','ADMIN'))
  ) with check (
    exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.is_active and p.role in ('OWNER','ADMIN'))
  );
create policy campaign_binding_manager_delete on public.campaign_code_bindings
  for delete to authenticated using (
    exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.is_active and p.role in ('OWNER','ADMIN'))
  );

-- The alias must never accidentally redeem as a legacy voucher, including
-- when either table is written through the Data API instead of the app form.
create function public.guard_campaign_code_collision() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.code, 0));
  if tg_table_name='campaign_code_bindings' then
    if exists(select 1 from public.vouchers v where v.code=new.code) then
      raise exception 'CAMPAIGN_CODE_COLLIDES_WITH_VOUCHER' using errcode='23505';
    end if;
  elsif exists(select 1 from public.campaign_code_bindings b where b.code=new.code) then
    raise exception 'CAMPAIGN_CODE_COLLIDES_WITH_ALIAS' using errcode='23505';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_campaign_code_collision() from public,anon,authenticated;
create trigger campaign_binding_code_collision before insert or update of code
  on public.campaign_code_bindings for each row execute function public.guard_campaign_code_collision();
create trigger campaign_voucher_code_collision before insert or update of code
  on public.vouchers for each row execute function public.guard_campaign_code_collision();
