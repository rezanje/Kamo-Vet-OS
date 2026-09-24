-- BUG-07: save a new fixed asset and its purchase journal in one transaction.
create or replace function public.create_fixed_asset_purchase(
  p_nama text,
  p_category_id uuid,
  p_tanggal date,
  p_harga numeric,
  p_nilai_sisa numeric,
  p_umur_bulan integer,
  p_branch_id uuid,
  p_funding text,
  p_credit_code text
) returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_asset_id uuid := gen_random_uuid();
  v_entry_id uuid := gen_random_uuid();
  v_category_name text;
  v_asset_account uuid;
  v_credit_account uuid;
  v_prefix text;
  v_no_jurnal text;
  v_seq bigint;
  v_constraint text;
begin
  if p_nama is null or length(btrim(p_nama)) = 0 or length(p_nama) > 120
     or p_category_id is null or p_tanggal is null
     or p_harga is null or p_harga <= 0
     or p_nilai_sisa is null or p_nilai_sisa < 0 or p_nilai_sisa >= p_harga
     or p_umur_bulan is null or p_umur_bulan <= 0 then
    raise exception 'Data pembelian aset tidak valid.';
  end if;
  if p_funding is null or p_funding not in ('Tunai', 'Bank') then
    raise exception 'Pembelian baru wajib memakai Kas atau Bank.';
  end if;
  if p_branch_id is not null and not public.user_can_access_branch(p_branch_id) then
    raise exception 'Cabang tidak dapat diakses.';
  end if;

  select nama into v_category_name
  from public.asset_categories
  where id = p_category_id and is_active = true;
  if not found then raise exception 'Kategori aset tidak aktif atau tidak ditemukan.'; end if;

  select id into v_asset_account
  from public.coa_accounts
  where code = '1501' and is_active = true and is_header is not true;
  if not found then raise exception 'Akun aset tetap 1501 tidak tersedia sebagai akun detail aktif.'; end if;

  select account.id into v_credit_account
  from public.cash_accounts cash
  join public.coa_accounts account on account.code = cash.coa_code
  where cash.coa_code = p_credit_code
    and cash.is_active = true
    and account.is_active = true
    and account.is_header is not true;
  if not found then raise exception 'Rekening kas/bank tidak aktif atau tidak valid.'; end if;

  insert into public.fixed_assets (
    id, nama, kategori, category_id, tanggal_perolehan, harga_perolehan,
    nilai_sisa, umur_bulan, branch_id
  ) values (
    v_asset_id, btrim(p_nama), v_category_name, p_category_id, p_tanggal,
    p_harga, p_nilai_sisa, p_umur_bulan, p_branch_id
  );

  -- Serialize with this RPC's journal-number allocation; unique retry also
  -- covers older posting paths that do not use the advisory lock.
  v_prefix := 'JRN-' || to_char(p_tanggal, 'YYYYMM') || '-';
  perform pg_advisory_xact_lock(hashtext('vetos:journal:' || v_prefix)::bigint);
  select coalesce(max(substring(entry.no_jurnal from length(v_prefix) + 1 for 4)::bigint), 0) + 1
    into v_seq
  from public.journal_entries entry
  where left(entry.no_jurnal, length(v_prefix)) = v_prefix
    and substring(entry.no_jurnal from length(v_prefix) + 1 for 4) ~ '^[0-9]{4}$';

  loop
    v_no_jurnal := v_prefix || lpad(v_seq::text, 4, '0');
    begin
      insert into public.journal_entries (
        id, no_jurnal, tanggal, deskripsi, source, source_ref, branch_id
      ) values (
        v_entry_id, v_no_jurnal, p_tanggal,
        'Pembelian aset tetap: ' || btrim(p_nama), 'asset-purchase', v_asset_id::text, p_branch_id
      );
      exit;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint <> 'journal_entries_no_jurnal_key' then raise; end if;
      v_seq := v_seq + 1;
    end;
  end loop;

  insert into public.journal_lines(entry_id, account_id, debit, credit) values
    (v_entry_id, v_asset_account, p_harga, 0),
    (v_entry_id, v_credit_account, 0, p_harga);

  return v_asset_id;
end;
$$;

revoke all on function public.create_fixed_asset_purchase(text, uuid, date, numeric, numeric, integer, uuid, text, text) from public, anon;
grant execute on function public.create_fixed_asset_purchase(text, uuid, date, numeric, numeric, integer, uuid, text, text) to authenticated;

comment on function public.create_fixed_asset_purchase(text, uuid, date, numeric, numeric, integer, uuid, text, text) is
  'Creates one cash/bank fixed-asset purchase and its balanced journal atomically.';
