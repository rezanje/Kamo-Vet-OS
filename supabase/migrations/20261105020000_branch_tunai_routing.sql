-- Prepare branch-specific Tunai routing. Apply only after the approved branch
-- mappings have been linked to existing COA accounts in the same release window.
-- No account, journal, or payment history is rewritten here.

create or replace function public.unit_posting_cash(p_method text, p_branch uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_code text;
begin
  if p_method = 'Tunai' and p_branch is not null then
    select a.coa_code into v_code
    from public.payment_account_map m
    join public.cash_accounts a on a.id = m.cash_account_id
    join public.coa_accounts c on c.code = a.coa_code
    where m.metode = 'Tunai' and m.branch_id = p_branch
      and a.branch_id = p_branch and a.jenis = 'Kas' and a.is_active
      and c.type = 'ASET' and c.is_active and not c.is_header;
    if v_code is null then
      raise exception 'BRANCH_CASH_UNMAPPED: kas Tunai cabang belum dipetakan ke akun aktif' using errcode = '23514';
    end if;
    return v_code;
  end if;

  select a.coa_code into v_code
  from public.payment_account_map m
  join public.cash_accounts a on a.id = m.cash_account_id
  where m.metode = p_method and (m.branch_id = p_branch or m.branch_id is null)
    and a.is_active
  order by m.branch_id nulls last limit 1;
  return coalesce(v_code, case when p_method = 'Tunai' then '110003' else '120002' end);
end;
$$;
revoke all on function public.unit_posting_cash(text, uuid) from public, anon, authenticated, service_role;

create or replace function clinic_private.kas_code(p_metode text, p_branch_id uuid) returns text
language plpgsql stable set search_path = '' as $$
declare v_code text; v_active boolean;
begin
  if p_metode = 'Tunai' and p_branch_id is not null then
    select ca.coa_code into v_code
    from public.payment_account_map pam
    join public.cash_accounts ca on ca.id = pam.cash_account_id
    join public.coa_accounts coa on coa.code = ca.coa_code
    where pam.metode = 'Tunai' and pam.branch_id = p_branch_id
      and ca.branch_id = p_branch_id and ca.jenis = 'Kas' and ca.is_active
      and coa.type = 'ASET' and coa.is_active and not coa.is_header;
    if v_code is null then
      raise exception using errcode = '23514', message = 'BRANCH_CASH_UNMAPPED: kas Tunai klinik belum dipetakan ke akun aktif';
    end if;
    return v_code;
  end if;

  select ca.coa_code, ca.is_active into v_code, v_active
  from public.payment_account_map pam join public.cash_accounts ca on ca.id = pam.cash_account_id
  where pam.metode = p_metode and pam.branch_id = p_branch_id limit 1;
  if v_code is null then
    select ca.coa_code, ca.is_active into v_code, v_active
    from public.payment_account_map pam join public.cash_accounts ca on ca.id = pam.cash_account_id
    where pam.metode = p_metode and pam.branch_id is null limit 1;
  end if;
  if v_code is not null and v_active is distinct from true then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_INVALID: rekening pembayaran tidak aktif';
  end if;
  v_code := coalesce(v_code, case when p_metode = 'Tunai' then '110003' else '120002' end);
  if not exists (select 1 from public.coa_accounts a where a.code = v_code and a.is_active and not a.is_header) then
    raise exception using errcode = 'P0001', message = format('ACCOUNT_INVALID: akun penerimaan %s tidak tersedia', v_code);
  end if;
  return v_code;
end;
$$;

create function public.guard_branch_tunai_map() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.metode = 'Tunai' and new.branch_id is not null and not exists (
    select 1 from public.cash_accounts a join public.coa_accounts c on c.code = a.coa_code
    where a.id = new.cash_account_id and a.branch_id = new.branch_id
      and a.jenis = 'Kas' and a.is_active and c.type = 'ASET' and c.is_active and not c.is_header
  ) then
    raise exception 'Rekening Tunai harus kas aktif milik cabang yang dipilih' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_branch_tunai_map() from public, anon, authenticated, service_role;
create trigger payment_account_map_branch_cash_guard
before insert or update on public.payment_account_map
for each row execute function public.guard_branch_tunai_map();
