-- Editable PENDING inpatient cashier cart. Issued stages / DP remain immutable.
-- Original 0404 billing/payment functions remain the sole money/stock engine.
alter table public.prescription_items add column billing_withdrawn_at timestamptz,
 add column billing_withdrawn_by uuid,add column billing_withdrawal_reason text;
create function public.guard_billing_withdrawal()returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if current_user in ('authenticated','anon','service_role') and
  ((tg_op='INSERT' and new.billing_withdrawn_at is not null) or (tg_op='UPDATE' and
   (new.billing_withdrawn_at is distinct from old.billing_withdrawn_at or new.billing_withdrawn_by is distinct from old.billing_withdrawn_by or new.billing_withdrawal_reason is distinct from old.billing_withdrawal_reason)))then
  raise exception 'ACCESS_DENIED: pembatalan penagihan hanya lewat revisi kasir berjejak';end if;
 return new;
end$$;
revoke all on function public.guard_billing_withdrawal()from public,anon,authenticated,service_role;
create trigger aa_billing_withdrawal before insert or update on public.prescription_items for each row execute function public.guard_billing_withdrawal();
create function public.guard_withdrawn_invoice_item()returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.prescription_items where id=new.prescription_item_id and billing_withdrawn_at is not null)then raise exception 'CART_INVALID: resep dibatalkan dari penagihan; tidak boleh ditagih ulang';end if;
 return new;
end$$;
revoke all on function public.guard_withdrawn_invoice_item()from public,anon,authenticated,service_role;
create trigger aa_withdrawn_invoice_item before insert or update of prescription_item_id on public.invoice_items for each row execute function public.guard_withdrawn_invoice_item();
-- The original engine excludes explicit withdrawn billing rows, without deleting
-- the prescription, evidence or issued stock history.
do $patch$
declare d text;needle text:='where mr.visit_id=p_visit_id and not exists';
begin
 d:=pg_get_functiondef('clinic_private.inpatient_payment_quote(uuid,uuid,jsonb)'::regprocedure);
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Pending quote anchor drift';end if;
 execute replace(d,needle,'where mr.visit_id=p_visit_id and pi.billing_withdrawn_at is null and not exists');
end $patch$;
create table clinic_private.inpatient_cashier_requests(
 request_key text primary key,created_by uuid not null,request_hash text not null,result jsonb not null,
 visit_id uuid not null,created_at timestamptz not null default clock_timestamp()
);
revoke all on clinic_private.inpatient_cashier_requests from public,anon,authenticated,service_role;
create table public.clinic_pending_cart_edits(
 id uuid primary key default gen_random_uuid(),visit_id uuid not null references public.visits(id),
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default clock_timestamp(),
 reason text not null,before_rows jsonb not null,after_rows jsonb not null,request_key text not null unique
);
alter table public.clinic_pending_cart_edits enable row level security;
revoke all on public.clinic_pending_cart_edits from public,anon,authenticated,service_role;
grant select on public.clinic_pending_cart_edits to authenticated;
create policy pending_cart_audit_read on public.clinic_pending_cart_edits for select to authenticated
 using(public.clinic_record_correction_actor(visit_id));
create trigger pending_cart_audit_immutable before update or delete on public.clinic_pending_cart_edits
 for each row execute function public.clinic_record_correction_immutable();
create trigger pending_cart_audit_no_truncate before truncate on public.clinic_pending_cart_edits
 for each statement execute function public.clinic_record_correction_immutable();

create function clinic_private.pending_cashier_rows(p_visit_id uuid)returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at,p.id),'[]')
 from public.prescription_items p join public.medical_records m on m.id=p.medical_record_id
 where m.visit_id=p_visit_id and p.billing_withdrawn_at is null and not exists(select 1 from public.invoice_items l join public.invoices i on i.id=l.invoice_id
 where l.prescription_item_id=p.id and i.voided_at is null);
$$;
revoke all on function clinic_private.pending_cashier_rows(uuid)from public,anon,authenticated,service_role;

-- Bind the current monetary quote and tax settings, not only rows/accounts.
-- Amount/excess depend on the entered payment and are intentionally excluded.
create function clinic_private.inpatient_cashier_snapshot(p_rows jsonb,p_quote jsonb)returns text
language sql stable set search_path='' as $$
 select md5(jsonb_build_array(p_rows,p_quote-array['token','amount','excess','lines','shift_id'],
   jsonb_build_object('mode_pkp',s.mode_pkp,'ppn_rate',s.ppn_rate))::text)
 from public.company_settings s where s.id=true;
$$;
revoke all on function clinic_private.inpatient_cashier_snapshot(jsonb,jsonb)from public,anon,authenticated,service_role;

create function public.clinic_read_inpatient_cashier(p_record_id uuid,p_visit_id uuid)returns jsonb
language plpgsql security definer set search_path='' as $$
declare quote jsonb;rows jsonb;history jsonb;receipts jsonb;applications jsonb;
 v public.visits%rowtype;me public.profiles%rowtype;
begin
 -- Same authorization as the original quote, before either history or shift state.
 -- Only money/editing needs an OWN open shift; historical documents do not.
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
 if exists(select 1 from public.cashier_shifts where opened_by=me.id and branch_id=v.branch_id and shift_type='klinik' and status='open')then
  quote:=clinic_private.inpatient_payment_quote(p_record_id,p_visit_id,'[]');
  rows:=clinic_private.pending_cashier_rows(p_visit_id);
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'invoice_no',i.invoice_no,'total',i.total,'paid_status',i.paid_status,
 'received',clinic_private.invoice_received(i.id),'dp_amount',i.dp_amount,'correction_pending',i.correction_pending,
 'lines',(select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at,l.id),'[]') from public.invoice_items l where l.invoice_id=i.id)) order by i.created_at,i.id),'[]')
 into history from public.invoices i where i.visit_id=p_visit_id and i.voided_at is null;
 select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('parts',(select coalesce(jsonb_agg(to_jsonb(p) order by p.urutan),'[]') from public.clinic_payment_receipt_parts p where p.receipt_id=r.id)) order by r.created_at,r.id),'[]') into receipts
 from public.clinic_payment_receipts r where r.visit_id=p_visit_id;
 select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]') into applications from public.clinic_advance_applications a join public.invoices i on i.id=a.invoice_id where i.visit_id=p_visit_id and i.voided_at is null and a.released_at is null;
 return jsonb_build_object('state',case when quote is null then 'SHIFT_REQUIRED' else 'EDITABLE' end,
  'snapshot',case when quote is not null then clinic_private.inpatient_cashier_snapshot(rows,quote) end,'rows',rows,'quote',quote-'lines'-'shift_id','history',history,'receipts',receipts,'applications',applications,
  'tax_settings',(select jsonb_build_object('mode_pkp',s.mode_pkp,'ppn_rate',s.ppn_rate) from public.company_settings s where s.id=true),
  'compound_pending',exists(select 1 from public.compounding_recipes c join public.medical_records m on m.id=c.medical_record_id where m.visit_id=p_visit_id and c.status='pending'));
end$$;
revoke all on function public.clinic_read_inpatient_cashier(uuid,uuid)from public,anon,authenticated,service_role;
grant execute on function public.clinic_read_inpatient_cashier(uuid,uuid)to authenticated;

create function public.clinic_save_inpatient_cashier(
 p_record_id uuid,p_visit_id uuid,p_request_key text,p_tanggal date,p_snapshot text,p_rows jsonb,p_parts jsonb,
 p_overpayment_ack text default null,p_add_owner_credit boolean default false,p_dp_override_reason text default null,p_reason text default null
)returns jsonb language plpgsql security definer set search_path='' set lock_timeout='8s' as $$
declare quote jsonb;before_rows jsonb;after_rows jsonb;row_value jsonb;rx public.prescription_items%rowtype;
 cached clinic_private.inpatient_cashier_requests%rowtype;fingerprint text;result jsonb;locked_shift uuid;v_seen uuid[]:='{}';v_id uuid;
 v_item public.items%rowtype;v_mr uuid;v_unit text;v_factor numeric;v_qty numeric;v_price numeric;initial_accounts jsonb;
begin
 -- Validates active role/module/branch/stay and owns shared coordinator BEFORE
 -- shift/visit/Rx locks. It is intentionally NOT the DOCTOR clinical-text API.
 quote:=clinic_private.inpatient_payment_quote(p_record_id,p_visit_id,p_parts);
 initial_accounts:=quote->'accounts';
 locked_shift:=(quote->>'shift_id')::uuid;
 perform 1 from public.cashier_shifts where id=locked_shift for update;
 -- Pin configuration after the shift, before invoice/stock/journal work, so
 -- a tax writer cannot change the nominal between draft validation and352.
 perform 1 from public.company_settings where id=true for share;
 quote:=clinic_private.inpatient_payment_quote(p_record_id,p_visit_id,p_parts);
 if locked_shift is distinct from (quote->>'shift_id')::uuid then raise exception 'SHIFT_INVALID: shift berubah';end if;
 if initial_accounts is distinct from quote->'accounts' then raise exception 'ACCOUNT_INVALID: rekening berubah saat menunggu shift; muat ulang';end if;
 if nullif(btrim(p_request_key),'') is null or length(p_request_key)>80 or jsonb_typeof(p_rows) is distinct from 'array'
 or jsonb_array_length(p_rows)>200 or length(btrim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'CART_INVALID: isi alasan perubahan';end if;
 perform pg_advisory_xact_lock(hashtextextended('clinic-cashier:'||p_request_key,0));
 fingerprint:=md5(jsonb_build_array(p_record_id,p_visit_id,p_tanggal,p_snapshot,p_rows,p_parts,p_add_owner_credit,p_dp_override_reason,p_reason)::text);
 select * into cached from clinic_private.inpatient_cashier_requests where request_key=p_request_key;
 if found then
  if cached.created_by<>auth.uid() or cached.visit_id<>p_visit_id or cached.request_hash<>fingerprint then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  return cached.result;
 end if;
 before_rows:=clinic_private.pending_cashier_rows(p_visit_id);
 if p_snapshot is distinct from clinic_private.inpatient_cashier_snapshot(before_rows,quote)then raise exception 'CART_STALE: rekam medis/keranjang/rekening/pajak/saldo berubah; muat ulang dan periksa ulang';end if;
 begin
  insert into clinic_private.record_edit_permits values(txid_current(),auth.uid(),p_visit_id);
  for row_value in select value from jsonb_array_elements(p_rows)loop
   v_id:=nullif(row_value->>'id','')::uuid;
   if v_id is null or v_id=any(v_seen)then raise exception 'CART_INVALID: resep tidak sesuai pending terkini';end if;
   v_seen:=v_seen||v_id;
   select * into rx from public.prescription_items where id=v_id for update;
   if found and not exists(select 1 from jsonb_array_elements(before_rows) x where x->>'id'=v_id::text)then raise exception 'CART_INVALID: hanya item pending boleh diedit';end if;
   v_qty:=(row_value->>'qty')::numeric;v_price:=(row_value->>'harga')::numeric;
   if v_qty is null or v_qty<=0 or v_qty>100000 or v_qty<>trunc(v_qty) or v_price is null or v_price<0 or v_price>1e12
    or coalesce((row_value->>'diskon_persen')::numeric,0)<>0 then raise exception 'CART_INVALID: jumlah/harga tidak valid atau diskon tahap tidak didukung';end if;
   if rx.compound_recipe_id is not null then
    if (row_value->>'qty')::numeric is distinct from rx.qty or (row_value->>'harga')::numeric is distinct from rx.harga
    or nullif(row_value->>'item_id','')::uuid is distinct from rx.item_id then raise exception 'COMPOUND_LOCKED: racikan harus lewat koreksi asli';end if;
   else
    if rx.bmhp_components is not null and nullif(row_value->>'item_id','')::uuid is distinct from rx.item_id then raise exception 'BMHP_LOCKED: ganti item ber-BMHP lewat dokter';end if;
    if nullif(row_value->>'item_id','') is not null then
     select * into v_item from public.items where id=(row_value->>'item_id')::uuid and is_active;
     if not found or v_item.item_type not in ('Jasa','Persediaan')then raise exception 'CART_INVALID: pilih item master aktif';end if;
     v_unit:=coalesce(nullif(row_value->>'satuan',''),v_item.unit);v_factor:=1;
     if v_unit<>v_item.unit then
      select factor into v_factor from public.item_units where item_id=v_item.id and unit=v_unit;
      if v_factor is null or v_factor<=0 then raise exception 'CART_INVALID: satuan tidak tersedia';end if;
     end if;
    else
     v_item:=null;v_unit:=rx.satuan;v_factor:=rx.faktor;
     if rx.id is null or rx.item_id is not null then raise exception 'CART_INVALID: item baru harus dari master';end if;
    end if;
    if rx.id is null then
     select id into v_mr from public.medical_records where visit_id=p_visit_id order by created_at,id limit 1;
     if v_mr is null then raise exception 'CART_INVALID: rekam medis tidak ditemukan';end if;
     insert into public.prescription_items(id,medical_record_id,nama_obat,item_id,qty,satuan,faktor,harga,jenis,kategori,service_performers)
     values(v_id,v_mr,v_item.name,v_item.id,v_qty,v_unit,v_factor,v_price,case when v_item.item_type='Jasa' then 'jasa' else 'obat' end,v_item.tindakan_kategori,nullif(row_value->'service_performers','null'));
    else
     update public.prescription_items set qty=v_qty,harga=v_price,item_id=v_item.id,nama_obat=coalesce(v_item.name,rx.nama_obat),
      satuan=v_unit,faktor=v_factor,jenis=case when v_item.id is null then rx.jenis when v_item.item_type='Jasa' then 'jasa' else 'obat' end where id=v_id;
    end if;
   end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(before_rows) x where not((x->>'id')::uuid=any(v_seen)) and x->>'compound_recipe_id' is not null)then raise exception 'COMPOUND_LOCKED: gunakan pengembalian/koreksi racikan asli';end if;
  update public.prescription_items set billing_withdrawn_at=clock_timestamp(),billing_withdrawn_by=auth.uid(),billing_withdrawal_reason=btrim(p_reason)
  where id in(select (x->>'id')::uuid from jsonb_array_elements(before_rows) x where not((x->>'id')::uuid=any(v_seen)));
  after_rows:=clinic_private.pending_cashier_rows(p_visit_id);
  if after_rows is distinct from before_rows then insert into public.clinic_pending_cart_edits(visit_id,created_by,reason,before_rows,after_rows,request_key)
   values(p_visit_id,auth.uid(),btrim(p_reason),before_rows,after_rows,p_request_key);end if;
  delete from clinic_private.record_edit_permits where transaction_id=txid_current();
  result:=public.clinic_bill_and_pay_inpatient(p_record_id,p_visit_id,'cart:'||md5(p_request_key),p_tanggal,p_parts,p_overpayment_ack,p_add_owner_credit,p_dp_override_reason);
  -- Confirmation must NOT commit even the pending cart. On retry deterministic
  -- IDs preserve the same edited quote; its original token binds money/credit.
  if result->>'status'='OVERPAYMENT_CONFIRM_REQUIRED' then raise exception using errcode='P0409',message='confirm',detail=result::text;end if;
 exception when sqlstate 'P0409' then
  get stacked diagnostics result=pg_exception_detail;
  return result;
 end;
 insert into clinic_private.inpatient_cashier_requests values(p_request_key,auth.uid(),fingerprint,result,p_visit_id,clock_timestamp());
 return result;
end$$;
revoke all on function public.clinic_save_inpatient_cashier(uuid,uuid,text,date,text,jsonb,jsonb,text,boolean,text,text)from public,anon,authenticated,service_role;
grant execute on function public.clinic_save_inpatient_cashier(uuid,uuid,text,date,text,jsonb,jsonb,text,boolean,text,text)to authenticated;
