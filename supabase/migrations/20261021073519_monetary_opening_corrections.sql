-- Monetary opening corrections only. Original and nonmonetary lines stay intact.
-- PR62's general opening replacement/void migration is deliberately not imported.
create table public.monetary_opening_corrections (
 id uuid primary key,
 cash_account_id uuid not null references public.cash_accounts(id) on delete restrict,
 revision integer not null check(revision>0),
 reason text not null check(length(btrim(reason)) between 3 and 1000),
 old_amount numeric not null, new_amount numeric not null,
 before_value jsonb not null, after_value jsonb not null,
 original_entry_id uuid references public.journal_entries(id) on delete restrict,
 reversal_entry_id uuid not null references public.journal_entries(id) on delete restrict,
 replacement_entry_id uuid not null references public.journal_entries(id) on delete restrict,
 created_by uuid not null references public.profiles(id) on delete restrict,
 created_at timestamptz not null default clock_timestamp(),
 unique(cash_account_id,revision)
);
alter table public.monetary_opening_corrections enable row level security;
revoke all on public.monetary_opening_corrections from public,anon,authenticated,service_role;
grant select on public.monetary_opening_corrections to authenticated;
create policy monetary_opening_audit_read on public.monetary_opening_corrections for select to authenticated using (
 exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and p.role='OWNER')
 and exists(select 1 from public.cash_accounts a where a.id=cash_account_id and (a.branch_id is null or public.user_can_access_branch(a.branch_id)))
);
create table public.monetary_opening_requests (
 actor_id uuid not null references public.profiles(id) on delete restrict,
 request_key text not null, cash_account_id uuid not null references public.cash_accounts(id) on delete restrict,
 payload jsonb not null, result jsonb not null, created_at timestamptz not null default clock_timestamp(),
 primary key(actor_id,request_key)
);
alter table public.monetary_opening_requests enable row level security;
revoke all on public.monetary_opening_requests from public,anon,authenticated,service_role;

create function public.guard_monetary_opening_journal() returns trigger
language plpgsql set search_path='' as $$
declare protected boolean;
begin
 if current_user in('authenticated','anon','service_role') then
  if tg_table_name='journal_entries' then
   protected:=new.source in('saldo-awal','cash-account-opening','cash-open-reversal','cash-open-replacement')
    or old.source in('saldo-awal','cash-account-opening','cash-open-reversal','cash-open-replacement');
  else
   select exists(select 1 from public.journal_entries where id in(new.entry_id,old.entry_id)
    and source in('saldo-awal','cash-account-opening','cash-open-reversal','cash-open-replacement')) into protected;
  end if;
  if protected then raise exception 'Saldo awal hanya dapat dicatat atau dikoreksi melalui jalur resmi' using errcode='42501';end if;
 end if;
 return coalesce(new,old);
end$$;
revoke all on function public.guard_monetary_opening_journal() from public,anon,authenticated,service_role;
create trigger monetary_opening_header_guard before insert or update or delete on public.journal_entries for each row execute function public.guard_monetary_opening_journal();
create trigger monetary_opening_line_guard before insert or update or delete on public.journal_lines for each row execute function public.guard_monetary_opening_journal();

-- Private access helper. Holds current authorization/account mapping stable for this transaction.
create function public.monetary_opening_access(p_account_id uuid) returns public.cash_accounts
language plpgsql security definer set search_path='' as $$
declare account public.cash_accounts%rowtype;
begin
 perform 1 from public.profiles where id=auth.uid() and is_active and role='OWNER' for share;
 if not found then raise exception 'Hanya Owner aktif dapat mengoreksi saldo awal' using errcode='42501';end if;
 select * into account from public.cash_accounts where id=p_account_id for share;
 if not found or not account.is_active then raise exception 'Rekening tidak ditemukan atau tidak aktif';end if;
 if account.branch_id is not null then
  perform 1 from public.branches where id=account.branch_id and is_active for share;
  if not found or not public.user_can_access_branch(account.branch_id) then raise exception 'Cabang rekening tidak dapat diakses atau tidak aktif' using errcode='42501';end if;
 end if;
 perform 1 from public.coa_accounts where code=account.coa_code and is_active and not is_header and type='ASET' and normal_balance='D' for share;
 if not found then raise exception 'Akun kas/bank tidak aktif atau bukan akun detail aset';end if;
 perform 1 from public.coa_accounts where code='3101' and is_active and not is_header and type='EKUITAS' and normal_balance='K' for share;
 if not found then raise exception 'Akun Modal Pemilik tidak tersedia';end if;
 if (select count(*) from public.cash_accounts where coa_code=account.coa_code)<>1 then raise exception 'Pemetaan rekening tidak unik';end if;
 return account;
end$$;
revoke all on function public.monetary_opening_access(uuid) from public,anon,authenticated,service_role;

create function public.monetary_opening_context(p_account_id uuid) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare
 account public.cash_accounts%rowtype; original public.journal_entries%rowtype;
 latest public.monetary_opening_corrections%rowtype;
 cash_coa uuid; equity_coa uuid; roots integer; line_count integer;
 total_d numeric;total_c numeric;original_amount numeric:=0;current_amount numeric;balance numeric;
 opening_date date;posting_branch uuid;closed date;fingerprint text;ledger_fingerprint text;source_lines jsonb;
begin
 account:=public.monetary_opening_access(p_account_id);
 select closed_until into closed from public.accounting_locks where id for share;
 if not found then raise exception 'Pengaturan periode belum tersedia';end if;
 -- Matches reconciliation's stable ledger snapshot and the journal-number lock order.
 -- No reconciliation row lock: a pending reconciliation will snapshot the corrected ledger.
 lock table public.journal_entries,public.journal_lines in share row exclusive mode;
 account:=public.monetary_opening_access(p_account_id);
 select id into cash_coa from public.coa_accounts where code=account.coa_code;
 select id into equity_coa from public.coa_accounts where code='3101';
 select count(*) into roots from public.journal_entries e where
  (e.source='cash-account-opening' and (e.source_ref=account.coa_code or exists(select 1 from public.journal_lines l where l.entry_id=e.id and l.account_id=cash_coa)))
  or (e.source='saldo-awal' and exists(select 1 from public.journal_lines l where l.entry_id=e.id and l.account_id=cash_coa));
 if roots>1 then raise exception 'Sumber saldo awal ganda atau ambigu; perlu pencocokan sebelum koreksi';end if;
 if roots=1 then
  select * into original from public.journal_entries e where
   (e.source='cash-account-opening' and (e.source_ref=account.coa_code or exists(select 1 from public.journal_lines l where l.entry_id=e.id and l.account_id=cash_coa)))
   or (e.source='saldo-awal' and exists(select 1 from public.journal_lines l where l.entry_id=e.id and l.account_id=cash_coa));
  if original.voided_at is not null or original.revision<>0
   or (original.source='cash-account-opening' and (original.source_ref is distinct from account.coa_code or original.branch_id is distinct from account.branch_id))
   or (original.source='saldo-awal' and original.branch_id is not null) then raise exception 'Hubungan jurnal saldo awal tidak sesuai';end if;
  select sum(debit),sum(credit),count(*),jsonb_agg(to_jsonb(l) order by l.id)
   into total_d,total_c,line_count,source_lines from public.journal_lines l where entry_id=original.id;
  if line_count<2 or total_d is null or total_d<=0 or total_d is distinct from total_c
   or exists(select 1 from public.journal_lines l join public.coa_accounts a on a.id=l.account_id where l.entry_id=original.id
    and (l.debit<0 or l.credit<0 or (l.debit>0 and l.credit>0) or l.debit::text in('NaN','Infinity','-Infinity') or l.credit::text in('NaN','Infinity','-Infinity')
     or l.debit<>round(l.debit,2) or l.credit<>round(l.credit,2) or a.type not in('ASET','LIABILITAS','EKUITAS')))
   or (select count(*) from public.journal_lines where entry_id=original.id and account_id=cash_coa)<>1 then
   raise exception 'Jurnal saldo awal tidak lengkap atau tidak seimbang';end if;
  if original.source='cash-account-opening' and (line_count<>2 or not exists(select 1 from public.journal_lines where entry_id=original.id and account_id=equity_coa)) then
   raise exception 'Jurnal pembuka rekening tidak memiliki bukti pasangan modal';end if;
  select debit-credit into original_amount from public.journal_lines where entry_id=original.id and account_id=cash_coa;
  opening_date:=original.tanggal;posting_branch:=original.branch_id;
  fingerprint:=md5(jsonb_build_object('entry',to_jsonb(original),'lines',source_lines)::text);
 else
  -- Existing account creation deliberately omits a journal for a zero opening.
  -- An incomplete explicit opening is caught above even when its lines are absent.
  opening_date:=(account.created_at at time zone 'Asia/Jakarta')::date;posting_branch:=account.branch_id;
  if exists(select 1 from public.journal_entries where source='saldo-awal' and tanggal is distinct from opening_date) then
   raise exception 'Tanggal saldo awal nol belum memiliki bukti yang pasti; perlu pencocokan sebelum koreksi';end if;
  fingerprint:=md5(jsonb_build_object('account',account.id,'code',account.coa_code,'date',opening_date,'branch',posting_branch,'zero',true)::text);
 end if;
 if opening_date is null or not isfinite(opening_date) or opening_date>(now() at time zone 'Asia/Jakarta')::date then raise exception 'Tanggal sumber saldo awal tidak valid';end if;
 if closed is not null and opening_date<=closed then raise exception 'Periode saldo awal sudah ditutup';end if;
 if exists(select 1 from public.journal_entries where source='closing' and tanggal>=opening_date) then raise exception 'Jurnal tutup buku bergantung pada periode saldo awal';end if;
 if exists(select 1 from public.bank_reconciliations r where r.voided_at is null and r.tanggal>=opening_date
  and (r.cash_account_id=account.id or r.bank_coa_code=account.coa_code
   or (account.jenis='Bank' and r.cash_account_id is null and r.bank_coa_code is null))) then
  raise exception 'Rekonsiliasi bank sudah mencakup saldo awal; koreksi rekonsiliasi terlebih dahulu';end if;
 select * into latest from public.monetary_opening_corrections where cash_account_id=account.id order by revision desc limit 1;
 if found and (latest.original_entry_id is distinct from original.id or latest.before_value->>'base_fingerprint' is distinct from fingerprint) then
  raise exception 'Bukti sumber saldo awal berubah; perlu pencocokan';end if;
 current_amount:=coalesce(latest.new_amount,original_amount);
 select coalesce(sum(l.debit-l.credit),0),
  md5(coalesce(string_agg(jsonb_build_array(l.id,l.entry_id,l.debit,l.credit,e.tanggal,e.branch_id)::text,',' order by l.id),''))
  into balance,ledger_fingerprint from public.journal_lines l join public.journal_entries e on e.id=l.entry_id where l.account_id=cash_coa;
 return jsonb_build_object('account_id',account.id,'account_code',account.coa_code,'account_name',account.nama,
  'original_entry_id',original.id,'original_no_jurnal',original.no_jurnal,'tanggal',opening_date,'branch_id',posting_branch,
  'revision',coalesce(latest.revision,0),'old_amount',current_amount,'balance_before',balance,
  'base_fingerprint',fingerprint,'ledger_fingerprint',ledger_fingerprint);
end$$;
revoke all on function public.monetary_opening_context(uuid) from public,anon,authenticated,service_role;

create function public.preview_monetary_opening(p_account_id uuid,p_new_amount numeric,p_reason text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare context jsonb; old_amount numeric;
begin
 -- Authorize even invalid requests; no financial context leaks to a nonowner.
 perform public.monetary_opening_access(p_account_id);
 if length(btrim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'Alasan koreksi wajib diisi (3–1000 karakter)';end if;
 if p_new_amount is null or p_new_amount::text in('NaN','Infinity','-Infinity') or p_new_amount<0 or p_new_amount>1000000000000 or p_new_amount<>round(p_new_amount,2) then
  raise exception 'Nilai saldo awal harus angka rupiah valid, maksimal dua desimal';end if;
 context:=public.monetary_opening_context(p_account_id);old_amount:=(context->>'old_amount')::numeric;
 if p_new_amount=old_amount then raise exception 'Nilai saldo awal tidak berubah';end if;
 return context||jsonb_build_object('new_amount',p_new_amount,'reason',btrim(p_reason),'delta',p_new_amount-old_amount,
  'balance_after',(context->>'balance_before')::numeric+p_new_amount-old_amount,
  'reversal',jsonb_build_array(
   jsonb_build_object('code',context->>'account_code','debit',greatest(-old_amount,0),'credit',greatest(old_amount,0)),
   jsonb_build_object('code','3101','debit',greatest(old_amount,0),'credit',greatest(-old_amount,0))),
  'replacement',jsonb_build_array(
   jsonb_build_object('code',context->>'account_code','debit',p_new_amount,'credit',0),
   jsonb_build_object('code','3101','debit',0,'credit',p_new_amount)));
end$$;
revoke all on function public.preview_monetary_opening(uuid,numeric,text) from public,anon,authenticated,service_role;
grant execute on function public.preview_monetary_opening(uuid,numeric,text) to authenticated;

create function public.correct_monetary_opening(p_account_id uuid,p_new_amount numeric,p_reason text,p_preview jsonb,p_request_key text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare
 prior public.monetary_opening_requests%rowtype;context jsonb;payload jsonb;result jsonb;
 audit uuid:=gen_random_uuid();reversal uuid:=gen_random_uuid();replacement uuid:=gen_random_uuid();
 cash_coa uuid;equity_coa uuid;d date;branch uuid;old_amount numeric;version integer;
begin
 perform public.monetary_opening_access(p_account_id);
 if p_request_key is null or length(p_request_key) not between 1 and 120 or btrim(p_request_key)='' or jsonb_typeof(p_preview) is distinct from 'object' then raise exception 'Identitas koreksi atau preview tidak valid';end if;
 payload:=jsonb_build_object('account_id',p_account_id,'new_amount',p_new_amount,'reason',btrim(p_reason),'preview',p_preview);
 perform pg_advisory_xact_lock(hashtextextended('vetos:monetary-opening:'||auth.uid()::text||':'||p_request_key,0));
 select * into prior from public.monetary_opening_requests where actor_id=auth.uid() and request_key=p_request_key;
 if found then
  if prior.payload is distinct from payload then raise exception 'Permintaan digunakan untuk rincian berbeda';end if;
  return prior.result;
 end if;
 context:=public.monetary_opening_context(p_account_id);
 if not context <@ p_preview then raise exception 'Preview sudah berubah. Periksa ulang dampak sebelum menyimpan';end if;
 context:=public.preview_monetary_opening(p_account_id,p_new_amount,p_reason);
 if context is distinct from p_preview then raise exception 'Preview sudah berubah. Periksa ulang dampak sebelum menyimpan';end if;
 select id into cash_coa from public.coa_accounts where code=context->>'account_code';
 select id into equity_coa from public.coa_accounts where code='3101';
 d:=(context->>'tanggal')::date;branch:=(context->>'branch_id')::uuid;
 old_amount:=(context->>'old_amount')::numeric;version:=(context->>'revision')::integer+1;
 insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id) values
  (reversal,public.sales_next_number('JRN',d),d,'Pembalik saldo pembuka moneter — '||(context->>'account_name'),'cash-open-reversal',audit::text,branch);
 insert into public.journal_lines(entry_id,account_id,debit,credit) values
  (reversal,cash_coa,greatest(-old_amount,0),greatest(old_amount,0)),(reversal,equity_coa,greatest(old_amount,0),greatest(-old_amount,0));
 insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id) values
  (replacement,public.sales_next_number('JRN',d),d,'Pengganti saldo pembuka moneter — '||(context->>'account_name'),'cash-open-replacement',audit::text,branch);
 insert into public.journal_lines(entry_id,account_id,debit,credit) values (replacement,cash_coa,p_new_amount,0),(replacement,equity_coa,0,p_new_amount);
 insert into public.monetary_opening_corrections(id,cash_account_id,revision,reason,old_amount,new_amount,before_value,after_value,original_entry_id,reversal_entry_id,replacement_entry_id,created_by)
  values(audit,p_account_id,version,btrim(p_reason),old_amount,p_new_amount,context,
   jsonb_build_object('amount',p_new_amount,'balance',(context->>'balance_after')::numeric,'reversal',context->'reversal','replacement',context->'replacement'),
   (context->>'original_entry_id')::uuid,reversal,replacement,auth.uid());
 result:=jsonb_build_object('correction_id',audit,'revision',version,'reversal_entry_id',reversal,'replacement_entry_id',replacement,'old_amount',old_amount,'new_amount',p_new_amount,'balance_after',context->'balance_after');
 insert into public.monetary_opening_requests(actor_id,request_key,cash_account_id,payload,result) values(auth.uid(),p_request_key,p_account_id,payload,result);
 return result;
end$$;
revoke all on function public.correct_monetary_opening(uuid,numeric,text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.correct_monetary_opening(uuid,numeric,text,jsonb,text) to authenticated;

create function public.get_monetary_opening_result(p_account_id uuid,p_request_key text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare result jsonb;
begin
 perform public.monetary_opening_access(p_account_id);
 if p_request_key is null or length(p_request_key) not between 1 and 120 or btrim(p_request_key)='' then raise exception 'Identitas koreksi tidak valid';end if;
 perform pg_advisory_xact_lock(hashtextextended('vetos:monetary-opening:'||auth.uid()::text||':'||p_request_key,0));
 select r.result into result from public.monetary_opening_requests r where r.actor_id=auth.uid() and r.request_key=p_request_key and r.cash_account_id=p_account_id;
 return result;
end$$;
revoke all on function public.get_monetary_opening_result(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.get_monetary_opening_result(uuid,text) to authenticated;

-- Compatibility for the existing initial-entry forms. They can create an opening
-- once; replacing/deleting one must never bypass the monetary correction flow.
create table public.opening_balance_create_requests (
 actor_id uuid not null references public.profiles(id),request_key text not null,
 payload jsonb not null,result jsonb not null,primary key(actor_id,request_key)
);
alter table public.opening_balance_create_requests enable row level security;
revoke all on public.opening_balance_create_requests from public,anon,authenticated,service_role;

create function public.create_opening_balance_atomic(p_request_key text,p_tanggal date,p_rows jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare actor public.profiles%rowtype;prior public.opening_balance_create_requests%rowtype;payload jsonb;result jsonb;
 row_data jsonb;account uuid;equity uuid;amount numeric;side text;v_code text;lines jsonb:='[]';
 total_d numeric:=0;total_c numeric:=0;modal numeric;closed date;entry uuid:=gen_random_uuid();number text;
begin
 select * into actor from public.profiles where id=auth.uid() and is_active for share;
 if not found or actor.role not in('OWNER','ADMIN','FINANCE') or not public.has_role_capability('all_branches') then raise exception 'Akses saldo awal ditolak' using errcode='42501';end if;
 if actor.role<>'OWNER' and exists(select 1 from public.role_modules where role=actor.role)
  and not exists(select 1 from public.role_modules where role=actor.role and module_id='buku-besar') then raise exception 'Akses Buku Besar diperlukan' using errcode='42501';end if;
 if p_request_key is null or length(p_request_key) not between 1 and 120 or btrim(p_request_key)='' then raise exception 'Identitas saldo awal tidak valid';end if;
 if p_tanggal is null or not isfinite(p_tanggal) or p_tanggal>(now() at time zone 'Asia/Jakarta')::date then raise exception 'Tanggal saldo awal tidak valid';end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'Baris saldo awal tidak valid';end if;
 payload:=jsonb_build_object('tanggal',p_tanggal,'rows',p_rows);
 perform pg_advisory_xact_lock(hashtextextended('vetos:opening-create:'||auth.uid()::text||':'||p_request_key,0));
 select * into prior from public.opening_balance_create_requests where actor_id=auth.uid() and request_key=p_request_key;
 if found then
  if prior.payload is distinct from payload then raise exception 'Permintaan digunakan untuk rincian berbeda';end if;
  return prior.result;
 end if;
 select closed_until into closed from public.accounting_locks where id for share;
 if not found or (closed is not null and p_tanggal<=closed) then raise exception 'Periode saldo awal sudah ditutup atau belum tersedia';end if;
 -- Lock account identities in a fixed order before taking the ledger lock.
 perform 1 from public.coa_accounts where code='3101' or code in(select btrim(value->>'code') from jsonb_array_elements(p_rows)) order by id for share;
 for row_data in select value from jsonb_array_elements(p_rows) loop
  v_code:=btrim(row_data->>'code');amount:=(row_data->>'nilai')::numeric;side:=row_data->>'sisi';
  if jsonb_typeof(row_data) is distinct from 'object' or side is null or side not in('D','K') or amount is null or amount::text in('NaN','Infinity','-Infinity') or abs(amount)>1000000000000 or amount<>round(amount) then raise exception 'Nilai saldo awal harus rupiah bulat yang valid';end if;
  if amount=0 then continue;end if;
  if v_code='3101' then raise exception 'Modal Pemilik dihitung otomatis';end if;
  select id into account from public.coa_accounts a where a.code=v_code and is_active and not is_header and type in('ASET','LIABILITAS','EKUITAS');
  if not found then raise exception 'Akun saldo awal tidak valid';end if;
  if exists(select 1 from jsonb_array_elements(lines) x where (x->>'account_id')::uuid=account) then raise exception 'Akun saldo awal tidak boleh berulang';end if;
  if amount<0 then side:=case side when 'D' then 'K' else 'D' end;amount:=-amount;end if;
  lines:=lines||jsonb_build_array(jsonb_build_object('account_id',account,'debit',case when side='D' then amount else 0 end,'credit',case when side='K' then amount else 0 end));
  if side='D' then total_d:=total_d+amount;else total_c:=total_c+amount;end if;
 end loop;
 if greatest(total_d,total_c)<=0 or greatest(total_d,total_c)>1000000000000 then raise exception 'Total saldo awal tidak valid';end if;
 modal:=total_d-total_c;
 if modal<>0 then
  select id into equity from public.coa_accounts where coa_accounts.code='3101' and is_active and not is_header and type='EKUITAS';
  if not found then raise exception 'Akun Modal Pemilik tidak tersedia';end if;
  lines:=lines||jsonb_build_array(jsonb_build_object('account_id',equity,'debit',greatest(-modal,0),'credit',greatest(modal,0)));
 end if;
 if jsonb_array_length(lines)<2 then raise exception 'Minimal dua baris jurnal diperlukan';end if;
 lock table public.journal_entries,public.journal_lines in share row exclusive mode;
 if actor.role<>'OWNER' and (not public.has_role_capability('all_branches') or (exists(select 1 from public.role_modules where role=actor.role) and not exists(select 1 from public.role_modules where role=actor.role and module_id='buku-besar'))) then raise exception 'Akses saldo awal ditolak' using errcode='42501';end if;
 if exists(select 1 from public.journal_entries where source='saldo-awal') then raise exception 'Saldo awal sudah tersimpan. Koreksi saldo moneter dari rekening; riwayat tidak boleh diganti';end if;
 if exists(select 1 from public.monetary_opening_corrections c join public.cash_accounts a on a.id=c.cash_account_id where a.coa_code in(select btrim(value->>'code') from jsonb_array_elements(p_rows)))
  or exists(select 1 from public.journal_entries e where e.source='cash-account-opening' and e.source_ref in(select btrim(value->>'code') from jsonb_array_elements(p_rows))) then raise exception 'Rekening sudah memiliki saldo pembuka; hindari pencatatan ganda';end if;
 number:=public.sales_next_number('JRN',p_tanggal);
 insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id) values(entry,number,p_tanggal,'Saldo awal per '||p_tanggal::text,'saldo-awal',p_tanggal::text,null);
 insert into public.journal_lines(entry_id,account_id,debit,credit) select entry,(x->>'account_id')::uuid,(x->>'debit')::numeric,(x->>'credit')::numeric from jsonb_array_elements(lines) x;
 result:=jsonb_build_object('entry_id',entry,'no_jurnal',number,'modal',modal);
 insert into public.opening_balance_create_requests(actor_id,request_key,payload,result) values(auth.uid(),p_request_key,payload,result);
 return result;
end$$;
revoke all on function public.create_opening_balance_atomic(text,date,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.create_opening_balance_atomic(text,date,jsonb) to authenticated;

create function public.post_cash_account_opening_atomic(p_account_id uuid,p_amount numeric) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare account public.cash_accounts%rowtype;actor public.profiles%rowtype;original public.journal_entries%rowtype;
 cash_coa uuid;equity uuid;d date;closed date;entry uuid:=gen_random_uuid();
begin
 select * into actor from public.profiles where id=auth.uid() and is_active for share;
 if not found or actor.role not in('OWNER','ADMIN') then raise exception 'Akses membuat rekening ditolak' using errcode='42501';end if;
 if actor.role<>'OWNER' and exists(select 1 from public.role_modules where role=actor.role) and not exists(select 1 from public.role_modules where role=actor.role and module_id='kas-bank') then raise exception 'Akses Kas & Bank diperlukan' using errcode='42501';end if;
 select * into account from public.cash_accounts where id=p_account_id and is_active for share;
 if not found then raise exception 'Rekening tidak aktif';end if;
 if account.branch_id is not null then
  perform 1 from public.branches where id=account.branch_id and is_active for share;
  if not found or not public.user_can_access_branch(account.branch_id) then raise exception 'Cabang rekening tidak dapat diakses' using errcode='42501';end if;
 elsif not public.has_role_capability('all_branches') then raise exception 'Akses seluruh cabang diperlukan' using errcode='42501';end if;
 if p_amount is null or p_amount::text in('NaN','Infinity','-Infinity') or p_amount<=0 or p_amount>1000000000000 or p_amount<>round(p_amount,2) then raise exception 'Nilai saldo awal rekening tidak valid';end if;
 select closed_until into closed from public.accounting_locks where id for share;
 if not found then raise exception 'Pengaturan periode belum tersedia';end if;
 perform 1 from public.coa_accounts where code in(account.coa_code,'3101') order by id for share;
 select id into cash_coa from public.coa_accounts where code=account.coa_code and is_active and not is_header and type='ASET' and normal_balance='D';
 select id into equity from public.coa_accounts where code='3101' and is_active and not is_header and type='EKUITAS';
 if cash_coa is null or equity is null then raise exception 'Akun pembuka rekening tidak tersedia';end if;
 lock table public.journal_entries,public.journal_lines in share row exclusive mode;
 if actor.role<>'OWNER' and exists(select 1 from public.role_modules where role=actor.role) and not exists(select 1 from public.role_modules where role=actor.role and module_id='kas-bank') then raise exception 'Akses Kas & Bank diperlukan' using errcode='42501';end if;
 select * into original from public.journal_entries where source='cash-account-opening' and source_ref=account.coa_code;
 if found then
  if original.branch_id is distinct from account.branch_id or (select count(*) from public.journal_lines where entry_id=original.id)<>2
   or not exists(select 1 from public.journal_lines where entry_id=original.id and account_id=cash_coa and debit=p_amount and credit=0)
   or not exists(select 1 from public.journal_lines where entry_id=original.id and account_id=equity and debit=0 and credit=p_amount) then raise exception 'Saldo pembuka sudah memiliki rincian berbeda';end if;
  return jsonb_build_object('entry_id',original.id);
 end if;
 d:=(account.created_at at time zone 'Asia/Jakarta')::date;
 if d is null or not isfinite(d) or d<>(now() at time zone 'Asia/Jakarta')::date or (closed is not null and d<=closed) then raise exception 'Tanggal pembuka rekening tidak valid atau periode ditutup';end if;
 if exists(select 1 from public.journal_lines where account_id=cash_coa) or exists(select 1 from public.monetary_opening_corrections where cash_account_id=account.id) then raise exception 'Rekening sudah berjalan; gunakan koreksi saldo awal Owner';end if;
 insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id) values(entry,public.sales_next_number('JRN',d),d,'Saldo awal rekening '||account.nama,'cash-account-opening',account.coa_code,account.branch_id);
 insert into public.journal_lines(entry_id,account_id,debit,credit) values(entry,cash_coa,p_amount,0),(entry,equity,0,p_amount);
 return jsonb_build_object('entry_id',entry);
end$$;
revoke all on function public.post_cash_account_opening_atomic(uuid,numeric) from public,anon,authenticated,service_role;
grant execute on function public.post_cash_account_opening_atomic(uuid,numeric) to authenticated;
