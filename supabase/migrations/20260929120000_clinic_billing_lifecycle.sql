-- Keep clinic receivables, inpatient discharge fees, and invoice corrections
-- within database transactions. Financial writes must fail together.

create table public.clinic_invoice_operations (
  request_key text primary key,
  invoice_id uuid not null references public.invoices(id),
  request_hash text not null,
  kind text not null check (kind in ('edit','reissue')),
  result_invoice_id uuid not null references public.invoices(id),
  created_at timestamptz not null default now()
);
revoke all on public.clinic_invoice_operations from public, anon, authenticated;

-- A voided invoice and its replacement may point to the same prescription.
-- The active-invoice uniqueness guard and RPC ownership protect billing instead.
drop index if exists public.invoice_items_prescription_item_unique;
create index invoice_items_prescription_item_idx on public.invoice_items(prescription_item_id)
  where prescription_item_id is not null;
revoke insert, update, delete on public.invoice_items from authenticated;
revoke insert, update, delete on public.invoices from authenticated;
revoke insert on public.invoice_edit_log from authenticated;
revoke update, delete on public.inpatient_records from authenticated;

-- Replace demo-era open invoice policies with branch-scoped reads.
drop policy if exists inv_all on public.invoices;
create policy inv_all on public.invoices for all to authenticated
  using (exists(select 1 from public.visits v where v.id=invoices.visit_id
    and public.user_can_access_branch(v.branch_id)))
  with check (exists(select 1 from public.visits v where v.id=invoices.visit_id
    and public.user_can_access_branch(v.branch_id)));
drop policy if exists invit_all on public.invoice_items;
create policy invit_all on public.invoice_items for all to authenticated
  using (exists(select 1 from public.invoices i join public.visits v on v.id=i.visit_id
    where i.id=invoice_items.invoice_id and public.user_can_access_branch(v.branch_id)))
  with check (exists(select 1 from public.invoices i join public.visits v on v.id=i.visit_id
    where i.id=invoice_items.invoice_id and public.user_can_access_branch(v.branch_id)));
drop policy if exists iel_sel on public.invoice_edit_log;
create policy iel_sel on public.invoice_edit_log for select to authenticated
  using (exists(select 1 from public.invoices i join public.visits v on v.id=i.visit_id
    where i.id=invoice_edit_log.invoice_id and public.user_can_access_branch(v.branch_id)));
drop policy if exists invpay_all on public.invoice_payments;
create policy invpay_all on public.invoice_payments for all to authenticated
  using (exists(select 1 from public.invoices i join public.visits v on v.id=i.visit_id
    where i.id=invoice_payments.invoice_id and public.user_can_access_branch(v.branch_id)))
  with check (exists(select 1 from public.invoices i join public.visits v on v.id=i.visit_id
    where i.id=invoice_payments.invoice_id and public.user_can_access_branch(v.branch_id)));

-- A live inpatient stay must have its calculated fee before any invoice is
-- issued. This also serializes a checkout against concurrent invoice posting.
create function public.guard_open_inpatient_invoice() returns trigger
language plpgsql security definer set search_path = '' as $function$
begin
  if exists(select 1 from public.inpatient_records r
    where r.visit_id=new.visit_id and r.discharged_at is null for share) then
    raise exception using errcode='P0001', message='INPATIENT_OPEN: biaya rawat inap belum dihitung';
  end if;
  return new;
end;
$function$;
create trigger guard_open_inpatient_invoice before insert on public.invoices
  for each row execute function public.guard_open_inpatient_invoice();
revoke all on function public.guard_open_inpatient_invoice() from public,anon,authenticated,service_role;

-- Security-invoker trigger sees the RPC owner's current_user during the two
-- authorized lifecycle functions; authenticated direct writes remain blocked.
create or replace function public.guard_posted_clinic_invoice() returns trigger
language plpgsql security invoker set search_path = '' as $function$
declare v_posted boolean;
begin
  if current_user <> 'authenticated' then return coalesce(new, old); end if;
  if tg_table_name = 'invoices' then
    if tg_op = 'DELETE' then
      if old.request_key is not null then
        raise exception using errcode='P0001', message='INVOICE_POSTED: invoice klinik perlu pembalikan atomik';
      end if;
      return old;
    end if;
    if old.request_key is not null then
      raise exception using errcode='P0001', message='INVOICE_POSTED: invoice klinik perlu pembalikan atomik';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    select i.request_key is not null into v_posted from public.invoices i where i.id=old.invoice_id;
  elsif tg_op = 'UPDATE' then
    select coalesce(bool_or(i.request_key is not null), false) into v_posted
      from public.invoices i where i.id in (old.invoice_id, new.invoice_id);
  else
    select i.request_key is not null into v_posted from public.invoices i where i.id=new.invoice_id;
  end if;
  if v_posted then
    raise exception using errcode='P0001', message='INVOICE_POSTED: baris invoice sudah diposting';
  end if;
  return coalesce(new, old);
end;
$function$;

alter table public.invoice_payments
  add column request_key text,
  add column request_hash text,
  add column transferred_from uuid references public.invoices(id);
alter table public.invoices
  add column correction_pending boolean not null default false,
  add column shift_cash_carry numeric(15,2);
create unique index invoice_payments_request_key_unique
  on public.invoice_payments(request_key) where request_key is not null;

-- The RPC owns payment writes. Direct writes could otherwise bypass the
-- invoice lock, amount check, and journal transaction.
revoke insert, update, delete on public.invoice_payments from authenticated;

create function public.clinic_receive_invoice_payment(
  p_invoice_id uuid, p_tanggal date, p_amount numeric, p_metode text,
  p_kas_code text, p_catatan text, p_request_key text
) returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_user uuid := auth.uid();
  v_visit public.visits%rowtype;
  v_invoice public.invoices%rowtype;
  v_existing public.invoice_payments%rowtype;
  v_key text := nullif(btrim(p_request_key), '');
  v_hash text;
  v_paid numeric;
  v_remaining numeric;
  v_payment_id uuid;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'authenticated'
     or v_user is null then
    raise exception using errcode='P0001', message='ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  if p_invoice_id is null or p_tanggal is null or p_amount is null
     or p_amount <= 0 or p_amount <> round(p_amount, 2)
     or p_metode not in ('Tunai','Transfer','Debit','Kredit','QRIS','E-Wallet')
     or nullif(btrim(p_kas_code), '') is null or v_key is null or length(v_key) > 100 then
    raise exception using errcode='P0001', message='PAYMENT_INVALID: data pelunasan tidak lengkap';
  end if;

  -- Visit first, invoice second: same lock order as posting and void/reissue.
  select v.* into v_visit from public.visits v
  join public.invoices i on i.visit_id = v.id where i.id = p_invoice_id;
  if not found then
    raise exception using errcode='P0001', message='INVOICE_INVALID: invoice tidak ditemukan';
  end if;
  perform 1 from public.visits where id = v_visit.id for update;
  if not public.user_can_access_branch(v_visit.branch_id) then
    raise exception using errcode='P0001', message='ACCESS_DENIED: cabang tidak diizinkan';
  end if;
  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if not found or v_invoice.voided_at is not null then
    raise exception using errcode='P0001', message='INVOICE_INVALID: invoice sudah dibatalkan';
  end if;

  v_hash := md5(jsonb_build_object(
    'invoice', p_invoice_id, 'tanggal', p_tanggal, 'amount', p_amount,
    'metode', p_metode, 'kas_code', p_kas_code, 'catatan', nullif(btrim(p_catatan), '')
  )::text);
  select * into v_existing from public.invoice_payments
  where request_key = v_key for update;
  if found then
    if v_existing.invoice_id is distinct from p_invoice_id
       or v_existing.request_hash is distinct from v_hash then
      raise exception using errcode='P0001', message='IDEMPOTENCY_CONFLICT: kunci pelunasan dipakai untuk data berbeda';
    end if;
    return v_existing.id;
  end if;
  if v_invoice.paid_status = 'Lunas' or v_invoice.invoice_no is null
     or v_invoice.correction_pending then
    raise exception using errcode='P0001', message='PAYMENT_INVALID: selesaikan koreksi tagihan sebelum menerima pembayaran';
  end if;
  select coalesce(sum(amount), 0) into v_paid from public.invoice_payments
  where invoice_id = p_invoice_id;
  v_remaining := v_invoice.total - v_invoice.dp_amount - v_paid;
  if v_remaining <= 0 or p_amount > v_remaining then
    raise exception using errcode='P0001', message='PAYMENT_INVALID: pelunasan melebihi sisa piutang';
  end if;
  if not exists (
    select 1 from public.cash_accounts ca
    join public.coa_accounts coa on coa.code = ca.coa_code
    where ca.coa_code = p_kas_code and ca.is_active
      and (ca.branch_id is null or ca.branch_id = v_visit.branch_id)
      and coa.is_active and not coa.is_header
  ) then
    raise exception using errcode='P0001', message='ACCOUNT_INVALID: rekening penerimaan tidak tersedia';
  end if;

  insert into public.invoice_payments(
    invoice_id, tanggal, amount, metode, catatan, kas_code, created_by,
    request_key, request_hash
  ) values (
    p_invoice_id, p_tanggal, p_amount, p_metode, nullif(btrim(p_catatan), ''),
    p_kas_code, v_user, v_key, v_hash
  ) returning id into v_payment_id;
  perform public.clinic_write_journal(
    p_tanggal, 'Pelunasan piutang ' || v_invoice.invoice_no, 'klinik-ar',
    v_invoice.invoice_no, v_visit.branch_id,
    jsonb_build_array(
      jsonb_build_object('code',p_kas_code,'debit',p_amount,'credit',0),
      jsonb_build_object('code','1201','debit',0,'credit',p_amount)
    )
  );
  if p_amount = v_remaining then
    update public.invoices set paid_status='Lunas', paid_at=now()
    where id = p_invoice_id;
    update public.visits set status='Selesai' where id = v_visit.id;
  end if;
  return v_payment_id;
end;
$function$;
revoke all on function public.clinic_receive_invoice_payment(uuid,date,numeric,text,text,text,text)
  from public, anon, service_role;
grant execute on function public.clinic_receive_invoice_payment(uuid,date,numeric,text,text,text,text)
  to authenticated;

-- One status change includes its audit row and automatic fee. No status is
-- saved when the fee insert fails.
create function public.clinic_change_inpatient_condition(
  p_inpatient_id uuid, p_new_status text, p_notes text
) returns boolean language plpgsql security definer set search_path = '' as $function$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_record public.inpatient_records%rowtype;
  v_tariff public.items%rowtype;
  v_medical_record_id uuid;
  v_days integer;
  v_discharged_at timestamptz;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'authenticated'
     or v_user is null then
    raise exception using errcode='P0001', message='ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  if p_new_status not in ('stabil','kritis','sembuh','rip') then
    raise exception using errcode='P0001', message='LOG_INVALID: status rawat inap tidak valid';
  end if;
  select * into v_record from public.inpatient_records
  where id = p_inpatient_id for update;
  if not found or not public.user_can_access_branch(v_record.branch_id) then
    raise exception using errcode='P0001', message='ACCESS_DENIED: rawat inap tidak dapat diakses';
  end if;
  if not exists(select 1 from public.visits v where v.id=v_record.visit_id
    and v.branch_id=v_record.branch_id) then
    raise exception using errcode='P0001', message='ACCESS_DENIED: cabang kunjungan tidak cocok'; end if;
  select role into v_role from public.profiles where id = v_user;
  if v_role is null or (p_new_status = 'rip' and v_role <> 'DOCTOR') then
    raise exception using errcode='P0001', message='ACCESS_DENIED: status RIP hanya boleh diubah dokter';
  end if;
  if v_record.condition_status = p_new_status then return false; end if;

  v_discharged_at := case when p_new_status in ('sembuh','rip') then now() else null end;
  if v_discharged_at is not null and exists(select 1 from public.invoices
      where visit_id=v_record.visit_id and voided_at is null) then
    raise exception using errcode='P0001', message='INVOICE_EXISTS: tagihan sudah terbit sebelum biaya rawat inap dihitung';
  end if;
  insert into public.inpatient_status_log(
    inpatient_record_id, previous_status, new_status, changed_by, notes
  ) values (p_inpatient_id, v_record.condition_status, p_new_status, v_user, p_notes);
  update public.inpatient_records set condition_status=p_new_status,
    discharged_at=v_discharged_at where id=p_inpatient_id;

  if v_discharged_at is not null then
    select * into v_tariff from public.items
    where tindakan_kategori='Rawat Inap' and is_active
    order by name, id limit 1;
    if found then
      select m.id into v_medical_record_id from public.medical_records m
      where m.visit_id = v_record.visit_id
      order by m.created_at desc, m.id desc limit 1;
      if v_medical_record_id is not null then
        v_days := greatest(1, ceil(extract(epoch from
          (v_discharged_at - v_record.admitted_at)) / 86400)::integer);
        delete from public.prescription_items
        where medical_record_id=v_medical_record_id and item_id=v_tariff.id;
        insert into public.prescription_items(
          medical_record_id, item_id, nama_obat, qty, harga, satuan,
          jenis, kategori, aturan_pakai
        ) values (
          v_medical_record_id, v_tariff.id, v_tariff.name, v_days,
          coalesce(v_tariff.sell_price, 0), coalesce(v_tariff.unit, 'hari'),
          'jasa', 'Rawat Inap',
          'Otomatis dari lama rawat inap: ' || v_days || ' hari'
        );
      end if;
    end if;
  end if;
  return true;
end;
$function$;
revoke all on function public.clinic_change_inpatient_condition(uuid,text,text)
  from public, anon, service_role;
grant execute on function public.clinic_change_inpatient_condition(uuid,text,text)
  to authenticated;

-- Wrap the existing atomic daily-log RPC so a selected discharge condition and
-- its fee join the same transaction. The status also participates in the retry
-- fingerprint; replaying a successful form never changes a later status.
create function public.clinic_save_inpatient_log_with_status(
  p_inpatient_id uuid, p_medical_record_id uuid, p_log jsonb,
  p_rows jsonb, p_compounds jsonb, p_request_key text, p_new_status text
) returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_user uuid := auth.uid();
  v_record public.inpatient_records%rowtype;
  v_existing public.inpatient_daily_logs%rowtype;
  v_log jsonb := p_log || jsonb_build_object('_new_status', p_new_status);
  v_hash text;
  v_log_id uuid;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'authenticated'
     or v_user is null then
    raise exception using errcode='P0001', message='ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  select * into v_record from public.inpatient_records
  where id=p_inpatient_id for update;
  if not found or not public.user_can_access_branch(v_record.branch_id) then
    raise exception using errcode='P0001', message='ACCESS_DENIED: rawat inap tidak dapat diakses';
  end if;
  v_hash := md5(jsonb_build_object(
    'inpatient', p_inpatient_id, 'medical_record', p_medical_record_id,
    'log', v_log, 'rows', p_rows, 'compounds', p_compounds
  )::text);
  select * into v_existing from public.inpatient_daily_logs
  where submission_key=p_request_key for update;
  if found then
    if v_existing.inpatient_record_id is distinct from p_inpatient_id
       or v_existing.submitted_by is distinct from v_user
       or v_existing.submission_hash is distinct from v_hash then
      raise exception using errcode='P0001', message='IDEMPOTENCY_CONFLICT: kunci catatan dipakai untuk data berbeda';
    end if;
    return v_existing.id;
  end if;
  v_log_id := public.clinic_save_inpatient_log(
    p_inpatient_id, p_medical_record_id, v_log,
    p_rows, p_compounds, p_request_key
  );
  if p_new_status is not null then
    perform public.clinic_change_inpatient_condition(
      p_inpatient_id, p_new_status, 'Diubah dari catatan harian'
    );
  end if;
  return v_log_id;
end;
$function$;
revoke all on function public.clinic_save_inpatient_log_with_status(uuid,uuid,jsonb,jsonb,jsonb,text,text)
  from public, anon, service_role;
grant execute on function public.clinic_save_inpatient_log_with_status(uuid,uuid,jsonb,jsonb,jsonb,text,text)
  to authenticated;

-- Reverse the actual ledger, including every partial AR receipt. Calculating
-- a reversal from invoice flags loses payments made after the original sale.
create function public.clinic_reverse_journal_lines(p_invoice_no text, p_sources text[])
returns jsonb language sql security definer set search_path = '' as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'code', x.code, 'debit', greatest(-x.net, 0),
    'credit', greatest(x.net, 0)) order by x.code), '[]'::jsonb)
  from (
    select a.code, sum(l.debit-l.credit) as net
    from public.journal_entries e
    join public.journal_lines l on l.entry_id=e.id
    join public.coa_accounts a on a.id=l.account_id
    where e.source_ref=p_invoice_no and e.source=any(p_sources)
    group by a.code having sum(l.debit-l.credit) <> 0
  ) x;
$function$;
revoke all on function public.clinic_reverse_journal_lines(text,text[])
  from public, anon, authenticated, service_role;

create function public.clinic_edit_invoice(
  p_invoice_id uuid, p_request_key text, p_invoice jsonb, p_lines jsonb
) returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_user uuid := auth.uid();
  v_visit public.visits%rowtype;
  v_invoice public.invoices%rowtype;
  v_operation public.clinic_invoice_operations%rowtype;
  v_key text := nullif(btrim(p_request_key), '');
  v_hash text;
  v_reason text := nullif(btrim(p_invoice->>'reason'), '');
  v_subtotal numeric(15,2);
  v_discount numeric(15,2);
  v_tax numeric(15,2);
  v_total numeric(15,2);
  v_line jsonb;
  v_item uuid;
  v_pi uuid;
  v_qty integer;
  v_price numeric(15,2);
  v_disc numeric(5,2);
  v_kind text;
  v_unit text;
  v_base_unit text;
  v_factor numeric(15,4);
  v_old_qty numeric;
  v_old_hpp numeric;
  v_new_qty numeric;
  v_new_hpp numeric;
  v_hpp numeric;
  v_warehouse uuid;
  v_stock numeric;
  v_out record;
  v_hpp_map jsonb := '{}'::jsonb;
  v_total_hpp numeric(15,2);
  v_old_snapshot jsonb;
  v_reverse jsonb;
  v_sale jsonb;
  v_credit numeric;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'') <> 'authenticated' or v_user is null then
    raise exception using errcode='P0001', message='ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  if v_key is null or length(v_key)>100 or v_reason is null or length(v_reason)>500
     or jsonb_typeof(p_invoice) is distinct from 'object'
     or jsonb_typeof(p_lines) is distinct from 'array'
     or jsonb_array_length(p_lines) not between 1 and 200 then
    raise exception using errcode='P0001', message='INVOICE_INVALID: koreksi dan alasan wajib diisi';
  end if;
  v_hash := md5(jsonb_build_object('invoice',p_invoice,'lines',p_lines)::text);
  perform pg_advisory_xact_lock(hashtextextended('clinic-invoice-operation:'||v_key,0));
  select * into v_operation from public.clinic_invoice_operations where request_key=v_key;
  if found then
    if v_operation.invoice_id is distinct from p_invoice_id or v_operation.request_hash is distinct from v_hash
       or v_operation.kind <> 'edit' then
      raise exception using errcode='P0001', message='IDEMPOTENCY_CONFLICT: kunci koreksi dipakai untuk data berbeda';
    end if;
    if not exists(select 1 from public.invoices i join public.visits v on v.id=i.visit_id
      where i.id=p_invoice_id and public.user_can_access_branch(v.branch_id)) then
      raise exception using errcode='P0001', message='ACCESS_DENIED: cabang tidak diizinkan'; end if;
    return v_operation.result_invoice_id;
  end if;
  select v.* into v_visit from public.visits v join public.invoices i on i.visit_id=v.id
    where i.id=p_invoice_id;
  if not found then raise exception using errcode='P0001', message='INVOICE_INVALID: tagihan tidak ditemukan'; end if;
  perform 1 from public.visits where id=v_visit.id for update;
  if not public.user_can_access_branch(v_visit.branch_id) then
    raise exception using errcode='P0001', message='ACCESS_DENIED: cabang tidak diizinkan';
  end if;
  select * into v_invoice from public.invoices where id=p_invoice_id for update;
  if v_invoice.voided_at is not null or v_invoice.request_key is null
     or (v_invoice.paid_status='Lunas' and not v_invoice.correction_pending)
     or exists(select 1 from public.invoice_payments
       where invoice_id=p_invoice_id and (transferred_from is null or not v_invoice.correction_pending))
     or exists(select 1 from public.invoice_items where invoice_id=p_invoice_id
               and (compound_recipe_id is not null or (jenis='obat' and item_id is null))) then
    raise exception using errcode='P0001', message='INVOICE_INVALID: tagihan ini perlu pemeriksaan keuangan';
  end if;
  v_subtotal := (p_invoice->>'subtotal')::numeric(15,2);
  v_discount := (p_invoice->>'discount')::numeric(15,2);
  v_tax := (p_invoice->>'tax')::numeric(15,2);
  v_total := (p_invoice->>'total')::numeric(15,2);
  select coalesce(sum(amount),0) into v_credit from public.invoice_payments
    where invoice_id=p_invoice_id and transferred_from is not null;
  if v_subtotal is null or v_discount is null or v_tax is null or v_total is null
     or v_subtotal<0 or v_discount<0 or v_discount>v_subtotal or v_tax<0
     or v_total<>v_subtotal-v_discount+v_tax or v_total<v_invoice.dp_amount+v_credit
     or p_invoice->>'paid_status' is distinct from
       (case when v_total=v_invoice.dp_amount+v_credit then 'Lunas'
             when v_invoice.dp_amount+v_credit>0 then 'DP' else 'Belum Lunas' end)
     or (p_invoice->>'dp_amount')::numeric is distinct from v_invoice.dp_amount
     or p_invoice->>'metode_bayar' is distinct from v_invoice.metode_bayar then
    raise exception using errcode='P0001', message='INVOICE_INVALID: nilai koreksi tidak konsisten';
  end if;
  if (select round(coalesce(sum((x.value->>'qty')::numeric*(x.value->>'price')::numeric*
      (1-coalesce((x.value->>'discount_percent')::numeric,0)/100)),0),2)
      from jsonb_array_elements(p_lines) x) <> v_subtotal then
    raise exception using errcode='P0001', message='INVOICE_INVALID: subtotal berbeda dari rincian';
  end if;
  if exists(select 1 from jsonb_array_elements(p_lines) x
    where nullif(x.value->>'item_id','') is not null
    group by x.value->>'item_id' having count(*)>1) then
    raise exception using errcode='P0001', message='LINE_INVALID: barang sama muncul lebih dari sekali';
  end if;
  if exists(select 1 from jsonb_array_elements(p_lines) x
    where nullif(x.value->>'prescription_item_id','') is not null
    group by x.value->>'prescription_item_id' having count(*)>1) then
    raise exception using errcode='P0001', message='LINE_INVALID: resep sama muncul lebih dari sekali';
  end if;
  if not exists(select 1 from public.journal_entries
    where source in ('klinik','klinik-reissue') and source_ref=v_invoice.invoice_no)
     or ((select coalesce(sum(hpp),0) from public.invoice_items where invoice_id=p_invoice_id)>0
        and not exists(select 1 from public.journal_entries
          where source='klinik-hpp' and source_ref=v_invoice.invoice_no)) then
    raise exception using errcode='P0001', message='JOURNAL_MISSING: jurnal awal belum lengkap';
  end if;
  select id into v_warehouse from public.warehouses where branch_id=v_visit.branch_id
    and type='VET' and is_active order by created_at,id limit 1;
  v_old_snapshot := to_jsonb(v_invoice);

  -- Validate all new rows and keep one cost amount per item. Stock is changed
  -- only by the quantity difference, preserving cost of unchanged dispensed units.
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_item := nullif(v_line->>'item_id','')::uuid;
    v_pi := nullif(v_line->>'prescription_item_id','')::uuid;
    v_qty := (v_line->>'qty')::integer;
    v_price := (v_line->>'price')::numeric(15,2);
    v_disc := coalesce((v_line->>'discount_percent')::numeric,0);
    v_kind := v_line->>'kind';
    v_unit := nullif(v_line->>'unit','');
    if nullif(btrim(v_line->>'description'),'') is null or length(v_line->>'description')>160
       or v_qty is null or v_qty<=0 or v_price is null or v_price<0
       or v_disc<0 or v_disc>100 or v_kind not in ('obat','jasa')
       or nullif(v_line->>'recipe_id','') is not null then
      raise exception using errcode='P0001', message='LINE_INVALID: rincian koreksi tidak valid';
    end if;
    if v_pi is not null and not exists(
      select 1 from public.prescription_items pi
      join public.medical_records m on m.id=pi.medical_record_id
      where pi.id=v_pi and m.visit_id=v_visit.id and pi.item_id is not distinct from v_item
        and pi.compound_recipe_id is null and pi.satuan is not distinct from v_unit
    ) then raise exception using errcode='P0001', message='LINE_INVALID: resep tidak cocok'; end if;
    if v_item is null then
      if v_kind <> 'jasa' then raise exception using errcode='P0001', message='LINE_INVALID: obat tanpa barang tidak dapat dikoreksi'; end if;
    elsif v_kind='jasa' then
      if not exists(select 1 from public.items where id=v_item and is_active and item_type='Jasa') then
        raise exception using errcode='P0001', message='ITEM_INVALID: jasa tidak aktif'; end if;
    else
      select unit into v_base_unit from public.items
        where id=v_item and is_active and item_type='Persediaan';
      if not found then raise exception using errcode='P0001', message='ITEM_INVALID: obat tidak aktif'; end if;
      v_unit := coalesce(v_unit,v_base_unit);
      if v_unit=v_base_unit then v_factor:=1;
      else
        select factor into v_factor from public.item_units where item_id=v_item and unit=v_unit;
        if not found or v_factor<=0 or v_pi is null then
          raise exception using errcode='P0001', message='UNIT_INVALID: satuan obat tidak cocok'; end if;
      end if;
      if v_pi is not null and not exists(select 1 from public.prescription_items
        where id=v_pi and faktor=v_factor) then
        raise exception using errcode='P0001', message='UNIT_INVALID: faktor resep berubah'; end if;
      select coalesce(sum(qty*faktor),0),coalesce(sum(hpp),0)
        into v_old_qty,v_old_hpp from public.invoice_items
        where invoice_id=p_invoice_id and item_id=v_item and jenis='obat';
      v_new_qty := v_qty*v_factor;
      if v_old_qty>0 and v_old_hpp<=0 then
        raise exception using errcode='P0001', message='COST_MISSING: HPP lama tidak tersedia'; end if;
      if v_new_qty>v_old_qty then
        if v_warehouse is null then raise exception using errcode='P0001', message='WAREHOUSE_MISSING: gudang klinik tidak tersedia'; end if;
        select qty into v_stock from public.stock where warehouse_id=v_warehouse and item_id=v_item for update;
        if coalesce(v_stock,0)<v_new_qty-v_old_qty then
          raise exception using errcode='P0001', message='STOCK_SHORT: obat koreksi tidak cukup'; end if;
        select * into v_out from public.stock_out_fifo(v_warehouse,v_item,v_new_qty-v_old_qty,
          'klinik-edit',v_invoice.invoice_no,current_date);
        if v_out.shortfall>0 or v_out.cost<=0 or exists(
          select 1 from jsonb_array_elements(v_out.takes) x where (x.value->>'unit_cost')::numeric<=0) then
          raise exception using errcode='P0001', message='COST_MISSING: lapisan HPP obat tidak lengkap'; end if;
        v_new_hpp := v_old_hpp+round(v_out.cost,2);
      elsif v_new_qty<v_old_qty then
        if v_warehouse is null then raise exception using errcode='P0001', message='WAREHOUSE_MISSING: gudang klinik tidak tersedia'; end if;
        perform public.stock_in_fifo(v_warehouse,v_item,v_old_qty-v_new_qty,
          v_old_hpp/v_old_qty,'klinik-edit',v_invoice.invoice_no,current_date,null);
        v_new_hpp := round(v_old_hpp*v_new_qty/v_old_qty,2);
      else v_new_hpp:=v_old_hpp;
      end if;
      v_hpp_map := v_hpp_map || jsonb_build_object(v_item::text,v_new_hpp);
    end if;
  end loop;

  -- Items removed entirely return to stock at their historical average cost.
  for v_item,v_old_qty,v_old_hpp in
    select item_id,sum(qty*faktor),sum(hpp) from public.invoice_items
    where invoice_id=p_invoice_id and jenis='obat' and item_id is not null
      and not exists(select 1 from jsonb_array_elements(p_lines) x
        where nullif(x.value->>'item_id','')::uuid=invoice_items.item_id)
    group by item_id order by item_id
  loop
    if v_old_hpp<=0 or v_warehouse is null then
      raise exception using errcode='P0001', message='COST_MISSING: HPP obat lama tidak tersedia'; end if;
    perform public.stock_in_fifo(v_warehouse,v_item,v_old_qty,v_old_hpp/v_old_qty,
      'klinik-edit',v_invoice.invoice_no,current_date,null);
  end loop;

  delete from public.invoice_items where invoice_id=p_invoice_id;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_item := nullif(v_line->>'item_id','')::uuid;
    v_kind := v_line->>'kind';
    v_unit := nullif(v_line->>'unit','');
    v_factor := 1;
    if v_item is not null and v_kind='obat' then
      select unit into v_base_unit from public.items where id=v_item;
      v_unit := coalesce(v_unit,v_base_unit);
      if v_unit is distinct from v_base_unit then
        select factor into v_factor from public.item_units where item_id=v_item and unit=v_unit;
      end if;
    end if;
    insert into public.invoice_items(invoice_id,deskripsi,qty,harga,jenis,diskon_persen,
      item_id,hpp,prescription_item_id,satuan,faktor)
    values(p_invoice_id,v_line->>'description',(v_line->>'qty')::integer,
      (v_line->>'price')::numeric,v_kind,(v_line->>'discount_percent')::numeric,
      v_item,case when v_item is not null and v_kind='obat'
        then (v_hpp_map->>v_item::text)::numeric else null end,
      nullif(v_line->>'prescription_item_id','')::uuid,v_unit,v_factor);
  end loop;
  select coalesce(sum(hpp),0) into v_total_hpp from public.invoice_items where invoice_id=p_invoice_id;
  v_reverse := public.clinic_reverse_journal_lines(v_invoice.invoice_no,array['klinik','klinik-reissue','klinik-edit']);
  perform public.clinic_write_journal(current_date,'Pembalikan koreksi '||v_invoice.invoice_no,
    'klinik-edit',v_invoice.invoice_no,v_visit.branch_id,v_reverse);
  v_sale := jsonb_build_array(
    jsonb_build_object('code','1201','debit',v_total-v_invoice.dp_amount,'credit',0),
    jsonb_build_object('code','4102','debit',v_discount,'credit',0),
    jsonb_build_object('code','4201','debit',0,'credit',v_subtotal),
    jsonb_build_object('code','2201','debit',0,'credit',v_tax));
  -- Preserve original DP cash account and amount; its receipt is never rebooked.
  if v_invoice.dp_amount>0 then
    v_sale := v_sale || jsonb_build_array(jsonb_build_object('code',(
      select a.code from public.journal_entries e
      join public.journal_lines l on l.entry_id=e.id
      join public.coa_accounts a on a.id=l.account_id
      where e.source='klinik' and e.source_ref=v_invoice.invoice_no
        and l.debit>0 and a.code not in ('1201','4102') order by e.created_at,l.id limit 1
    ),'debit',v_invoice.dp_amount,'credit',0));
  end if;
  perform public.clinic_write_journal(current_date,'Koreksi tagihan '||v_invoice.invoice_no,
    'klinik-edit',v_invoice.invoice_no,v_visit.branch_id,v_sale);
  v_reverse := public.clinic_reverse_journal_lines(v_invoice.invoice_no,
    array['klinik-hpp','klinik-hpp-edit']);
  perform public.clinic_write_journal(current_date,'Pembalikan HPP '||v_invoice.invoice_no,
    'klinik-hpp-edit',v_invoice.invoice_no,v_visit.branch_id,v_reverse);
  if v_total_hpp>0 then
    perform public.clinic_write_journal(current_date,'HPP koreksi '||v_invoice.invoice_no,
      'klinik-hpp-edit',v_invoice.invoice_no,v_visit.branch_id,jsonb_build_array(
        jsonb_build_object('code','5101','debit',v_total_hpp,'credit',0),
        jsonb_build_object('code','1301','debit',0,'credit',v_total_hpp)));
  end if;
  update public.invoices set subtotal=v_subtotal,discount=v_discount,tax=v_tax,total=v_total,
    paid_status=p_invoice->>'paid_status',
    paid_at=case when p_invoice->>'paid_status'='Lunas' then coalesce(paid_at,now()) else null end,
    correction_pending=false,
    voucher_code=nullif(p_invoice->>'voucher_code','') where id=p_invoice_id;
  update public.visits set status=case when p_invoice->>'paid_status'='Lunas'
    then 'Selesai'::public.visit_status else 'Pembayaran'::public.visit_status end where id=v_visit.id;
  insert into public.invoice_edit_log(invoice_id,edited_by,field_changed,old_value,new_value,reason)
    values(p_invoice_id,v_user,'invoice',v_old_snapshot::text,
      jsonb_build_object('invoice',p_invoice,'lines',p_lines)::text,v_reason);
  insert into public.clinic_invoice_operations(request_key,invoice_id,request_hash,kind,result_invoice_id)
    values(v_key,p_invoice_id,v_hash,'edit',p_invoice_id);
  return p_invoice_id;
end;
$function$;
revoke all on function public.clinic_edit_invoice(uuid,text,jsonb,jsonb) from public,anon,service_role;
grant execute on function public.clinic_edit_invoice(uuid,text,jsonb,jsonb) to authenticated;

create function public.clinic_void_reissue_invoice(
  p_invoice_id uuid, p_request_key text, p_reason text
) returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_user uuid := auth.uid();
  v_visit public.visits%rowtype;
  v_invoice public.invoices%rowtype;
  v_operation public.clinic_invoice_operations%rowtype;
  v_key text := nullif(btrim(p_request_key),'');
  v_reason text := nullif(btrim(p_reason),'');
  v_hash text;
  v_pattern text;
  v_digits integer := 4;
  v_prefix text;
  v_seq bigint;
  v_no text;
  v_new_id uuid;
  v_paid numeric;
  v_direct numeric;
  v_shift_cash numeric;
  v_cash_code text;
  v_hpp numeric;
  v_lines jsonb;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'') <> 'authenticated' or v_user is null then
    raise exception using errcode='P0001', message='ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  if v_key is null or length(v_key)>100 or v_reason is null or length(v_reason)>500 then
    raise exception using errcode='P0001', message='INVOICE_INVALID: alasan pembatalan wajib diisi';
  end if;
  v_hash := md5(jsonb_build_object('invoice',p_invoice_id,'reason',v_reason)::text);
  perform pg_advisory_xact_lock(hashtextextended('clinic-invoice-operation:'||v_key,0));
  select * into v_operation from public.clinic_invoice_operations where request_key=v_key;
  if found then
    if v_operation.invoice_id is distinct from p_invoice_id or v_operation.request_hash is distinct from v_hash
       or v_operation.kind <> 'reissue' then
      raise exception using errcode='P0001', message='IDEMPOTENCY_CONFLICT: kunci pembatalan dipakai untuk data berbeda';
    end if;
    if not exists(select 1 from public.invoices i join public.visits v on v.id=i.visit_id
      where i.id=p_invoice_id and public.user_can_access_branch(v.branch_id)) then
      raise exception using errcode='P0001', message='ACCESS_DENIED: cabang tidak diizinkan'; end if;
    return v_operation.result_invoice_id;
  end if;
  select v.* into v_visit from public.visits v join public.invoices i on i.visit_id=v.id
    where i.id=p_invoice_id;
  if not found then raise exception using errcode='P0001', message='INVOICE_INVALID: tagihan tidak ditemukan'; end if;
  perform 1 from public.visits where id=v_visit.id for update;
  if not public.user_can_access_branch(v_visit.branch_id) then
    raise exception using errcode='P0001', message='ACCESS_DENIED: cabang tidak diizinkan'; end if;
  select * into v_invoice from public.invoices where id=p_invoice_id for update;
  if v_invoice.voided_at is not null or v_invoice.request_key is null
     or exists(select 1 from public.invoice_items where invoice_id=p_invoice_id
       and (compound_recipe_id is not null or (jenis='obat' and item_id is null))) then
    raise exception using errcode='P0001', message='INVOICE_INVALID: tagihan ini perlu pemeriksaan keuangan';
  end if;
  select coalesce(sum(amount),0) into v_paid from public.invoice_payments
    where invoice_id=p_invoice_id;
  v_direct := case when v_invoice.reissued_from is not null then 0
    when v_invoice.paid_status='Lunas' and v_paid=0 then v_invoice.total
    else v_invoice.dp_amount end;
  v_shift_cash := case when v_invoice.reissued_from is not null then v_invoice.shift_cash_carry
    else v_direct end;
  v_paid := v_paid + v_direct;
  if v_paid>v_invoice.total then
    raise exception using errcode='P0001', message='PAYMENT_INVALID: pembayaran melebihi tagihan'; end if;
  if v_invoice.paid_status<>'Lunas' and v_paid=0 then
    raise exception using errcode='P0001', message='INVOICE_INVALID: tagihan ini cukup dikoreksi'; end if;
  if not exists(select 1 from public.journal_entries
       where source in ('klinik','klinik-reissue') and source_ref=v_invoice.invoice_no)
     or ((select coalesce(sum(hpp),0) from public.invoice_items where invoice_id=p_invoice_id)>0
        and not exists(select 1 from public.journal_entries
          where source='klinik-hpp' and source_ref=v_invoice.invoice_no))
     or ((select count(*) from public.journal_entries
       where source='klinik-ar' and source_ref=v_invoice.invoice_no)
       <> (select count(*) from public.invoice_payments
         where invoice_id=p_invoice_id and transferred_from is null))
     then
    raise exception using errcode='P0001', message='JOURNAL_MISSING: jurnal pembayaran tidak lengkap';
  end if;
  if v_direct>0 then
    select a.code into v_cash_code from public.journal_entries e
    join public.journal_lines l on l.entry_id=e.id
    join public.coa_accounts a on a.id=l.account_id
    where e.source='klinik' and e.source_ref=v_invoice.invoice_no
      and l.debit=v_direct and a.code not in ('1201','4102')
    order by e.created_at,l.id limit 1;
    if v_cash_code is null then
      raise exception using errcode='P0001', message='JOURNAL_MISSING: rekening pembayaran awal tidak ditemukan'; end if;
  end if;
  if exists(select 1 from public.invoice_payments where invoice_id=p_invoice_id
      and (kas_code is null or amount<=0)) then
    raise exception using errcode='P0001', message='JOURNAL_MISSING: rekening cicilan tidak lengkap'; end if;

  select pola,digit into v_pattern,v_digits from public.document_numbering where jenis='INV';
  if not found then v_pattern:='INV-{YYYY}{MM}-'; v_digits:=4; end if;
  v_prefix := replace(replace(replace(replace(v_pattern,'{YYYY}',to_char(current_date,'YYYY')),
    '{YY}',to_char(current_date,'YY')),'{MM}',to_char(current_date,'MM')),'{DD}',to_char(current_date,'DD'));
  if v_prefix ~ '\\{[^}]+\\}' or length(v_prefix)=0 then
    raise exception using errcode='P0001', message='INVOICE_NO_INVALID: format nomor tagihan tidak valid'; end if;
  perform pg_advisory_xact_lock(hashtextextended('clinic-invoice-number:'||v_prefix,0));
  select coalesce(max(substring(i.invoice_no,length(v_prefix)+1)::bigint),0)+1 into v_seq
    from public.invoices i where left(i.invoice_no,length(v_prefix))=v_prefix
      and substring(i.invoice_no,length(v_prefix)+1) ~ '^[0-9]+$';
  v_no := v_prefix||case when length(v_seq::text)>v_digits then v_seq::text
    else lpad(v_seq::text,v_digits,'0') end;
  if length(v_no)>24 then
    raise exception using errcode='P0001', message='INVOICE_NO_INVALID: nomor tagihan terlalu panjang'; end if;

  v_lines := public.clinic_reverse_journal_lines(v_invoice.invoice_no,
    array['klinik','klinik-reissue','klinik-edit']);
  -- Keep received cash in its original account. The old receivable becomes
  -- customer credit, then the replacement sale consumes it through the same AR.
  if v_direct>0 then
    select coalesce(jsonb_agg(e.value),'[]'::jsonb) into v_lines
    from jsonb_array_elements(v_lines) e where e.value->>'code'<>v_cash_code;
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('code','1201','debit',0,'credit',v_direct));
  end if;
  perform public.clinic_write_journal(current_date,'Pembatalan '||v_invoice.invoice_no,
    'klinik-void',v_invoice.invoice_no,v_visit.branch_id,v_lines);
  v_lines := public.clinic_reverse_journal_lines(v_invoice.invoice_no,
    array['klinik-hpp','klinik-hpp-edit']);
  perform public.clinic_write_journal(current_date,'Pembatalan HPP '||v_invoice.invoice_no,
    'klinik-hpp-void',v_invoice.invoice_no,v_visit.branch_id,v_lines);
  select coalesce(sum(hpp),0) into v_hpp from public.invoice_items where invoice_id=p_invoice_id;

  update public.invoices set voided_at=now() where id=p_invoice_id;
  insert into public.invoices(visit_id,invoice_no,subtotal,discount,tax,total,dp_amount,
    dp_date,paid_status,metode_bayar,paid_at,shift_id,voucher_code,salesperson_id,
    reissued_from,request_key,request_hash,correction_pending,shift_cash_carry)
  values(v_visit.id,v_no,v_invoice.subtotal,v_invoice.discount,v_invoice.tax,v_invoice.total,
    0,null,case when v_paid=v_invoice.total then 'Lunas' else 'DP' end,
    v_invoice.metode_bayar,case when v_paid=v_invoice.total then now() else null end,v_invoice.shift_id,
    v_invoice.voucher_code,v_invoice.salesperson_id,p_invoice_id,v_key,v_hash,true,v_shift_cash)
  returning id into v_new_id;
  insert into public.invoice_items(invoice_id,deskripsi,qty,harga,jenis,diskon_persen,
    item_id,hpp,prescription_item_id,satuan,faktor)
  select v_new_id,deskripsi,qty,harga,jenis,diskon_persen,item_id,hpp,
    prescription_item_id,satuan,faktor from public.invoice_items where invoice_id=p_invoice_id;
  v_lines := jsonb_build_array(
    jsonb_build_object('code','1201','debit',v_invoice.total,'credit',0),
    jsonb_build_object('code','4102','debit',v_invoice.discount,'credit',0),
    jsonb_build_object('code','4201','debit',0,'credit',v_invoice.subtotal),
    jsonb_build_object('code','2201','debit',0,'credit',v_invoice.tax));
  perform public.clinic_write_journal(current_date,'Terbit ulang '||v_no,
    'klinik-reissue',v_no,v_visit.branch_id,v_lines);
  if v_paid>0 then
    if v_direct>0 then
      insert into public.invoice_payments(invoice_id,tanggal,amount,metode,catatan,
        kas_code,created_by,transferred_from)
      values(v_new_id,current_date,v_direct,v_invoice.metode_bayar,
        'Dialihkan dari '||v_invoice.invoice_no,v_cash_code,v_user,p_invoice_id);
    end if;
    insert into public.invoice_payments(invoice_id,tanggal,amount,metode,catatan,
      kas_code,created_by,transferred_from)
    select v_new_id,current_date,p.amount,p.metode,
      'Dialihkan dari '||v_invoice.invoice_no,p.kas_code,v_user,p_invoice_id
    from public.invoice_payments p where p.invoice_id=p_invoice_id;
  end if;
  if v_hpp>0 then
    perform public.clinic_write_journal(current_date,'HPP terbit ulang '||v_no,
      'klinik-hpp',v_no,v_visit.branch_id,jsonb_build_array(
        jsonb_build_object('code','5101','debit',v_hpp,'credit',0),
        jsonb_build_object('code','1301','debit',0,'credit',v_hpp)));
  end if;
  insert into public.invoice_edit_log(invoice_id,edited_by,field_changed,old_value,new_value,reason)
    values(p_invoice_id,v_user,'voided',v_invoice.invoice_no,v_no,v_reason);
  update public.visits set status=case when v_paid=v_invoice.total
    then 'Selesai'::public.visit_status else 'Pembayaran'::public.visit_status end where id=v_visit.id;
  insert into public.clinic_invoice_operations(request_key,invoice_id,request_hash,kind,result_invoice_id)
    values(v_key,p_invoice_id,v_hash,'reissue',v_new_id);
  return v_new_id;
end;
$function$;
revoke all on function public.clinic_void_reissue_invoice(uuid,text,text)
  from public,anon,service_role;
grant execute on function public.clinic_void_reissue_invoice(uuid,text,text) to authenticated;
