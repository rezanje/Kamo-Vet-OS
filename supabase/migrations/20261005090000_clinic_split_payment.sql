alter table public.invoice_payments add column checkout_payment boolean not null default false;

-- Keep invoice, stock, receipts and their journals in one transaction. The
-- existing invoice request hash includes all payment parts, so retries also
-- validate the complete mixed-payment payload without a second request ledger.
create function public.clinic_post_split_invoice(
  p_visit_id uuid, p_request_key text, p_invoice jsonb,
  p_lines jsonb, p_payments jsonb
) returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_user uuid := auth.uid();
  v_visit public.visits%rowtype;
  v_key text := nullif(btrim(p_request_key), '');
  v_invoice_id uuid;
  v_payment_id uuid;
  v_part jsonb;
  v_amount numeric;
  v_total numeric := 0;
  v_index integer := 0;
  v_base jsonb;
begin
  if coalesce(auth.role(), '') <> 'authenticated' or v_user is null then
    raise exception using errcode='P0001', message='ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  if v_key is null or length(v_key) > 100 or jsonb_typeof(p_invoice) is distinct from 'object'
    or jsonb_typeof(p_payments) is distinct from 'array' then
    raise exception using errcode='P0001', message='PAYMENT_INVALID: rincian pembayaran campuran tidak valid';
  end if;
  if jsonb_array_length(p_payments) not between 2 and 6 then
    raise exception using errcode='P0001', message='PAYMENT_INVALID: pilih dua sampai enam bagian pembayaran';
  end if;
  for v_part in select value from jsonb_array_elements(p_payments) loop
    if jsonb_typeof(v_part) is distinct from 'object'
      or jsonb_typeof(v_part->'amount') is distinct from 'number'
      or coalesce(v_part->>'method', '') not in ('Tunai','Transfer','Debit','Kredit','QRIS','E-Wallet')
      or nullif(btrim(v_part->>'kas_code'), '') is null then
      raise exception using errcode='P0001', message='PAYMENT_INVALID: metode atau rekening pembayaran tidak valid';
    end if;
    v_amount := (v_part->>'amount')::numeric;
    if v_amount <= 0 or v_amount <> trunc(v_amount) or v_amount > 9007199254740991 then
      raise exception using errcode='P0001', message='PAYMENT_INVALID: nominal pembayaran harus rupiah positif';
    end if;
    v_total := v_total + v_amount;
  end loop;
  if (p_invoice->>'total')::numeric is distinct from v_total
    or p_invoice->>'paid_status' is distinct from 'Lunas'
    or coalesce((p_invoice->>'dp_amount')::numeric, 0) <> 0 then
    raise exception using errcode='P0001', message='PAYMENT_INVALID: jumlah pembayaran harus sama dengan total invoice';
  end if;

  -- Check access even on a committed retry; same lock order as invoice posting.
  perform pg_advisory_xact_lock(hashtextextended('clinic-invoice-request:' || v_key, 0));
  select * into v_visit from public.visits where id=p_visit_id for update;
  if not found or not public.user_can_access_branch(v_visit.branch_id) then
    raise exception using errcode='P0001', message='ACCESS_DENIED: cabang kunjungan tidak diizinkan';
  end if;
  v_base := p_invoice || jsonb_build_object('paid_status','Belum Lunas',
    'dp_amount',0,'dp_date',null,'metode_bayar',p_payments->0->>'method',
    'split_payments',p_payments);
  v_invoice_id := public.clinic_post_invoice(p_visit_id,v_key,v_base,p_lines);
  for v_part in select value from jsonb_array_elements(p_payments) loop
    v_index := v_index + 1;
    v_payment_id := public.clinic_receive_invoice_payment(v_invoice_id,
      (p_invoice->>'tanggal')::date,(v_part->>'amount')::numeric,
      v_part->>'method',v_part->>'kas_code',null,
      'split:' || md5(v_key) || ':' || v_index::text);
    update public.invoice_payments set checkout_payment=true where id=v_payment_id;
  end loop;
  perform public.set_visit_service_state(p_visit_id,'checkout');
  return v_invoice_id;
end;
$function$;
revoke all on function public.clinic_post_split_invoice(uuid,text,jsonb,jsonb,jsonb) from public,anon,service_role;
grant execute on function public.clinic_post_split_invoice(uuid,text,jsonb,jsonb,jsonb) to authenticated;

-- Preserve original checkout parts when a paid invoice is reissued.
create or replace function public.clinic_void_reissue_invoice(
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
  if coalesce(auth.role(),'') <> 'authenticated' or v_user is null then
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
      kas_code,created_by,transferred_from,checkout_payment)
    select v_new_id,current_date,p.amount,p.metode,
      'Dialihkan dari '||v_invoice.invoice_no,p.kas_code,v_user,p_invoice_id,p.checkout_payment
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
