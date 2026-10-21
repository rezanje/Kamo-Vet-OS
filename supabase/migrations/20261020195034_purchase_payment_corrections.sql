-- Payments are immutable signed movements: cancellation appends an exact opposite.
-- Invoice/inventory cancellation is a separate posting family.
alter table public.purchase_invoice_payments
 add column revision integer not null default 0,
 add column voided_at timestamptz,
 add column reversal_of uuid unique references public.purchase_invoice_payments(id),
 add column journal_id uuid references public.journal_entries(id),
 add column replaces_payment_id uuid unique references public.purchase_invoice_payments(id);
alter table public.purchase_invoice_payments drop constraint purchase_invoice_payments_amount_check;
alter table public.purchase_invoice_payments drop constraint purchase_invoice_payments_dari_uang_muka_check;
alter table public.purchase_invoice_payments add constraint purchase_payment_signed_amount check(
 (reversal_of is null and amount>0 and dari_uang_muka between 0 and amount)
 or (reversal_of is not null and amount<0 and dari_uang_muka between amount and 0));
alter table public.payment_orders add column revision integer not null default 0;

create table public.purchase_payment_cancellations(
 id uuid primary key, payment_id uuid not null references public.purchase_invoice_payments(id),
 payment_order_id uuid references public.payment_orders(id), reason text not null,
 before_value jsonb not null, original_journal_id uuid not null references public.journal_entries(id),
 reversal_journal_id uuid not null references public.journal_entries(id),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
alter table public.purchase_payment_cancellations enable row level security;
revoke all on public.purchase_payment_cancellations from public,anon,authenticated,service_role;
grant select on public.purchase_payment_cancellations to authenticated;
create policy purchase_payment_cancellations_read on public.purchase_payment_cancellations for select to authenticated using(
 exists(select 1 from public.purchase_invoice_payments p join public.purchase_invoices i on i.id=p.invoice_id
 left join public.purchase_orders o on o.id=i.po_id where p.id=payment_id and public.user_can_access_branch(coalesce(i.branch_id,o.branch_id)))
);
create table public.purchase_payment_cancellation_requests(
 actor_id uuid not null references public.profiles(id),request_key text not null,payload jsonb not null,result jsonb not null,
 primary key(actor_id,request_key)
);
alter table public.purchase_payment_cancellation_requests enable row level security;
revoke all on public.purchase_payment_cancellation_requests from public,anon,authenticated,service_role;
create table public.purchase_payment_order_requests(
 actor_id uuid not null references public.profiles(id),request_key text not null,payload jsonb not null,result jsonb not null,
 primary key(actor_id,request_key)
);
alter table public.purchase_payment_order_requests enable row level security;
revoke all on public.purchase_payment_order_requests from public,anon,authenticated,service_role;

-- Only the protected request result establishes an old partial payment's journal.
-- Never pair old payments and journals by date, amount, or invoice number.
update public.purchase_invoice_payments p set journal_id=x.journal_id from (
 select (r.result->>'payment_id')::uuid payment_id,(array_agg((r.result->>'journal_id')::uuid))[1] journal_id
 from public.purchase_payment_requests r join public.journal_entries j on j.id=(r.result->>'journal_id')::uuid
 where r.result ? 'payment_id' and j.source='purchase-pay'
 group by r.result->>'payment_id' having count(*)=1
) x where p.id=x.payment_id;

create function public.guard_purchase_payment_write() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user in ('authenticated','anon','service_role') then raise exception 'Pembayaran hanya melalui jalur resmi' using errcode='42501';end if;
 return coalesce(new,old);
end$$;
revoke all on function public.guard_purchase_payment_write() from public,anon,authenticated,service_role;
create trigger purchase_payment_write_guard before insert or update or delete on public.purchase_invoice_payments for each row execute function public.guard_purchase_payment_write();
create trigger purchase_payment_order_write_guard before insert or update or delete on public.payment_orders for each row execute function public.guard_purchase_payment_write();
create trigger purchase_payment_order_item_write_guard before insert or update or delete on public.payment_order_items for each row execute function public.guard_purchase_payment_write();
revoke insert,update,delete on public.payment_orders,public.payment_order_items,public.purchase_invoice_payments from authenticated,anon,service_role;

create function public.guard_purchase_payment_journal() returns trigger language plpgsql set search_path='' as $$
declare protected boolean;begin
 if current_user in ('authenticated','anon','service_role') then
  if tg_table_name='journal_entries' then protected:=new.source in ('purchase-pay','purchase-pay-void') or old.source in ('purchase-pay','purchase-pay-void');
  else select exists(select 1 from public.journal_entries where id in(new.entry_id,old.entry_id) and source in ('purchase-pay','purchase-pay-void')) into protected;end if;
  if protected then raise exception 'Jurnal pembayaran hanya melalui jalur resmi' using errcode='42501';end if;
 end if;return coalesce(new,old);
end$$;
revoke all on function public.guard_purchase_payment_journal() from public,anon,authenticated,service_role;
create trigger purchase_payment_journal_guard before insert or update or delete on public.journal_entries for each row execute function public.guard_purchase_payment_journal();
create trigger purchase_payment_lines_guard before insert or update or delete on public.journal_lines for each row execute function public.guard_purchase_payment_journal();

-- Direct advance edits must not forge allocations or move an allocated source.
create function public.guard_purchase_advance_allocation() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user in ('authenticated','anon','service_role') then
  if tg_op='INSERT' then
   if new.terpakai<>0 then raise exception 'Alokasi uang muka hanya melalui pembayaran resmi' using errcode='42501';end if;
  elsif tg_op='DELETE' then
   if old.terpakai<>0 or exists(select 1 from public.purchase_invoice_payments where advance_id=old.id) then raise exception 'Riwayat uang muka harus dipertahankan' using errcode='42501';end if;
  elsif new.terpakai is distinct from old.terpakai or ((old.terpakai>0 or exists(select 1 from public.purchase_invoice_payments where advance_id=old.id))
   and (new.supplier_id is distinct from old.supplier_id or new.po_id is distinct from old.po_id or new.jumlah is distinct from old.jumlah or new.account_id is distinct from old.account_id or new.metode is distinct from old.metode or new.tanggal is distinct from old.tanggal or new.no_um is distinct from old.no_um or (new.status='batal' and old.terpakai>0))) then
    raise exception 'Uang muka sudah dialokasikan; gunakan koreksi pembayaran' using errcode='42501';
  end if;
 end if;return coalesce(new,old);
end$$;
revoke all on function public.guard_purchase_advance_allocation() from public,anon,authenticated,service_role;
create trigger purchase_advance_allocation_guard before insert or update or delete on public.purchase_advances for each row execute function public.guard_purchase_advance_allocation();

create function public.purchase_payment_period(p_original date,p_new date) returns void language plpgsql security definer set search_path='' as $$
declare closed date;today date:=(now() at time zone 'Asia/Jakarta')::date;begin
 select closed_until into closed from public.accounting_locks where id for share;
 if p_original is null or p_new is null or not isfinite(p_original) or not isfinite(p_new) or p_original>today or p_new>today then raise exception 'Tanggal pembayaran tidak valid atau di masa depan';end if;
 if closed is not null and (p_original<=closed or p_new<=closed) then raise exception 'Periode sumber atau pembatalan sudah ditutup';end if;
end$$;
revoke all on function public.purchase_payment_period(date,date) from public,anon,authenticated,service_role;
create function public.purchase_payment_scope(p_branch uuid,p_account uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare bank public.cash_accounts%rowtype;begin
 perform public.purchase_payment_access(p_branch);
 perform 1 from public.branches where id=p_branch and is_active for share;
 if not public.user_can_access_branch(p_branch) or (p_branch is not null and not found) then raise exception 'Cabang pembayaran tidak dapat diakses' using errcode='42501';end if;
 if p_account is not null then
  select * into bank from public.cash_accounts where id=p_account for share;
  if not found or not bank.is_active or (bank.branch_id is not null and (bank.branch_id is distinct from p_branch or not public.user_can_access_branch(bank.branch_id))) then raise exception 'Rekening pembayaran tidak aktif atau tidak sesuai cabang' using errcode='42501';end if;
  perform 1 from public.coa_accounts where code=bank.coa_code and is_active and not is_header and type='ASET' for share;
  if not found then raise exception 'Akun kas pembayaran tidak aktif atau bukan akun rincian aset';end if;
 end if;
 perform public.purchase_payment_access(p_branch);
end$$;
revoke all on function public.purchase_payment_scope(uuid,uuid) from public,anon,authenticated,service_role;

-- Resolve branch mapping -> global mapping -> legacy default once, preserving the exact source.
create function public.purchase_payment_cash(p_method text,p_branch uuid,p_account uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare mapping public.payment_account_map%rowtype;account uuid:=p_account;resolved_code text;begin
 if account is null then
  select * into mapping from public.payment_account_map where metode=p_method and (branch_id=p_branch or branch_id is null) order by branch_id nulls last limit 1 for share;
  if found then
   if (select count(*) from public.payment_account_map where metode=p_method and branch_id is not distinct from mapping.branch_id)<>1 then raise exception 'Peta rekening pembayaran tidak unik';end if;
   account:=mapping.cash_account_id;
  else
   resolved_code:=case when p_method='Tunai' then '1101' else '1102' end;
   if (select count(*) from public.cash_accounts where coa_code=resolved_code)>1 then raise exception 'Rekening bawaan pembayaran tidak unik';end if;
   select id into account from public.cash_accounts where coa_code=resolved_code;
  end if;
 end if;
 perform public.purchase_payment_scope(p_branch,account);
 if account is not null then select coa_code into resolved_code from public.cash_accounts where id=account;end if;
 perform 1 from public.coa_accounts where coa_accounts.code=resolved_code and is_active and not is_header and type='ASET' for share;
 if not found then raise exception 'Akun kas pembayaran tidak aktif atau bukan akun rincian aset';end if;
 perform public.purchase_payment_access(p_branch);
 return jsonb_build_object('account_id',account,'code',resolved_code);
end$$;
revoke all on function public.purchase_payment_cash(text,uuid,uuid) from public,anon,authenticated,service_role;

-- Historical recovery uses the protected source and exact cash credit, never today's mapping.
create function public.purchase_payment_source(p_journal uuid,p_branch uuid) returns void language plpgsql security definer set search_path='' as $$
declare request public.purchase_payment_requests%rowtype;entry public.journal_entries%rowtype;
 cash_amount numeric;cash_code text;source_code text;account uuid;cash_lines integer;credits numeric;snapshot jsonb;
begin
 if (select count(*) from public.purchase_payment_requests r where r.result->>'journal_id'=p_journal::text)<>1 then raise exception 'Tautan jurnal pembayaran tidak unik';end if;
 select * into request from public.purchase_payment_requests r where r.result->>'journal_id'=p_journal::text;
 select * into entry from public.journal_entries where id=p_journal for share;
 if not found or entry.source<>'purchase-pay' or entry.branch_id is distinct from p_branch then raise exception 'Jurnal sumber tidak sesuai pembayaran';end if;
 select sum(amount-dari_uang_muka) into cash_amount from public.purchase_invoice_payments where journal_id=p_journal;
 if cash_amount is null or cash_amount<0 then raise exception 'Tautan rincian pembayaran sumber tidak lengkap';end if;
 select count(*),min(a.code),sum(l.credit) into cash_lines,cash_code,credits from public.journal_lines l join public.coa_accounts a on a.id=l.account_id where l.entry_id=p_journal and a.code not in ('2101','1303');
 if (cash_amount>0 and (cash_lines<>1 or credits is distinct from cash_amount or exists(select 1 from public.journal_lines l join public.coa_accounts a on a.id=l.account_id where l.entry_id=p_journal and a.code not in ('2101','1303') and l.debit<>0))) or (cash_amount=0 and cash_lines<>0) then raise exception 'Kredit kas sumber tidak sesuai pembayaran';end if;
 snapshot:=request.result->'cash_source';
 account:=coalesce((snapshot->>'account_id')::uuid,(request.payload->>'account_id')::uuid);
 source_code:=coalesce(snapshot->>'code',cash_code);
 if account is null and source_code is not null then
  if (select count(*) from public.cash_accounts where coa_code=source_code)>1 then raise exception 'Rekening sumber pembayaran tidak unik';end if;
  select id into account from public.cash_accounts where coa_code=source_code;
  if account is null and source_code<>(case when request.payload->>'metode'='Tunai' then '1101' else '1102' end) then raise exception 'Rekening sumber lama tidak memiliki bukti pasti';end if;
 end if;
 perform public.purchase_payment_scope(p_branch,account);
 if account is not null then
  if source_code is null then select coa_code into source_code from public.cash_accounts where id=account;
  elsif not exists(select 1 from public.cash_accounts where id=account and coa_code=source_code) then raise exception 'Akun rekening sumber sudah berubah';end if;
 end if;
 if cash_amount>0 and source_code is distinct from cash_code then raise exception 'Rekening sumber tidak cocok dengan kredit kas jurnal';end if;
 if source_code is not null then
  perform 1 from public.coa_accounts where code=source_code and is_active and not is_header and type='ASET' for share;
  if not found then raise exception 'Akun kas sumber tidak aktif';end if;
 end if;
 perform public.purchase_payment_access(p_branch);
end$$;
revoke all on function public.purchase_payment_source(uuid,uuid) from public,anon,authenticated,service_role;

-- Existing posting algorithms retained; new links and checks are written in the same transaction.
create or replace function public.pay_purchase_invoice_atomic(p_request_key text,p_invoice_id uuid,p_tanggal date,p_amount numeric,p_metode text,p_catatan text,p_account_id uuid,p_advance_id uuid,p_replaces_payment_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 inv public.purchase_invoices%rowtype; adv public.purchase_advances%rowtype;
 prior public.purchase_payment_requests%rowtype; payload jsonb; result jsonb;cash_source jsonb;
 v_po_id uuid; branch uuid; cash_code text; paid numeric; returns_left numeric:=0; residual numeric; available numeric:=0; from_advance numeric:=0;
 r record; payment_id uuid:=gen_random_uuid(); v_journal_id uuid; lines jsonb;
 rule_id uuid; approval_id uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501';end if;
 if p_request_key is null or length(p_request_key) not between 1 and 120 or p_amount is null or p_amount<>round(p_amount) or p_amount<=0 or p_amount::text in ('NaN','Infinity','-Infinity') or p_tanggal is null then raise exception 'Nominal atau identitas pembayaran tidak valid' using errcode='22023';end if;
 payload:=jsonb_build_object('invoice_id',p_invoice_id,'tanggal',p_tanggal,'amount',p_amount,'metode',p_metode,'catatan',p_catatan,'account_id',p_account_id,'advance_id',p_advance_id,'replaces_payment_id',p_replaces_payment_id);
 -- No locks are acquired on an invoice before its PO: returns use this order too.
 select i.po_id into v_po_id from public.purchase_invoices i where i.id=p_invoice_id;
 if v_po_id is not null then perform 1 from public.purchase_orders where id=v_po_id for update;end if;
 if v_po_id is not null then perform 1 from public.purchase_invoices i where i.po_id=v_po_id order by id for update;end if;
 select * into inv from public.purchase_invoices where id=p_invoice_id for update;
 if not found then raise exception 'Faktur tidak ditemukan';end if;
 branch:=inv.branch_id;if branch is null and inv.po_id is not null then select branch_id into branch from public.purchase_orders where id=inv.po_id;end if;
 perform public.purchase_payment_scope(branch,p_account_id);
 perform public.purchase_payment_period(p_tanggal,p_tanggal);
 perform pg_advisory_xact_lock(hashtext('vetos:purchase-payment:'||auth.uid()::text||':'||p_request_key)::bigint);
 select * into prior from public.purchase_payment_requests where actor_id=auth.uid() and request_key=p_request_key;
 if found then if (prior.payload||jsonb_build_object('replaces_payment_id',prior.payload->'replaces_payment_id'))<>payload then raise exception 'Permintaan pembayaran sudah digunakan dengan rincian berbeda' using errcode='22023';end if;perform public.purchase_payment_source((prior.result->>'journal_id')::uuid,branch);return prior.result;end if;
 if p_replaces_payment_id is not null then
  if not exists(select 1 from public.purchase_invoice_payments where id=p_replaces_payment_id and invoice_id=inv.id and voided_at is not null and reversal_of is null and payment_order_id is null) then raise exception 'Pembayaran pengganti tidak sesuai sumber yang dibatalkan';end if;
  if exists(select 1 from public.purchase_invoice_payments where replaces_payment_id=p_replaces_payment_id) then raise exception 'Pembayaran pengganti sudah tersimpan. Buka riwayat faktur';end if;
 end if;
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
  if adv.supplier_id is distinct from inv.supplier_id or adv.supplier_id is null then raise exception 'Uang muka milik pemasok lain';end if;
  if adv.po_id is not null and adv.po_id is distinct from inv.po_id then raise exception 'Uang muka terkait PO lain';end if;
  if adv.account_id is not null then perform public.purchase_payment_scope(branch,adv.account_id);end if;
  if adv.terpakai is distinct from (select coalesce(sum(dari_uang_muka),0) from public.purchase_invoice_payments where advance_id=adv.id) then raise exception 'Alokasi uang muka lama perlu direkonsiliasi';end if;
  from_advance:=least(p_amount,greatest(0,adv.jumlah-adv.terpakai));
  if from_advance<=0 then raise exception 'Uang muka sudah habis terpakai';end if;
  if from_advance<>round(from_advance) then raise exception 'Porsi uang muka harus rupiah bulat' using errcode='22023';end if;
 end if;
 -- Preserve approval thresholds and latest live request; consume only in this transaction.
 select id into rule_id from public.approval_rules where jenis='bayar-faktur' and is_active and p_amount>min_nilai order by min_nilai desc limit 1;
 if rule_id is not null then
  select id into approval_id from public.approval_requests where jenis='bayar-faktur' and ref_id=inv.id::text and status in ('menunggu','disetujui','ditolak') order by diajukan_at desc limit 1 for update;
  if approval_id is null or not exists(select 1 from public.approval_requests where id=approval_id and status='disetujui' and nilai>=p_amount) then raise exception 'Transaksi ini butuh persetujuan atasan';end if;
  update public.approval_requests set status='terpakai' where id=approval_id;
 end if;
 cash_source:=public.purchase_payment_cash(p_metode,branch,p_account_id);cash_code:=cash_source->>'code';
 lines:=jsonb_build_array(jsonb_build_object('code','2101','debit',round(p_amount),'credit',0));
 if round(from_advance)>0 then lines:=lines||jsonb_build_array(jsonb_build_object('code','1303','debit',0,'credit',least(round(p_amount),round(from_advance))));end if;
 if round(p_amount)>round(from_advance) then lines:=lines||jsonb_build_array(jsonb_build_object('code',cash_code,'debit',0,'credit',round(p_amount)-round(from_advance)));end if;
 insert into public.purchase_invoice_payments(id,invoice_id,tanggal,amount,metode,catatan,created_by,advance_id,dari_uang_muka,replaces_payment_id) values(payment_id,inv.id,p_tanggal,p_amount,p_metode,p_catatan,auth.uid(),p_advance_id,from_advance,p_replaces_payment_id);
 if from_advance>0 then update public.purchase_advances set terpakai=terpakai+from_advance where id=adv.id;end if;
 v_journal_id:=public.clinic_write_journal(p_tanggal,'Pembayaran faktur '||inv.no_faktur||case when from_advance>0 then ' (pakai uang muka)' else '' end,'purchase-pay',inv.no_faktur,branch,lines);
 if v_journal_id is null then raise exception 'Jurnal pembayaran belum tersimpan';end if;
 update public.purchase_invoice_payments set journal_id=v_journal_id where id=payment_id;
 result:=jsonb_build_object('payment_id',payment_id,'journal_id',v_journal_id,'no_faktur',inv.no_faktur,'cash_source',cash_source);
 perform public.purchase_payment_scope(branch,(cash_source->>'account_id')::uuid);
 insert into public.purchase_payment_requests values(auth.uid(),p_request_key,payload,result);
 return result;
end;
$$;
revoke all on function public.pay_purchase_invoice_atomic(text,uuid,date,numeric,text,text,uuid,uuid,uuid) from public,anon;
grant execute on function public.pay_purchase_invoice_atomic(text,uuid,date,numeric,text,text,uuid,uuid,uuid) to authenticated;
drop function public.pay_purchase_invoice_atomic(text,uuid,date,numeric,text,text,uuid,uuid);
-- All new payments use the locked RPC; read policies remain unchanged.
revoke insert,update,delete on public.purchase_invoice_payments from authenticated;

-- Aggregate payment orders keep their existing one-journal-per-order source/ref.
create or replace function public.pay_purchase_payment_order_atomic(p_request_key text,p_order_id uuid,p_tanggal date,p_metode text,p_account_id uuid,p_expected_revision integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 ord public.payment_orders%rowtype; prior public.purchase_payment_requests%rowtype;
 payload jsonb; result jsonb;cash_source jsonb; role_name text; r record; other record; branch uuid;
 order_before jsonb;payment_ids jsonb;cash_code text; v_total numeric:=0; paid numeric; ret numeric; avail numeric; residual numeric; v_journal_id uuid;
begin
 perform public.purchase_payment_access(null);
 select role::text into role_name from public.profiles where id=auth.uid() and is_active;
 if role_name not in ('OWNER','ADMIN') then raise exception 'Hanya pemilik/admin yang dapat membayar perintah bayar' using errcode='42501';end if;
 if p_request_key is null or length(p_request_key) not between 1 and 120 or p_tanggal is null then raise exception 'Identitas pembayaran tidak valid' using errcode='22023';end if;
 payload:=jsonb_build_object('order_id',p_order_id,'tanggal',p_tanggal,'metode',p_metode,'account_id',p_account_id,'revision',p_expected_revision);
 select * into ord from public.payment_orders where id=p_order_id for update;
 if not found then raise exception 'Perintah bayar tidak ditemukan';end if;
 perform 1 from public.payment_order_items where order_id=ord.id order by id for update;
 if not exists(select 1 from public.payment_order_items where order_id=ord.id) then raise exception 'Perintah bayar tidak punya baris faktur';end if;
 -- All POs first, sorted; then all invoices in those POs, sorted, including direct invoices.
 perform 1 from public.purchase_orders p where p.id in(select i.po_id from public.payment_order_items b join public.purchase_invoices i on i.id=b.invoice_id where b.order_id=ord.id) order by p.id for update;
 perform 1 from public.purchase_invoices i where i.po_id in(select i2.po_id from public.payment_order_items b join public.purchase_invoices i2 on i2.id=b.invoice_id where b.order_id=ord.id) or i.id in(select invoice_id from public.payment_order_items where order_id=ord.id) order by i.id for update;
 perform public.purchase_payment_period(p_tanggal,p_tanggal);
 perform pg_advisory_xact_lock(hashtext('vetos:purchase-payment:'||auth.uid()::text||':'||p_request_key)::bigint);
 select * into prior from public.purchase_payment_requests where actor_id=auth.uid() and request_key=p_request_key;
 if found then
  if (prior.payload||jsonb_build_object('revision',coalesce(prior.payload->'revision','0'::jsonb)))<>payload then raise exception 'Permintaan pembayaran sudah digunakan dengan rincian berbeda' using errcode='22023';end if;
  for r in select coalesce(i.branch_id,p.branch_id) branch_id from public.payment_order_items b join public.purchase_invoices i on i.id=b.invoice_id left join public.purchase_orders p on p.id=i.po_id where b.order_id=ord.id loop perform public.purchase_payment_scope(r.branch_id,p_account_id);end loop;
  select branch_id into branch from public.journal_entries where id=(prior.result->>'journal_id')::uuid;
  perform public.purchase_payment_source((prior.result->>'journal_id')::uuid,branch);
  return prior.result;
 end if;
 if (select count(distinct coalesce(coalesce(i.branch_id,p.branch_id)::text,'global')) from public.payment_order_items b join public.purchase_invoices i on i.id=b.invoice_id left join public.purchase_orders p on p.id=i.po_id where b.order_id=ord.id)<>1 then raise exception 'Perintah bayar harus satu cabang';end if;
 if ord.revision is distinct from p_expected_revision then raise exception 'Perintah bayar sudah berubah. Muat ulang';end if;
 order_before:=to_jsonb(ord);
 if exists(select 1 from public.purchase_invoice_payments where payment_order_id=ord.id and reversal_of is null and voided_at is null) then raise exception 'Perintah bayar sudah memiliki pembayaran aktif';end if;
 if ord.status<>'disetujui' then raise exception 'Perintah bayar belum disetujui';end if;
 perform 1 from public.accounting_locks where id for share;
 if exists(select 1 from public.accounting_locks where id and p_tanggal<=closed_until) then raise exception 'Periode akuntansi sudah ditutup';end if;

 for r in select i.id,i.total,i.po_id,coalesce(i.branch_id,p.branch_id) branch_id,sum(b.jumlah) amount from public.payment_order_items b join public.purchase_invoices i on i.id=b.invoice_id left join public.purchase_orders p on p.id=i.po_id where b.order_id=ord.id group by i.id,p.branch_id order by i.id loop
  perform public.purchase_payment_scope(r.branch_id,p_account_id);
  if branch is null then branch:=r.branch_id;elsif branch is distinct from r.branch_id then raise exception 'Perintah bayar harus satu cabang';end if;
  if not exists(select 1 from public.purchase_invoices where id=r.id and supplier_id=ord.supplier_id) then raise exception 'Pemasok faktur tidak sesuai perintah bayar';end if;
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
 cash_source:=public.purchase_payment_cash(p_metode,branch,p_account_id);cash_code:=cash_source->>'code';
 v_journal_id:=public.clinic_write_journal(p_tanggal,'Pembayaran hutang lewat '||ord.no_pp,'purchase-pay',ord.no_pp,branch,jsonb_build_array(jsonb_build_object('code','2101','debit',v_total,'credit',0),jsonb_build_object('code',cash_code,'debit',0,'credit',v_total)));
 if v_journal_id is null then raise exception 'Jurnal pembayaran belum tersimpan';end if;
 update public.purchase_invoice_payments set journal_id=v_journal_id where payment_order_id=ord.id and voided_at is null and reversal_of is null;
 select jsonb_agg(id order by id) into payment_ids from public.purchase_invoice_payments where journal_id=v_journal_id;
 update public.payment_orders set status='dibayar',paid_at=now(),revision=revision+1 where id=ord.id;
 result:=jsonb_build_object('order_id',ord.id,'no_pp',ord.no_pp,'journal_id',v_journal_id,'payment_ids',payment_ids,'order_before',order_before,'cash_source',cash_source);
 perform public.purchase_payment_scope(branch,(cash_source->>'account_id')::uuid);
 insert into public.purchase_payment_requests values(auth.uid(),p_request_key,payload,result);
 return result;
end;$$;
revoke all on function public.pay_purchase_payment_order_atomic(text,uuid,date,text,uuid,integer) from public,anon;
grant execute on function public.pay_purchase_payment_order_atomic(text,uuid,date,text,uuid,integer) to authenticated;

drop function public.pay_purchase_payment_order_atomic(text,uuid,date,text,uuid);

-- Lock all source invoices after their POs, shared with payment and return posting.
create function public.mutate_purchase_payment_order(p_request_key text,p_action text,p_order_id uuid,p_expected_revision integer,p_header jsonb,p_items jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ord public.payment_orders%rowtype;prior public.purchase_payment_order_requests%rowtype;
 payload jsonb;result jsonb;actor_role text;row record;v_total numeric:=0;v_supplier uuid;v_branch uuid;
 reserved numeric;available numeric;paid numeric;ret numeric;residual numeric;other record;
 v_id uuid:=gen_random_uuid();v_no text;prefix text;seq bigint;today date:=(now() at time zone 'Asia/Jakarta')::date;
begin
 perform public.purchase_payment_access(null);
 select role::text into actor_role from public.profiles where id=auth.uid() and is_active;
 if actor_role not in ('OWNER','ADMIN','FINANCE') or (p_action<>'create' and actor_role not in ('OWNER','ADMIN')) then raise exception 'Akses perintah bayar ditolak' using errcode='42501';end if;
 if p_action is null or p_action not in ('create','approve','cancel') or length(btrim(coalesce(p_request_key,''))) not between 1 and 120 or jsonb_typeof(p_header) is distinct from 'object' or jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Identitas perintah bayar tidak valid';end if;
 payload:=jsonb_build_object('action',p_action,'order_id',p_order_id,'revision',p_expected_revision,'header',p_header,'items',p_items);
 perform pg_advisory_xact_lock(hashtextextended('vetos:purchase-order-payment:'||auth.uid()::text||':'||p_request_key,0));
 if p_action='create' then
  if jsonb_array_length(p_items)=0 or (select count(*)<>count(distinct x->>'invoice_id') from jsonb_array_elements(p_items)x) then raise exception 'Pilih faktur yang unik';end if;
  v_supplier:=(p_header->>'supplier_id')::uuid;
  if not exists(select 1 from public.suppliers where id=v_supplier) then raise exception 'Pemasok tidak ditemukan';end if;
 else
  select * into ord from public.payment_orders where id=p_order_id for update;
  if not found then raise exception 'Perintah bayar tidak ditemukan';end if;
  v_supplier:=ord.supplier_id;
  p_items:=(select jsonb_agg(jsonb_build_object('invoice_id',invoice_id,'jumlah',jumlah) order by invoice_id) from public.payment_order_items where order_id=ord.id);
  if p_items is null then raise exception 'Perintah bayar kosong';end if;
 end if;
 perform 1 from public.purchase_orders where id in(select i.po_id from public.purchase_invoices i join jsonb_array_elements(p_items)x on i.id=(x->>'invoice_id')::uuid) order by id for update;
 perform 1 from public.purchase_invoices where po_id in(select i.po_id from public.purchase_invoices i join jsonb_array_elements(p_items)x on i.id=(x->>'invoice_id')::uuid) or id in(select (x->>'invoice_id')::uuid from jsonb_array_elements(p_items)x) order by id for update;
 if (select count(*) from public.purchase_invoices where id in(select (x->>'invoice_id')::uuid from jsonb_array_elements(p_items)x))<>jsonb_array_length(p_items) then raise exception 'Faktur tidak ditemukan';end if;
 if (select count(distinct coalesce(coalesce(i.branch_id,p.branch_id)::text,'global')) from jsonb_array_elements(p_items)x join public.purchase_invoices i on i.id=(x->>'invoice_id')::uuid left join public.purchase_orders p on p.id=i.po_id)<>1 then raise exception 'Perintah bayar harus satu cabang';end if;
 for row in select i.*,coalesce(i.branch_id,p.branch_id) invoice_branch,(x->>'jumlah')::numeric amount from jsonb_array_elements(p_items)x join public.purchase_invoices i on i.id=(x->>'invoice_id')::uuid left join public.purchase_orders p on p.id=i.po_id order by i.id loop
  perform public.purchase_payment_scope(row.invoice_branch);
  if row.supplier_id is distinct from v_supplier then raise exception 'Faktur bukan milik pemasok ini';end if;
  if v_branch is null then v_branch:=row.invoice_branch;elsif v_branch is distinct from row.invoice_branch then raise exception 'Perintah bayar harus satu cabang';end if;
 end loop;
 select * into prior from public.purchase_payment_order_requests where actor_id=auth.uid() and request_key=p_request_key;
 if found then if prior.payload is distinct from payload then raise exception 'Permintaan sudah digunakan dengan rincian berbeda';end if;return prior.result;end if;
 if p_action<>'create' and ord.revision is distinct from p_expected_revision then raise exception 'Perintah bayar sudah berubah. Muat ulang';end if;
 if p_action='approve' and ord.status<>'draft' or p_action='cancel' and ord.status not in ('draft','disetujui') then raise exception 'Status perintah bayar tidak bisa diubah';end if;
 if p_action in ('create','approve') then
  for row in select i.*,(x->>'jumlah')::numeric amount from jsonb_array_elements(p_items)x join public.purchase_invoices i on i.id=(x->>'invoice_id')::uuid order by i.id loop
   if row.amount is null or row.amount<=0 or row.amount<>round(row.amount) or row.amount::text in ('NaN','Infinity','-Infinity') then raise exception 'Nominal pembayaran harus rupiah bulat positif';end if;
   if row.po_id is null then select greatest(0,row.total-coalesce(sum(amount),0)) into available from public.purchase_invoice_payments where invoice_id=row.id;
   else
    select coalesce(sum(total),0) into ret from public.purchase_returns where po_id=row.po_id;
    for other in select id,total from public.purchase_invoices where po_id=row.po_id order by jatuh_tempo,id loop
     select coalesce(sum(amount),0) into paid from public.purchase_invoice_payments where invoice_id=other.id;
     residual:=greatest(0,other.total-paid);available:=greatest(0,residual-ret);ret:=greatest(0,ret-residual);
     if other.id=row.id then exit;end if;
    end loop;
   end if;
   select coalesce(sum(b.jumlah),0) into reserved from public.payment_order_items b join public.payment_orders o on o.id=b.order_id where b.invoice_id=row.id and o.status in ('draft','disetujui') and o.id is distinct from ord.id;
   if row.amount>available-reserved then raise exception 'Nominal melebihi sisa faktur atau sudah diajukan';end if;
   v_total:=v_total+row.amount;
  end loop;
 end if;
 if p_action='create' then
  prefix:='PP.'||to_char(today,'YYYY.MM')||'.';
  perform pg_advisory_xact_lock(hashtextextended('vetos:payment-order-number:'||prefix,0));
  select coalesce(max(substring(no_pp,length(prefix)+1)::bigint),0)+1 into seq from public.payment_orders where left(no_pp,length(prefix))=prefix and substring(no_pp,length(prefix)+1)~'^[0-9]+$';
  v_no:=prefix||lpad(seq::text,greatest(5,length(seq::text)),'0');
  insert into public.payment_orders(id,no_pp,supplier_id,tanggal,rencana_bayar,total,catatan,created_by) values(v_id,v_no,v_supplier,today,nullif(p_header->>'rencana_bayar','')::date,v_total,nullif(p_header->>'catatan',''),auth.uid());
  insert into public.payment_order_items(order_id,invoice_id,jumlah) select v_id,(x->>'invoice_id')::uuid,(x->>'jumlah')::numeric from jsonb_array_elements(p_items)x;
 else
  v_id:=ord.id;v_no:=ord.no_pp;
  if p_action='approve' then update public.payment_orders set status='disetujui',approved_by=auth.uid(),approved_at=now(),revision=revision+1 where id=ord.id;
  else update public.payment_orders set status='batal',revision=revision+1 where id=ord.id;end if;
 end if;
 result:=jsonb_build_object('order_id',v_id,'no_pp',v_no,'before',to_jsonb(ord),'after',(select to_jsonb(o) from public.payment_orders o where id=v_id));
 perform public.purchase_payment_scope(v_branch);
 insert into public.purchase_payment_order_requests values(auth.uid(),p_request_key,payload,result);
 return result;
end$$;
revoke all on function public.mutate_purchase_payment_order(text,text,uuid,integer,jsonb,jsonb) from public,anon,service_role;
grant execute on function public.mutate_purchase_payment_order(text,text,uuid,integer,jsonb,jsonb) to authenticated;

create function public.cancel_purchase_payment(p_payment_id uuid,p_expected_revision integer,p_request_key text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare pay public.purchase_invoice_payments%rowtype;ord public.payment_orders%rowtype;original public.journal_entries%rowtype;
 prior public.purchase_payment_cancellation_requests%rowtype;posting public.purchase_payment_requests%rowtype;adv public.purchase_advances%rowtype;
 payload jsonb;result jsonb;before_value jsonb;linked_ids jsonb;row record;branch uuid;
 v_order uuid;v_invoice uuid;v_po uuid;total numeric;advance_total numeric;debit_total numeric;credit_total numeric;ap_total numeric;advance_credit numeric;
 audit uuid:=gen_random_uuid();reversal uuid:=gen_random_uuid();today date:=(now() at time zone 'Asia/Jakarta')::date;
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated' then raise exception 'Sesi login diperlukan' using errcode='42501';end if;
 if p_payment_id is null or p_expected_revision is null or p_expected_revision<0 or length(btrim(coalesce(p_request_key,''))) not between 1 and 120 or length(btrim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'Identitas atau alasan pembatalan tidak valid';end if;
 payload:=jsonb_build_object('payment_id',p_payment_id,'revision',p_expected_revision,'reason',btrim(p_reason));
 perform pg_advisory_xact_lock(hashtextextended('vetos:purchase-payment-cancel:'||auth.uid()::text||':'||p_request_key,0));
 select payment_order_id,invoice_id into v_order,v_invoice from public.purchase_invoice_payments where id=p_payment_id;
 if not found then raise exception 'Pembayaran tidak ditemukan';end if;
 if v_order is not null then
  select * into ord from public.payment_orders where id=v_order for update;
  perform 1 from public.payment_order_items where order_id=v_order order by id for update;
 end if;
 select po_id into v_po from public.purchase_invoices where id=v_invoice;
 perform 1 from public.purchase_orders where id=v_po or id in(select i.po_id from public.purchase_invoice_payments p join public.purchase_invoices i on i.id=p.invoice_id where p.payment_order_id=v_order) order by id for update;
 perform 1 from public.purchase_invoices where id=v_invoice or po_id=v_po or po_id in(select i.po_id from public.purchase_invoice_payments p join public.purchase_invoices i on i.id=p.invoice_id where p.payment_order_id=v_order) or id in(select invoice_id from public.purchase_invoice_payments where payment_order_id=v_order) order by id for update;
 select * into pay from public.purchase_invoice_payments where id=p_payment_id for update;
 perform 1 from public.profiles where id=auth.uid() and is_active and role='OWNER' for share;
 if not found then raise exception 'Hanya Owner aktif dapat membatalkan pembayaran' using errcode='42501';end if;
 select coalesce(i.branch_id,p.branch_id) into branch from public.purchase_invoices i left join public.purchase_orders p on p.id=i.po_id where i.id=pay.invoice_id;
 perform public.purchase_payment_scope(branch);
 perform public.purchase_payment_period(pay.tanggal,today);
 if pay.journal_id is null then raise exception 'Jurnal pembayaran lama tidak memiliki tautan pasti; rekonsiliasi diperlukan';end if;
 select * into original from public.journal_entries where id=pay.journal_id for update;
 if not found then raise exception 'Jurnal pembayaran sumber tidak ditemukan';end if;
 perform public.purchase_payment_period(original.tanggal,today);
 perform 1 from public.purchase_invoice_payments where journal_id=original.id order by id for update;
 for row in select coalesce(i.branch_id,o.branch_id) invoice_branch from public.purchase_invoice_payments p join public.purchase_invoices i on i.id=p.invoice_id left join public.purchase_orders o on o.id=i.po_id where p.journal_id=original.id loop
  perform public.purchase_payment_scope(row.invoice_branch);
  if row.invoice_branch is distinct from branch then raise exception 'Pembayaran sumber mencampur cabang';end if;
 end loop;
 perform public.purchase_payment_source(original.id,branch);
 select * into prior from public.purchase_payment_cancellation_requests where actor_id=auth.uid() and request_key=p_request_key;
 if found then if prior.payload is distinct from payload then raise exception 'Permintaan sudah digunakan dengan rincian berbeda';end if;return prior.result;end if;
 if pay.reversal_of is not null or pay.voided_at is not null or pay.revision<>p_expected_revision then raise exception 'Pembayaran sudah berubah atau dibatalkan. Muat ulang';end if;
 if original.source<>'purchase-pay' or original.branch_id is distinct from branch or original.tanggal<>pay.tanggal or original.voided_at is not null then raise exception 'Jurnal sumber tidak sesuai pembayaran';end if;
 if (select count(*) from public.purchase_payment_requests request where request.result->>'journal_id'=original.id::text)<>1 then raise exception 'Tautan jurnal pembayaran tidak unik';end if;
 select * into posting from public.purchase_payment_requests request where request.result->>'journal_id'=original.id::text;
 if v_order is null then
  if posting.result->>'payment_id' is distinct from pay.id::text or posting.payload->>'invoice_id' is distinct from pay.invoice_id::text
   or original.source_ref is distinct from (select no_faktur from public.purchase_invoices where id=pay.invoice_id)
   or (select count(*) from public.purchase_invoice_payments where journal_id=original.id)<>1 then raise exception 'Pembayaran sumber tidak cocok dengan bukti simpan';end if;
 else
  select jsonb_agg(id order by id) into linked_ids from public.purchase_invoice_payments where journal_id=original.id;
  if posting.result->>'order_id' is distinct from v_order::text or posting.result->'payment_ids' is distinct from linked_ids
   or posting.result->'order_before'->>'status' is distinct from 'disetujui' or ord.status<>'dibayar'
   or ord.revision is distinct from (posting.result->'order_before'->>'revision')::integer+1
   or original.source_ref is distinct from ord.no_pp then raise exception 'Bukti perintah bayar tidak lengkap atau sudah berubah';end if;
  if exists(select 1 from public.purchase_invoice_payments where payment_order_id=v_order and voided_at is null and reversal_of is null and journal_id is distinct from original.id)
   or exists(select 1 from public.purchase_invoice_payments where journal_id=original.id and payment_order_id is distinct from v_order) then raise exception 'Pembayaran perintah bayar tidak dapat dipisahkan';end if;
 end if;
 if exists(select 1 from public.purchase_invoice_payments where journal_id=original.id and (voided_at is not null or reversal_of is not null or tanggal<>original.tanggal or amount<>round(amount) or dari_uang_muka<>round(dari_uang_muka))) then raise exception 'Rincian pembayaran sumber tidak valid';end if;
 select sum(amount),sum(dari_uang_muka) into total,advance_total from public.purchase_invoice_payments where journal_id=original.id;
 perform 1 from public.journal_lines where entry_id=original.id order by id for update;
 select sum(l.debit),sum(l.credit),coalesce(sum(l.debit-l.credit) filter(where a.code='2101'),0),coalesce(sum(l.credit-l.debit) filter(where a.code='1303'),0)
 into debit_total,credit_total,ap_total,advance_credit from public.journal_lines l join public.coa_accounts a on a.id=l.account_id where l.entry_id=original.id;
 if total is null or debit_total is distinct from total or credit_total is distinct from total or ap_total is distinct from total or advance_credit is distinct from advance_total
  or exists(select 1 from public.journal_lines where entry_id=original.id and (debit<0 or credit<0 or debit<>round(debit) or credit<>round(credit) or (debit>0 and credit>0))) then raise exception 'Jurnal pembayaran tidak lengkap atau tidak cocok dengan alokasi';end if;
 -- Posting locks the advance before writing its journal; cancellation must use the same order.
 perform 1 from public.purchase_advances where id in(select advance_id from public.purchase_invoice_payments where journal_id=original.id and dari_uang_muka>0) order by id for update;
 lock table public.journal_entries,public.journal_lines in share row exclusive mode;
 perform public.purchase_payment_source(original.id,branch);
 -- Bank reconciliation freezes the account balance through its statement date.
 if exists(select 1 from public.bank_reconciliations r join public.cash_accounts a on a.id=r.cash_account_id join public.coa_accounts c on c.code=coalesce(r.bank_coa_code,a.coa_code) join public.journal_lines l on l.account_id=c.id
  where l.entry_id=original.id and r.voided_at is null and r.tanggal>=original.tanggal) then raise exception 'Rekonsiliasi bank sudah mencakup pembayaran. Koreksi rekonsiliasi dahulu';end if;
 before_value:=jsonb_build_object('payments',(select jsonb_agg(to_jsonb(p) order by id) from public.purchase_invoice_payments p where journal_id=original.id),'order',to_jsonb(ord),'journal',to_jsonb(original),'lines',(select jsonb_agg(to_jsonb(l) order by id) from public.journal_lines l where entry_id=original.id));
 for row in select advance_id,sum(dari_uang_muka) used from public.purchase_invoice_payments where journal_id=original.id and dari_uang_muka>0 group by advance_id order by advance_id loop
  select * into adv from public.purchase_advances where id=row.advance_id;
  if not found or adv.status<>'aktif' or adv.terpakai<row.used or adv.terpakai is distinct from (select coalesce(sum(dari_uang_muka),0) from public.purchase_invoice_payments where advance_id=adv.id) then raise exception 'Alokasi uang muka sudah berubah; rekonsiliasi diperlukan';end if;
  if adv.account_id is not null then perform public.purchase_payment_scope(branch,adv.account_id);end if;
  if exists(select 1 from public.purchase_invoice_payments p join public.purchase_invoices i on i.id=p.invoice_id where p.journal_id=original.id and p.advance_id=adv.id and (i.supplier_id is distinct from adv.supplier_id or (adv.po_id is not null and adv.po_id is distinct from i.po_id))) then raise exception 'Sumber uang muka tidak sesuai faktur';end if;
  update public.purchase_advances set terpakai=terpakai-row.used where id=adv.id;
 end loop;
 insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id) values(reversal,public.sales_next_number('JRN',today),today,'Pembatalan pembayaran hutang','purchase-pay-void',audit::text,branch);
 insert into public.journal_lines(entry_id,account_id,debit,credit) select reversal,account_id,credit,debit from public.journal_lines where entry_id=original.id;
 insert into public.purchase_invoice_payments(invoice_id,tanggal,amount,metode,catatan,created_by,advance_id,dari_uang_muka,payment_order_id,reversal_of,journal_id)
 select invoice_id,today,-amount,metode,btrim(p_reason),auth.uid(),advance_id,-dari_uang_muka,payment_order_id,id,reversal from public.purchase_invoice_payments where journal_id=original.id;
 update public.purchase_invoice_payments set voided_at=now(),revision=revision+1 where journal_id=original.id;
 if v_order is not null then update public.payment_orders set status='disetujui',paid_at=null,revision=revision+1 where id=v_order;end if;
 insert into public.purchase_payment_cancellations(id,payment_id,payment_order_id,reason,before_value,original_journal_id,reversal_journal_id,created_by) values(audit,pay.id,v_order,btrim(p_reason),before_value,original.id,reversal,auth.uid());
 result:=jsonb_build_object('payment_id',pay.id,'invoice_id',pay.invoice_id,'order_id',v_order,'cancellation_id',audit,'reversal_journal_id',reversal);
 perform public.purchase_payment_source(original.id,branch);
 insert into public.purchase_payment_cancellation_requests values(auth.uid(),p_request_key,payload,result);
 return result;
end$$;
revoke all on function public.cancel_purchase_payment(uuid,integer,text,text) from public,anon,service_role;
grant execute on function public.cancel_purchase_payment(uuid,integer,text,text) to authenticated;

-- Recovery reuses current authorization/period checks; it never posts a new cancellation.
create function public.get_purchase_payment_cancellation(p_payment_id uuid,p_request_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.purchase_payment_cancellation_requests%rowtype;begin
 perform public.purchase_payment_access(null);
 if not exists(select 1 from public.profiles where id=auth.uid() and is_active and role='OWNER') then raise exception 'Hanya Owner aktif dapat memeriksa koreksi' using errcode='42501';end if;
 select * into prior from public.purchase_payment_cancellation_requests where actor_id=auth.uid() and request_key=p_request_key;
 if not found then return null;end if;
 if prior.payload->>'payment_id' is distinct from p_payment_id::text then raise exception 'Permintaan bukan untuk pembayaran ini';end if;
 return public.cancel_purchase_payment(p_payment_id,(prior.payload->>'revision')::integer,p_request_key,prior.payload->>'reason');
end$$;
revoke all on function public.get_purchase_payment_cancellation(uuid,text) from public,anon,service_role;
grant execute on function public.get_purchase_payment_cancellation(uuid,text) to authenticated;

create or replace function public.recover_purchase_payment(p_request_key text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.purchase_payment_requests%rowtype;branch uuid;begin
 perform public.purchase_payment_access(null);
 select * into prior from public.purchase_payment_requests where actor_id=auth.uid() and request_key=p_request_key;
 if not found then return null;end if;
 if not (prior.payload ? 'invoice_id') then raise exception 'Jenis permintaan pembayaran berbeda' using errcode='22023';end if;
 -- Older requests predate the optional replacement link.
 if (prior.payload||jsonb_build_object('replaces_payment_id',prior.payload->'replaces_payment_id')) is distinct from (p_payload||jsonb_build_object('replaces_payment_id',p_payload->'replaces_payment_id')) then raise exception 'Permintaan pembayaran sudah digunakan dengan rincian berbeda' using errcode='22023';end if;
 select coalesce(i.branch_id,p.branch_id) into branch from public.purchase_invoices i left join public.purchase_orders p on p.id=i.po_id where i.id=(prior.payload->>'invoice_id')::uuid;
 if not found then raise exception 'Faktur hasil pembayaran tidak ditemukan';end if;
 perform public.purchase_payment_scope(branch,(prior.payload->>'account_id')::uuid);
 perform public.purchase_payment_period((prior.payload->>'tanggal')::date,(prior.payload->>'tanggal')::date);
 perform public.purchase_payment_source((prior.result->>'journal_id')::uuid,branch);
 return prior.result;
end$$;

-- Keep existing write architecture, but enforce source branch isolation for payment readers.
create policy purchase_invoice_branch_read on public.purchase_invoices as restrictive for select to authenticated using(
 public.user_can_access_branch(coalesce(branch_id,(select p.branch_id from public.purchase_orders p where p.id=po_id)))
);
create policy purchase_invoice_item_branch_read on public.purchase_invoice_items as restrictive for select to authenticated using(
 exists(select 1 from public.purchase_invoices i where i.id=invoice_id)
);
drop policy pinvp_all on public.purchase_invoice_payments;
create policy purchase_payment_read on public.purchase_invoice_payments for select to authenticated using(
 exists(select 1 from public.purchase_invoices i where i.id=invoice_id)
);
create function public.purchase_payment_order_visible(p_order uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and is_active)
 and exists(select 1 from public.payment_order_items where order_id=p_order)
 and not exists(select 1 from public.payment_order_items b join public.purchase_invoices i on i.id=b.invoice_id left join public.purchase_orders p on p.id=i.po_id where b.order_id=p_order and not public.user_can_access_branch(coalesce(i.branch_id,p.branch_id)))
$$;
revoke all on function public.purchase_payment_order_visible(uuid) from public,anon,service_role;
grant execute on function public.purchase_payment_order_visible(uuid) to authenticated;
drop policy po_pay_all on public.payment_orders;
drop policy po_pay_item_all on public.payment_order_items;
create policy purchase_payment_order_read on public.payment_orders for select to authenticated using(public.purchase_payment_order_visible(id));
create policy purchase_payment_order_item_read on public.payment_order_items for select to authenticated using(public.purchase_payment_order_visible(order_id));
