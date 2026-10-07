-- Serialize payment with purchase returns using the same PO -> invoice lock order.
-- Request identity is an exact-payload recovery key; no automatic replay by the UI.
create table public.purchase_payment_requests(
 actor_id uuid not null references public.profiles(id), request_key text not null,
 payload jsonb not null, result jsonb not null, primary key(actor_id,request_key)
);
alter table public.purchase_payment_requests enable row level security;
revoke all on public.purchase_payment_requests from public,anon,authenticated,service_role;

create function public.purchase_payment_access(p_branch uuid) returns void language plpgsql security definer set search_path='' as $$
declare v_role text;
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated' then raise exception 'Sesi login diperlukan' using errcode='42501';end if;
 select role::text into v_role from public.profiles where id=auth.uid() and is_active for share;
 if not found then raise exception 'Akun tidak aktif' using errcode='42501';end if;
 if v_role<>'OWNER' and ((exists(select 1 from public.role_modules where role::text=v_role) and not exists(select 1 from public.role_modules where role::text=v_role and module_id='kas-bank')) or (v_role='STAFF' and not exists(select 1 from public.role_modules where role::text=v_role))) then raise exception 'Akses Kas & Bank diperlukan' using errcode='42501';end if;
 if p_branch is not null and not public.user_can_access_branch(p_branch) then raise exception 'Cabang tidak dapat diakses' using errcode='42501';end if;
end;$$;
revoke all on function public.purchase_payment_access(uuid) from public,anon,authenticated,service_role;
create function public.recover_purchase_payment(p_request_key text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.purchase_payment_requests%rowtype; branch uuid;
begin
 perform public.purchase_payment_access(null);
 select * into prior from public.purchase_payment_requests where actor_id=auth.uid() and request_key=p_request_key;
 if not found then return null;end if;
 if not (prior.payload ? 'invoice_id') then raise exception 'Jenis permintaan pembayaran berbeda' using errcode='22023';end if;
 if prior.payload<>p_payload then raise exception 'Permintaan pembayaran sudah digunakan dengan rincian berbeda' using errcode='22023';end if;
 select coalesce(i.branch_id,p.branch_id) into branch from public.purchase_invoices i left join public.purchase_orders p on p.id=i.po_id where i.id=(prior.payload->>'invoice_id')::uuid;
 perform public.purchase_payment_access(branch);
 return prior.result;
end;$$;
revoke all on function public.recover_purchase_payment(text,jsonb) from public,anon;
grant execute on function public.recover_purchase_payment(text,jsonb) to authenticated;

create function public.pay_purchase_invoice_atomic(p_request_key text,p_invoice_id uuid,p_tanggal date,p_amount numeric,p_metode text,p_catatan text,p_account_id uuid,p_advance_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 inv public.purchase_invoices%rowtype; adv public.purchase_advances%rowtype;
 prior public.purchase_payment_requests%rowtype; payload jsonb; result jsonb;
 v_po_id uuid; branch uuid; cash_code text; paid numeric; returns_left numeric:=0; residual numeric; available numeric:=0; from_advance numeric:=0;
 r record; payment_id uuid:=gen_random_uuid(); journal_id uuid; lines jsonb;
 rule_id uuid; approval_id uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501';end if;
 if p_request_key is null or length(p_request_key) not between 1 and 120 or p_amount is null or p_amount<>round(p_amount) or p_amount<=0 or p_amount::text in ('NaN','Infinity','-Infinity') or p_tanggal is null then raise exception 'Nominal atau identitas pembayaran tidak valid' using errcode='22023';end if;
 payload:=jsonb_build_object('invoice_id',p_invoice_id,'tanggal',p_tanggal,'amount',p_amount,'metode',p_metode,'catatan',p_catatan,'account_id',p_account_id,'advance_id',p_advance_id);
 -- No locks are acquired on an invoice before its PO: returns use this order too.
 select i.po_id into v_po_id from public.purchase_invoices i where i.id=p_invoice_id;
 if v_po_id is not null then perform 1 from public.purchase_orders where id=v_po_id for update;end if;
 if v_po_id is not null then perform 1 from public.purchase_invoices i where i.po_id=v_po_id order by id for update;end if;
 select * into inv from public.purchase_invoices where id=p_invoice_id for update;
 if not found then raise exception 'Faktur tidak ditemukan';end if;
 branch:=inv.branch_id;if branch is null and inv.po_id is not null then select branch_id into branch from public.purchase_orders where id=inv.po_id;end if;
 perform public.purchase_payment_access(branch);
 perform pg_advisory_xact_lock(hashtext('vetos:purchase-payment:'||auth.uid()::text||':'||p_request_key)::bigint);
 select * into prior from public.purchase_payment_requests where actor_id=auth.uid() and request_key=p_request_key;
 if found then if prior.payload<>payload then raise exception 'Permintaan pembayaran sudah digunakan dengan rincian berbeda' using errcode='22023';end if;return prior.result;end if;
 perform 1 from public.accounting_locks where id for share;
 if exists(select 1 from public.accounting_locks where id and p_tanggal<=closed_until) then raise exception 'Periode akuntansi sudah ditutup';end if;
 -- Allocate PO returns against outstanding invoices in the same due-date order as Hutang.
 if inv.po_id is not null then
  select coalesce(sum(total),0) into returns_left from public.purchase_returns where purchase_returns.po_id=inv.po_id;
  for r in select i.id,i.total from public.purchase_invoices i where i.po_id=inv.po_id order by i.jatuh_tempo,i.id loop
   select coalesce(sum(amount),0) into paid from public.purchase_invoice_payments where invoice_id=r.id;
   residual:=greatest(0,r.total-paid);
   available:=greatest(0,residual-returns_left);
   returns_left:=greatest(0,returns_left-residual);
   if r.id=inv.id then exit;end if;
  end loop;
 else
  select coalesce(sum(amount),0) into paid from public.purchase_invoice_payments where invoice_id=inv.id;
  available:=greatest(0,inv.total-paid);
 end if;
 if p_amount>available then raise exception 'Nominal melebihi sisa faktur setelah pembayaran dan retur' using errcode='22003';end if;
 if p_advance_id is not null then
  select * into adv from public.purchase_advances where id=p_advance_id for update;
  if not found or adv.status<>'aktif' then raise exception 'Uang muka tidak tersedia';end if;
  if adv.supplier_id is not null and inv.supplier_id is not null and adv.supplier_id<>inv.supplier_id then raise exception 'Uang muka milik pemasok lain';end if;
  from_advance:=least(p_amount,greatest(0,adv.jumlah-adv.terpakai));
  if from_advance<=0 then raise exception 'Uang muka sudah habis terpakai';end if;
  if from_advance<>round(from_advance) then raise exception 'Porsi uang muka harus rupiah bulat' using errcode='22023';end if;
 end if;
 -- Preserve approval thresholds and latest live request; consume only in this transaction.
 select id into rule_id from public.approval_rules where jenis='bayar-faktur' and is_active and p_amount>min_nilai order by min_nilai desc limit 1;
 if rule_id is not null then
  select id into approval_id from public.approval_requests where jenis='bayar-faktur' and ref_id=inv.id::text and status in ('menunggu','disetujui','ditolak') order by diajukan_at desc limit 1 for update;
  if approval_id is null or not exists(select 1 from public.approval_requests where id=approval_id and status='disetujui') then raise exception 'Transaksi ini butuh persetujuan atasan';end if;
  update public.approval_requests set status='terpakai' where id=approval_id;
 end if;
 if p_account_id is not null then
  select coa_code into cash_code from public.cash_accounts where id=p_account_id and is_active;
 end if;
 if cash_code is null then cash_code:=public.unit_posting_cash(p_metode,branch);end if;
 lines:=jsonb_build_array(jsonb_build_object('code','2101','debit',round(p_amount),'credit',0));
 if round(from_advance)>0 then lines:=lines||jsonb_build_array(jsonb_build_object('code','1303','debit',0,'credit',least(round(p_amount),round(from_advance))));end if;
 if round(p_amount)>round(from_advance) then lines:=lines||jsonb_build_array(jsonb_build_object('code',cash_code,'debit',0,'credit',round(p_amount)-round(from_advance)));end if;
 insert into public.purchase_invoice_payments(id,invoice_id,tanggal,amount,metode,catatan,created_by,advance_id,dari_uang_muka) values(payment_id,inv.id,p_tanggal,p_amount,p_metode,p_catatan,auth.uid(),p_advance_id,from_advance);
 if from_advance>0 then update public.purchase_advances set terpakai=terpakai+from_advance where id=adv.id;end if;
 journal_id:=public.clinic_write_journal(p_tanggal,'Pembayaran faktur '||inv.no_faktur||case when from_advance>0 then ' (pakai uang muka)' else '' end,'purchase-pay',inv.no_faktur,branch,lines);
 if journal_id is null then raise exception 'Jurnal pembayaran belum tersimpan';end if;
 result:=jsonb_build_object('payment_id',payment_id,'journal_id',journal_id,'no_faktur',inv.no_faktur);
 insert into public.purchase_payment_requests values(auth.uid(),p_request_key,payload,result);
 return result;
end;
$$;
revoke all on function public.pay_purchase_invoice_atomic(text,uuid,date,numeric,text,text,uuid,uuid) from public,anon;
grant execute on function public.pay_purchase_invoice_atomic(text,uuid,date,numeric,text,text,uuid,uuid) to authenticated;
-- All new payments use the locked RPC; read policies remain unchanged.
revoke insert,update,delete on public.purchase_invoice_payments from authenticated;

-- Aggregate payment orders keep their existing one-journal-per-order source/ref.
create function public.pay_purchase_payment_order_atomic(p_request_key text,p_order_id uuid,p_tanggal date,p_metode text,p_account_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 ord public.payment_orders%rowtype; prior public.purchase_payment_requests%rowtype;
 payload jsonb; result jsonb; role_name text; r record; other record; branch uuid;
 cash_code text; v_total numeric:=0; paid numeric; ret numeric; avail numeric; residual numeric; journal_id uuid;
begin
 perform public.purchase_payment_access(null);
 select role::text into role_name from public.profiles where id=auth.uid() and is_active;
 if role_name not in ('OWNER','ADMIN') then raise exception 'Hanya pemilik/admin yang dapat membayar perintah bayar' using errcode='42501';end if;
 if p_request_key is null or length(p_request_key) not between 1 and 120 or p_tanggal is null then raise exception 'Identitas pembayaran tidak valid' using errcode='22023';end if;
 payload:=jsonb_build_object('order_id',p_order_id,'tanggal',p_tanggal,'metode',p_metode,'account_id',p_account_id);
 select * into ord from public.payment_orders where id=p_order_id for update;
 if not found then raise exception 'Perintah bayar tidak ditemukan';end if;
 perform 1 from public.payment_order_items where order_id=ord.id order by id for update;
 if not exists(select 1 from public.payment_order_items where order_id=ord.id) then raise exception 'Perintah bayar tidak punya baris faktur';end if;
 -- All POs first, sorted; then all invoices in those POs, sorted, including direct invoices.
 perform 1 from public.purchase_orders p where p.id in(select i.po_id from public.payment_order_items b join public.purchase_invoices i on i.id=b.invoice_id where b.order_id=ord.id) order by p.id for update;
 perform 1 from public.purchase_invoices i where i.po_id in(select i2.po_id from public.payment_order_items b join public.purchase_invoices i2 on i2.id=b.invoice_id where b.order_id=ord.id) or i.id in(select invoice_id from public.payment_order_items where order_id=ord.id) order by i.id for update;
 perform pg_advisory_xact_lock(hashtext('vetos:purchase-payment:'||auth.uid()::text||':'||p_request_key)::bigint);
 select * into prior from public.purchase_payment_requests where actor_id=auth.uid() and request_key=p_request_key;
 if found then
  if prior.payload<>payload then raise exception 'Permintaan pembayaran sudah digunakan dengan rincian berbeda' using errcode='22023';end if;
  for r in select coalesce(i.branch_id,p.branch_id) branch_id from public.payment_order_items b join public.purchase_invoices i on i.id=b.invoice_id left join public.purchase_orders p on p.id=i.po_id where b.order_id=ord.id loop perform public.purchase_payment_access(r.branch_id);end loop;
  return prior.result;
 end if;
 if ord.status<>'disetujui' then raise exception 'Perintah bayar belum disetujui';end if;
 perform 1 from public.accounting_locks where id for share;
 if exists(select 1 from public.accounting_locks where id and p_tanggal<=closed_until) then raise exception 'Periode akuntansi sudah ditutup';end if;

 for r in select i.id,i.total,i.po_id,coalesce(i.branch_id,p.branch_id) branch_id,sum(b.jumlah) amount from public.payment_order_items b join public.purchase_invoices i on i.id=b.invoice_id left join public.purchase_orders p on p.id=i.po_id where b.order_id=ord.id group by i.id,p.branch_id order by i.id loop
  perform public.purchase_payment_access(r.branch_id);
  if branch is null then branch:=r.branch_id;end if;
  if r.po_id is not null then
   select coalesce(sum(total),0) into ret from public.purchase_returns where po_id=r.po_id;
   for other in select id,total from public.purchase_invoices where po_id=r.po_id order by jatuh_tempo,id loop
    select coalesce(sum(amount),0) into paid from public.purchase_invoice_payments where invoice_id=other.id;
    residual:=greatest(0,other.total-paid);avail:=greatest(0,residual-ret);ret:=greatest(0,ret-residual);
    if other.id=r.id then exit;end if;
   end loop;
  else select greatest(0,r.total-coalesce(sum(amount),0)) into avail from public.purchase_invoice_payments where invoice_id=r.id;end if;
  if r.amount<>round(r.amount) then raise exception 'Nominal pembayaran harus rupiah bulat' using errcode='22023';end if;
  if r.amount<=0 or r.amount>avail then raise exception 'Nominal melebihi sisa faktur setelah pembayaran dan retur' using errcode='22003';end if;
  insert into public.purchase_invoice_payments(invoice_id,tanggal,amount,metode,catatan,created_by,payment_order_id) values(r.id,p_tanggal,r.amount,p_metode,'Perintah bayar '||ord.no_pp,auth.uid(),ord.id);
  v_total:=v_total+r.amount;
 end loop;
 if p_account_id is not null then select coa_code into cash_code from public.cash_accounts where id=p_account_id and is_active;end if;
 if cash_code is null then cash_code:=public.unit_posting_cash(p_metode,branch);end if;
 journal_id:=public.clinic_write_journal(p_tanggal,'Pembayaran hutang lewat '||ord.no_pp,'purchase-pay',ord.no_pp,branch,jsonb_build_array(jsonb_build_object('code','2101','debit',v_total,'credit',0),jsonb_build_object('code',cash_code,'debit',0,'credit',v_total)));
 if journal_id is null then raise exception 'Jurnal pembayaran belum tersimpan';end if;
 update public.payment_orders set status='dibayar',paid_at=now() where id=ord.id;
 result:=jsonb_build_object('order_id',ord.id,'no_pp',ord.no_pp,'journal_id',journal_id);
 insert into public.purchase_payment_requests values(auth.uid(),p_request_key,payload,result);
 return result;
end;$$;
revoke all on function public.pay_purchase_payment_order_atomic(text,uuid,date,text,uuid) from public,anon;
grant execute on function public.pay_purchase_payment_order_atomic(text,uuid,date,text,uuid) to authenticated;
