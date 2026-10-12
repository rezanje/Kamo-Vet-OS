create function public.clinic_post_demo_invoice(p_visit_id uuid,p_request_key text,p_invoice jsonb,p_lines jsonb,
  p_policy_id uuid,p_payments jsonb,p_employee_ids uuid[]) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_policy public.clinic_demo_policies%rowtype;v_visit public.visits%rowtype;
  v_snapshot public.clinic_demo_invoice_snapshots%rowtype;v_key text:=nullif(btrim(p_request_key),'');v_hash text;
  v_part jsonb;v_quote jsonb:='[]';v_amount numeric;v_rate numeric;v_fee numeric;v_fees numeric:=0;v_base_total numeric:=0;
  v_subtotal numeric;v_service numeric:=0;v_basis numeric;v_pool bigint;v_id uuid;v_no text;v_payment_id uuid;v_index integer:=0;
  v_invoice jsonb;v_lines jsonb:=p_lines;v_employee uuid;v_role text;v_employees uuid[];v_count integer;v_alloc bigint;
begin
  if coalesce(auth.role(),'')<>'authenticated' or auth.uid() is null or not exists(
    select 1 from public.profiles where id=auth.uid() and is_active
  ) then raise exception 'ACCESS_DENIED: pengguna tidak aktif atau tidak terautentikasi';end if;
  if v_key is null or length(v_key)>100 or jsonb_typeof(p_invoice) is distinct from 'object'
    or jsonb_typeof(p_lines) is distinct from 'array' or jsonb_typeof(p_payments) is distinct from 'array'
    or jsonb_array_length(p_payments) not between 1 and 6
    or p_invoice->>'paid_status' is distinct from 'Lunas' or coalesce((p_invoice->>'dp_amount')::numeric,0)<>0 then
    raise exception 'PAYMENT_INVALID: aturan DEMO hanya untuk checkout awal yang lunas';end if;
  select array_agg(distinct e order by e) into v_employees from unnest(p_employee_ids) e;
  v_count:=coalesce(cardinality(v_employees),0);
  if v_count not between 1 and 12 or array_position(v_employees,null) is not null then
    raise exception 'INCENTIVE_INVALID: pilih 1–12 petugas yang menangani pasien';end if;
  v_hash:=md5(jsonb_build_object('visit',p_visit_id,'invoice',p_invoice,'lines',p_lines,'policy',p_policy_id,
    'payments',p_payments,'employees',v_employees)::text);
  perform pg_advisory_xact_lock(hashtextextended('clinic-invoice-request:'||v_key,0));
  select * into v_visit from public.visits where id=p_visit_id for update;
  if not found or not public.user_can_access_branch(v_visit.branch_id) then raise exception 'ACCESS_DENIED: cabang kunjungan tidak diizinkan';end if;
  select * into v_snapshot from public.clinic_demo_invoice_snapshots where request_key=v_key;
  if found then
    if v_snapshot.request_hash is distinct from v_hash then raise exception 'IDEMPOTENCY_CONFLICT: data checkout DEMO berubah';end if;
    return v_snapshot.invoice_id;
  end if;
  if not public.clinic_inpatient_consent_valid(p_visit_id) then raise exception 'CONSENT_REQUIRED: persetujuan rawat inap tidak valid';end if;
  select * into v_policy from public.clinic_demo_policies where id=p_policy_id for share;
  if not found or not v_policy.is_active then raise exception 'POLICY_INVALID: aturan DEMO berubah; muat ulang halaman';end if;
  foreach v_employee in array v_employees loop
    if v_employee is distinct from v_visit.doctor_id and v_employee is distinct from v_visit.service_provider_id
      and not exists(select 1 from public.inpatient_records r left join public.inpatient_daily_logs l on l.inpatient_record_id=r.id
        where r.visit_id=p_visit_id and (r.doctor_id=v_employee or l.visit_doctor_id=v_employee or l.paramedic_id=v_employee)) then
      raise exception 'INCENTIVE_INVALID: petugas belum tercatat menangani pasien';end if;
    select (public.clinic_employee_roles(jabatan))[1] into v_role from public.employees where id=v_employee;
    if v_role is null then raise exception 'INCENTIVE_INVALID: jabatan petugas bukan klinis';end if;
    perform public.clinic_staff_name(v_employee,v_visit.branch_id,v_role);
  end loop;
  for v_part in select value from jsonb_array_elements(p_payments) loop
    if jsonb_typeof(v_part->'amount') is distinct from 'number' or coalesce(v_part->>'method','') not in ('Tunai','Transfer','Debit','Kredit','QRIS','E-Wallet') then
      raise exception 'PAYMENT_INVALID: metode atau nominal pembayaran tidak valid';end if;
    v_amount:=(v_part->>'amount')::numeric;
    if v_amount<=0 or v_amount<>trunc(v_amount) or v_amount>9999999999999 then raise exception 'PAYMENT_INVALID: isi rupiah positif';end if;
    -- A caller cannot direct receipt money to a revenue/expense account.
    if not exists(select 1 from public.cash_accounts c join public.coa_accounts a on a.code=c.coa_code
      where c.coa_code=v_part->>'kas_code' and c.is_active and a.is_active and not a.is_header and a.type='ASET'
      ) or v_part->>'kas_code' is distinct from coalesce((select a.coa_code from public.payment_account_map m
        join public.cash_accounts a on a.id=m.cash_account_id where m.metode=v_part->>'method'
          and (m.branch_id=v_visit.branch_id or m.branch_id is null) order by m.branch_id nulls last limit 1),
        case when v_part->>'method'='Tunai' then '1101' else '1102' end) then
      raise exception 'PAYMENT_INVALID: rekening kas/bank tidak aktif untuk metode dan cabang';end if;
    v_rate:=coalesce((v_policy.fee_rates->>(v_part->>'method'))::numeric,0);
    v_fee:=round(v_amount*v_rate/10000);
    v_fees:=v_fees+v_fee;v_base_total:=v_base_total+v_amount;
    v_quote:=v_quote||jsonb_build_array(v_part||jsonb_build_object('fee',v_fee,
      'gross',v_amount+case when v_policy.fee_bearer='customer' then v_fee else 0 end,
      'net',v_amount-case when v_policy.fee_bearer='company' then v_fee else 0 end));
  end loop;
  if v_base_total is distinct from (p_invoice->>'total')::numeric then raise exception 'PAYMENT_INVALID: jumlah bagian tidak sama dengan tagihan dasar';end if;
  v_subtotal:=(p_invoice->>'subtotal')::numeric;
  for v_part in select value from jsonb_array_elements(p_lines) loop
    if v_part->>'kind'='jasa' then
      v_service:=v_service+round((v_part->>'qty')::numeric*(v_part->>'price')::numeric*(1-coalesce((v_part->>'discount_percent')::numeric,0)/100),2);
    end if;
  end loop;
  v_basis:=case when v_subtotal>0 then round(v_service*(v_subtotal-(p_invoice->>'discount')::numeric)/v_subtotal,2) else 0 end;
  v_pool:=round(v_basis*v_policy.incentive_percent/100);
  if v_basis<0 or v_pool<0 then raise exception 'INCENTIVE_INVALID: dasar insentif tidak valid';end if;
  v_invoice:=p_invoice||jsonb_build_object('paid_status','Belum Lunas','dp_amount',0,'dp_date',null,
    'metode_bayar',v_quote->0->>'method','demo_policy',p_policy_id,'demo_payments',v_quote,'demo_employees',v_employees);
  if v_policy.fee_bearer='customer' and v_fees>0 then
    v_invoice:=v_invoice||jsonb_build_object('subtotal',v_subtotal+v_fees,'total',v_base_total+v_fees);
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('description','Admin pembayaran DEMO','kind','jasa','qty',1,'price',v_fees));
  end if;
  v_id:=public.clinic_post_invoice(p_visit_id,v_key,v_invoice,v_lines);
  select invoice_no into v_no from public.invoices where id=v_id;
  for v_part in select value from jsonb_array_elements(v_quote) loop
    v_index:=v_index+1;
    v_payment_id:=public.clinic_receive_invoice_payment(v_id,(p_invoice->>'tanggal')::date,(v_part->>'gross')::numeric,
      v_part->>'method',v_part->>'kas_code',null,'demo:'||md5(v_key)||':'||v_index);
    update public.invoice_payments set checkout_payment=true where id=v_payment_id;
    if v_policy.fee_bearer='company' and (v_part->>'fee')::numeric>0 then
      perform public.clinic_write_journal((p_invoice->>'tanggal')::date,'Admin pembayaran DEMO '||v_no,'klinik-demo-expense',v_no,v_visit.branch_id,
        jsonb_build_array(jsonb_build_object('code',v_policy.admin_expense_code,'debit',(v_part->>'fee')::numeric,'credit',0),
          jsonb_build_object('code',v_part->>'kas_code','debit',0,'credit',(v_part->>'fee')::numeric)));
    end if;
  end loop;
  if v_policy.fee_bearer='customer' and v_fees>0 then
    perform public.clinic_write_journal((p_invoice->>'tanggal')::date,'Pendapatan admin DEMO '||v_no,'klinik-demo-admin',v_no,v_visit.branch_id,
      jsonb_build_array(jsonb_build_object('code','4201','debit',v_fees,'credit',0),
        jsonb_build_object('code',v_policy.admin_revenue_code,'debit',0,'credit',v_fees)));
  end if;
  insert into public.clinic_demo_invoice_snapshots(invoice_id,policy_id,branch_id,request_key,request_hash,base_total,fee_amount,fee_bearer,payments,service_basis,incentive_pool)
    values(v_id,p_policy_id,v_visit.branch_id,v_key,v_hash,v_base_total,v_fees,v_policy.fee_bearer,v_quote,v_basis,v_pool);
  v_index:=0;
  foreach v_employee in array v_employees loop
    v_alloc:=v_pool/v_count+case when v_index<v_pool%v_count then 1 else 0 end;
    insert into public.clinic_demo_incentive_allocations(invoice_id,employee_id,amount) values(v_id,v_employee,v_alloc);
    v_index:=v_index+1;
  end loop;
  perform public.set_visit_service_state(p_visit_id,'checkout');
  return v_id;
end $$;
revoke all on function public.clinic_post_demo_invoice(uuid,text,jsonb,jsonb,uuid,jsonb,uuid[]) from public,anon,service_role;
grant execute on function public.clinic_post_demo_invoice(uuid,text,jsonb,jsonb,uuid,jsonb,uuid[]) to authenticated;

-- Reissue preserves money and the single incentive entitlement; the report
-- reads only the active successor. Existing correction remains for legacy
-- invoices; changing a paid DEMO snapshot needs a separate refund workflow.
alter function public.clinic_void_reissue_invoice(uuid,text,text) rename to clinic_void_reissue_invoice_core;
revoke all on function public.clinic_void_reissue_invoice_core(uuid,text,text) from public,anon,authenticated,service_role;
create function public.clinic_void_reissue_invoice(p_invoice_id uuid,p_request_key text,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid;v_s public.clinic_demo_invoice_snapshots%rowtype;v_p public.clinic_demo_policies%rowtype;v_old_no text;v_new_no text;
begin
  if coalesce(auth.role(),'')<>'authenticated' or not exists(select 1 from public.profiles where id=auth.uid() and is_active) then
    raise exception 'ACCESS_DENIED: pengguna tidak aktif atau tidak terautentikasi';end if;
  v_id:=public.clinic_void_reissue_invoice_core(p_invoice_id,p_request_key,p_reason);
  select * into v_s from public.clinic_demo_invoice_snapshots where invoice_id=p_invoice_id;
  if found and not exists(select 1 from public.clinic_demo_invoice_snapshots where invoice_id=v_id) then
    select * into v_p from public.clinic_demo_policies where id=v_s.policy_id;
    select invoice_no into v_old_no from public.invoices where id=p_invoice_id;
    select invoice_no into v_new_no from public.invoices where id=v_id;
    insert into public.clinic_demo_invoice_snapshots(invoice_id,policy_id,branch_id,request_key,request_hash,base_total,fee_amount,fee_bearer,payments,service_basis,incentive_pool,earned_at)
      values(v_id,v_s.policy_id,v_s.branch_id,p_request_key,md5(p_invoice_id::text||p_request_key),v_s.base_total,v_s.fee_amount,v_s.fee_bearer,v_s.payments,v_s.service_basis,v_s.incentive_pool,v_s.earned_at);
    insert into public.clinic_demo_incentive_allocations(invoice_id,employee_id,amount) select v_id,employee_id,amount from public.clinic_demo_incentive_allocations where invoice_id=p_invoice_id;
    if v_s.fee_bearer='customer' and v_s.fee_amount>0 then
      perform public.clinic_write_journal(current_date,'Pembalikan admin DEMO '||v_old_no,'klinik-demo-admin-void',v_old_no,v_s.branch_id,
        jsonb_build_array(jsonb_build_object('code',v_p.admin_revenue_code,'debit',v_s.fee_amount,'credit',0),jsonb_build_object('code','4201','debit',0,'credit',v_s.fee_amount)));
      perform public.clinic_write_journal(current_date,'Admin DEMO terbit ulang '||v_new_no,'klinik-demo-admin',v_new_no,v_s.branch_id,
        jsonb_build_array(jsonb_build_object('code','4201','debit',v_s.fee_amount,'credit',0),jsonb_build_object('code',v_p.admin_revenue_code,'debit',0,'credit',v_s.fee_amount)));
    end if;
    update public.invoices set correction_pending=false where id=v_id;
  end if;
  return v_id;
end $$;
revoke all on function public.clinic_void_reissue_invoice(uuid,text,text) from public,anon,service_role;
grant execute on function public.clinic_void_reissue_invoice(uuid,text,text) to authenticated;
alter function public.clinic_edit_invoice(uuid,text,jsonb,jsonb) rename to clinic_edit_invoice_core;
revoke all on function public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb) from public,anon,authenticated,service_role;
create function public.clinic_edit_invoice(p_invoice_id uuid,p_request_key text,p_invoice jsonb,p_lines jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
begin
  if coalesce(auth.role(),'')<>'authenticated' or not exists(select 1 from public.profiles where id=auth.uid() and is_active) then
    raise exception 'ACCESS_DENIED: pengguna tidak aktif atau tidak terautentikasi';end if;
  if exists(select 1 from public.clinic_demo_invoice_snapshots where invoice_id=p_invoice_id) then
    raise exception 'INVOICE_POSTED: uang dan pembagian insentif DEMO terkunci; terbit ulang mempertahankan snapshot';end if;
  return public.clinic_edit_invoice_core(p_invoice_id,p_request_key,p_invoice,p_lines);
end $$;
revoke all on function public.clinic_edit_invoice(uuid,text,jsonb,jsonb) from public,anon,service_role;
grant execute on function public.clinic_edit_invoice(uuid,text,jsonb,jsonb) to authenticated;
