alter table public.bank_reconciliations
 add column revision integer not null default 0,
 add column voided_at timestamptz,
 add column bank_coa_code text,
 add column journal_entry_id uuid references public.journal_entries(id),
 add column created_by uuid references public.profiles(id);
alter table public.bank_reconciliations alter column created_at set default clock_timestamp();

create table public.bank_reconciliation_requests(
 actor_id uuid not null references public.profiles(id),request_key text not null,
 reconciliation_id uuid not null references public.bank_reconciliations(id),payload jsonb not null,result jsonb not null,
 created_at timestamptz not null default now(),primary key(actor_id,request_key)
);
alter table public.bank_reconciliation_requests enable row level security;
revoke all on public.bank_reconciliation_requests from public,anon,authenticated,service_role;
create table public.bank_reconciliation_revisions(
 id uuid primary key default gen_random_uuid(),reconciliation_id uuid not null references public.bank_reconciliations(id),
 action text not null check(action in ('edit','void')),reason text not null,before_value jsonb not null,after_value jsonb not null,
 original_journal_id uuid references public.journal_entries(id),reversal_journal_id uuid references public.journal_entries(id),
 replacement_journal_id uuid references public.journal_entries(id),created_by uuid not null references public.profiles(id),created_at timestamptz not null default now()
);
alter table public.bank_reconciliation_revisions enable row level security;
revoke all on public.bank_reconciliation_revisions from public,anon,authenticated,service_role;
grant select on public.bank_reconciliation_revisions to authenticated;
create policy bank_reconciliation_revisions_read on public.bank_reconciliation_revisions for select to authenticated
 using(exists(select 1 from public.bank_reconciliations where id=reconciliation_id));

create function public.bank_reconciliation_access() returns void
language plpgsql security definer set search_path='' as $$
declare actor public.profiles%rowtype;begin
 if auth.uid() is null then raise exception 'Login diperlukan' using errcode='42501';end if;
 select * into actor from public.profiles where id=auth.uid() and is_active for share;
 if not found or actor.role not in ('OWNER','ADMIN','FINANCE') then raise exception 'Akses keuangan diperlukan' using errcode='42501';end if;
 if actor.role<>'OWNER' and exists(select 1 from public.role_modules where role=actor.role)
  and not exists(select 1 from public.role_modules where role=actor.role and module_id='kas-bank') then
  raise exception 'Akses Kas & Bank diperlukan' using errcode='42501';end if;
 -- The account's book balance includes global and branch journals; partial visibility is insufficient.
 if not public.has_role_capability('all_branches') then raise exception 'Rekonsiliasi bank memerlukan akses seluruh cabang agar saldo buku lengkap' using errcode='42501';end if;
end$$;
revoke all on function public.bank_reconciliation_access() from public,anon,authenticated,service_role;

drop policy bankrec_all on public.bank_reconciliations;
create policy bank_reconciliations_read on public.bank_reconciliations for select to authenticated using(
 exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and p.role in ('OWNER','ADMIN','FINANCE')
  and (p.role='OWNER' or not exists(select 1 from public.role_modules where role=p.role) or exists(select 1 from public.role_modules where role=p.role and module_id='kas-bank')))
 and public.has_role_capability('all_branches')
 and (cash_account_id is null or exists(select 1 from public.cash_accounts a where a.id=cash_account_id and (a.branch_id is null or public.user_can_access_branch(a.branch_id))))
);
revoke insert,update,delete on public.bank_reconciliations from authenticated,anon,service_role;

create function public.guard_bank_reconciliation_journal() returns trigger language plpgsql set search_path='' as $$
declare protected boolean;begin
 if current_user in ('authenticated','anon','service_role') then
  if tg_table_name='journal_entries' then protected:=new.source in ('bank-rec','bank-rec-reversal') or old.source in ('bank-rec','bank-rec-reversal');
  else select exists(select 1 from public.journal_entries where id in(new.entry_id,old.entry_id) and source in ('bank-rec','bank-rec-reversal')) into protected;end if;
  if protected then raise exception 'Penyesuaian rekonsiliasi hanya melalui jalur resmi' using errcode='42501';end if;
 end if;return coalesce(new,old);
end$$;
revoke all on function public.guard_bank_reconciliation_journal() from public,anon,authenticated,service_role;
create trigger bank_reconciliation_journal_guard before insert or update or delete on public.journal_entries for each row execute function public.guard_bank_reconciliation_journal();
create trigger bank_reconciliation_lines_guard before insert or update or delete on public.journal_lines for each row execute function public.guard_bank_reconciliation_journal();

create function public.mutate_bank_reconciliation(p_request_key text,p_action text,p_id uuid,p_expected_revision integer,p_header jsonb,p_reason text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare actor uuid:=auth.uid();doc public.bank_reconciliations%rowtype;prior public.bank_reconciliation_requests%rowtype;
 bank public.cash_accounts%rowtype;old_bank public.cash_accounts%rowtype;original public.journal_entries%rowtype;
 payload jsonb;result jsonb;before_value jsonb;expected jsonb;actual jsonb;
 d date;closed date;fee numeric;interest numeric;bank_balance numeric;book_balance numeric;notes text;
 bank_coa uuid;fee_coa uuid;interest_coa uuid;old_bank_coa uuid;
 journal uuid;reversal uuid;audit uuid:=gen_random_uuid();reference uuid;replay_branch uuid;
begin
 perform public.bank_reconciliation_access();
 if p_request_key is null or length(p_request_key) not between 1 and 120 or btrim(p_request_key)='' or p_action not in ('create','edit','void') or p_action is null
  or jsonb_typeof(p_header) is distinct from 'object' then raise exception 'Identitas rekonsiliasi tidak valid';end if;
 if p_action<>'create' and (p_id is null or p_expected_revision is null or p_expected_revision<0 or length(btrim(coalesce(p_reason,''))) not between 3 and 1000) then raise exception 'Identitas atau alasan koreksi tidak valid';end if;
 if p_action<>'create' and not exists(select 1 from public.profiles where id=actor and role='OWNER') then raise exception 'Hanya Owner dapat mengoreksi rekonsiliasi' using errcode='42501';end if;
 payload:=jsonb_build_object('action',p_action,'id',p_id,'expected_revision',p_expected_revision,'header',p_header,'reason',p_reason);
 perform pg_advisory_xact_lock(hashtextextended('vetos:bank-reconciliation:'||actor::text||':'||p_request_key,0));
 if p_action<>'create' then
  select * into doc from public.bank_reconciliations where id=p_id for update;
  if not found then raise exception 'Rekonsiliasi tidak ditemukan';end if;
  if doc.cash_account_id is null then raise exception 'Rekening sumber belum tertaut; perlu pencocokan sebelum koreksi';end if;
  select * into old_bank from public.cash_accounts where id=doc.cash_account_id for share;
  if not found or (old_bank.branch_id is not null and not public.user_can_access_branch(old_bank.branch_id)) then raise exception 'Rekening sumber tidak dapat diakses' using errcode='42501';end if;
 end if;
 perform public.bank_reconciliation_access();
 select * into prior from public.bank_reconciliation_requests where actor_id=actor and request_key=p_request_key;
 if found then
  if prior.payload is distinct from payload then raise exception 'Identitas simpan dipakai untuk rincian berbeda';end if;
  select a.branch_id into replay_branch from public.bank_reconciliations r join public.cash_accounts a on a.id=r.cash_account_id where r.id=prior.reconciliation_id;
  if not found or (replay_branch is not null and not public.user_can_access_branch(replay_branch)) then raise exception 'Rekening hasil tidak dapat diakses' using errcode='42501';end if;
  return prior.result;
 end if;
 select closed_until into closed from public.accounting_locks where id for share;
 if p_action<>'create' then
  if doc.voided_at is not null or doc.revision<>p_expected_revision then raise exception 'Rekonsiliasi sudah berubah; muat ulang';end if;
  if not isfinite(doc.tanggal) or doc.tanggal>(now() at time zone 'Asia/Jakarta')::date or (closed is not null and doc.tanggal<=closed) then raise exception 'Tanggal sumber belum boleh dikoreksi atau periodenya ditutup';end if;
  before_value:=to_jsonb(doc);
 end if;
 if p_action<>'void' then
  d:=(p_header->>'tanggal')::date;fee:=(p_header->>'biaya_adm')::numeric;interest:=(p_header->>'bunga')::numeric;bank_balance:=(p_header->>'saldo_bank')::numeric;
  notes:=nullif(btrim(p_header->>'catatan'),'');
  if d is null or not isfinite(d) or d>(now() at time zone 'Asia/Jakarta')::date or (closed is not null and d<=closed) then raise exception 'Tanggal rekonsiliasi tidak valid atau periode sudah ditutup';end if;
  if fee is null or interest is null or bank_balance is null or fee<0 or interest<0
   or fee::text in ('NaN','Infinity','-Infinity') or interest::text in ('NaN','Infinity','-Infinity') or bank_balance::text in ('NaN','Infinity','-Infinity')
   or fee>1000000000000 or interest>1000000000000 or abs(bank_balance)>1000000000000
   or fee<>round(fee,2) or interest<>round(interest,2) or bank_balance<>round(bank_balance,2) or length(coalesce(notes,''))>1000 then raise exception 'Nilai rekonsiliasi tidak valid';end if;
  select * into bank from public.cash_accounts where id=(p_header->>'account_id')::uuid for share;
  if not found or not bank.is_active or bank.jenis<>'Bank' then raise exception 'Pilih rekening bank aktif';end if;
  if bank.branch_id is not null and (not public.user_can_access_branch(bank.branch_id) or not exists(select 1 from public.branches where id=bank.branch_id and is_active)) then raise exception 'Cabang rekening tidak dapat diakses atau tidak aktif' using errcode='42501';end if;
  if (select count(*) from public.cash_accounts where coa_code=bank.coa_code)<>1 then raise exception 'Akun pembukuan rekening dipakai rekening lain; gunakan akun detail terpisah';end if;
  perform 1 from public.coa_accounts where code in(bank.coa_code,'5501','4301') order by id for share;
  select id into bank_coa from public.coa_accounts where code=bank.coa_code and is_active and not is_header and type='ASET';
  select id into fee_coa from public.coa_accounts where code='5501' and is_active and not is_header;
  select id into interest_coa from public.coa_accounts where code='4301' and is_active and not is_header;
  if bank_coa is null or (fee>0 and fee_coa is null) or (interest>0 and interest_coa is null) or bank_coa in(fee_coa,interest_coa) then raise exception 'Akun penyesuaian tidak tersedia sebagai akun detail terpisah';end if;
 end if;
 -- Freeze the ledger while taking the as-of-date snapshot and posting its adjustment.
 lock table public.journal_entries,public.journal_lines in share row exclusive mode;
 perform public.bank_reconciliation_access();
 if p_action<>'create' and old_bank.branch_id is not null then
  perform 1 from public.branches where id=old_bank.branch_id and is_active for share;
  if not found or not public.user_can_access_branch(old_bank.branch_id) then raise exception 'Cabang sumber tidak dapat diakses atau tidak aktif' using errcode='42501';end if;
 end if;
 if p_action<>'void' and bank.branch_id is not null then
  perform 1 from public.branches where id=bank.branch_id and is_active for share;
  if not found or not public.user_can_access_branch(bank.branch_id) then raise exception 'Cabang rekening tidak dapat diakses atau tidak aktif' using errcode='42501';end if;
 end if;
 perform public.bank_reconciliation_access();
 if p_action<>'create' and exists(select 1 from public.bank_reconciliations x where x.cash_account_id=doc.cash_account_id and x.voided_at is null and x.id<>doc.id and x.created_at>=doc.created_at) then raise exception 'Batalkan rekonsiliasi yang lebih baru terlebih dahulu';end if;
  if p_action='edit' and exists(select 1 from public.bank_reconciliations x where x.cash_account_id=bank.id and x.id<>doc.id and x.voided_at is null and x.created_at>=doc.created_at) then raise exception 'Batalkan rekonsiliasi rekening tujuan yang lebih baru terlebih dahulu';end if;

 if p_action<>'create' and (doc.biaya_adm<>0 or doc.bunga<>0) then
  if doc.journal_entry_id is null or doc.bank_coa_code is null then raise exception 'Rekonsiliasi lama belum punya hubungan jurnal yang pasti; perlu pencocokan sebelum koreksi';end if;
  select * into original from public.journal_entries where id=doc.journal_entry_id for update;
  if not found or original.source<>'bank-rec' or original.source_ref<>doc.id::text or original.tanggal<>doc.tanggal or original.branch_id is distinct from old_bank.branch_id then raise exception 'Jurnal rekonsiliasi sumber tidak sesuai';end if;
  select id into old_bank_coa from public.coa_accounts where code=doc.bank_coa_code;
  select id into fee_coa from public.coa_accounts where code='5501';
  select id into interest_coa from public.coa_accounts where code='4301';
  select coalesce(jsonb_agg(jsonb_build_object('account_id',x.a,'debit',x.d,'credit',x.c) order by x.a,x.d,x.c),'[]') into expected from (
   select fee_coa a,doc.biaya_adm d,0::numeric c where doc.biaya_adm>0 union all select old_bank_coa,0,doc.biaya_adm where doc.biaya_adm>0
   union all select old_bank_coa,doc.bunga,0 where doc.bunga>0 union all select interest_coa,0,doc.bunga where doc.bunga>0) x;
  select coalesce(jsonb_agg(jsonb_build_object('account_id',account_id,'debit',debit,'credit',credit) order by account_id,debit,credit),'[]') into actual from public.journal_lines where entry_id=original.id;
  if actual is distinct from expected then raise exception 'Baris jurnal sumber tidak sesuai';end if;
  reversal:=gen_random_uuid();
  insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id) values(reversal,public.sales_next_number('JRN',doc.tanggal),doc.tanggal,'Pembalik rekonsiliasi bank','bank-rec-reversal',audit::text,original.branch_id);
  insert into public.journal_lines(entry_id,account_id,debit,credit) select reversal,account_id,credit,debit from public.journal_lines where entry_id=original.id;
 elsif p_action<>'create' and doc.journal_entry_id is not null then raise exception 'Jurnal sumber rekonsiliasi tanpa penyesuaian perlu dicocokkan';end if;
 if p_action<>'void' then
  select coalesce(sum(l.debit-l.credit),0) into book_balance from public.journal_lines l join public.journal_entries e on e.id=l.entry_id where l.account_id=bank_coa and e.tanggal<=d;
  if book_balance::text in ('NaN','Infinity','-Infinity') then raise exception 'Saldo buku tidak valid; tinjau jurnal sumber';end if;
  reference:=coalesce(doc.id,gen_random_uuid());
  if fee>0 or interest>0 then
   journal:=gen_random_uuid();
   insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id) values(journal,public.sales_next_number('JRN',d),d,'Penyesuaian rekonsiliasi — '||bank.nama,'bank-rec',reference::text,bank.branch_id);
   if fee>0 then insert into public.journal_lines(entry_id,account_id,debit,credit) values(journal,fee_coa,fee,0),(journal,bank_coa,0,fee);end if;
   if interest>0 then insert into public.journal_lines(entry_id,account_id,debit,credit) values(journal,bank_coa,interest,0),(journal,interest_coa,0,interest);end if;
  end if;
  if p_action='create' then
   insert into public.bank_reconciliations(id,tanggal,cash_account_id,saldo_buku,saldo_bank,biaya_adm,bunga,selisih,catatan,bank_coa_code,journal_entry_id,created_by)
    values(reference,d,bank.id,book_balance,bank_balance,fee,interest,bank_balance-(book_balance+interest-fee),notes,bank.coa_code,journal,actor) returning * into doc;
  else update public.bank_reconciliations set tanggal=d,cash_account_id=bank.id,saldo_buku=book_balance,saldo_bank=bank_balance,biaya_adm=fee,bunga=interest,selisih=bank_balance-(book_balance+interest-fee),catatan=notes,bank_coa_code=bank.coa_code,journal_entry_id=journal,revision=revision+1 where id=doc.id returning * into doc;end if;
 else update public.bank_reconciliations set voided_at=now(),revision=revision+1 where id=doc.id returning * into doc;
 end if;
 if p_action<>'create' then insert into public.bank_reconciliation_revisions(id,reconciliation_id,action,reason,before_value,after_value,original_journal_id,reversal_journal_id,replacement_journal_id,created_by) values(audit,doc.id,p_action,btrim(p_reason),before_value,to_jsonb(doc),original.id,reversal,journal,actor);end if;
 perform public.bank_reconciliation_access();
 result:=jsonb_build_object('reconciliation_id',doc.id,'revision',doc.revision);
 insert into public.bank_reconciliation_requests values(actor,p_request_key,doc.id,payload,result,now());
 return result;
end$$;
revoke all on function public.mutate_bank_reconciliation(text,text,uuid,integer,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.mutate_bank_reconciliation(text,text,uuid,integer,jsonb,text) to authenticated;

create function public.get_bank_reconciliation_result(p_request_key text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare request public.bank_reconciliation_requests%rowtype;bank_branch uuid;begin
 perform public.bank_reconciliation_access();
 if p_request_key is null or length(p_request_key) not between 1 and 120 then raise exception 'Identitas simpan tidak valid';end if;
 perform pg_advisory_xact_lock(hashtextextended('vetos:bank-reconciliation:'||auth.uid()::text||':'||p_request_key,0));
 perform public.bank_reconciliation_access();
 select * into request from public.bank_reconciliation_requests where actor_id=auth.uid() and request_key=p_request_key;
 if not found then return null;end if;
 if request.payload->>'action'<>'create' and not exists(select 1 from public.profiles where id=auth.uid() and role='OWNER') then raise exception 'Akses Owner diperlukan' using errcode='42501';end if;
 select a.branch_id into bank_branch from public.bank_reconciliations r join public.cash_accounts a on a.id=r.cash_account_id where r.id=request.reconciliation_id;
 if not found or (bank_branch is not null and not public.user_can_access_branch(bank_branch)) then raise exception 'Rekening hasil tidak dapat diakses' using errcode='42501';end if;
 return request.result;
end$$;
revoke all on function public.get_bank_reconciliation_result(text) from public,anon,authenticated,service_role;
grant execute on function public.get_bank_reconciliation_result(text) to authenticated;
