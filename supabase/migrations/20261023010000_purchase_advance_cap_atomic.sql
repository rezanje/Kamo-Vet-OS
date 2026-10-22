-- New advances only: exact request receipt, PO-serialized cap and atomic source/journal.
-- Existing advances, allocations, PO valuation and cancellation/refund semantics are not rewritten.
create table public.purchase_advance_requests (
 actor_id uuid not null references public.profiles(id),request_key text not null check(length(request_key) between 1 and 120),
 payload jsonb not null,result jsonb not null,branch_id uuid references public.branches(id),created_at timestamptz not null default now(),
 primary key(actor_id,request_key)
);
alter table public.purchase_advance_requests enable row level security;
revoke all on public.purchase_advance_requests from public,anon,authenticated,service_role;

-- Row-version conflict also protects repeatable-read snapshots after waiting for
-- the unchanged PO row. No amount counter or historical PO value is rewritten.
create table public.purchase_advance_capacity_locks (
 po_id uuid primary key references public.purchase_orders(id),epoch bigint not null default 0
);
alter table public.purchase_advance_capacity_locks enable row level security;
revoke all on public.purchase_advance_capacity_locks from public,anon,authenticated,service_role;

create function public.purchase_advance_access(p_branch uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated' then raise exception 'Sesi login diperlukan' using errcode='42501';end if;
 perform 1 from public.profiles where id=auth.uid() and is_active and role in('OWNER','ADMIN','FINANCE') for share;
 if not found then raise exception 'Hanya OWNER/ADMIN/FINANCE aktif yang boleh mencatat uang muka' using errcode='42501';end if;
 perform public.purchase_payment_access(p_branch);
end$$;
revoke all on function public.purchase_advance_access(uuid) from public,anon,authenticated,service_role;

-- A legacy status alone is not proof that cash was returned. Only a unique,
-- exact source/reversal pair may release its PO capacity; no history is repaired.
create function public.purchase_advance_refund_proven(p_advance uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((
  select a.status='batal' and a.terpakai=0 and a.jumlah::text not in('NaN','Infinity','-Infinity') and a.jumlah>0 and a.jumlah=trunc(a.jumlah)
   and a.terpakai=(select coalesce(sum(dari_uang_muka),0) from public.purchase_invoice_payments where advance_id=a.id)
   and (select count(*) from public.journal_entries where source='purchase-advance' and source_ref=a.no_um)=1
   and (select count(*) from public.journal_entries where source='purchase-advance-void' and source_ref=a.no_um)=1
   and o.branch_id is not distinct from v.branch_id
   and (a.po_id is null or o.branch_id is not distinct from (select branch_id from public.purchase_orders where id=a.po_id))
   and (select count(*)=2 and sum(debit)=a.jumlah and sum(credit)=a.jumlah
     and count(*)filter(where debit=a.jumlah and credit=0 and account_id=(select id from public.coa_accounts where code='1303'))=1
     and count(*)filter(where credit=a.jumlah and debit=0 and account_id<>(select id from public.coa_accounts where code='1303'))=1
     from public.journal_lines where entry_id=o.id)
   and (select count(*)=2 and sum(debit)=a.jumlah and sum(credit)=a.jumlah from public.journal_lines where entry_id=v.id)
   and not exists(select 1 from public.journal_lines where entry_id=v.id and (debit<0 or credit<0 or (debit>0 and credit>0)))
   and not exists(select account_id from public.journal_lines where entry_id in(o.id,v.id)
     group by account_id having sum(debit)<>sum(credit))
  from public.purchase_advances a
  join public.journal_entries o on o.source='purchase-advance' and o.source_ref=a.no_um
  join public.journal_entries v on v.source='purchase-advance-void' and v.source_ref=a.no_um
  where a.id=p_advance limit 1
 ),false)
$$;
revoke all on function public.purchase_advance_refund_proven(uuid) from public,anon,authenticated,service_role;

create or replace function public.guard_purchase_advance_parent() returns trigger
language plpgsql security invoker set search_path='' as $$
declare po public.purchase_orders%rowtype;used numeric;
begin
 if new.po_id is null or new.status<>'aktif' then return new;end if;
 select * into po from public.purchase_orders where id=new.po_id for update;
 if not found then raise exception 'PO uang muka tidak ditemukan';end if;
 if po.status not in('Draft','Dipesan') then raise exception 'PO uang muka sudah tidak aktif' using errcode='55000';end if;
 if po.supplier_id is not null and new.supplier_id is distinct from po.supplier_id then raise exception 'Pemasok uang muka tidak sesuai PO' using errcode='22023';end if;
 insert into public.purchase_advance_capacity_locks(po_id)values(po.id)
  on conflict(po_id)do update set epoch=public.purchase_advance_capacity_locks.epoch+1;
 if exists(select 1 from public.purchase_advances where po_id=po.id and status='batal' and not public.purchase_advance_refund_proven(id)) then
  raise exception 'Pembatalan DP lama belum memiliki bukti pengembalian lengkap; rekonsiliasi sumber PO dahulu' using errcode='55000';end if;
 select coalesce(sum(jumlah),0) into used from public.purchase_advances where po_id=po.id and status='aktif' and id<>new.id;
 if po.total is null or po.total::text in('NaN','Infinity','-Infinity') or po.total<=0 or used+new.jumlah>po.total then
  raise exception 'Nominal melebihi sisa batas DP PO (nilai PO %, DP aktif %, sisa %)',po.total,used,greatest(0,po.total-used) using errcode='22003';
 end if;
 return new;
end$$;
drop trigger purchase_advance_parent_guard on public.purchase_advances;
create trigger purchase_advance_parent_guard before insert or update of po_id,supplier_id,jumlah,status on public.purchase_advances
 for each row execute function public.guard_purchase_advance_parent();

-- Keep protected allocation paths intact. Source financial fields and status
-- require the atomic creation/cancellation paths, including legacy advances.
create function public.guard_purchase_advance_source() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user in('authenticated','anon','service_role') then
  if tg_op in('INSERT','DELETE') then raise exception 'Uang muka baru hanya melalui posting atomik' using errcode='42501';end if;
  if (new.no_um,new.supplier_id,new.po_id,new.tanggal,new.jumlah,new.metode,new.account_id,new.created_by)
   is distinct from (old.no_um,old.supplier_id,old.po_id,old.tanggal,old.jumlah,old.metode,old.account_id,old.created_by)
   or new.status is distinct from old.status then
   raise exception 'Rincian uang muka tidak boleh diubah langsung' using errcode='42501';
  end if;
 end if;
 return coalesce(new,old);
end$$;
revoke all on function public.guard_purchase_advance_source() from public,anon,authenticated,service_role;
create trigger purchase_advance_source_guard before insert or update or delete on public.purchase_advances for each row execute function public.guard_purchase_advance_source();

create function public.guard_purchase_advance_journal() returns trigger language plpgsql set search_path='' as $$
declare protected boolean;
begin
 if current_user in('authenticated','anon','service_role') then
  if tg_table_name='journal_entries' then protected:=new.source in('purchase-advance','purchase-advance-void') or old.source in('purchase-advance','purchase-advance-void');
  else select exists(select 1 from public.journal_entries where id in(new.entry_id,old.entry_id) and source in('purchase-advance','purchase-advance-void')) into protected;end if;
  if protected then raise exception 'Jurnal uang muka hanya melalui posting atomik' using errcode='42501';end if;
 end if;return coalesce(new,old);
end$$;
revoke all on function public.guard_purchase_advance_journal() from public,anon,authenticated,service_role;
create trigger purchase_advance_entry_guard before insert or update or delete on public.journal_entries for each row execute function public.guard_purchase_advance_journal();
create trigger purchase_advance_line_guard before insert or update or delete on public.journal_lines for each row execute function public.guard_purchase_advance_journal();

create function public.get_purchase_advance_result(p_request_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.purchase_advance_requests%rowtype;
begin
 -- Do not hold the profile while waiting for an in-flight request: its PO
 -- may be held by a revision that must update-lock that same profile.
 if auth.uid() is null or auth.role() is distinct from 'authenticated' then raise exception 'Sesi login diperlukan' using errcode='42501';end if;
 if nullif(btrim(p_request_key),'') is null or length(p_request_key)>120 then raise exception 'Kunci uang muka tidak valid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('vetos:purchase-advance:'||auth.uid()::text||':'||p_request_key,0));
 perform public.purchase_advance_access(null);
 select * into prior from public.purchase_advance_requests where actor_id=auth.uid() and request_key=p_request_key;
 if not found then return null;end if;
 perform public.purchase_advance_access(prior.branch_id);
 if not public.user_can_access_branch(prior.branch_id) then raise exception 'Cabang bukti uang muka tidak dapat diakses' using errcode='42501';end if;
 if not exists(select 1 from public.journal_entries where id=(prior.result->>'journal_id')::uuid and source='purchase-advance' and source_ref=prior.result->>'no_um' and branch_id is not distinct from prior.branch_id) then
  raise exception 'Bukti jurnal uang muka belum lengkap; periksa rekonsiliasi sumber';end if;
 return prior.result;
end$$;
revoke all on function public.get_purchase_advance_result(text) from public,anon,service_role;
grant execute on function public.get_purchase_advance_result(text) to authenticated;

create function public.pay_purchase_advance_atomic(
 p_request_key text,p_no_prefix text,p_no_digits integer,p_supplier_id uuid,p_po_id uuid,
 p_tanggal date,p_jumlah numeric,p_metode text,p_account_id uuid,p_catatan text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 prior public.purchase_advance_requests%rowtype;po public.purchase_orders%rowtype;payload jsonb;result jsonb;cash jsonb;
 branch uuid;used numeric:=0;seq bigint;no_um text;advance_id uuid:=gen_random_uuid();journal_id uuid;v_constraint text;
begin
 -- Nonlocking admission only. Exact actor authorization is locked/rechecked after
 -- the PO, matching the established PO revision and receipt lock order.
 if auth.uid() is null or auth.role() is distinct from 'authenticated'
  or not exists(select 1 from public.profiles where id=auth.uid() and is_active and role in('OWNER','ADMIN','FINANCE')) then
  raise exception 'Hanya OWNER/ADMIN/FINANCE aktif yang boleh mencatat uang muka' using errcode='42501';end if;
 if nullif(btrim(p_request_key),'') is null or length(p_request_key)>120 or p_supplier_id is null or p_tanggal is null or not isfinite(p_tanggal)
 or p_jumlah is null or p_jumlah::text in('NaN','Infinity','-Infinity') or p_jumlah<=0 or p_jumlah<>trunc(p_jumlah) or p_jumlah>9999999999999 then
  raise exception 'Identitas atau nominal uang muka tidak valid; gunakan rupiah bulat' using errcode='22023';end if;
 if p_metode is null or p_metode not in('Tunai','Transfer','Debit','Kredit','QRIS','E-Wallet') then raise exception 'Metode pembayaran tidak valid' using errcode='22023';end if;
 payload:=jsonb_build_object('supplier_id',p_supplier_id,'po_id',p_po_id,'tanggal',p_tanggal,'jumlah',p_jumlah,'metode',p_metode,'account_id',p_account_id,'catatan',p_catatan);
 perform pg_advisory_xact_lock(hashtextextended('vetos:purchase-advance:'||auth.uid()::text||':'||p_request_key,0));
 select * into prior from public.purchase_advance_requests where actor_id=auth.uid() and request_key=p_request_key;
 if found then
  if prior.payload is distinct from payload then raise exception 'Kunci uang muka sudah dipakai dengan rincian berbeda' using errcode='22023';end if;
  return public.get_purchase_advance_result(p_request_key);
 end if;
 if p_po_id is not null then
  select * into po from public.purchase_orders where id=p_po_id for update;
  if not found then raise exception 'PO tidak ditemukan' using errcode='22023';end if;
  branch:=po.branch_id;
  perform public.purchase_advance_access(branch);
  if po.status not in('Draft','Dipesan') then raise exception 'PO sudah diterima atau tidak aktif; DP baru ditolak' using errcode='55000';end if;
  if po.supplier_id is not null and po.supplier_id is distinct from p_supplier_id then raise exception 'PO itu milik pemasok lain' using errcode='22023';end if;
  if exists(select 1 from public.purchase_advances where po_id=po.id and status='batal' and not public.purchase_advance_refund_proven(id)) then
  raise exception 'Pembatalan DP lama belum memiliki bukti pengembalian lengkap; rekonsiliasi sumber PO dahulu' using errcode='55000';end if;
 select coalesce(sum(jumlah),0) into used from public.purchase_advances where po_id=po.id and status='aktif';
  if po.total is null or po.total::text in('NaN','Infinity','-Infinity') or po.total<=0 or used+p_jumlah>po.total then
   raise exception 'Nominal melebihi sisa batas DP PO (nilai PO %, DP aktif %, sisa %)',po.total,used,greatest(0,po.total-used) using errcode='22003';end if;
 else
  -- Established operational context wins; in all-branch context an explicitly
  -- selected bank provides its own authoritative branch. Scope validation below
  -- rejects inactive, unauthorized or mismatched contexts/accounts.
  branch:=nullif(nullif(current_setting('request.headers',true),'')::jsonb->>'x-kamo-operational-branch','')::uuid;
  if branch is null and p_account_id is not null then select branch_id into branch from public.cash_accounts where id=p_account_id;end if;
  perform public.purchase_advance_access(branch);
 end if;
 perform 1 from public.suppliers where id=p_supplier_id and is_active and trashed_at is null for share;
 if not found then raise exception 'Pemasok tidak aktif atau tidak ditemukan' using errcode='22023';end if;
 perform 1 from public.accounting_locks where id for share;
 if exists(select 1 from public.accounting_locks where id and closed_until>=p_tanggal) then raise exception 'Periode akuntansi sudah ditutup' using errcode='55000';end if;
 cash:=public.purchase_payment_cash(p_metode,branch,p_account_id);
 if nullif(p_no_prefix,'') is null or p_no_digits is null or p_no_digits not between 1 and 8 or length(p_no_prefix)+p_no_digits>30 then raise exception 'Format nomor uang muka tidak valid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('vetos:purchase-advance-number:'||p_no_prefix,0));
 select coalesce(max(substring(a.no_um,length(p_no_prefix)+1)::bigint),0)+1 into seq from public.purchase_advances a
  where left(a.no_um,length(p_no_prefix))=p_no_prefix and substring(a.no_um,length(p_no_prefix)+1)~'^[0-9]+$';
 loop
  if length(seq::text)>p_no_digits then raise exception 'Nomor uang muka mencapai batas format';end if;
  no_um:=p_no_prefix||lpad(seq::text,p_no_digits,'0');
  begin
   insert into public.purchase_advances(id,no_um,supplier_id,po_id,tanggal,jumlah,metode,account_id,catatan,created_by)
    values(advance_id,no_um,p_supplier_id,p_po_id,p_tanggal,p_jumlah,p_metode,(cash->>'account_id')::uuid,p_catatan,auth.uid());
   exit;
  exception when unique_violation then get stacked diagnostics v_constraint=constraint_name;
   if v_constraint<>'purchase_advances_no_um_key' then raise;end if;seq:=seq+1;
  end;
 end loop;
 journal_id:=public.clinic_write_journal(p_tanggal,'Uang muka pembelian '||no_um,'purchase-advance',no_um,branch,
  jsonb_build_array(jsonb_build_object('code','1303','debit',p_jumlah,'credit',0),jsonb_build_object('code',cash->>'code','debit',0,'credit',p_jumlah)));
 if journal_id is null or (select coalesce(sum(debit),0) from public.journal_lines where entry_id=journal_id)<>p_jumlah
  or (select coalesce(sum(credit),0) from public.journal_lines where entry_id=journal_id)<>p_jumlah then raise exception 'Jurnal uang muka belum tersimpan lengkap';end if;
 result:=jsonb_build_object('advance_id',advance_id,'no_um',no_um,'journal_id',journal_id,'cash_source',cash,'po_value',po.total,'existing_advances',used,'remaining_cap',case when p_po_id is null then null else greatest(0,po.total-used-p_jumlah) end);
 insert into public.purchase_advance_requests(actor_id,request_key,payload,result,branch_id)values(auth.uid(),p_request_key,payload,result,branch);
 return result;
end$$;
revoke all on function public.pay_purchase_advance_atomic(text,text,integer,uuid,uuid,date,numeric,text,uuid,text) from public,anon,service_role;
grant execute on function public.pay_purchase_advance_atomic(text,text,integer,uuid,uuid,date,numeric,text,uuid,text) to authenticated;

-- Releasing PO capacity is also a financial write. Preserve the existing full,
-- unallocated cancellation rule, but reverse the immutable original source in
-- the same transaction. No partial refund, revision or historical repair.
create table public.purchase_advance_cancellations (
 advance_id uuid primary key references public.purchase_advances(id),actor_id uuid not null references public.profiles(id),
 original_journal_id uuid not null references public.journal_entries(id),journal_id uuid not null references public.journal_entries(id),
 result jsonb not null,created_at timestamptz not null default now()
);
alter table public.purchase_advance_cancellations enable row level security;
revoke all on public.purchase_advance_cancellations from public,anon,authenticated,service_role;

create function public.cancel_purchase_advance_atomic(p_advance_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 adv public.purchase_advances%rowtype;prior public.purchase_advance_cancellations%rowtype;original public.journal_entries%rowtype;
 po_id uuid;branch uuid;cash_code text;cash_account uuid;today date:=(now() at time zone 'Asia/Jakarta')::date;
 debit_code text;debits numeric;credits numeric;line_count integer;reversal uuid;result jsonb;
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated' then raise exception 'Sesi login diperlukan' using errcode='42501';end if;
 select a.po_id into po_id from public.purchase_advances a where id=p_advance_id;
 if not found then raise exception 'Uang muka tidak ditemukan' using errcode='22023';end if;
 if po_id is not null then perform 1 from public.purchase_orders where id=po_id for update;end if;
 perform public.purchase_advance_access(null);
 select * into adv from public.purchase_advances where id=p_advance_id for update;
 if not found or adv.po_id is distinct from po_id then raise exception 'Sumber uang muka berubah; muat ulang' using errcode='55000';end if;
 select * into prior from public.purchase_advance_cancellations where advance_id=adv.id;
 if found then
  branch:=(prior.result->>'branch_id')::uuid;
  perform public.purchase_advance_access(branch);
  if not public.user_can_access_branch(branch) then raise exception 'Cabang pembatalan tidak dapat diakses' using errcode='42501';end if;
  if not exists(select 1 from public.journal_entries where id=prior.journal_id and source='purchase-advance-void' and source_ref=adv.no_um and branch_id is not distinct from branch) then raise exception 'Bukti pembatalan belum lengkap; rekonsiliasi sumber';end if;
  return prior.result;
 end if;
 if adv.status<>'aktif' then raise exception 'Uang muka ini sudah dibatalkan; periksa sumber lama' using errcode='55000';end if;
 if adv.terpakai<>0 or adv.terpakai is distinct from (select coalesce(sum(dari_uang_muka),0) from public.purchase_invoice_payments where advance_id=adv.id) then raise exception 'Uang muka sudah memiliki alokasi pembayaran; koreksi pembayaran dahulu' using errcode='55000';end if;
 if adv.jumlah::text in('NaN','Infinity','-Infinity') or adv.jumlah<=0 or adv.jumlah<>trunc(adv.jumlah) then raise exception 'Nominal sumber lama perlu direkonsiliasi; pembatalan tidak boleh menebak pembulatan' using errcode='22023';end if;
 if (select count(*) from public.journal_entries where source='purchase-advance' and source_ref=adv.no_um)<>1 then raise exception 'Jurnal asal uang muka tidak unik/lengkap; rekonsiliasi sumber dahulu';end if;
 select * into original from public.journal_entries where source='purchase-advance' and source_ref=adv.no_um for share;
 branch:=original.branch_id;
 perform public.purchase_advance_access(branch);
 if not public.user_can_access_branch(branch) then raise exception 'Cabang uang muka tidak dapat diakses' using errcode='42501';end if;
 if po_id is not null and branch is distinct from (select branch_id from public.purchase_orders where id=po_id) then raise exception 'Cabang jurnal asal tidak sesuai PO; rekonsiliasi sumber';end if;
 if exists(select 1 from public.journal_entries where source='purchase-advance-void' and source_ref=adv.no_um) then raise exception 'Jurnal pembatalan lama sudah ada; rekonsiliasi sumber sebelum mencoba lagi';end if;
 perform 1 from public.journal_lines where entry_id=original.id order by id for share;
 select count(*),sum(l.debit),sum(l.credit),max(a.code)filter(where l.credit>0),max(a.code)filter(where l.debit>0)
 into line_count,debits,credits,cash_code,debit_code from public.journal_lines l join public.coa_accounts a on a.id=l.account_id where l.entry_id=original.id;
 if line_count<>2 or debits<>adv.jumlah or credits<>adv.jumlah or debit_code<>'1303' or cash_code is null or cash_code='1303'
  or exists(select 1 from public.journal_lines where entry_id=original.id and (debit<0 or credit<0 or (debit>0 and credit>0))) then raise exception 'Jurnal asal tidak cocok dengan nominal uang muka; rekonsiliasi sumber dahulu';end if;
 select id into cash_account from public.cash_accounts where coa_code=cash_code;
 if adv.account_id is not null and cash_account is distinct from adv.account_id then raise exception 'Rekening sumber tidak sesuai jurnal asal; rekonsiliasi dahulu';end if;
 perform public.purchase_payment_scope(branch,cash_account);
 perform 1 from public.coa_accounts where code=cash_code and is_active and not is_header and type='ASET' for share;
 if not found then raise exception 'Akun sumber pembatalan tidak aktif';end if;
 perform 1 from public.accounting_locks where id for share;
 if exists(select 1 from public.accounting_locks where id and closed_until>=today) then raise exception 'Periode pembatalan sudah ditutup' using errcode='55000';end if;
 reversal:=public.clinic_write_journal(today,'Pembatalan uang muka '||adv.no_um,'purchase-advance-void',adv.no_um,branch,
  jsonb_build_array(jsonb_build_object('code',cash_code,'debit',adv.jumlah,'credit',0),jsonb_build_object('code','1303','debit',0,'credit',adv.jumlah)));
 if reversal is null or (select coalesce(sum(debit),0) from public.journal_lines where entry_id=reversal)<>adv.jumlah
  or (select coalesce(sum(credit),0) from public.journal_lines where entry_id=reversal)<>adv.jumlah then raise exception 'Jurnal pembatalan belum lengkap';end if;
 update public.purchase_advances set status='batal' where id=adv.id;
 result:=jsonb_build_object('advance_id',adv.id,'no_um',adv.no_um,'original_journal_id',original.id,'journal_id',reversal,'branch_id',branch);
 insert into public.purchase_advance_cancellations(advance_id,actor_id,original_journal_id,journal_id,result)values(adv.id,auth.uid(),original.id,reversal,result);
 return result;
end$$;
revoke all on function public.cancel_purchase_advance_atomic(uuid) from public,anon,service_role;
grant execute on function public.cancel_purchase_advance_atomic(uuid) to authenticated;
