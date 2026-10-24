-- J02: Correct a finalized POS cash/transfer allocation on its original sale.
-- Historic rows and journal entries remain in the audit trail. Only OWNER may
-- invoke the atomic correction; direct source mutation stays forbidden.
create table public.sale_payment_correction_gate (
 transaction_id bigint not null,
 backend_pid integer not null,
 sale_id uuid not null references public.sales(id) on delete restrict,
 primary key(transaction_id,backend_pid,sale_id)
);
alter table public.sale_payment_correction_gate enable row level security;
revoke all on public.sale_payment_correction_gate from public,anon,authenticated,service_role;

create table public.sale_payment_corrections (
 id uuid primary key default gen_random_uuid(),
 sale_id uuid not null references public.sales(id) on delete restrict,
 branch_id uuid not null references public.branches(id) on delete restrict,
 revision integer not null check(revision>0),
 reason text not null,
 before_sale jsonb not null,
 before_payments jsonb not null,
 after_payments jsonb not null,
 original_journal_id uuid not null references public.journal_entries(id) on delete restrict,
 reversal_journal_id uuid not null unique references public.journal_entries(id) on delete restrict,
 replacement_journal_id uuid not null unique references public.journal_entries(id) on delete restrict,
 created_by uuid not null references public.profiles(id) on delete restrict,
 created_at timestamptz not null default clock_timestamp(),
 unique(sale_id,revision)
);
create index sale_payment_corrections_sale_idx on public.sale_payment_corrections(sale_id,revision desc);
alter table public.sale_payment_corrections enable row level security;
revoke all on public.sale_payment_corrections from public,anon,authenticated,service_role;
grant select on public.sale_payment_corrections to authenticated;
create policy sale_payment_corrections_owner_read on public.sale_payment_corrections for select to authenticated using (
 exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and p.role='OWNER')
 and public.user_can_access_branch(branch_id)
);

-- The deployed cancellation RPC reverses the original sale journal only.
-- After a payment correction that would leave the replacement posting live.
-- Fail closed until cancellation can reconcile the complete correction chain.
create function public.guard_corrected_sale_cancellation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.voided_at is distinct from old.voided_at
  and exists(select 1 from public.sale_payment_corrections where sale_id=old.id) then
  raise exception 'Koreksi metode pembayaran perlu rekonsiliasi sebelum pembatalan';
 end if;
 return new;
end $$;
revoke all on function public.guard_corrected_sale_cancellation() from public,anon,authenticated,service_role;
create trigger pos_sale_corrected_cancel_guard before update on public.sales for each row
 execute function public.guard_corrected_sale_cancellation();

create table public.sale_payment_correction_requests (
 actor_id uuid not null references public.profiles(id) on delete restrict,
 request_key text not null,
 sale_id uuid not null references public.sales(id) on delete restrict,
 payload jsonb not null,
 result jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 primary key(actor_id,request_key)
);
alter table public.sale_payment_correction_requests enable row level security;
revoke all on public.sale_payment_correction_requests from public,anon,authenticated,service_role;

create function public.pos_sale_payment_correction_allowed(p_sale_id uuid) returns boolean
language sql volatile security definer set search_path='' as $$
 select exists(select 1 from public.sale_payment_correction_gate g
  where g.transaction_id=txid_current() and g.backend_pid=pg_backend_pid() and g.sale_id=p_sale_id)
$$;
revoke all on function public.pos_sale_payment_correction_allowed(uuid) from public,anon,authenticated,service_role;
-- The existing header trigger is SECURITY INVOKER and needs this read-only
-- predicate. It exposes no gate rows or ability to create a gate.
grant execute on function public.pos_sale_payment_correction_allowed(uuid) to authenticated;

create or replace function public.pos_sale_protect_header() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' then
  if new.payments_finalized_at is not null then raise exception 'Metadata pembayaran dikelola server';end if;
 else
  if new.merchant_fee_total is distinct from old.merchant_fee_total then raise exception 'Fee merchant penjualan sudah tetap';end if;
  if new.payment_plan is distinct from old.payment_plan
   and public.pos_sale_payment_correction_allowed(old.id) then
   if old.payment_plan is null or old.payments_finalized_at is null or old.voided_at is not null
    or new.revision is distinct from old.revision+1
    or (to_jsonb(new)-array['payment_plan','metode_bayar','revision']) is distinct from
       (to_jsonb(old)-array['payment_plan','metode_bayar','revision']) then
    raise exception 'Koreksi metode hanya boleh mengubah alokasi, metode dan revisi';end if;
   return new;
  end if;
  if new.payment_plan is distinct from old.payment_plan then raise exception 'Rencana pembayaran sudah tetap';end if;
  if new.payments_finalized_at is distinct from old.payments_finalized_at and current_user in('authenticated','anon','service_role') then
   raise exception 'Metadata pembayaran dikelola server';end if;
  if old.payment_plan is not null and
   (to_jsonb(new)-array['payments_finalized_at','revision','voided_at','voided_by','void_reason']) is distinct from
   (to_jsonb(old)-array['payments_finalized_at','revision','voided_at','voided_by','void_reason']) then
   raise exception 'Snapshot keuangan penjualan sudah tetap';end if;
 end if;
 return new;
end $$;

create or replace function public.unit_posted_sale_source_immutable() returns trigger language plpgsql security definer set search_path='' as $$
declare sale_id uuid;ref text;posted boolean;
begin
 if tg_op='UPDATE' and tg_table_name='sale_items' then if new.sale_id is distinct from old.sale_id then raise exception 'Induk rincian penjualan tidak boleh dipindah' using errcode='22023';end if;end if;
 if tg_op='UPDATE' and tg_table_name='sale_item_group_components' then if new.sale_item_id is distinct from old.sale_item_id then raise exception 'Induk snapshot komponen tidak boleh dipindah' using errcode='22023';end if;end if;
 if tg_table_name='sales' then sale_id:=old.id;
 elsif tg_table_name='sale_item_group_components' then select si.sale_id into sale_id from public.sale_items si where si.id=case when tg_op='INSERT' then new.sale_item_id else old.sale_item_id end;
 elsif tg_op='INSERT' then sale_id:=new.sale_id;
 else sale_id:=old.sale_id;end if;
 select no_struk into ref from public.sales where id=sale_id for update;
 posted:=exists(select 1 from public.journal_entries where source in ('sale','sale-online') and source_ref=ref)
  or exists(select 1 from public.sales where id=sale_id and payments_finalized_at is not null);
 if posted then
  if tg_table_name='sales' and tg_op='UPDATE' then
   if public.pos_sale_payment_correction_allowed(old.id)
    and old.payment_plan is not null and old.payments_finalized_at is not null
    and new.revision is not distinct from old.revision+1
    and (to_jsonb(new)-array['payment_plan','metode_bayar','revision']) is not distinct from
        (to_jsonb(old)-array['payment_plan','metode_bayar','revision']) then return new;end if;
   if (to_jsonb(new)-array['marketplace_status','komisi','disbursed_at','external_ref','buyer_name','revision','voided_at','voided_by','void_reason']) is distinct from (to_jsonb(old)-array['marketplace_status','komisi','disbursed_at','external_ref','buyer_name','revision','voided_at','voided_by','void_reason']) then raise exception 'Snapshot penjualan yang sudah diposting tidak boleh diubah' using errcode='22023';end if;
  else raise exception 'Snapshot rincian penjualan yang sudah diposting tidak boleh diubah' using errcode='22023';end if;
 end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;

create or replace function public.pos_sale_allocation_immutable() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='sale_payments' and tg_op in('UPDATE','DELETE')
  and public.pos_sale_payment_correction_allowed(old.sale_id) then
  if tg_op='UPDATE' and new.sale_id is distinct from old.sale_id then
   raise exception 'Induk alokasi pembayaran tidak boleh dipindah';end if;
  if tg_op='DELETE' then return old;else return new;end if;
 end if;
 if tg_op='DELETE' then
  if tg_table_name='sale_payments' then
   if not exists(select 1 from public.sales where id=old.sale_id) then return old;end if;
  else
   if not exists(select 1 from public.sales_returns where id=old.sales_return_id) then return old;end if;
  end if;
 end if;
 raise exception 'Snapshot alokasi pembayaran sudah tetap';
end $$;

create function public.correct_pos_sale_payment(
 p_sale_id uuid,p_expected_revision integer,p_request_key text,p_reason text,
 p_cash_amount numeric,p_transfer_amount numeric
) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare
 actor uuid:=auth.uid();s public.sales%rowtype;posting public.pos_sale_postings%rowtype;
 prior public.sale_payment_correction_requests%rowtype;last_change public.sale_payment_corrections%rowtype;
 source_journal public.journal_entries%rowtype;cash_account public.cash_accounts%rowtype;
 transfer_account public.cash_accounts%rowtype;old_part record;rec record;
 payload jsonb;result jsonb;before_payments jsonb;after_payments jsonb;plan_before jsonb;plan_after jsonb;
 expected_lines jsonb;actual_lines jsonb;nonpayment_lines jsonb;source_count integer;old_cash numeric;old_transfer numeric;
 cash_code text;transfer_code text;closed date;source_date date;today date:=(now() at time zone 'Asia/Jakarta')::date;
 audit uuid:=gen_random_uuid();reversal uuid:=gen_random_uuid();replacement uuid:=gen_random_uuid();
begin
 if actor is null or auth.role() is distinct from 'authenticated' then raise exception 'Sesi login diperlukan' using errcode='42501';end if;
 if p_sale_id is null or p_expected_revision is null or p_expected_revision<0
  or length(btrim(coalesce(p_request_key,''))) not between 1 and 120
  or length(btrim(coalesce(p_reason,''))) not between 3 and 1000
  or p_cash_amount is null or p_transfer_amount is null
  or p_cash_amount::text in('NaN','Infinity','-Infinity') or p_transfer_amount::text in('NaN','Infinity','-Infinity')
  or p_cash_amount<0 or p_transfer_amount<0 or p_cash_amount>1000000000000 or p_transfer_amount>1000000000000
  or p_cash_amount<>round(p_cash_amount,2) or p_transfer_amount<>round(p_transfer_amount,2) then
  raise exception 'Identitas, alasan atau jumlah koreksi tidak valid' using errcode='22023';end if;
 select * into s from public.sales where id=p_sale_id for update;
 if not found then raise exception 'Penjualan tidak ditemukan';end if;
 perform 1 from public.profiles where id=actor and is_active and role='OWNER' for share;
 if not found then raise exception 'Hanya Owner aktif dapat mengoreksi metode pembayaran' using errcode='42501';end if;
 perform public.sales_assert_access(s.branch_id);
 perform 1 from public.branches where id=s.branch_id and is_active for share;
 if not found then raise exception 'Cabang sumber tidak aktif' using errcode='42501';end if;
 payload:=jsonb_build_object('sale_id',p_sale_id,'revision',p_expected_revision,'reason',btrim(p_reason),
  'cash',p_cash_amount,'transfer',p_transfer_amount);
 perform pg_advisory_xact_lock(hashtextextended('vetos:pos-payment-correction:'||actor::text||':'||p_request_key,0));
 select * into prior from public.sale_payment_correction_requests where actor_id=actor and request_key=p_request_key;
 if found then
  if prior.payload is distinct from payload then raise exception 'Identitas simpan sudah dipakai untuk rincian berbeda';end if;
  if prior.sale_id is distinct from s.id then raise exception 'Identitas simpan bukan milik penjualan ini';end if;
  return prior.result;
 end if;
 if s.revision<>p_expected_revision then raise exception 'Penjualan sudah berubah. Muat ulang sebelum koreksi';end if;
 if s.channel is not null or s.voided_at is not null or s.payment_plan is null or s.payments_finalized_at is null
  or s.total<=0 or s.kembali<>0 then
  raise exception 'Sumber POS belum memenuhi syarat koreksi metode; kembalian tunai dan sumber legacy memerlukan rekonsiliasi';end if;
 if exists(select 1 from public.sales_returns where sale_id=s.id)
  or exists(select 1 from public.sale_payment_refunds r join public.sale_payments p on p.id=r.sale_payment_id where p.sale_id=s.id)
  or exists(select 1 from public.sales_refund_requests where sale_id=s.id) then
  raise exception 'Penjualan sudah memiliki retur atau permintaan refund; rekonsiliasi sumber diperlukan';end if;
 source_date:=(s.created_at at time zone 'Asia/Jakarta')::date;
 select closed_until into closed from public.accounting_locks where id for share;
 if source_date>today or (closed is not null and (source_date<=closed or today<=closed)) then
  raise exception 'Periode sumber atau koreksi telah ditutup atau tanggal sumber tidak valid';end if;
 if s.shift_id is not null then
  perform 1 from public.cashier_shifts where id=s.shift_id and branch_id=s.branch_id and status='open' for update;
  if not found then raise exception 'Shift kasir sudah ditutup; rekonsiliasi shift diperlukan';end if;
 end if;
 select * into posting from public.pos_sale_postings where sale_id=s.id for update;
 if not found or posting.revenue_journal_id is null then raise exception 'Jurnal sumber penjualan belum lengkap';end if;
 select * into last_change from public.sale_payment_corrections where sale_id=s.id order by revision desc limit 1 for update;
 if found and last_change.revision<>s.revision then raise exception 'Jejak koreksi dan revisi penjualan tidak cocok';end if;
 if not found and s.revision<>0 then raise exception 'Revisi sumber tanpa jejak koreksi memerlukan rekonsiliasi';end if;
 select * into source_journal from public.journal_entries where id=coalesce(last_change.replacement_journal_id,posting.revenue_journal_id) for share;
 if not found or source_journal.branch_id is distinct from s.branch_id or source_journal.voided_at is not null
  or (last_change.id is null and (source_journal.source<>'sale' or source_journal.source_ref is distinct from s.no_struk))
  or (last_change.id is not null and (source_journal.source<>'sale-payment-repost' or source_journal.source_ref is distinct from last_change.id::text)) then
  raise exception 'Jurnal aktif penjualan tidak sesuai sumber';end if;
 select coalesce(jsonb_agg(to_jsonb(p) order by p.method,p.id),'[]'::jsonb) into before_payments
  from public.sale_payments p where p.sale_id=s.id;
 select count(*),coalesce(sum(amount) filter(where method='Tunai'),0),coalesce(sum(amount) filter(where method='Transfer'),0)
  into source_count,old_cash,old_transfer from public.sale_payments where sale_id=s.id;
 if source_count<>jsonb_array_length(s.payment_plan) or source_count not between 1 and 6
  or (select coalesce(sum(amount),0) from public.sale_payments where sale_id=s.id)<>s.total
  or (select coalesce(sum(fee_amount),0) from public.sale_payments where sale_id=s.id)<>s.merchant_fee_total
  or old_cash+old_transfer<=0 or old_cash+old_transfer<>p_cash_amount+p_transfer_amount
  or (old_cash=p_cash_amount and old_transfer=p_transfer_amount) then
  raise exception 'Alokasi sumber tidak lengkap, total berbeda atau koreksi tidak mengubah metode';end if;
 select coalesce(jsonb_agg(jsonb_build_object('method',x.method,'amount',x.amount,
   'fee_percent',coalesce(x.fee_percent,0),'fee_amount',coalesce(x.fee_amount,0)) order by x.method),'[]'::jsonb)
  into plan_before from jsonb_to_recordset(s.payment_plan) x(method text,amount numeric,fee_percent numeric,fee_amount numeric);
 if plan_before is distinct from (select coalesce(jsonb_agg(jsonb_build_object('method',method,'amount',amount,
   'fee_percent',fee_percent,'fee_amount',fee_amount) order by method),'[]'::jsonb) from public.sale_payments where sale_id=s.id) then
  raise exception 'Rencana pembayaran dan alokasi tersimpan berbeda';end if;
 if exists(select 1 from public.sale_payments where sale_id=s.id and method in('Tunai','Transfer')
  and (fee_percent<>0 or fee_amount<>0)) then raise exception 'Fee Tunai/Transfer perlu rekonsiliasi terpisah';end if;
 cash_code:=public.unit_posting_cash('Tunai',s.branch_id);
 transfer_code:=public.unit_posting_cash('Transfer',s.branch_id);
 if cash_code is null or transfer_code is null or cash_code=transfer_code then
  raise exception 'Peta akun Tunai dan Transfer tidak lengkap atau sama';end if;
 select * into cash_account from public.cash_accounts where coa_code=cash_code and is_active
  and (branch_id is null or branch_id=s.branch_id) for share;
 if not found or (select count(*) from public.cash_accounts where coa_code=cash_code and is_active
  and (branch_id is null or branch_id=s.branch_id))<>1 then raise exception 'Rekening Tunai tidak unik atau tidak aktif';end if;
 select * into transfer_account from public.cash_accounts where coa_code=transfer_code and is_active
  and (branch_id is null or branch_id=s.branch_id) for share;
 if not found or (select count(*) from public.cash_accounts where coa_code=transfer_code and is_active
  and (branch_id is null or branch_id=s.branch_id))<>1 then raise exception 'Rekening Transfer tidak unik atau tidak aktif';end if;
 for rec in select code from public.coa_accounts where code in(cash_code,transfer_code) and is_active and not is_header
  and type='ASET' and normal_balance='D' for share loop null;end loop;
 if (select count(*) from public.coa_accounts where code in(cash_code,transfer_code) and is_active and not is_header
  and type='ASET' and normal_balance='D')<>2 then raise exception 'Akun Tunai/Transfer bukan aset detail aktif';end if;
 for old_part in select * from public.sale_payments where sale_id=s.id and method in('Tunai','Transfer') order by method,id for share loop
  if old_part.coa_code is distinct from (case when old_part.method='Tunai' then cash_code else transfer_code end)
   or (old_part.account_snapshot->>'code') is distinct from old_part.coa_code
   or (old_part.account_snapshot->>'cash_account_id') is distinct from
     (case when old_part.method='Tunai' then cash_account.id else transfer_account.id end)::text then
   raise exception 'Akun sumber berubah dari peta rekening; cocokkan sebelum koreksi';end if;
 end loop;
 -- Serializes the as-of ledger snapshot with bank reconciliation and other corrections.
 lock table public.journal_entries,public.journal_lines in share row exclusive mode;
 if exists(select 1 from public.bank_reconciliations r left join public.cash_accounts a on a.id=r.cash_account_id
  left join public.coa_accounts c on c.code=coalesce(r.bank_coa_code,a.coa_code)
  where r.voided_at is null and r.tanggal>=source_date
   and (c.id is null or c.code in(cash_code,transfer_code))) then
  raise exception 'Rekonsiliasi bank sudah mencakup rekening sumber atau tujuan; koreksi rekonsiliasi dahulu';end if;
 -- Compare the active revenue journal to the immutable non-payment snapshot
 -- plus effective allocations. No unrecognised line may be reversed/reposted.
 select coalesce(jsonb_agg(jsonb_build_object('code',x.code,'debit',x.debit,'credit',x.credit)
  order by x.code,x.debit,x.credit),'[]'::jsonb) into nonpayment_lines
 from jsonb_to_recordset(posting.expected_lines) x(code text,debit numeric,credit numeric)
 join public.coa_accounts a on a.code=x.code where a.type<>'ASET';
 select coalesce(jsonb_agg(jsonb_build_object('code',z.code,'debit',z.debit,'credit',z.credit)
  order by z.code,z.debit,z.credit),'[]'::jsonb) into expected_lines from(
   select x.code,x.debit,x.credit from jsonb_to_recordset(nonpayment_lines) x(code text,debit numeric,credit numeric)
   union all select p.coa_code,p.amount,0::numeric from public.sale_payments p where p.sale_id=s.id
  ) z;
 select coalesce(jsonb_agg(jsonb_build_object('code',a.code,'debit',l.debit,'credit',l.credit)
  order by a.code,l.debit,l.credit),'[]'::jsonb) into actual_lines
  from public.journal_lines l join public.coa_accounts a on a.id=l.account_id where l.entry_id=source_journal.id;
 if actual_lines is distinct from expected_lines or jsonb_array_length(nonpayment_lines)=0
  or (select coalesce(sum(debit-credit),0) from public.journal_lines where entry_id=source_journal.id)<>0
  or exists(select 1 from public.journal_lines l join public.coa_accounts a on a.id=l.account_id
   where l.entry_id=source_journal.id and (not a.is_active or a.is_header)) then
  raise exception 'Jurnal aktif tidak sama dengan alokasi dan pendapatan sumber';end if;
 select coalesce(jsonb_agg(jsonb_build_object('method',z.method,'amount',z.amount,
  'fee_percent',z.fee_percent,'fee_amount',z.fee_amount) order by z.method),'[]'::jsonb) into plan_after from(
   select p.method,p.amount,p.fee_percent,p.fee_amount from public.sale_payments p
    where p.sale_id=s.id and p.method not in('Tunai','Transfer')
   union all select 'Tunai'::text,p_cash_amount,0::numeric,0::numeric where p_cash_amount>0
   union all select 'Transfer'::text,p_transfer_amount,0::numeric,0::numeric where p_transfer_amount>0
  ) z;
 if jsonb_array_length(plan_after) not between 1 and 6 then raise exception 'Rincian hasil koreksi tidak valid';end if;
 insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id)
  values(reversal,public.sales_next_number('JRN',today),today,'Pembalik metode pembayaran '||s.no_struk,
   'sale-payment-reversal',audit::text,s.branch_id);
 insert into public.journal_lines(entry_id,account_id,debit,credit)
  select reversal,account_id,credit,debit from public.journal_lines where entry_id=source_journal.id;
 insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id)
  values(replacement,public.sales_next_number('JRN',today),today,'Metode pembayaran terkoreksi '||s.no_struk,
   'sale-payment-repost',audit::text,s.branch_id);
 insert into public.journal_lines(entry_id,account_id,debit,credit)
  select replacement,l.account_id,l.debit,l.credit from public.journal_lines l
   join public.coa_accounts a on a.id=l.account_id where l.entry_id=source_journal.id and a.type<>'ASET';
 insert into public.journal_lines(entry_id,account_id,debit,credit)
  select replacement,a.id,z.amount,0 from jsonb_to_recordset(plan_after) z(method text,amount numeric)
   join public.coa_accounts a on a.code=case when z.method='Tunai' then cash_code
    when z.method='Transfer' then transfer_code else
     (select p.coa_code from public.sale_payments p where p.sale_id=s.id and p.method=z.method) end
   where a.is_active and not a.is_header and a.type='ASET' and a.normal_balance='D';
 if (select count(*) from public.journal_lines l join public.coa_accounts a on a.id=l.account_id
  where l.entry_id=replacement and a.type='ASET' and l.debit>0)=jsonb_array_length(plan_after)
  and (select coalesce(sum(debit-credit),0) from public.journal_lines where entry_id=replacement)=0
  and (select coalesce(sum(debit-credit),0) from public.journal_lines where entry_id=reversal)=0 then null;
 else raise exception 'Jurnal pengganti atau pembalik tidak lengkap/seimbang';end if;
 insert into public.sale_payment_correction_gate(transaction_id,backend_pid,sale_id)
  values(txid_current(),pg_backend_pid(),s.id);
 delete from public.sale_payments where sale_id=s.id and method in('Tunai','Transfer');
 if p_cash_amount>0 then
  insert into public.sale_payments(sale_id,method,amount,fee_percent,fee_amount,coa_code,account_snapshot)
  select s.id,'Tunai',p_cash_amount,0,0,cash_code,
   jsonb_build_object('coa_id',a.id,'code',a.code,'name',a.name,'cash_account_id',cash_account.id,'cash_account_name',cash_account.nama)
  from public.coa_accounts a where a.code=cash_code;
 end if;
 if p_transfer_amount>0 then
  insert into public.sale_payments(sale_id,method,amount,fee_percent,fee_amount,coa_code,account_snapshot)
  select s.id,'Transfer',p_transfer_amount,0,0,transfer_code,
   jsonb_build_object('coa_id',a.id,'code',a.code,'name',a.name,'cash_account_id',transfer_account.id,'cash_account_name',transfer_account.nama)
  from public.coa_accounts a where a.code=transfer_code;
 end if;
 update public.sales set payment_plan=plan_after,
  metode_bayar=case when jsonb_array_length(plan_after)>1 then 'Split' else plan_after->0->>'method' end,
  revision=revision+1 where id=s.id;
 delete from public.sale_payment_correction_gate where transaction_id=txid_current()
  and backend_pid=pg_backend_pid() and sale_id=s.id;
 select coalesce(jsonb_agg(to_jsonb(p) order by p.method,p.id),'[]'::jsonb) into after_payments
  from public.sale_payments p where p.sale_id=s.id;
 if (select coalesce(sum(amount),0) from public.sale_payments where sale_id=s.id)<>s.total
  or (select coalesce(sum(fee_amount),0) from public.sale_payments where sale_id=s.id)<>s.merchant_fee_total then
  raise exception 'Alokasi hasil koreksi tidak sama dengan sumber';end if;
 insert into public.sale_payment_corrections(id,sale_id,branch_id,revision,reason,before_sale,before_payments,
  after_payments,original_journal_id,reversal_journal_id,replacement_journal_id,created_by)
  values(audit,s.id,s.branch_id,s.revision+1,btrim(p_reason),to_jsonb(s),before_payments,after_payments,
   source_journal.id,reversal,replacement,actor);
 result:=jsonb_build_object('sale_id',s.id,'audit_id',audit,'revision',s.revision+1,
  'reversal_journal_id',reversal,'replacement_journal_id',replacement);
 insert into public.sale_payment_correction_requests(actor_id,request_key,sale_id,payload,result)
  values(actor,p_request_key,s.id,payload,result);
 return result;
end $$;
revoke all on function public.correct_pos_sale_payment(uuid,integer,text,text,numeric,numeric)
 from public,anon,authenticated,service_role;
grant execute on function public.correct_pos_sale_payment(uuid,integer,text,text,numeric,numeric) to authenticated;
