-- C05 runtime: explicitly selected transaction aliases use their existing voucher.
-- SECURITY SCOPE: review before Production application. This adds a narrow
-- SECURITY DEFINER read API and write guards; it does not widen table RLS.
alter table public.sales add column campaign_code varchar(24);
alter table public.invoices add column campaign_code varchar(24);

comment on column public.sales.campaign_code is 'Submitted campaign alias snapshot; voucher_code remains the canonical voucher for usage limits.';
comment on column public.invoices.campaign_code is 'Submitted campaign alias snapshot; voucher_code remains the canonical voucher for usage limits.';
comment on table public.campaign_code_bindings is 'C05 alias configuration. Only transaction_voucher with existing_voucher mode is redeemable in POS and single-visit clinic checkout.';

create function public.campaign_voucher_aliases(p_code text default null)
returns table(code text, voucher_code text)
language plpgsql security definer set search_path = '' stable as $$
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null
    or not exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active) then
    raise exception 'CAMPAIGN_ACCESS_DENIED' using errcode='42501';
  end if;
  if p_code is not null and exists(
    select 1 from public.campaign_code_bindings b where b.code=p_code
      and (b.binding_type<>'transaction_voucher' or b.calculation_mode is distinct from 'existing_voucher')
  ) then
    raise exception 'CAMPAIGN_MODE_NOT_AVAILABLE' using errcode='P0001';
  end if;
  return query select b.code::text,v.code::text
    from public.campaign_code_bindings b join public.vouchers v on v.id=b.voucher_id
    where b.binding_type='transaction_voucher' and b.calculation_mode='existing_voucher'
      and (p_code is null or b.code=p_code)
    order by b.code;
end;
$$;
revoke all on function public.campaign_voucher_aliases(text) from public,anon,service_role;
grant execute on function public.campaign_voucher_aliases(text) to authenticated;

-- Keep the alias and canonical voucher consistent even when a caller bypasses
-- the application. A historical reissue inherits the original snapshot even
-- if a manager has since changed or removed the alias configuration.
create function public.guard_campaign_redemption() returns trigger
language plpgsql security definer set search_path = '' as $$
declare source_code text; source_voucher text; canonical text;
begin
  if tg_op='UPDATE' then
    if new.campaign_code is distinct from old.campaign_code then
      raise exception 'CAMPAIGN_SNAPSHOT_IMMUTABLE' using errcode='23514';
    end if;
    if new.campaign_code is not null and new.voucher_code is distinct from old.voucher_code then
      raise exception 'CAMPAIGN_VOUCHER_IMMUTABLE' using errcode='23514';
    end if;
    return new;
  end if;

  if tg_table_name='invoices' then
    if new.reissued_from is not null then
      select i.campaign_code,i.voucher_code into source_code,source_voucher
        from public.invoices i where i.id=new.reissued_from for share;
      if source_code is not null then
        if new.campaign_code is not null and new.campaign_code is distinct from source_code then
          raise exception 'CAMPAIGN_REISSUE_MISMATCH' using errcode='23514';
        end if;
        if new.voucher_code is distinct from source_voucher then
          raise exception 'CAMPAIGN_REISSUE_VOUCHER_MISMATCH' using errcode='23514';
        end if;
        new.campaign_code:=source_code;
        return new;
      end if;
    end if;
  end if;

  if new.campaign_code is null then return new; end if;
  select v.code into canonical from public.campaign_code_bindings b
    join public.vouchers v on v.id=b.voucher_id
    where b.code=new.campaign_code and b.binding_type='transaction_voucher'
      and b.calculation_mode='existing_voucher'
    for share of b,v;
  if canonical is null or new.voucher_code is distinct from canonical then
    raise exception 'CAMPAIGN_VOUCHER_MISMATCH' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_campaign_redemption() from public,anon,authenticated,service_role;
create trigger zz_campaign_sale_redemption before insert or update of voucher_code,campaign_code
  on public.sales for each row execute function public.guard_campaign_redemption();
create trigger zz_campaign_invoice_redemption before insert or update of voucher_code,campaign_code
  on public.invoices for each row execute function public.guard_campaign_redemption();

-- Preserve the existing atomic clinic posting contract and exact ACL. Split
-- and DEMO posting call this core function with the same p_invoice JSON.
do $patch$
declare definition text; signature regprocedure := 'public.clinic_post_invoice(uuid,text,jsonb,jsonb)'::regprocedure;
  columns_anchor text := 'paid_status, metode_bayar, paid_at, shift_id, voucher_code, salesperson_id, service_pricing_version';
  values_anchor text := E'v_shift.id, v_voucher, v_salesperson_id, nullif(p_invoice->>''service_pricing_version'','''')::smallint';
begin
  definition:=pg_get_functiondef(signature);
  if (length(definition)-length(replace(definition,columns_anchor,'')))/length(columns_anchor)<>1
    or (length(definition)-length(replace(definition,values_anchor,'')))/length(values_anchor)<>1 then
    raise exception 'C05 expected one clinic invoice insert anchor; inspect core RPC before release';
  end if;
  definition:=replace(definition,columns_anchor,columns_anchor||', campaign_code');
  definition:=replace(definition,values_anchor,values_anchor||E', nullif(p_invoice->>''campaign_code'','''')');
  execute definition;
end;
$patch$;
