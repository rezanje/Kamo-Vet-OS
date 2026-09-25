-- Clinic invoice posting is one database transaction: invoice rows, medicine
-- layers, the recipe cost already issued at compounding time, and both journals.

alter table public.prescription_items
  add column compound_recipe_id uuid references public.compounding_recipes(id) on delete restrict;
create unique index prescription_items_compound_recipe_unique
  on public.prescription_items(compound_recipe_id) where compound_recipe_id is not null;

alter table public.invoice_items
  add column compound_recipe_id uuid references public.compounding_recipes(id) on delete restrict,
  add column prescription_item_id uuid references public.prescription_items(id) on delete restrict,
  add column satuan varchar(20),
  add column faktor numeric(15,4) not null default 1;
create unique index invoice_items_compound_recipe_unique
  on public.invoice_items(compound_recipe_id) where compound_recipe_id is not null;
create unique index invoice_items_prescription_item_unique
  on public.invoice_items(prescription_item_id) where prescription_item_id is not null;

alter table public.invoices
  add column request_key text,
  add column request_hash text;
create unique index invoices_request_key_unique
  on public.invoices(request_key) where request_key is not null;

-- These existing journal guards resolve relation names at trigger runtime. The
-- posting RPC deliberately has an empty search_path, so qualify their lookups.
create or replace function public.check_period_lock()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_closed date;
begin
  select l.closed_until into v_closed from public.accounting_locks l where l.id;
  if v_closed is null then return coalesce(new, old); end if;
  if (tg_op in ('INSERT','UPDATE') and new.tanggal <= v_closed)
     or (tg_op in ('UPDATE','DELETE') and old.tanggal <= v_closed) then
    raise exception 'Periode s/d % sudah ditutup — jurnal terkunci', v_closed;
  end if;
  return coalesce(new, old);
end;
$function$;

create or replace function public.check_period_lock_lines()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_closed date;
  v_tanggal date;
begin
  select l.closed_until into v_closed from public.accounting_locks l where l.id;
  if v_closed is null then return coalesce(new, old); end if;
  select e.tanggal into v_tanggal from public.journal_entries e where e.id = coalesce(new.entry_id, old.entry_id);
  if v_tanggal is not null and v_tanggal <= v_closed then
    raise exception 'Periode s/d % sudah ditutup — baris jurnal terkunci', v_closed;
  end if;
  return coalesce(new, old);
end;
$function$;

create or replace function public.tolak_jurnal_ke_akun_header()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if exists (select 1 from public.coa_accounts a where a.id = new.account_id and a.is_header) then
    raise exception 'Akun induk tidak boleh dipakai memposting jurnal — pilih akun rinciannya.';
  end if;
  return new;
end;
$function$;

-- Each successfully issued compound gets one explicit billing row in the same
-- transaction as its stock issue. No name matching is used at invoice time.
create or replace function public.link_compound_recipe_to_prescription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.prescription_items (
    medical_record_id, nama_obat, qty, harga, satuan, faktor, jenis,
    aturan_pakai, item_id, compound_recipe_id
  ) values (
    new.medical_record_id, new.recipe_name, 1, new.total_price, 'racikan', 1,
    'obat', new.dosage_instruction, null, new.id
  );
  return new;
end;
$function$;
revoke all on function public.link_compound_recipe_to_prescription() from public, anon, authenticated, service_role;
create trigger compounding_recipe_billing_link
  after insert on public.compounding_recipes
  for each row execute function public.link_compound_recipe_to_prescription();

-- Internal journal writer: only the invoice RPC below can call this function.
create or replace function public.clinic_write_journal(
  p_tanggal date,
  p_deskripsi text,
  p_source text,
  p_source_ref text,
  p_branch_id uuid,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_line jsonb;
  v_code text;
  v_account_id uuid;
  v_debit numeric;
  v_credit numeric;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_prefix text;
  v_seq bigint;
  v_attempt integer := 0;
  v_no_jurnal text;
  v_entry_id uuid;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_INVALID: baris jurnal tidak valid';
  end if;
  if jsonb_array_length(p_lines) = 0 then return null; end if;

  for v_line in select e.value from jsonb_array_elements(p_lines) as e(value)
  loop
    v_code := nullif(v_line ->> 'code', '');
    v_debit := coalesce((v_line ->> 'debit')::numeric, 0);
    v_credit := coalesce((v_line ->> 'credit')::numeric, 0);
    if v_code is null or v_debit < 0 or v_credit < 0 or (v_debit > 0 and v_credit > 0) then
      raise exception using errcode = 'P0001', message = 'ACCOUNT_INVALID: baris jurnal tidak valid';
    end if;
    if v_debit > 0 or v_credit > 0 then
      select a.id into v_account_id
      from public.coa_accounts a
      where a.code = v_code and a.is_active and not a.is_header;
      if not found then
        raise exception using errcode = 'P0001', message = format('ACCOUNT_INVALID: akun %s tidak aktif atau tidak ditemukan', v_code);
      end if;
      v_total_debit := v_total_debit + v_debit;
      v_total_credit := v_total_credit + v_credit;
    end if;
  end loop;
  if v_total_debit = 0 and v_total_credit = 0 then return null; end if;
  if v_total_debit <> v_total_credit then
    raise exception using errcode = 'P0001', message = 'JOURNAL_UNBALANCED: jurnal invoice tidak seimbang';
  end if;

  v_prefix := 'JRN-' || to_char(p_tanggal, 'YYYYMM') || '-';
  perform pg_advisory_xact_lock(hashtextextended('clinic-journal-number:' || v_prefix, 0));
  select coalesce(max(substring(e.no_jurnal, length(v_prefix) + 1)::bigint), 0) + 1
    into v_seq
  from public.journal_entries e
    where left(e.no_jurnal, length(v_prefix)) = v_prefix
    and substring(e.no_jurnal, length(v_prefix) + 1) ~ '^[0-9]+$';

  loop
    v_no_jurnal := v_prefix || case when length(v_seq::text) > 4 then v_seq::text else lpad(v_seq::text, 4, '0') end;
    begin
      insert into public.journal_entries (
        no_jurnal, tanggal, deskripsi, source, source_ref, branch_id
      ) values (
        v_no_jurnal, p_tanggal, p_deskripsi, p_source, p_source_ref, p_branch_id
      ) returning id into v_entry_id;
      exit;
    exception when unique_violation then
      v_attempt := v_attempt + 1;
      v_seq := v_seq + 1;
      if v_attempt > 100 then
        raise exception using errcode = 'P0001', message = 'JOURNAL_DUPLICATE: nomor atau jurnal invoice sudah digunakan';
      end if;
    end;
  end loop;

  for v_line in select e.value from jsonb_array_elements(p_lines) as e(value)
  loop
    v_debit := coalesce((v_line ->> 'debit')::numeric, 0);
    v_credit := coalesce((v_line ->> 'credit')::numeric, 0);
    if v_debit > 0 or v_credit > 0 then
      select a.id into v_account_id from public.coa_accounts a
      where a.code = v_line ->> 'code' and a.is_active and not a.is_header;
      if not found then
        raise exception using errcode = 'P0001', message = format('ACCOUNT_INVALID: akun %s tidak aktif atau tidak ditemukan', v_line ->> 'code');
      end if;
      insert into public.journal_lines (entry_id, account_id, debit, credit)
      values (v_entry_id, v_account_id, v_debit, v_credit);
    end if;
  end loop;
  return v_entry_id;
end;
$function$;
revoke all on function public.clinic_write_journal(date, text, text, text, uuid, jsonb) from public, anon, authenticated, service_role;

create or replace function public.clinic_post_invoice(
  p_visit_id uuid,
  p_request_key text,
  p_invoice jsonb,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
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
  v_item_name text;
  v_pi record;
  v_recipe record;
  v_recipe_cost numeric(15,2);
  v_cashier_shift_ok boolean;
begin
  v_call_role := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
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
  if exists (select 1 from public.invoices i where i.visit_id = p_visit_id and i.voided_at is null) then
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
    paid_status, metode_bayar, paid_at, shift_id, voucher_code, salesperson_id,
    request_key, request_hash
  ) values (
    p_visit_id, v_invoice_no, v_subtotal, v_discount, v_tax, v_total,
    v_dp_amount, nullif(p_invoice ->> 'dp_date', '')::date, v_paid_status,
    v_metode, case when v_paid_status = 'Lunas' then now() else null end,
    v_shift.id, v_voucher, v_salesperson_id, v_request_key, v_hash
  ) returning id into v_invoice_id;

  -- Lock stock balances by item ID before consuming any FEFO/FIFO layer. This
  -- fixed order is shared by all invoice calls and avoids cross-item deadlocks.
  for v_line in
    select distinct (e.value ->> 'item_id')::uuid as item_id
    from jsonb_array_elements(p_lines) as e(value)
    where nullif(e.value ->> 'item_id', '') is not null
      and coalesce(e.value ->> 'kind', 'obat') <> 'jasa'
    order by item_id
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
      if v_prescription_item_id is null and v_unit is distinct from v_base_unit then
        raise exception using errcode = 'P0001', message = 'UNIT_INVALID: baris manual hanya boleh memakai satuan dasar';
      end if;
      if v_unit = v_base_unit then
        v_factor := 1;
      else
        select iu.factor into v_factor from public.item_units iu
        where iu.item_id = v_item_id and iu.unit = v_unit;
        if not found or v_factor <= 0 then
          raise exception using errcode = 'P0001', message = 'UNIT_INVALID: satuan barang tidak ditemukan';
        end if;
      end if;
      if v_prescription_item_id is not null and v_pi.faktor is distinct from v_factor then
        raise exception using errcode = 'P0001', message = 'UNIT_INVALID: faktor satuan resep berbeda dari master';
      end if;
      v_base_qty := v_qty * v_factor;
      if v_warehouse_id is null then
        raise exception using errcode = 'P0001', message = 'WAREHOUSE_MISSING: gudang klinik aktif tidak ditemukan';
      end if;
      select s.qty into v_stock_qty from public.stock s
      where s.warehouse_id = v_warehouse_id and s.item_id = v_item_id;
      if not found or v_stock_qty < v_base_qty then
        raise exception using errcode = 'P0001', message = format('STOCK_SHORT: %s', coalesce(v_item_name, v_description));
      end if;

      v_remaining := v_base_qty;
      v_line_hpp := 0;
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
        if v_layer.unit_cost <= 0 then
          raise exception using errcode = 'P0001', message = format('COST_MISSING: %s', coalesce(v_item_name, v_description));
        end if;
        update public.stock_layers set qty_left = qty_left - v_take where id = v_layer.id;
        v_line_hpp := v_line_hpp + v_take * v_layer.unit_cost;
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
        (v_line_hpp / nullif(v_base_qty, 0)), 'klinik', v_invoice_no);
    elsif v_item_id is not null and v_kind = 'jasa' then
      select i.item_type, i.is_active into v_item_type, v_is_active from public.items i where i.id = v_item_id for share;
      if not found or not v_is_active or v_item_type is distinct from 'Jasa' then
        raise exception using errcode = 'P0001', message = 'ITEM_INVALID: item jasa tidak aktif atau bukan jasa';
      end if;
      v_unit := coalesce(v_unit, 'jasa');
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
      compound_recipe_id, prescription_item_id, satuan, faktor
    ) values (
      v_invoice_id, v_description, v_qty, v_price, v_kind, v_discount_percent,
      v_item_id, v_line_hpp, v_recipe_id, v_prescription_item_id, v_unit, v_factor
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

  return v_invoice_id;
end;
$function$;

revoke all on function public.clinic_post_invoice(uuid, text, jsonb, jsonb) from public, anon, service_role;
grant execute on function public.clinic_post_invoice(uuid, text, jsonb, jsonb) to authenticated;
