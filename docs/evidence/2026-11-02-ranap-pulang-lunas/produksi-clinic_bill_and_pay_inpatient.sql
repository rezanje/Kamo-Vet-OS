CREATE OR REPLACE FUNCTION public.clinic_bill_and_pay_inpatient(p_record_id uuid, p_visit_id uuid, p_request_key text, p_tanggal date, p_parts jsonb, p_overpayment_ack text DEFAULT NULL::text, p_add_owner_credit boolean DEFAULT false, p_dp_override_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$
