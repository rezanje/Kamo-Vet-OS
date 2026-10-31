-- Prepare branch-specific Tunai routing. Apply only after the approved branch
-- mappings have been linked to existing COA accounts in the same release window.
-- No account, journal, or payment history is rewritten here.

-- Candidate pairs are intentionally explicit: branch type/name similarity is
-- insufficient to prevent posting one shop's money to another shop's cash.
create function public.branch_cash_matches(p_code text, p_branch uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.branches b
    join (values
      ('110004','BTKM'),('110005','CIAW'),('110006','CMS'),('110007','CMGG'),
      ('110008','MUAR'),('110009','TKI'),('110010','GRND'),('110011','SRKN'),
      ('110012','PDRY'),('110013','VET_CMS'),('110014','VET_CMGG'),
      ('110015','VET_CIAW'),('110016','VET_PDRY'),('110017','VET_TKI'),
      ('110018','VET_GRDA'),('110019','VET_GRLG'),('110020','VET_SRKN'),
      ('110021','VET_GRND')
    ) approved(coa_code,branch_code) on approved.coa_code = p_code and approved.branch_code = b.code
    where b.id = p_branch and b.is_active
  );
$$;
revoke all on function public.branch_cash_matches(text, uuid) from public, anon, authenticated, service_role;

do $$begin
  if exists (
    select 1 from public.cash_accounts a join public.coa_accounts c on c.code = a.coa_code
    where c.name ~* '^kas toko( |$)' and
      (a.jenis is distinct from 'Kas' or not public.branch_cash_matches(a.coa_code, a.branch_id))
  ) or exists (
    select 1 from public.payment_account_map m join public.cash_accounts a on a.id = m.cash_account_id
    where m.metode = 'Tunai' and m.branch_id is not null
      and not public.branch_cash_matches(a.coa_code, m.branch_id)
  ) then
    raise exception 'BRANCH_CASH_MISMATCH: perbaiki pasangan kas cabang yang sudah ada sebelum migrasi'
      using errcode = '23514';
  end if;
end$$;

create function public.guard_branch_cash_account() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.coa_accounts c where c.code = new.coa_code and c.name ~* '^kas toko( |$)')
    and (new.jenis is distinct from 'Kas' or not public.branch_cash_matches(new.coa_code, new.branch_id)) then
    raise exception 'BRANCH_CASH_MISMATCH: akun Kas Toko tidak sesuai cabang' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_branch_cash_account() from public, anon, authenticated, service_role;
create trigger cash_accounts_branch_cash_guard
before insert or update of coa_code, branch_id, jenis on public.cash_accounts
for each row execute function public.guard_branch_cash_account();

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
      and public.branch_cash_matches(a.coa_code, p_branch)
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
      and public.branch_cash_matches(ca.coa_code, p_branch_id)
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
      and public.branch_cash_matches(a.coa_code, new.branch_id)
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

-- Several older posting RPCs resolve the map themselves instead of calling
-- unit_posting_cash/clinic_private.kas_code. Validate the final account at the
-- posting boundary so a global fallback or submitted account cannot reroute
-- a branch's Tunai entry. Non-cash methods and branchless central jobs retain
-- their existing behavior.
create function public.require_branch_tunai_account(p_method text, p_branch uuid, p_code text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_method = 'Tunai' and p_branch is not null and not exists (
    select 1 from public.payment_account_map m
    join public.cash_accounts c on c.id = m.cash_account_id
    join public.coa_accounts a on a.code = c.coa_code
    where m.metode = 'Tunai' and m.branch_id = p_branch
      and c.branch_id = p_branch and c.coa_code = p_code
      and c.jenis = 'Kas' and c.is_active
      and public.branch_cash_matches(c.coa_code, p_branch)
      and a.type = 'ASET' and a.is_active and not a.is_header
  ) then
    raise exception 'BRANCH_CASH_UNMAPPED: kas Tunai cabang belum dipetakan ke akun aktif'
      using errcode = '23514';
  end if;
end;
$$;
revoke all on function public.require_branch_tunai_account(text, uuid, text)
from public, anon, authenticated, service_role;

-- These exact markers were checked against the current Production function
-- definitions when preparing this migration. Refuse to apply if a concurrent
-- release changes any function; a partial patch would route money incorrectly.
do $branch_cash_patch$
declare
  r record;
  v_oid oid;
  v_hash text;
  v_body text;
begin
  for r in select * from (values
    ('clinic_post_invoice',
     'select a.id into v_account_id from public.coa_accounts a',
     'if v_cash_received > 0 then perform public.require_branch_tunai_account(v_metode,v_visit.branch_id,v_cash_code); end if;',
     'bf08f1f9edc70e59e3439b3b8a4c7d18'),
    ('clinic_post_demo_invoice',
     'v_rate:=coalesce((v_policy.fee_rates',
     'perform public.require_branch_tunai_account(v_part->>''method'',v_visit.branch_id,v_part->>''kas_code'');',
     '4ba946e228883ad810d161569e5785ea'),
    ('clinic_receive_invoice_payment',
     'insert into public.invoice_payments(',
     'perform public.require_branch_tunai_account(p_metode,v_visit.branch_id,p_kas_code);',
     'dcf9654777f40d432211724242c5ee63'),
    ('receive_wholesale_payment',
     'perform 1 from public.coa_accounts where code=cash_code',
     'perform public.require_branch_tunai_account(p_metode,inv.branch_id,cash_code);',
     'f15b6a5fcd3e439160ced60a6758ba1f'),
    ('purchase_payment_cash',
     'perform 1 from public.coa_accounts where coa_accounts.code=resolved_code',
     'perform public.require_branch_tunai_account(p_method,p_branch,resolved_code);',
     'f4004bebf96f9bf2351b2b214bc18d5b'),
    ('correct_clinic_invoice_payment',
     'to_code:=to_account.coa_code;',
     'perform public.require_branch_tunai_account(p_new_method,vis.branch_id,to_account.coa_code);',
     'd706eb7e0ca3a2bc14856ca8b5a3008f'),
    ('clinic_refund_apply',
     'perform 1 from public.coa_accounts where code=account.coa_code',
     'perform public.require_branch_tunai_account(method,v.branch_id,account.coa_code);',
     'bf46845f5512a6299855bdcf475dcaf3'),
    ('pos_sale_post_refund_selected',
     'perform 1 from public.coa_accounts where code=account.coa_code',
     'perform public.require_branch_tunai_account(method,p_sale.branch_id,account.coa_code);',
     'c32a701caad033547ed1e9a5d03f91dc')
  ) as patch(proname, needle, guard, expected_hash) loop
    select p.oid, md5(p.prosrc) into strict v_oid, v_hash from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = r.proname;
    v_body := pg_get_functiondef(v_oid);
    if v_hash is distinct from r.expected_hash
       or length(v_body) - length(replace(v_body, r.needle, '')) <> length(r.needle)
       or position('require_branch_tunai_account' in v_body) > 0 then
      raise exception 'BRANCH_CASH_PATCH_CONFLICT: function % changed', r.proname;
    end if;
    v_body := replace(v_body, r.needle, r.guard || E'\n  ' || r.needle);
    execute v_body;
  end loop;
end;
$branch_cash_patch$;
