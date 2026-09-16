-- P0/P1: distinguish opening assets from new purchases and post purchases atomically.

alter table public.fixed_assets
  add column if not exists acquisition_kind varchar(20) not null default 'opening_balance'
    check (acquisition_kind in ('opening_balance', 'purchase', 'purchase_invoice')),
  add column if not exists acquisition_source_code varchar(12),
  add column if not exists purchase_invoice_id uuid references public.purchase_invoices(id) on delete set null;

alter table public.asset_categories alter column umur_bulan drop not null;

comment on column public.fixed_assets.acquisition_kind is
  'opening_balance has no journal; purchase and purchase_invoice require source-document journals.';

drop policy if exists fa_all on public.fixed_assets;
create policy fixed_assets_select on public.fixed_assets for select to authenticated
  using (public.user_can_access_branch(branch_id));
create policy fixed_assets_write on public.fixed_assets for all to authenticated
  using (public.user_can_access_branch(branch_id))
  with check (public.user_can_access_branch(branch_id));

create or replace function public.create_fixed_asset_purchase(
  p_nama text,
  p_category_id uuid,
  p_tanggal date,
  p_harga numeric,
  p_nilai_sisa numeric,
  p_umur_bulan integer,
  p_branch_id uuid,
  p_credit_code text
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_asset_id uuid := gen_random_uuid();
  v_entry_id uuid := gen_random_uuid();
  v_category_name text;
  v_asset_account uuid;
  v_credit_account uuid;
begin
  if p_harga <= 0 or p_umur_bulan <= 0 or p_nilai_sisa < 0 or p_nilai_sisa >= p_harga then
    raise exception 'Data pembelian aset tidak valid';
  end if;
  if p_branch_id is not null and not public.user_can_access_branch(p_branch_id) then
    raise exception 'Cabang tidak dapat diakses';
  end if;

  select nama into v_category_name from public.asset_categories
  where id = p_category_id and is_active = true;
  if v_category_name is null then raise exception 'Kategori aset tidak valid'; end if;

  select id into v_asset_account from public.coa_accounts where code = '1501' and is_header is not true;
  select id into v_credit_account from public.coa_accounts where code = p_credit_code and is_header is not true;
  if v_asset_account is null or v_credit_account is null then raise exception 'Akun pembelian aset tidak valid'; end if;
  if p_credit_code <> '2101' and not exists (
    select 1 from public.cash_accounts where coa_code = p_credit_code and is_active = true
  ) then raise exception 'Sumber pembelian harus Kas, Bank, atau Hutang Usaha'; end if;

  insert into public.fixed_assets (
    id, nama, kategori, category_id, tanggal_perolehan, harga_perolehan,
    nilai_sisa, umur_bulan, branch_id, acquisition_kind, acquisition_source_code
  ) values (
    v_asset_id, p_nama, v_category_name, p_category_id, p_tanggal, p_harga,
    p_nilai_sisa, p_umur_bulan, p_branch_id, 'purchase', p_credit_code
  );

  insert into public.journal_entries (
    id, no_jurnal, tanggal, deskripsi, source, source_ref, branch_id
  ) values (
    v_entry_id,
    'JRN-' || to_char(p_tanggal, 'YYYYMM') || '-' || upper(substr(replace(v_entry_id::text, '-', ''), 1, 8)),
    p_tanggal, 'Pembelian aset tetap: ' || p_nama, 'asset-purchase', v_asset_id::text, p_branch_id
  );
  insert into public.journal_lines (entry_id, account_id, debit, credit) values
    (v_entry_id, v_asset_account, p_harga, 0),
    (v_entry_id, v_credit_account, 0, p_harga);

  return v_asset_id;
end;
$$;

revoke all on function public.create_fixed_asset_purchase(text, uuid, date, numeric, numeric, integer, uuid, text) from public;
grant execute on function public.create_fixed_asset_purchase(text, uuid, date, numeric, numeric, integer, uuid, text) to authenticated;
