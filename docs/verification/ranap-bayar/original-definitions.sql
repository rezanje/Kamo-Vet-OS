CREATE OR REPLACE FUNCTION clinic_private.enforce_min_dp(p_invoice_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_invoice public.invoices%rowtype;
  v_pct numeric;
  v_min numeric(15,2);
  v_received numeric(15,2);
  v_role text;
  v_reason text := nullif(btrim(p_reason), '');
begin
  select * into v_invoice from public.invoices where id = p_invoice_id;
  if not found or v_invoice.total <= 0 then return; end if;
  v_pct := clinic_private.min_dp_percent();
  if v_pct <= 0 then return; end if;
  v_received := clinic_private.invoice_received(p_invoice_id)::numeric(15,2);
  if v_invoice.paid_status = 'Lunas' or v_received >= v_invoice.total then return; end if;
  v_min := ceil(v_invoice.total * v_pct / 100)::numeric(15,2);
  if v_received >= v_min then return; end if;
  if v_reason is null then
    -- Pesan dijaga pendek (<100 karakter) supaya penerjemah galat di aplikasi bisa
    -- menampilkan rinciannya apa adanya, bukan jatuh ke pesan umum.
    raise exception using errcode='P0001', message=format(
      'DP_MINIMAL: minimal %s%% = Rp %s, baru diterima Rp %s',
      rtrim(rtrim(to_char(v_pct, 'FM999990.99'), '0'), '.'), trim(to_char(v_min, 'FM999999999990')),
      trim(to_char(v_received, 'FM999999999990')));
  end if;
  if length(v_reason) > 500 then
    raise exception using errcode='P0001', message='DP_MINIMAL: alasan penerobosan terlalu panjang';
  end if;
  select p.role into v_role from public.profiles p where p.id = auth.uid() and p.is_active;
  if v_role is null or v_role not in ('OWNER','ADMIN','FINANCE') then
    raise exception using errcode='P0001',
      message='DP_OVERRIDE_DENIED: hanya OWNER, ADMIN, atau FINANCE boleh menerima di bawah uang muka minimal';
  end if;
  insert into public.clinic_dp_overrides(
    invoice_id, min_percent, required_amount, received_amount, reason, created_by
  ) values (p_invoice_id, v_pct, v_min, v_received, v_reason, auth.uid())
  on conflict (invoice_id) do nothing;
end;
$function$

CREATE OR REPLACE FUNCTION clinic_private.invoice_received(p_invoice_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce((select i.dp_amount from public.invoices i where i.id = p_invoice_id), 0)
    + coalesce((select sum(p.amount) from public.invoice_payments p where p.invoice_id = p_invoice_id), 0);
$function$

CREATE OR REPLACE FUNCTION public.clinic_post_inpatient_stage_invoice(p_visit_id uuid, p_request_key text, p_invoice jsonb, p_lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_visit public.visits%rowtype;
  v_key text := nullif(btrim(p_request_key), '');
  v_replay boolean;
  v_invoice_id uuid;
  v_invoice_no text;
  v_tanggal date;
  v_branch uuid;
  v_remaining numeric(15,2);
  v_apply numeric(15,2);
  v_payment_id uuid;
  v_adv record;
begin
  v_role := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('role', true), 'none'));
  if v_role is distinct from 'authenticated' or v_user is null then
    raise exception using errcode='P0001', message='ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  if v_key is null or length(v_key) > 100 then
    raise exception using errcode='P0001', message='INVOICE_INVALID: kunci permintaan tidak valid';
  end if;
  select v.* into v_visit from public.visits v where v.id = p_visit_id;
  if not found or not public.user_can_access_branch(v_visit.branch_id) then
    raise exception using errcode='P0001', message='ACCESS_DENIED: kunjungan tidak ditemukan atau cabang tidak diizinkan';
  end if;
  if not exists (select 1 from public.inpatient_records r where r.visit_id = p_visit_id) then
    raise exception using errcode='P0001', message='STAGE_INVALID: kunjungan ini bukan rawat inap';
  end if;
  -- Uang tagihan tahap HANYA boleh masuk lewat kwitansi kunjungan
  -- (clinic_receive_visit_payment) di dalam shift klinik. Kepala tagihan yang
  -- membawa uang ditolak apa adanya — termasuk nilai bukan angka, null, negatif,
  -- pecahan, dan titipan kunci pembayaran campuran. Tanpa ini pemanggil RPC
  -- langsung (bukan layar) bisa membukukan kas tanpa kwitansi dan tanpa jejak
  -- pembatalan.
  if p_invoice ? 'split_payments' or p_invoice ? 'min_dp_deferred'
     or coalesce(nullif(p_invoice ->> 'paid_status', ''), 'Belum Lunas') is distinct from 'Belum Lunas'
     or (p_invoice ? 'dp_amount' and (
          jsonb_typeof(p_invoice -> 'dp_amount') not in ('number', 'null')
          or (jsonb_typeof(p_invoice -> 'dp_amount') = 'number'
              and (p_invoice ->> 'dp_amount')::numeric is distinct from 0)))
     or (p_invoice ? 'dp_date' and jsonb_typeof(p_invoice -> 'dp_date') is distinct from 'null') then
    raise exception using errcode='P0001',
      message='STAGE_INVALID: uang tagihan tahap hanya lewat kwitansi kunjungan';
  end if;
  -- LOCK-01 langkah 2: koordinator diambil SEBELUM clinic_post_invoice mengunci
  -- baris apa pun, lalu potret kunjungannya dibaca ulang di dalam bagian kritis.
  perform clinic_private.billing_lock(clinic_private.billing_keys_visit(p_visit_id));
  select v.* into v_visit from public.visits v where v.id = p_visit_id;
  if not found or not public.user_can_access_branch(v_visit.branch_id) then
    raise exception using errcode='P0001', message='ACCESS_DENIED: kunjungan tidak ditemukan atau cabang tidak diizinkan';
  end if;
  v_branch := v_visit.branch_id;
  v_tanggal := nullif(p_invoice ->> 'tanggal', '')::date;
  v_replay := exists (select 1 from public.invoices i where i.request_key = v_key);

  -- Konteks tahap dibuka hanya selama posting berjalan lalu ditutup lagi: baris lain
  -- dalam transaksi yang sama tidak boleh ikut menembus penjaga INPATIENT_OPEN, dan
  -- penundaan uang muka minimal tidak pernah berasal dari isi permintaan pemanggil.
  perform clinic_private.context_begin('stage', p_visit_id);
  v_invoice_id := public.clinic_post_invoice(p_visit_id, v_key, p_invoice, p_lines);
  perform clinic_private.context_end();
  if v_replay then return v_invoice_id; end if;
  update public.invoices set stage_billing = true where id = v_invoice_id;

  select i.invoice_no, i.total - i.dp_amount into v_invoice_no, v_remaining
  from public.invoices i where i.id = v_invoice_id for update;

  -- Uang muka pemilik (uang yang masuk sebelum ada tagihan) otomatis memotong tahap ini,
  -- tertua lebih dulu. Ini bukan penerimaan kas baru: utang ke pemilik yang berkurang.
  if v_visit.customer_id is not null then
    for v_adv in
      select a.* from public.clinic_customer_advances a
      where a.customer_id = v_visit.customer_id and a.branch_id = v_branch
        and a.status = 'aktif' and a.amount > a.applied and a.released_at is null
      order by a.created_at, a.id
      for update
    loop
      exit when v_remaining <= 0;
      v_apply := least(v_adv.amount - v_adv.applied, v_remaining)::numeric(15,2);
      insert into public.invoice_payments(
        invoice_id, tanggal, amount, metode, catatan, kas_code, created_by
      ) values (
        v_invoice_id, v_tanggal, v_apply, 'Uang Muka',
        'Pemakaian uang muka ' || v_adv.no_uang_muka, '2103', v_user
      ) returning id into v_payment_id;
      insert into public.clinic_advance_applications(advance_id, invoice_id, payment_id, amount, created_by)
        values (v_adv.id, v_invoice_id, v_payment_id, v_apply, v_user);
      update public.clinic_customer_advances set applied = applied + v_apply where id = v_adv.id;
      perform public.clinic_write_journal(v_tanggal, 'Pemakaian uang muka ' || v_invoice_no,
        'klinik-ar', v_invoice_no, v_branch, jsonb_build_array(
          jsonb_build_object('code','2103','debit',v_apply,'credit',0),
          jsonb_build_object('code','1201','debit',0,'credit',v_apply)));
      v_remaining := v_remaining - v_apply;
    end loop;
  end if;
  -- Status bayar SELALU dihitung ulang dari uang yang benar-benar menempel, bukan dari
  -- dp_amount kepala invoice (tagihan tahap selalu mengirim dp_amount = 0).
  perform clinic_private.sync_paid_status(v_invoice_id);

  -- DP lanjutan opsional hanya di pembungkus tahap terpercaya ini.
  if not exists (
    select 1 from public.invoices prior
    where prior.visit_id = p_visit_id and prior.id <> v_invoice_id
      and prior.voided_at is null and prior.total > 0
      and not coalesce(prior.correction_pending, false)
  ) then
    perform clinic_private.enforce_min_dp(v_invoice_id, p_invoice ->> 'dp_override_reason');
  end if;
  return v_invoice_id;
end;
$function$

CREATE OR REPLACE FUNCTION public.clinic_post_invoice(p_visit_id uuid, p_request_key text, p_invoice jsonb, p_lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid;
  v_call_role text;
  v_visit public.visits%rowtype;
  v_shift public.cashier_shifts%rowtype;
  v_warehouse_id uuid;
  v_request_key text;
  v_hash text;
  v_existing public.invoices%rowtype;
  v_invoice_no text;
  v_pattern text;
  v_prefix text;
  v_digits integer := 4;
  v_seq bigint;
  v_tanggal date;
  v_subtotal numeric(15,2);
  v_discount numeric(15,2);
  v_tax numeric(15,2);
  v_total numeric(15,2);
  v_dp_amount numeric(15,2);
  v_paid_status text;
  v_metode text;
  v_voucher text;
  v_salesperson_id uuid;
  v_cash_received numeric(15,2);
  v_cash_code text;
  v_cash_account_active boolean;
  v_account_id uuid;
  v_revenue_lines jsonb := '[]'::jsonb;
  v_total_hpp numeric(15,2) := 0;
  v_invoice_id uuid;
  v_line record;
  v_item_id uuid;
  v_prescription_item_id uuid;
  v_recipe_id uuid;
  v_medical_record_id uuid;
  v_qty integer;
  v_price numeric(15,2);
  v_discount_percent numeric;
  v_line_amount numeric(15,2);
  v_description text;
  v_kind text;
  v_unit text;
  v_base_unit text;
  v_factor numeric(15,4);
  v_item_type text;
  v_is_active boolean;
  v_stock_qty numeric;
  v_base_qty numeric;
  v_remaining numeric;
  v_take numeric;
  v_line_hpp numeric;
  v_layer record;
  v_average boolean;
  v_effective_cost numeric;
  v_item_name text;
  v_pi record;
  v_recipe record;
  v_recipe_cost numeric(15,2);
  v_cashier_shift_ok boolean;
  v_bmhp jsonb;
  v_job_order_cost numeric(15,2);
begin
  perform public.inventory_assert_open_date(nullif(p_invoice ->> 'tanggal', '')::date);
  v_average := public.inventory_is_average();
  v_call_role := coalesce(
    nullif(auth.role(), ''),
    nullif(current_setting('role', true), 'none')
  );
  v_user_id := auth.uid();
  if v_call_role is distinct from 'authenticated' or v_user_id is null then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  if jsonb_typeof(p_invoice) is distinct from 'object'
     or jsonb_typeof(p_lines) is distinct from 'array'
     or jsonb_array_length(p_lines) not between 1 and 200 then
    raise exception using errcode = 'P0001', message = 'INVOICE_INVALID: data invoice tidak lengkap';
  end if;
  v_request_key := nullif(btrim(p_request_key), '');
  if v_request_key is null or length(v_request_key) > 100 then
    raise exception using errcode = 'P0001', message = 'INVOICE_INVALID: kunci permintaan tidak valid';
  end if;

  v_hash := md5(jsonb_build_object(
    'invoice', p_invoice - 'invoice_no' - 'paid_at',
    'lines', p_lines
  )::text);
  perform clinic_private.billing_lock(clinic_private.billing_keys_visit(p_visit_id));
  perform pg_advisory_xact_lock(hashtextextended('clinic-invoice-request:' || v_request_key, 0));
  select i.* into v_existing from public.invoices i where i.request_key = v_request_key for update;
  if found then
    if v_existing.visit_id is distinct from p_visit_id or v_existing.request_hash is distinct from v_hash then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT: kunci invoice telah dipakai untuk data berbeda';
    end if;
    return v_existing.id;
  end if;

  select v.* into v_visit from public.visits v where v.id = p_visit_id for update;
  if not found or not public.user_can_access_branch(v_visit.branch_id) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: kunjungan tidak ditemukan atau cabang tidak diizinkan';
  end if;
  if exists (select 1 from public.invoices i where i.visit_id = p_visit_id and i.voided_at is null)
     and not clinic_private.stage_billing(p_visit_id) then
    raise exception using errcode = 'P0001', message = 'INVOICE_EXISTS: kunjungan sudah memiliki invoice aktif';
  end if;

  v_tanggal := nullif(p_invoice ->> 'tanggal', '')::date;
  v_subtotal := coalesce((p_invoice ->> 'subtotal')::numeric, 0)::numeric(15,2);
  v_discount := coalesce((p_invoice ->> 'discount')::numeric, 0)::numeric(15,2);
  v_tax := coalesce((p_invoice ->> 'tax')::numeric, 0)::numeric(15,2);
  v_total := coalesce((p_invoice ->> 'total')::numeric, 0)::numeric(15,2);
  v_dp_amount := coalesce((p_invoice ->> 'dp_amount')::numeric, 0)::numeric(15,2);
  v_paid_status := p_invoice ->> 'paid_status';
  v_metode := p_invoice ->> 'metode_bayar';
  v_voucher := nullif(p_invoice ->> 'voucher_code', '');
  v_salesperson_id := nullif(p_invoice ->> 'salesperson_id', '')::uuid;
  if v_tanggal is null or v_subtotal < 0 or v_discount < 0 or v_discount > v_subtotal
     or v_tax < 0 or v_total < 0 or v_dp_amount < 0 or v_dp_amount > v_total
     or round(v_total, 2) <> round(v_subtotal - v_discount + v_tax, 2)
     or v_paid_status not in ('Belum Lunas', 'DP', 'Lunas')
     or v_metode not in ('Tunai', 'Transfer', 'Debit', 'Kredit', 'QRIS', 'E-Wallet') then
    raise exception using errcode = 'P0001', message = 'INVOICE_INVALID: nilai invoice tidak konsisten';
  end if;
  if (v_paid_status = 'DP' and (v_dp_amount <= 0 or v_dp_amount >= v_total))
     or (v_paid_status = 'Belum Lunas' and v_dp_amount <> 0)
     or (v_paid_status = 'Lunas' and v_dp_amount <> 0) then
    raise exception using errcode = 'P0001', message = 'INVOICE_INVALID: status pembayaran dan uang muka tidak cocok';
  end if;

  select s.* into v_shift from public.cashier_shifts s
  where s.id = nullif(p_invoice ->> 'shift_id', '')::uuid
    and s.branch_id = v_visit.branch_id and s.opened_by = v_user_id
    and s.shift_type = 'klinik' and s.status = 'open'
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'SHIFT_INVALID: shift klinik aktif tidak ditemukan';
  end if;

  select w.id into v_warehouse_id from public.warehouses w
  where w.branch_id = v_visit.branch_id and w.type = 'VET' and w.is_active
  order by w.created_at, w.id limit 1 for update;

  -- Total dari baris harus sama dengan subtotal yang telah dihitung ulang server.
  select round(coalesce(sum(
    ((e.value ->> 'qty')::numeric) * ((e.value ->> 'price')::numeric)
      * (1 - coalesce((e.value ->> 'discount_percent')::numeric, 0) / 100)
  ), 0), 2)
    into v_line_amount
  from jsonb_array_elements(p_lines) as e(value);
  if v_line_amount <> v_subtotal then
    raise exception using errcode = 'P0001', message = 'INVOICE_INVALID: subtotal tidak sama dengan rincian';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_lines) as e(value)
    where nullif(e.value ->> 'recipe_id', '') is not null
    group by e.value ->> 'recipe_id' having count(*) > 1
  ) then
    raise exception using errcode = 'P0001', message = 'RECIPE_LINKED: racikan tercantum lebih dari sekali';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_lines) as e(value)
    where nullif(e.value ->> 'prescription_item_id', '') is not null
    group by e.value ->> 'prescription_item_id' having count(*) > 1
  ) then
    raise exception using errcode = 'P0001', message = 'LINE_BILLED: baris resep tercantum lebih dari sekali dalam satu tagihan';
  end if;

  -- Serialize this generator with other invoice RPCs, then use the configured
  -- document pattern (INV default matches the app's historical format).
  select n.pola, n.digit into v_pattern, v_digits
  from public.document_numbering n where n.jenis = 'INV';
  if not found then
    v_pattern := 'INV-{YYYY}{MM}-';
    v_digits := 4;
  end if;
  v_prefix := replace(replace(replace(replace(v_pattern, '{YYYY}', to_char(v_tanggal, 'YYYY')),
    '{YY}', to_char(v_tanggal, 'YY')), '{MM}', to_char(v_tanggal, 'MM')), '{DD}', to_char(v_tanggal, 'DD'));
  if v_prefix ~ '\{[^}]+\}' or length(v_prefix) = 0 then
    raise exception using errcode = 'P0001', message = 'INVOICE_NO_INVALID: format nomor invoice tidak valid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('clinic-invoice-number:' || v_prefix, 0));
  select coalesce(max(substring(i.invoice_no, length(v_prefix) + 1)::bigint), 0) + 1
    into v_seq
  from public.invoices i
  where left(i.invoice_no, length(v_prefix)) = v_prefix
    and substring(i.invoice_no, length(v_prefix) + 1) ~ '^[0-9]+$';
  v_invoice_no := v_prefix || case when length(v_seq::text) > v_digits then v_seq::text else lpad(v_seq::text, v_digits, '0') end;
  if length(v_invoice_no) > 24 then
    raise exception using errcode = 'P0001', message = 'INVOICE_NO_INVALID: nomor invoice melebihi batas';
  end if;

  insert into public.invoices (
    visit_id, invoice_no, subtotal, discount, tax, total, dp_amount, dp_date,
    paid_status, metode_bayar, paid_at, shift_id, voucher_code, salesperson_id, service_pricing_version, campaign_code
  ) values (
    p_visit_id, v_invoice_no, v_subtotal, v_discount, v_tax, v_total,
    v_dp_amount, nullif(p_invoice ->> 'dp_date', '')::date, v_paid_status,
    v_metode, case when v_paid_status = 'Lunas' then now() else null end,
    v_shift.id, v_voucher, v_salesperson_id, nullif(p_invoice->>'service_pricing_version','')::smallint, nullif(p_invoice->>'campaign_code','')
  ) returning id into v_invoice_id;

  -- Lock stock balances by item ID before consuming any FEFO/FIFO layer. This
  -- fixed order is shared by all invoice calls and avoids cross-item deadlocks.
  for v_line in
    select x.item_id from (
      select (e.value ->> 'item_id')::uuid as item_id
      from jsonb_array_elements(p_lines) as e(value)
      where nullif(e.value ->> 'item_id', '') is not null
        and coalesce(e.value ->> 'kind', 'obat') <> 'jasa'
      union
      select (c.value ->> 'item_id')::uuid
      from jsonb_array_elements(p_lines) as e(value)
      join public.prescription_items pi on pi.id = nullif(e.value ->> 'prescription_item_id', '')::uuid
      cross join lateral jsonb_array_elements(coalesce(pi.bmhp_components, '[]'::jsonb)) as c(value)
    ) x order by x.item_id
  loop
    if v_warehouse_id is null then
      raise exception using errcode = 'P0001', message = 'WAREHOUSE_MISSING: gudang klinik aktif tidak ditemukan';
    end if;
    perform 1 from public.stock s
    where s.warehouse_id = v_warehouse_id and s.item_id = v_line.item_id
    for update;
  end loop;

  -- Lock recipe rows in a stable order. Ingredients were issued at recipe time;
  -- invoice posting reads their historical costs but never debits them again.
  for v_line in
    select distinct (e.value ->> 'recipe_id')::uuid as recipe_id
    from jsonb_array_elements(p_lines) as e(value)
    where nullif(e.value ->> 'recipe_id', '') is not null
    order by recipe_id
  loop
    perform 1 from public.compounding_recipes r where r.id = v_line.recipe_id for update;
  end loop;

  for v_line in
    select e.value, e.ordinality
    from jsonb_array_elements(p_lines) with ordinality as e(value, ordinality)
    order by nullif(e.value ->> 'item_id', '')::uuid nulls last, e.ordinality
  loop
    v_description := nullif(btrim(v_line.value ->> 'description'), '');
    if nullif(v_line.value ->> 'qty', '') is not null
       and (v_line.value ->> 'qty')::numeric <> trunc((v_line.value ->> 'qty')::numeric) then
      raise exception using errcode = 'P0001', message = 'LINE_INVALID: jumlah item harus bilangan bulat';
    end if;
    v_qty := nullif(v_line.value ->> 'qty', '')::numeric::integer;
    v_price := coalesce(nullif(v_line.value ->> 'price', '')::numeric, 0)::numeric(15,2);
    v_discount_percent := coalesce(nullif(v_line.value ->> 'discount_percent', '')::numeric, 0)::numeric(5,2);
    v_kind := coalesce(nullif(v_line.value ->> 'kind', ''), 'obat');
    v_item_id := nullif(v_line.value ->> 'item_id', '')::uuid;
    v_prescription_item_id := nullif(v_line.value ->> 'prescription_item_id', '')::uuid;
    v_recipe_id := nullif(v_line.value ->> 'recipe_id', '')::uuid;
    v_unit := nullif(btrim(v_line.value ->> 'unit'), '');
    if v_description is null or length(v_description) > 160 or v_qty is null or v_qty <= 0
       or v_price < 0 or v_discount_percent < 0 or v_discount_percent > 100
       or v_kind not in ('obat','jasa') then
      raise exception using errcode = 'P0001', message = 'LINE_INVALID: rincian invoice tidak valid';
    end if;
    if v_item_id is not null and v_recipe_id is not null then
      raise exception using errcode = 'P0001', message = 'LINE_INVALID: baris tidak boleh menjadi obat dan racikan sekaligus';
    end if;

    v_factor := 1;
    v_line_hpp := null;
    v_bmhp := null;
    v_job_order_cost := null;
    if v_prescription_item_id is not null then
      select pi.medical_record_id, pi.item_id, pi.satuan, pi.faktor, pi.compound_recipe_id
        into v_pi
      from public.prescription_items pi
      join public.medical_records mr on mr.id = pi.medical_record_id
      where pi.id = v_prescription_item_id and mr.visit_id = p_visit_id
      for share of pi;
      if not found then
        raise exception using errcode = 'P0001', message = 'LINE_INVALID: baris resep tidak cocok dengan kunjungan';
      end if;
      v_medical_record_id := v_pi.medical_record_id;
      if v_pi.compound_recipe_id is distinct from v_recipe_id or v_pi.item_id is distinct from v_item_id then
        raise exception using errcode = 'P0001', message = 'RECIPE_ID_MISSING: identitas racikan atau obat resep tidak cocok';
      end if;
      if v_unit is distinct from v_pi.satuan then
        raise exception using errcode = 'P0001', message = 'UNIT_INVALID: satuan baris resep berubah';
      end if;
    end if;

    if v_recipe_id is not null then
      select r.id, r.medical_record_id, r.status
        into v_recipe
      from public.compounding_recipes r
      where r.id = v_recipe_id
      for update;
      if not found or v_recipe.medical_record_id is distinct from v_medical_record_id
         or v_recipe.status = 'void'
         or v_prescription_item_id is null then
        raise exception using errcode = 'P0001', message = 'RECIPE_ID_MISSING: racikan tidak memiliki tautan resep yang valid';
      end if;
      if exists (select 1 from public.invoice_items ii where ii.compound_recipe_id = v_recipe_id)
         or not exists (select 1 from public.compound_issues ci where ci.recipe_id = v_recipe_id)
         or exists (select 1 from public.compound_issues ci where ci.recipe_id = v_recipe_id and ci.restored_at is not null)
         or exists (select 1 from public.compound_issues ci where ci.recipe_id = v_recipe_id and ci.posted_invoice_item_id is not null) then
        raise exception using errcode = 'P0001', message = 'RECIPE_LINKED: racikan sudah dipakai atau tidak memiliki histori HPP';
      end if;
      select round(sum(ci.qty * ci.unit_cost), 2)::numeric(15,2)
        into v_recipe_cost
      from public.compound_issues ci where ci.recipe_id = v_recipe_id;
      if v_recipe_cost is null or v_recipe_cost <= 0 then
        raise exception using errcode = 'P0001', message = 'COST_MISSING: histori HPP racikan tidak tersedia';
      end if;
      v_line_hpp := v_recipe_cost;
    elsif v_item_id is not null and v_kind = 'obat' then
      select i.name, i.unit, i.item_type, i.is_active
        into v_item_name, v_base_unit, v_item_type, v_is_active
      from public.items i where i.id = v_item_id for share;
      if not found or not v_is_active or v_item_type is distinct from 'Persediaan' then
        raise exception using errcode = 'P0001', message = 'ITEM_INVALID: barang obat tidak aktif atau bukan persediaan';
      end if;
      if v_unit is null then v_unit := v_base_unit; end if;
      if v_unit = v_base_unit then
        v_factor := 1;
      else
        select iu.factor into v_factor from public.item_units iu
        where iu.item_id = v_item_id and iu.unit = v_unit;
        if not found or v_factor <= 0 then
          raise exception using errcode = 'P0001', message = 'UNIT_INVALID: satuan barang tidak ditemukan';
        end if;
      end if;
      if v_prescription_item_id is not null then
        if v_pi.faktor is distinct from v_factor then
          raise exception using errcode = 'P0001', message = 'UNIT_INVALID: faktor satuan resep berbeda dari master';
        end if;
      end if;
      v_base_qty := v_qty * v_factor;
      if v_warehouse_id is null then
        raise exception using errcode = 'P0001', message = 'WAREHOUSE_MISSING: gudang klinik aktif tidak ditemukan';
      end if;
      if v_prescription_item_id is not null then
        v_bmhp := clinic_private.bmhp_issue(v_prescription_item_id, v_warehouse_id, v_invoice_no, v_tanggal);
      end if;
      if v_bmhp is not null then
        -- PESANAN_TINDAKAN: bahan keluar, hasil tindakan masuk senilai bahan, lalu dijual.
        v_job_order_cost := (v_bmhp ->> 'cost')::numeric(15,2);
        v_line_hpp := clinic_private.job_order_complete(v_warehouse_id, v_item_id, v_base_qty,
          v_job_order_cost, v_invoice_no, v_tanggal);
      else
      select s.qty into v_stock_qty from public.stock s
      where s.warehouse_id = v_warehouse_id and s.item_id = v_item_id;
      if not found or v_stock_qty < v_base_qty then
        raise exception using errcode = 'P0001', message = format('STOCK_SHORT: %s', coalesce(v_item_name, v_description));
      end if;

      v_remaining := v_base_qty;
      v_line_hpp := 0;
      v_effective_cost := null;
      if v_average then
        v_effective_cost := public.inventory_effective_unit_cost(v_warehouse_id,v_item_id);
        if v_effective_cost is null or v_effective_cost <= 0 or v_effective_cost::text in ('NaN','Infinity','-Infinity') then
          raise exception using errcode='P0001', message=format('COST_MISSING: %s',coalesce(v_item_name,v_description));
        end if;
      end if;
      for v_layer in
        select l.id, l.qty_left, l.unit_cost
        from public.stock_layers l
        where l.warehouse_id = v_warehouse_id and l.item_id = v_item_id and l.qty_left > 0
        order by (l.exp_date is null), l.exp_date nulls last, l.tanggal, l.created_at, l.id
        for update
      loop
        exit when v_remaining <= 0;
        v_take := least(v_layer.qty_left, v_remaining);
        if v_take <= 0 then continue; end if;
        if not v_average and (v_layer.unit_cost is null or v_layer.unit_cost <= 0) then
          raise exception using errcode = 'P0001', message = format('COST_MISSING: %s', coalesce(v_item_name, v_description));
        end if;
        update public.stock_layers set qty_left = qty_left - v_take where id = v_layer.id;
        v_line_hpp := v_line_hpp + v_take * coalesce(v_effective_cost,v_layer.unit_cost);
        v_remaining := v_remaining - v_take;
      end loop;
      if v_remaining > 0 then
        raise exception using errcode = 'P0001', message = format('LAYER_SHORT: %s', coalesce(v_item_name, v_description));
      end if;
      v_line_hpp := round(v_line_hpp, 2)::numeric(15,2);
      update public.stock set qty = qty - v_base_qty, updated_at = now()
      where warehouse_id = v_warehouse_id and item_id = v_item_id;
      insert into public.stock_moves (tanggal, warehouse_id, item_id, qty, unit_cost, source, source_ref)
      values (v_tanggal, v_warehouse_id, v_item_id, -v_base_qty,
        (case when v_average then v_effective_cost else v_line_hpp / nullif(v_base_qty, 0) end), 'klinik', v_invoice_no);
      end if;
    elsif v_item_id is not null and v_kind = 'jasa' then
      select i.item_type, i.is_active into v_item_type, v_is_active from public.items i where i.id = v_item_id for share;
      if not found or not v_is_active or v_item_type is distinct from 'Jasa' then
        raise exception using errcode = 'P0001', message = 'ITEM_INVALID: item jasa tidak aktif atau bukan jasa';
      end if;
      v_unit := coalesce(v_unit, 'jasa');
      -- K02_BMHP: actual usage on the clinical procedure row is issued once, at posting.
      if v_prescription_item_id is not null then
        v_bmhp := clinic_private.bmhp_issue(v_prescription_item_id, v_warehouse_id, v_invoice_no, v_tanggal);
        if v_bmhp is not null then v_line_hpp := (v_bmhp ->> 'cost')::numeric(15,2); end if;
      end if;
    elsif v_recipe_id is null and v_item_id is null and (
      v_unit = 'racikan' or exists (
        select 1
        from public.prescription_items pi
        join public.medical_records mr on mr.id = pi.medical_record_id
        where mr.visit_id = p_visit_id and pi.item_id is null
          and pi.nama_obat = v_description
          and (pi.compound_recipe_id is not null or pi.satuan = 'racikan')
      )
    ) then
      raise exception using errcode = 'P0001', message = 'RECIPE_ID_MISSING: racikan lama belum memiliki tautan HPP historis';
    end if;

    v_line_amount := round(v_qty * v_price * (1 - v_discount_percent / 100), 2)::numeric(15,2);
    insert into public.invoice_items (
      invoice_id, deskripsi, qty, harga, jenis, diskon_persen, item_id, hpp,
      compound_recipe_id, prescription_item_id, satuan, faktor, service_performers, bmhp_components, salesperson_id, package_item_id, package_qty
    ) values (
      v_invoice_id, v_description, v_qty, v_price, v_kind, v_discount_percent,
      v_item_id, v_line_hpp, v_recipe_id, v_prescription_item_id, v_unit, v_factor, v_line.value->'service_performers', v_bmhp, nullif(v_line.value->>'salesperson_id','')::uuid,
      nullif(v_line.value->>'package_item_id','')::uuid, nullif(v_line.value->>'package_qty','')::numeric
    ) returning id into v_account_id;

    if v_recipe_id is not null then
      update public.compound_issues set posted_invoice_item_id = v_account_id
      where recipe_id = v_recipe_id and posted_invoice_item_id is null and restored_at is null;
      if not found then
        raise exception using errcode = 'P0001', message = 'RECIPE_LINKED: HPP racikan tidak dapat dipasangkan ke invoice';
      end if;
    end if;
  end loop;

  select round(coalesce(sum(ii.hpp), 0), 2)::numeric(15,2)
    into v_total_hpp from public.invoice_items ii where ii.invoice_id = v_invoice_id;
  v_cash_received := case
    when v_paid_status = 'Lunas' then v_total
    when v_paid_status = 'DP' then v_dp_amount
    else 0
  end;

  select ca.coa_code, ca.is_active into v_cash_code, v_cash_account_active
  from public.payment_account_map pam
  join public.cash_accounts ca on ca.id = pam.cash_account_id
  where pam.metode = v_metode and pam.branch_id = v_visit.branch_id
  limit 1;
  if v_cash_code is null then
    select ca.coa_code, ca.is_active into v_cash_code, v_cash_account_active
    from public.payment_account_map pam
    join public.cash_accounts ca on ca.id = pam.cash_account_id
    where pam.metode = v_metode and pam.branch_id is null
    limit 1;
  end if;
  if v_cash_code is not null and v_cash_account_active is distinct from true then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_INVALID: rekening pembayaran tidak aktif';
  end if;
  if v_cash_code is null then
    v_cash_code := case when v_metode = 'Tunai' then '1101' else '1102' end;
  end if;
  select a.id into v_account_id from public.coa_accounts a
  where a.code = v_cash_code and a.is_active and not a.is_header;
  if not found then
    raise exception using errcode = 'P0001', message = format('ACCOUNT_INVALID: akun penerimaan %s tidak tersedia', v_cash_code);
  end if;

  if v_cash_received > 0 then
    v_revenue_lines := v_revenue_lines || jsonb_build_array(jsonb_build_object('code',v_cash_code,'debit',v_cash_received,'credit',0));
  end if;
  if v_total - v_cash_received > 0 then
    v_revenue_lines := v_revenue_lines || jsonb_build_array(jsonb_build_object('code','1201','debit',v_total - v_cash_received,'credit',0));
  end if;
  if v_discount > 0 then
    v_revenue_lines := v_revenue_lines || jsonb_build_array(jsonb_build_object('code','4102','debit',v_discount,'credit',0));
  end if;
  if v_subtotal > 0 then
    v_revenue_lines := v_revenue_lines || jsonb_build_array(jsonb_build_object('code','4201','debit',0,'credit',v_subtotal));
  end if;
  if v_tax > 0 then
    v_revenue_lines := v_revenue_lines || jsonb_build_array(jsonb_build_object('code','2201','debit',0,'credit',v_tax));
  end if;

  perform public.clinic_write_journal(v_tanggal, 'Pendapatan jasa klinik ' || v_invoice_no,
    'klinik', v_invoice_no, v_visit.branch_id, v_revenue_lines);
  if v_total_hpp > 0 then
    perform public.clinic_write_journal(v_tanggal, 'HPP obat klinik ' || v_invoice_no,
      'klinik-hpp', v_invoice_no, v_visit.branch_id,
      jsonb_build_array(
        jsonb_build_object('code','5101','debit',v_total_hpp,'credit',0),
        jsonb_build_object('code','1301','debit',0,'credit',v_total_hpp)
      ));
  end if;

  -- Menandai invoice selesai setelah semua baris, stok, dan jurnal tersimpan.
  -- Trigger anti-mutasi boleh menolak INSERT baris sesudah titik ini.
  update public.invoices set request_key = v_request_key, request_hash = v_hash
  where id = v_invoice_id;

  if not clinic_private.dp_deferred(p_visit_id) then
    perform clinic_private.enforce_min_dp(v_invoice_id, p_invoice ->> 'dp_override_reason');
  end if;

  -- K08_ATOMIC_PAID_CHECKOUT_BEGIN
  -- The visit FOR UPDATE lock is still held; admission uses the same lock.
  if v_paid_status = 'Lunas' then
    perform public.set_visit_service_state(p_visit_id, 'checkout');
  end if;
  -- K08_ATOMIC_PAID_CHECKOUT_END
  return v_invoice_id;
end;
$function$

CREATE OR REPLACE FUNCTION public.clinic_receive_visit_payment(p_visit_id uuid, p_request_key text, p_tanggal date, p_parts jsonb, p_invoice_id uuid DEFAULT NULL::uuid, p_catatan text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_visit public.visits%rowtype;
  v_shift public.cashier_shifts%rowtype;
  v_key text := nullif(btrim(p_request_key), '');
  v_hash text;
  v_existing public.clinic_payment_receipts%rowtype;
  v_receipt_id uuid;
  v_no text;
  v_part jsonb;
  v_index integer := 0;
  v_slot integer;
  v_total numeric(15,2) := 0;
  v_amount numeric;
  v_parts jsonb := '[]'::jsonb;
  v_kas text;
  v_inv record;
  v_sisa numeric(15,2);
  v_take numeric(15,2);
  v_payment_id uuid;
  v_left numeric(15,2);
  v_adv_lines jsonb := '[]'::jsonb;
  v_adv_total numeric(15,2) := 0;
  v_adv_no text;
  v_adv_id uuid;
  v_any_paid boolean := false;
begin
  v_role := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('role', true), 'none'));
  if v_role is distinct from 'authenticated' or v_user is null then
    raise exception using errcode='P0001', message='ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  if v_key is null or length(v_key) > 100 or p_tanggal is null
     or jsonb_typeof(p_parts) is distinct from 'array'
     or jsonb_array_length(p_parts) not between 1 and 6 then
    raise exception using errcode='P0001', message='PAYMENT_INVALID: rincian pembayaran tidak lengkap';
  end if;
  -- LOCK-01 langkah 1-3: cabang diperiksa dari pembacaan tanpa kunci, koordinator
  -- diambil lebih dulu, kunci idempotensi kwitansi sesudahnya, baru barisnya.
  select v.* into v_visit from public.visits v where v.id = p_visit_id;
  if not found or not public.user_can_access_branch(v_visit.branch_id) then
    raise exception using errcode='P0001', message='ACCESS_DENIED: kunjungan tidak ditemukan atau cabang tidak diizinkan';
  end if;
  perform clinic_private.billing_lock(clinic_private.billing_keys_visit(p_visit_id));
  perform pg_advisory_xact_lock(hashtextextended('clinic-receipt:' || v_key, 0));
  select v.* into v_visit from public.visits v where v.id = p_visit_id for update;
  if not found or not public.user_can_access_branch(v_visit.branch_id) then
    raise exception using errcode='P0001', message='ACCESS_DENIED: kunjungan tidak ditemukan atau cabang tidak diizinkan';
  end if;
  -- Addendum §1: uang klinik hanya boleh berpindah di dalam shift klinik milik kasirnya.
  select s.* into v_shift from public.cashier_shifts s
  where s.branch_id = v_visit.branch_id and s.opened_by = v_user
    and s.shift_type = 'klinik' and s.status = 'open' for update;
  if not found then
    raise exception using errcode='P0001', message='SHIFT_INVALID: shift klinik aktif tidak ditemukan';
  end if;

  v_hash := md5(jsonb_build_object('visit', p_visit_id, 'tanggal', p_tanggal,
    'parts', p_parts, 'invoice', p_invoice_id, 'catatan', nullif(btrim(p_catatan), ''))::text);
  select * into v_existing from public.clinic_payment_receipts where request_key = v_key for update;
  if found then
    if v_existing.visit_id is distinct from p_visit_id or v_existing.request_hash is distinct from v_hash then
      raise exception using errcode='P0001', message='IDEMPOTENCY_CONFLICT: kunci pembayaran dipakai untuk data berbeda';
    end if;
    return v_existing.id;
  end if;

  for v_part in select value from jsonb_array_elements(p_parts) loop
    v_index := v_index + 1;
    if jsonb_typeof(v_part) is distinct from 'object'
      or coalesce(v_part ->> 'method', '') not in ('Tunai','Transfer','Debit','Kredit','QRIS','E-Wallet') then
      raise exception using errcode='P0001', message='PAYMENT_INVALID: metode pembayaran tidak valid';
    end if;
    v_amount := nullif(v_part ->> 'amount', '')::numeric;
    if v_amount is null or v_amount <= 0 or v_amount <> trunc(v_amount) or v_amount > 9007199254740991 then
      raise exception using errcode='P0001', message='PAYMENT_INVALID: nominal pembayaran harus rupiah bulat positif';
    end if;
    v_kas := clinic_private.kas_code(v_part ->> 'method', v_visit.branch_id);
    v_total := v_total + v_amount;
    v_parts := v_parts || jsonb_build_array(jsonb_build_object(
      'urutan', v_index, 'metode', v_part ->> 'method', 'amount', v_amount, 'kas_code', v_kas, 'sisa', v_amount));
  end loop;

  v_no := clinic_private.next_no('KWT', 'KWT-{YYYY}{MM}-', 4, p_tanggal,
    'public.clinic_payment_receipts'::regclass, 'no_kwitansi');
  insert into public.clinic_payment_receipts(
    no_kwitansi, visit_id, customer_id, branch_id, tanggal, total, catatan,
    shift_id, created_by, request_key, request_hash
  ) values (
    v_no, p_visit_id, v_visit.customer_id, v_visit.branch_id, p_tanggal, v_total,
    nullif(btrim(p_catatan), ''), v_shift.id, v_user, v_key, v_hash
  ) returning id into v_receipt_id;
  insert into public.clinic_payment_receipt_parts(receipt_id, urutan, metode, amount, kas_code)
  select v_receipt_id, (e.value ->> 'urutan')::smallint, e.value ->> 'metode',
    (e.value ->> 'amount')::numeric, e.value ->> 'kas_code'
  from jsonb_array_elements(v_parts) e;

  -- Alokasi: invoice tahap tertua lebih dulu, atau tagihan yang dipilih kasir.
  for v_inv in
    select i.id, i.invoice_no, i.total, i.dp_amount
    from public.invoices i
    where i.visit_id = p_visit_id and i.voided_at is null and i.paid_status <> 'Lunas'
      and i.invoice_no is not null and i.request_key is not null and not i.correction_pending
    order by (i.id = p_invoice_id) desc, i.created_at, i.id
    for update
  loop
    exit when v_total <= 0;
    v_sisa := (v_inv.total - v_inv.dp_amount
      - coalesce((select sum(p.amount) from public.invoice_payments p where p.invoice_id = v_inv.id), 0))::numeric(15,2);
    if v_sisa <= 0 then continue; end if;
    for v_slot in 1 .. jsonb_array_length(v_parts) loop
      exit when v_sisa <= 0;
      v_take := least((v_parts -> (v_slot - 1) ->> 'sisa')::numeric, v_sisa)::numeric(15,2);
      if v_take <= 0 then continue; end if;
      insert into public.invoice_payments(
        invoice_id, tanggal, amount, metode, catatan, kas_code, created_by, receipt_id
      ) values (
        v_inv.id, p_tanggal, v_take, v_parts -> (v_slot - 1) ->> 'metode',
        'Kwitansi ' || v_no, v_parts -> (v_slot - 1) ->> 'kas_code', v_user, v_receipt_id
      ) returning id into v_payment_id;
      perform public.clinic_write_journal(p_tanggal, 'Pembayaran ' || v_inv.invoice_no || ' (' || v_no || ')',
        'klinik-ar', v_inv.invoice_no, v_visit.branch_id, jsonb_build_array(
          jsonb_build_object('code', v_parts -> (v_slot - 1) ->> 'kas_code', 'debit', v_take, 'credit', 0),
          jsonb_build_object('code','1201','debit',0,'credit',v_take)));
      v_parts := jsonb_set(v_parts, array[(v_slot - 1)::text, 'sisa'],
        to_jsonb((v_parts -> (v_slot - 1) ->> 'sisa')::numeric - v_take));
      v_sisa := v_sisa - v_take;
      v_total := v_total - v_take;
    end loop;
    -- Uang yang baru masuk sebagian membuat statusnya DP, bukan tetap Belum Lunas.
    perform clinic_private.sync_paid_status(v_inv.id);
    if v_sisa <= 0 then v_any_paid := true; end if;
  end loop;

  -- Sisa uang saat tidak ada tagihan yang belum lunas = uang muka penjualan (2103),
  -- bukan omzet. Ia otomatis memotong tahap berikutnya saat tagihannya terbit.
  select coalesce(sum((e.value ->> 'sisa')::numeric), 0) into v_left from jsonb_array_elements(v_parts) e;
  if v_left > 0 then
    if v_visit.customer_id is null then
      raise exception using errcode='P0001',
        message='ADVANCE_INVALID: kelebihan uang tidak dapat disimpan tanpa data pemilik';
    end if;
    v_adv_no := clinic_private.next_no('UMK', 'UMK-{YYYY}{MM}-', 4, p_tanggal,
      'public.clinic_customer_advances'::regclass, 'no_uang_muka');
    insert into public.clinic_customer_advances(
      no_uang_muka, receipt_id, customer_id, branch_id, visit_id, tanggal, amount, shift_id, created_by
    ) values (
      v_adv_no, v_receipt_id, v_visit.customer_id, v_visit.branch_id, p_visit_id, p_tanggal,
      v_left, v_shift.id, v_user
    ) returning id into v_adv_id;
    select coalesce(jsonb_agg(jsonb_build_object(
        'code', e.value ->> 'kas_code', 'debit', (e.value ->> 'sisa')::numeric, 'credit', 0)), '[]'::jsonb),
      coalesce(sum((e.value ->> 'sisa')::numeric), 0)
      into v_adv_lines, v_adv_total
    from jsonb_array_elements(v_parts) e where (e.value ->> 'sisa')::numeric > 0;
    perform public.clinic_write_journal(p_tanggal, 'Uang muka pemilik ' || v_adv_no,
      'klinik-uang-muka', v_adv_no, v_visit.branch_id,
      v_adv_lines || jsonb_build_array(jsonb_build_object('code','2103','debit',0,'credit',v_adv_total)));
  end if;

  -- Kunjungan baru ditutup kalau pasien sudah pulang DAN tidak ada tagihan aktif yang
  -- belum lunas. Pasien rawat inap yang baru membayar sebagian tetap berjalan.
  if v_any_paid then
    update public.visits set status = 'Selesai' where id = p_visit_id and status <> 'Selesai'
      and not exists (select 1 from public.inpatient_records r where r.visit_id = p_visit_id and r.discharged_at is null)
      and not exists (select 1 from public.invoices i where i.visit_id = p_visit_id
        and i.voided_at is null and i.paid_status <> 'Lunas');
  end if;
  return v_receipt_id;
end;
$function$