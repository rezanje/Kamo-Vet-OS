-- Approved Andri: one EXPLICIT save, never typing/note save. Original public
-- stage/receipt RPCs remain the accounting engine; one transaction, no GUC bypass.
create table clinic_private.inpatient_bill_pay_requests (
  request_key text primary key,
  visit_id uuid not null,
  record_id uuid not null,
  request_hash text not null,
  result jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default now()
);
revoke all on clinic_private.inpatient_bill_pay_requests from public,anon,authenticated,service_role;

-- Every entry, including cached replay, validates CURRENT authorization AFTER
-- the shared coordinator and BEFORE any visit/shift/recipe/stock row locks.
create function clinic_private.inpatient_payment_quote(p_record_id uuid,p_visit_id uuid,p_parts jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v public.visits%rowtype; me public.profiles%rowtype; s uuid;
  lines jsonb; invoices jsonb; advances jsonb; accounts jsonb := '[]';
  settings public.company_settings%rowtype; part jsonb; method text; code text;
  account public.cash_accounts%rowtype; amount numeric; paid numeric:=0;
  subtotal numeric; tax numeric; debt numeric; credit numeric; eligible_debt numeric; snapshot jsonb;
begin
  perform clinic_private.billing_lock(clinic_private.billing_keys_visit(p_visit_id));
  select * into me from public.profiles where id=auth.uid() and is_active;
  select * into v from public.visits where id=p_visit_id;
  if auth.uid() is null or coalesce(auth.role(),current_setting('role',true)) <> 'authenticated'
    or me.id is null or v.id is null or not public.user_can_access_branch(v.branch_id)
    or not (me.role='OWNER' or exists(select 1 from public.role_modules m where m.role=me.role and m.module_id='klinik')
      or (not exists(select 1 from public.role_modules m where m.role=me.role) and me.role in ('ADMIN','DOCTOR','STAFF')))
    or not exists(select 1 from public.inpatient_records r where r.id=p_record_id and r.visit_id=v.id and r.branch_id=v.branch_id) then
    raise exception 'ACCESS_DENIED: rawat inap atau akses tidak valid';
  end if;
  select id into s from public.cashier_shifts where opened_by=me.id and branch_id=v.branch_id and shift_type='klinik' and status='open';
  if s is null then raise exception 'SHIFT_INVALID: shift klinik aktif tidak ditemukan'; end if;
  if jsonb_typeof(p_parts) is distinct from 'array' or jsonb_array_length(p_parts)>6 then
    raise exception 'PAYMENT_INVALID: maksimal enam bagian pembayaran';
  end if;
  for part in select value from jsonb_array_elements(p_parts) loop
    if jsonb_typeof(part->'amount') is distinct from 'number' or coalesce(part->>'method','') not in ('Tunai','Transfer','Debit','Kredit','QRIS','E-Wallet') then
      raise exception 'PAYMENT_INVALID: metode atau nominal tidak valid';
    end if;
    amount:=(part->>'amount')::numeric;
    if amount<=0 or amount<>trunc(amount) or amount>9007199254740991 then raise exception 'PAYMENT_INVALID: rupiah bulat positif wajib'; end if;
    paid:=paid+amount;
  end loop;
  select * into strict settings from public.company_settings where id=true;
  if settings.ppn_rate is null or settings.ppn_rate<0 or settings.ppn_rate>100 then raise exception 'INVOICE_INVALID: pengaturan pajak tidak valid'; end if;
  -- All records of THIS visit, stored clinical price only. Linked active original
  -- DP/stage/replacement invoices exclude a line even during pending correction.
  select coalesce(jsonb_agg(jsonb_build_object('description',pi.nama_obat,'qty',pi.qty,'price',pi.harga,
    'kind',case when pi.jenis='jasa' then 'jasa' else 'obat' end,'item_id',pi.item_id,'unit',pi.satuan,
    'prescription_item_id',pi.id,'recipe_id',pi.compound_recipe_id,'discount_percent',0) order by pi.created_at,pi.id),'[]'),
    round(coalesce(sum(pi.qty*pi.harga),0),2)
  into lines,subtotal
  from public.prescription_items pi join public.medical_records mr on mr.id=pi.medical_record_id
  where mr.visit_id=p_visit_id and not exists(select 1 from public.invoice_items ii join public.invoices i on i.id=ii.invoice_id
    where ii.prescription_item_id=pi.id and i.voided_at is null);
  if exists(select 1 from jsonb_array_elements(lines) l where l->'price'='null'::jsonb or l->'qty'='null'::jsonb
    or (l->>'price')::numeric<0 or (l->>'qty')::numeric<=0) then raise exception 'INVOICE_INVALID: harga atau jumlah resep tidak valid'; end if;
  tax:=case when settings.mode_pkp then round(subtotal*settings.ppn_rate/100) else 0 end;
  select coalesce(jsonb_agg(jsonb_build_object('invoice',to_jsonb(i),'received',clinic_private.invoice_received(i.id)) order by i.created_at,i.id),'[]'),
    coalesce(sum(greatest(0,i.total-clinic_private.invoice_received(i.id))),0)
  into invoices,debt from public.invoices i where i.visit_id=p_visit_id and i.voided_at is null;
  if exists(select 1 from public.invoices i where i.visit_id=p_visit_id and i.voided_at is null and i.correction_pending) then
    raise exception 'INVOICE_INVALID: selesaikan koreksi invoice dahulu';
  end if;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at,a.id),'[]'),coalesce(sum(a.amount-a.applied),0)
  into advances,credit from public.clinic_customer_advances a where a.customer_id=v.customer_id and a.branch_id=v.branch_id
    and a.status='aktif' and a.released_at is null and a.amount>a.applied;
  select coalesce(sum(greatest(0,i.total-clinic_private.invoice_received(i.id))),0) into eligible_debt
    from public.invoices i where i.visit_id=p_visit_id and i.voided_at is null
      and i.invoice_no is not null and i.request_key is not null and not i.correction_pending;
  -- These are the SAME method->branch/default destinations used by original receipt
  -- RPC, not a decorative bank selector and never caller-provided COA.
  foreach method in array array['Tunai','Transfer','Debit','Kredit','QRIS','E-Wallet'] loop
    begin
      code:=clinic_private.kas_code(method,v.branch_id);
      select * into strict account from public.cash_accounts where coa_code=code and is_active;
      accounts:=accounts||jsonb_build_array(jsonb_build_object('method',method,'code',code,'name',account.nama,'bank',account.bank_nama,'number',account.no_rekening));
    exception
      when no_data_found then null; -- This method has no active destination.
      when raise_exception then
        if sqlerrm <> 'ACCOUNT_INVALID: rekening pembayaran tidak aktif'
          and sqlerrm !~ '^ACCOUNT_INVALID: akun penerimaan [0-9A-Za-z._-]+ tidak tersedia$' then raise; end if;
    end;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_parts) p where not exists(
    select 1 from jsonb_array_elements(accounts) a where a->>'method'=p->>'method')) then
    raise exception 'ACCOUNT_INVALID: rekening metode terpilih tidak tersedia';
  end if;
  snapshot:=jsonb_build_object('record',p_record_id,'visit',p_visit_id,'branch',v.branch_id,'shift',s,'lines',lines,
    'invoices',invoices,'advances',advances,'tax_settings',to_jsonb(settings),'accounts',accounts,'parts',p_parts);
  return jsonb_build_object('token',md5(snapshot::text),'lines',lines,'subtotal',subtotal,'tax',tax,'pending',subtotal+tax,
    'debt',debt,'credit',credit,'apply_credit',least(credit,eligible_debt),
    'remaining',greatest(0,debt+subtotal+tax-least(credit,eligible_debt+subtotal+tax)),'amount',paid,
    'excess',greatest(0,paid-greatest(0,debt+subtotal+tax-least(credit,eligible_debt+subtotal+tax))),'accounts',accounts,'shift_id',s);
end $$;
revoke all on function clinic_private.inpatient_payment_quote(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create function public.clinic_quote_inpatient_payment(p_record_id uuid,p_visit_id uuid,p_parts jsonb default '[]')
returns jsonb language sql security definer set search_path='' as $$
  select clinic_private.inpatient_payment_quote(p_record_id,p_visit_id,p_parts)-'lines'-'shift_id';
$$;
revoke all on function public.clinic_quote_inpatient_payment(uuid,uuid,jsonb) from public,anon,service_role;
grant execute on function public.clinic_quote_inpatient_payment(uuid,uuid,jsonb) to authenticated;

-- Extract the ORIGINAL stage advance-application loop verbatim. Both the old
-- stage RPC and unified action use it, so owner credit offsets older AR first.
-- Only its validated/coordinated callers can execute this private primitive.
create function clinic_private.apply_invoice_owner_credit(v_invoice_id uuid,v_tanggal date)
returns void language plpgsql set search_path='' as $apply$
declare
 v_visit public.visits%rowtype; v_branch uuid; v_invoice_no text;
 v_remaining numeric(15,2); v_apply numeric(15,2); v_payment_id uuid;
 v_user uuid:=auth.uid(); v_adv record;
begin
 select v.* into strict v_visit from public.visits v join public.invoices i on i.visit_id=v.id where i.id=v_invoice_id;
 v_branch:=v_visit.branch_id;
 select i.invoice_no,greatest(0,i.total-clinic_private.invoice_received(i.id)) into v_invoice_no,v_remaining
 from public.invoices i where i.id=v_invoice_id and i.voided_at is null and not i.correction_pending for update;
 if not found then return; end if;
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
  perform clinic_private.sync_paid_status(v_invoice_id);
end $apply$;
revoke all on function clinic_private.apply_invoice_owner_credit(uuid,date) from public,anon,authenticated,service_role;
do $extract$
declare definition text; old_block text:=$old$  -- Uang muka pemilik (uang yang masuk sebelum ada tagihan) otomatis memotong tahap ini,
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
$old$;
begin
 definition:=pg_get_functiondef('public.clinic_post_inpatient_stage_invoice(uuid,text,jsonb,jsonb)'::regprocedure);
 if (length(definition)-length(replace(definition,old_block,'')))/length(old_block)<>1 then
   raise exception 'Unified payment: original stage advance anchor mismatch';
 end if;
 execute replace(definition,old_block,E'  perform clinic_private.apply_invoice_owner_credit(v_invoice_id,v_tanggal);\n');
end $extract$;

create function public.clinic_bill_and_pay_inpatient(
  p_record_id uuid,p_visit_id uuid,p_request_key text,p_tanggal date,p_parts jsonb,
  p_overpayment_ack text default null,p_add_owner_credit boolean default false,p_dp_override_reason text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  quote jsonb; fingerprint text; cached clinic_private.inpatient_bill_pay_requests%rowtype;
  receipt uuid; invoice uuid; old_invoice record; result jsonb; key text:=nullif(btrim(p_request_key),'');
  initial_accounts jsonb; locked_shift uuid; prior_applications uuid[]; applications jsonb;
begin
  quote:=clinic_private.inpatient_payment_quote(p_record_id,p_visit_id,p_parts);
  -- Coordinator -> validated own branch shift -> invoice/advance -> journal.
  -- Original receipt/release/posting take the shift before journal numbering.
  -- Never hold a monthly journal advisory lock while waiting on that shift.
  initial_accounts:=quote->'accounts';
  locked_shift:=(quote->>'shift_id')::uuid;
  perform 1 from public.cashier_shifts where id=locked_shift for update;
  -- A shift wait can outlive active-role/module/branch and monetary settings.
  quote:=clinic_private.inpatient_payment_quote(p_record_id,p_visit_id,p_parts);
  if locked_shift is distinct from (quote->>'shift_id')::uuid then
    raise exception 'SHIFT_INVALID: shift berubah saat menyimpan; muat ulang';
  end if;
  if initial_accounts is distinct from quote->'accounts' then
    raise exception 'ACCOUNT_INVALID: rekening berubah saat menyimpan; muat ulang dan periksa rekening';
  end if;
  if key is null or length(key)>80 or p_tanggal is null or p_add_owner_credit is null then raise exception 'PAYMENT_INVALID: kunci atau tanggal tidak valid'; end if;
  perform pg_advisory_xact_lock(hashtextextended('clinic-bill-pay:'||key,0));
  fingerprint:=md5(jsonb_build_object('record',p_record_id,'visit',p_visit_id,'date',p_tanggal,'parts',p_parts,
    'credit',p_add_owner_credit,'reason',nullif(btrim(p_dp_override_reason),''))::text);
  select * into cached from clinic_private.inpatient_bill_pay_requests where request_key=key;
  if found then
    if cached.visit_id is distinct from p_visit_id or cached.record_id is distinct from p_record_id or cached.request_hash<>fingerprint then
      raise exception 'IDEMPOTENCY_CONFLICT: kunci dipakai untuk data berbeda';
    end if;
    return cached.result;
  end if;
  if ((quote->>'excess')::numeric>0 and p_overpayment_ack is distinct from quote->>'token')
     or (p_overpayment_ack is not null and p_overpayment_ack is distinct from quote->>'token') then
    return jsonb_build_object('status','OVERPAYMENT_CONFIRM_REQUIRED','quote',quote-'lines'-'shift_id');
  end if;
  if (quote->>'debt')::numeric=0 and jsonb_array_length(quote->'lines')=0 and not p_add_owner_credit then
    raise exception 'PAYMENT_SETTLED: tidak ada tagihan baru; gunakan Tambah saldo pemilik secara eksplisit';
  end if;
  if (quote->>'amount')::numeric=0 and jsonb_array_length(quote->'lines')=0 and (quote->>'apply_credit')::numeric<=0 then
    raise exception 'PAYMENT_INVALID: tidak ada transaksi untuk disimpan';
  end if;
  select coalesce(array_agg(a.id),'{}'::uuid[]) into prior_applications
    from public.clinic_advance_applications a join public.invoices i on i.id=a.invoice_id where i.visit_id=p_visit_id;
  -- Apply only AVAILABLE credit, never rewrite an old allocation/header.
  -- Same primitive as stage posting, same coordinator; older AR first.
  for old_invoice in select i.id from public.invoices i where i.visit_id=p_visit_id and i.voided_at is null
    and i.invoice_no is not null and i.request_key is not null and not i.correction_pending
    order by i.created_at,i.id loop
    perform clinic_private.apply_invoice_owner_credit(old_invoice.id,p_tanggal);
  end loop;
  -- Receipt first: oldest EXISTING debt, then real documented advance. Posting the
  -- new stage applies that advance and enforces the ORIGINAL initial minimum.
  -- Any downstream shortage/closed period/DP failure rolls back the receipt too.
  if (quote->>'amount')::numeric>0 then
    receipt:=public.clinic_receive_visit_payment(p_visit_id,'pay:'||key,p_tanggal,p_parts,null,null);
    -- Account-map settings have independent writers. Never silently post to a
    -- destination different from this locked monetary quote while waiting on
    -- the original shift lock. Receipt rows/journals roll back on a mismatch.
    if exists (
      select 1 from public.clinic_payment_receipt_parts rp
      left join jsonb_array_elements(quote->'accounts') a on a->>'method'=rp.metode
      where rp.receipt_id=receipt and rp.kas_code is distinct from a->>'code'
    ) then raise exception 'ACCOUNT_INVALID: rekening berubah saat menyimpan; muat ulang dan periksa rekening'; end if;
  end if;
  if jsonb_array_length(quote->'lines')>0 then
    invoice:=public.clinic_post_inpatient_stage_invoice(p_visit_id,'bill:'||key,
      jsonb_build_object('tanggal',p_tanggal,'subtotal',(quote->>'subtotal')::numeric,'discount',0,
        'tax',(quote->>'tax')::numeric,'total',(quote->>'pending')::numeric,'dp_amount',0,'dp_date',null,
        'paid_status','Belum Lunas','metode_bayar','Tunai','shift_id',quote->>'shift_id','voucher_code',null,
        'salesperson_id',null,'dp_override_reason',p_dp_override_reason),quote->'lines');
  end if;
  select coalesce(jsonb_agg(a.id order by a.id),'[]'::jsonb) into applications
    from public.clinic_advance_applications a join public.invoices i on i.id=a.invoice_id
    where i.visit_id=p_visit_id and not(a.id=any(prior_applications));
  if receipt is null and invoice is null and jsonb_array_length(applications)=0 then
    raise exception 'PAYMENT_INVALID: tidak ada saldo yang diterapkan';
  end if;
  result:=jsonb_build_object('status','SAVED','receipt_id',receipt,'invoice_id',invoice,'application_ids',applications,'visit_id',p_visit_id,'record_id',p_record_id);
  insert into clinic_private.inpatient_bill_pay_requests(request_key,visit_id,record_id,request_hash,result,created_by)
    values(key,p_visit_id,p_record_id,fingerprint,result,auth.uid());
  return result;
end $$;
revoke all on function public.clinic_bill_and_pay_inpatient(uuid,uuid,text,date,jsonb,text,boolean,text) from public,anon,service_role;
grant execute on function public.clinic_bill_and_pay_inpatient(uuid,uuid,text,date,jsonb,text,boolean,text) to authenticated;
