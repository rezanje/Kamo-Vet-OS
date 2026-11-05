-- Laporan Aldi (grup ERP Dev, 5 Nov 2026):
-- 1. "Pembayaran tunai di masing-masing cabang belum konek ke COA kas masing-masing cabang,
--    masih ke kas kecil semua." Penyebab: bagan akun baru (20261105010000) sudah punya akun
--    110004–110021 "Kas Toko <cabang>", tetapi akun itu belum didaftarkan sebagai rekening di
--    Kas & Bank dan belum dipetakan ke metode Tunai per cabang. Tanpa peta, semua fungsi
--    penerimaan (kasir petshop, klinik, rawat inap, pengeluaran shift, selisih tutup shift)
--    jatuh ke bawaan 110003 Kas Kecil.
--    Perbaikan: daftarkan tiap akun Kas Toko sebagai rekening Kas cabangnya dan pasang aturan
--    peta "Tunai → Kas Toko <cabang>". Hanya transaksi BARU yang pindah; jurnal lama tidak
--    diubah. Aturan Tunai cabang yang sudah diisi manual oleh finance tidak ditimpa.
-- 2. "Penjualan online masih jadi piutang, tinggal tambah bayar piutang online saat uang sudah
--    masuk — bisa langsung bayar semua faktur." Perbaikan: RPC atomik pencairan marketplace
--    banyak order sekaligus (satu dana masuk, potongan platform dibagi proporsional).

-- ---------------------------------------------------------------------------------------
-- 1. Kas tunai per cabang
-- ---------------------------------------------------------------------------------------
do $$
declare
  r record; v_branch uuid; v_branch_n integer; v_coa public.coa_accounts%rowtype; v_rek public.cash_accounts%rowtype;
  v_norm text[];
begin
  for r in select * from (values
    ('110004', array['BTKM']),
    ('110005', array['CIAW','CIAWI']),
    ('110006', array['CMS']),
    ('110007', array['CMGG']),
    ('110008', array['MUAR']),
    ('110009', array['TKI']),
    ('110010', array['GRND']),
    ('110011', array['SRKN']),
    ('110012', array['PDRY']),
    ('110013', array['VETCMS']),
    ('110014', array['VETCMGG']),
    ('110015', array['VETCIAW','VETCIAWI']),
    ('110016', array['VETPDRY']),
    ('110017', array['VETTKI']),
    ('110018', array['VETGRDA']),
    ('110019', array['VETGRLG']),
    ('110020', array['VETSRKN']),
    ('110021', array['VETGRND'])
  ) as t(coa_code, branch_codes) loop
    -- Kode cabang dibandingkan tanpa tanda baca/spasi: VET_CMGG = VET-CMGG = VETCMGG.
    v_norm := r.branch_codes;
    select count(*), min(b.id::text)::uuid into v_branch_n, v_branch
    from public.branches b
    where b.is_active and upper(regexp_replace(b.code, '[^A-Za-z0-9]', '', 'g')) = any(v_norm);
    if v_branch_n <> 1 then
      raise notice 'Kas cabang %: cabang % tidak ditemukan tepat satu (% cocok) — dilewati', r.coa_code, r.branch_codes, v_branch_n;
      continue;
    end if;

    select * into v_coa from public.coa_accounts
    where code = r.coa_code and is_active and not is_header and type = 'ASET' and normal_balance = 'D';
    if not found then
      raise notice 'Kas cabang %: akun tidak ada / tidak aktif — dilewati', r.coa_code;
      continue;
    end if;

    select * into v_rek from public.cash_accounts where coa_code = r.coa_code for update;
    if not found then
      insert into public.cash_accounts(nama, jenis, coa_code, branch_id)
      values (left(v_coa.name, 80), 'Kas', r.coa_code, v_branch)
      returning * into v_rek;
    elsif not v_rek.is_active or (v_rek.branch_id is not null and v_rek.branch_id <> v_branch) then
      -- Sudah diatur manual (nonaktif / milik cabang lain): hormati, jangan dipetakan.
      raise notice 'Kas cabang %: rekening sudah ada tetapi nonaktif/milik cabang lain — dilewati', r.coa_code;
      continue;
    elsif v_rek.branch_id is null then
      update public.cash_accounts set branch_id = v_branch where id = v_rek.id;
    end if;

    insert into public.payment_account_map(metode, branch_id, cash_account_id)
    select 'Tunai', v_branch, v_rek.id
    where not exists (select 1 from public.payment_account_map m where m.metode = 'Tunai' and m.branch_id = v_branch);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------
-- 2. Pencairan marketplace banyak order sekaligus
-- ---------------------------------------------------------------------------------------
-- Satu dana masuk ke bank untuk N order piutang marketplace (channel & cabang sama).
-- Jurnal: Dr Bank (dana masuk) + Dr 740020 Beban Komisi Marketplace (selisih)
--         / Cr 130009 Piutang Marketplace (total order).
-- Komisi per order dibagi proporsional terhadap total order; sisa pembulatan ke order terbesar.
create or replace function public.online_disburse_batch(
  p_request_key text, p_sale_ids uuid[], p_nominal numeric, p_tanggal date, p_account_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  prior public.unit_posting_requests%rowtype; payload jsonb; result jsonb;
  v_ids uuid[]; v_n integer; v_found integer; v_channel text; v_branch uuid; v_channels integer; v_branches integer;
  v_total numeric; v_komisi numeric; v_alloc numeric := 0; v_share numeric; v_biggest uuid;
  v_code text; v_rek public.cash_accounts%rowtype; v_ref text; v_seq integer; s record; v_first text; v_last text;
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' then
    raise exception 'Sesi login diperlukan.' using errcode = '42501';
  end if;
  if p_request_key is null or length(p_request_key) not between 1 and 120 then
    raise exception 'Identitas simpan tidak valid. Muat ulang halaman.' using errcode = '22023';
  end if;
  select array_agg(distinct x order by x) into v_ids from unnest(coalesce(p_sale_ids, '{}')) x where x is not null;
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n = 0 then raise exception 'Pilih minimal satu order.' using errcode = '22023'; end if;
  if v_n > 1000 then raise exception 'Maksimal 1000 order sekali cair.' using errcode = '22023'; end if;
  if p_nominal is null or p_nominal::text = 'NaN' or p_nominal <= 0 or p_nominal > 1000000000000 then
    raise exception 'Dana masuk harus lebih dari nol.' using errcode = '22023';
  end if;
  if p_tanggal is null or p_tanggal > (now() at time zone 'Asia/Jakarta')::date then
    raise exception 'Tanggal dana masuk tidak valid (tidak boleh di masa depan).' using errcode = '22023';
  end if;

  payload := jsonb_build_object('sale_ids', to_jsonb(v_ids), 'nominal', p_nominal, 'tanggal', p_tanggal, 'account_id', p_account_id);
  perform pg_advisory_xact_lock(hashtext('vetos:unit-request:' || auth.uid()::text || ':' || p_request_key)::bigint);
  select * into prior from public.unit_posting_requests where actor_id = auth.uid() and request_key = p_request_key;
  if found then
    if prior.scope <> 'online-cair' or prior.payload <> payload then
      raise exception 'Permintaan sudah digunakan dengan rincian berbeda. Muat ulang halaman.' using errcode = '22023';
    end if;
    return prior.result;
  end if;

  -- Hak akses cabang dicek sebelum mengunci baris apa pun.
  for s in select distinct branch_id from public.sales where id = any(v_ids) loop
    perform public.sales_assert_access(s.branch_id);
  end loop;
  -- Kunci semua order (urut id → tidak saling kunci dengan pencairan lain).
  perform 1 from public.sales where id = any(v_ids) order by id for update;
  select count(*), count(distinct channel), count(distinct branch_id), min(channel), min(branch_id::text)::uuid, sum(total)
    into v_found, v_channels, v_branches, v_channel, v_branch, v_total
  from public.sales where id = any(v_ids);
  if v_found <> v_n then raise exception 'Sebagian order tidak ditemukan. Muat ulang halaman.'; end if;
  if exists (select 1 from public.sales where id = any(v_ids) and voided_at is not null) then
    raise exception 'Ada order yang sudah dibatalkan. Muat ulang halaman.';
  end if;
  if exists (select 1 from public.sales where id = any(v_ids)
             and (channel is null or channel not in ('Shopee', 'Tokopedia', 'TikTok Shop'))) then
    raise exception 'Hanya order marketplace (Shopee/Tokopedia/TikTok Shop) yang bisa dicairkan.';
  end if;
  if exists (select 1 from public.sales where id = any(v_ids) and marketplace_status is distinct from 'piutang') then
    raise exception 'Ada order yang sudah dicairkan. Muat ulang halaman.';
  end if;
  if v_channels <> 1 then raise exception 'Satu pencairan hanya untuk satu marketplace.'; end if;
  if v_branches <> 1 then raise exception 'Satu pencairan hanya untuk satu cabang/toko online.'; end if;

  v_total := coalesce(v_total, 0);
  if p_nominal > v_total then
    raise exception 'Dana masuk (Rp %) melebihi total order dipilih (Rp %).',
      to_char(p_nominal, 'FM999G999G999G999'), to_char(v_total, 'FM999G999G999G999');
  end if;

  perform 1 from public.accounting_locks where id for share;
  if exists (select 1 from public.accounting_locks where id and p_tanggal <= closed_until) then
    raise exception 'Periode akuntansi sudah ditutup — tidak bisa posting tanggal ini.';
  end if;

  if p_account_id is not null then
    select * into v_rek from public.cash_accounts
    where id = p_account_id and is_active and (branch_id is null or branch_id = v_branch) for share;
    if not found then raise exception 'Rekening tujuan tidak aktif atau bukan untuk cabang ini.'; end if;
    v_code := v_rek.coa_code;
  else
    v_code := public.unit_posting_cash('Transfer', v_branch);
  end if;
  if not exists (select 1 from public.coa_accounts where code = v_code and is_active and not is_header and type = 'ASET') then
    raise exception 'Akun rekening tujuan % tidak tersedia.', v_code;
  end if;

  -- Bagi komisi proporsional; pembulatan rupiah penuh, sisa ke order terbesar.
  v_komisi := v_total - p_nominal;
  select id into v_biggest from public.sales where id = any(v_ids) order by total desc, id limit 1;
  for s in select id, total from public.sales where id = any(v_ids) and id <> v_biggest order by id loop
    v_share := case when v_total > 0 then round(v_komisi * s.total / v_total) else 0 end;
    v_share := least(greatest(v_share, 0), s.total);
    v_alloc := v_alloc + v_share;
    update public.sales set marketplace_status = 'cair', komisi = v_share, disbursed_at = now() where id = s.id;
  end loop;
  v_share := v_komisi - v_alloc;
  if v_share < 0 or v_share > (select total from public.sales where id = v_biggest) then
    raise exception 'Pembagian komisi tidak valid.';
  end if;
  update public.sales set marketplace_status = 'cair', komisi = v_share, disbursed_at = now() where id = v_biggest;

  -- Nomor referensi pencairan: CAIR-YYYYMMDD-NNN.
  perform pg_advisory_xact_lock(hashtext('vetos:online-cair:' || p_tanggal::text)::bigint);
  select coalesce(max(substring(source_ref from 15)::integer), 0) + 1 into v_seq
  from public.journal_entries
  where source = 'sale-online-cair' and source_ref ~ ('^CAIR-' || to_char(p_tanggal, 'YYYYMMDD') || '-[0-9]+$');
  v_ref := 'CAIR-' || to_char(p_tanggal, 'YYYYMMDD') || '-' || lpad(v_seq::text, 3, '0');
  select min(no_struk), max(no_struk) into v_first, v_last from public.sales where id = any(v_ids);

  perform public.sales_write_journal(p_tanggal, v_branch, 'sale-online-cair', v_ref,
    left(format('Pencairan %s %s order (%s%s)', v_channel, v_n, v_first,
      case when v_n > 1 then ' s/d ' || v_last else '' end), 250),
    jsonb_build_array(
      jsonb_build_object('code', v_code, 'debit', p_nominal, 'credit', 0),
      jsonb_build_object('code', '740020', 'debit', v_komisi, 'credit', 0),
      jsonb_build_object('code', '130009', 'debit', 0, 'credit', v_total)));

  result := jsonb_build_object('reference', v_ref, 'orders', v_n, 'total', v_total, 'nominal', p_nominal, 'komisi', v_komisi, 'channel', v_channel);
  insert into public.unit_posting_requests values (auth.uid(), 'online-cair', p_request_key, payload, result, v_branch);
  return result;
end $$;
revoke all on function public.online_disburse_batch(text, uuid[], numeric, date, uuid) from public, anon, service_role;
grant execute on function public.online_disburse_batch(text, uuid[], numeric, date, uuid) to authenticated;
