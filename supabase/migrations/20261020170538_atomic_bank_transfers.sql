alter table public.cash_transfers add column revision integer not null default 0,
  add column journal_entry_id uuid references public.journal_entries(id) on delete restrict;

create table public.cash_transfer_revisions(
 id uuid primary key default gen_random_uuid(), transfer_id uuid not null references public.cash_transfers(id),
 branch_id uuid references public.branches(id), action text not null check(action in ('edit','void')),
 reason text not null, before_value jsonb not null, after_value jsonb not null,
 original_journal_id uuid not null references public.journal_entries(id),
 reversal_journal_id uuid not null references public.journal_entries(id),
 replacement_journal_id uuid references public.journal_entries(id),
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now()
);
alter table public.cash_transfer_revisions enable row level security;
revoke all on public.cash_transfer_revisions from public,anon,authenticated,service_role;
grant select on public.cash_transfer_revisions to authenticated;
create policy cash_transfer_revisions_read on public.cash_transfer_revisions for select to authenticated
 using(exists(select 1 from public.cash_transfers t where t.id=transfer_id));
create table public.cash_transfer_requests(
 actor_id uuid not null references public.profiles(id), request_key text not null,
 transfer_id uuid not null references public.cash_transfers(id),payload jsonb not null,result jsonb not null,
 created_at timestamptz not null default now(),primary key(actor_id,request_key)
);
alter table public.cash_transfer_requests enable row level security;
revoke all on public.cash_transfer_requests from public,anon,authenticated,service_role;
grant select on public.cash_transfers to authenticated;
drop policy cash_transfers_all on public.cash_transfers;
create policy cash_transfers_read on public.cash_transfers for select to authenticated using(
 exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and p.role in ('OWNER','ADMIN','FINANCE')
  and (p.role='OWNER' or not exists(select 1 from public.role_modules where role=p.role) or exists(select 1 from public.role_modules where role=p.role and module_id='kas-bank')))
 and public.user_can_access_branch(branch_id)
 and exists(select 1 from public.cash_accounts where id=from_account_id and (branch_id is null or public.user_can_access_branch(branch_id)))
 and exists(select 1 from public.cash_accounts where id=to_account_id and (branch_id is null or public.user_can_access_branch(branch_id)))
);
create function public.guard_cash_transfer_write() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user in ('authenticated','anon','service_role') then raise exception 'Transfer hanya boleh disimpan melalui jalur resmi' using errcode='42501';end if;
 return coalesce(new,old);
end$$;
create trigger cash_transfer_write_guard before insert or update or delete on public.cash_transfers
 for each row execute function public.guard_cash_transfer_write();

create function public.guard_cash_transfer_journal() returns trigger language plpgsql set search_path='' as $$
declare protected boolean;
begin
 if current_user in ('authenticated','anon','service_role') then
  if tg_table_name='journal_entries' then
   protected:=new.source in ('transfer','transfer-correction','transfer-reversal','transfer-void') or old.source in ('transfer','transfer-correction','transfer-reversal','transfer-void');
  else
   select exists(select 1 from public.journal_entries where id in (new.entry_id,old.entry_id)
    and source in ('transfer','transfer-correction','transfer-reversal','transfer-void')) into protected;
  end if;
  if protected then raise exception 'Jurnal transfer hanya boleh diubah melalui jalur resmi' using errcode='42501';end if;
 end if;
 return coalesce(new,old);
end$$;
create trigger cash_transfer_journal_guard before insert or update or delete on public.journal_entries
 for each row execute function public.guard_cash_transfer_journal();
create trigger cash_transfer_journal_lines_guard before insert or update or delete on public.journal_lines
 for each row execute function public.guard_cash_transfer_journal();

create function public.mutate_cash_transfer(p_request_key text,p_action text,p_transfer_id uuid,p_expected_revision integer,p_header jsonb,p_reason text)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor public.profiles%rowtype; prior public.cash_transfer_requests%rowtype;
 doc public.cash_transfers%rowtype; original public.journal_entries%rowtype;
 from_account public.cash_accounts%rowtype; to_account public.cash_accounts%rowtype;
 payload jsonb; result jsonb; before_value jsonb; branch uuid; d date; closed date;
 amount numeric; fee numeric; notes text; from_coa uuid; to_coa uuid; fee_coa uuid;
 journal uuid:=gen_random_uuid(); reversal uuid:=gen_random_uuid(); audit uuid:=gen_random_uuid();
 prefix text; digits integer; seq bigint; document_number text; v_debit numeric; v_credit numeric; line_count integer;
begin
 if auth.uid() is null or length(btrim(coalesce(p_request_key,''))) not between 1 and 120
  or p_action is null or p_action not in ('create','edit','void') or jsonb_typeof(p_header) is distinct from 'object'
  or (p_action<>'create' and (p_transfer_id is null or p_expected_revision is null or p_expected_revision<0 or length(btrim(coalesce(p_reason,''))) not between 3 and 1000))
  then raise exception 'Identitas atau alasan transfer tidak valid';end if;
 payload:=jsonb_build_object('action',p_action,'id',p_transfer_id,'revision',p_expected_revision,'header',p_header,'reason',nullif(btrim(p_reason),''));
 perform pg_advisory_xact_lock(hashtextextended('vetos:transfer:'||auth.uid()::text||':'||p_request_key,0));
 select * into actor from public.profiles where id=auth.uid() for update;
 if not found or not actor.is_active or actor.role not in ('OWNER','ADMIN','FINANCE')
  or (p_action='edit' and actor.role<>'OWNER') then raise exception 'Akses transfer ditolak' using errcode='42501';end if;
 if actor.role<>'OWNER' and exists(select 1 from public.role_modules where role=actor.role)
  and not exists(select 1 from public.role_modules where role=actor.role and module_id='kas-bank') then
  raise exception 'Akses transfer Kas dan Bank diperlukan' using errcode='42501';end if;
 if p_action='create' then branch:=nullif(p_header->>'branch_id','')::uuid;
 else
  select * into doc from public.cash_transfers where id=p_transfer_id for update;
  if not found then raise exception 'Transfer tidak ditemukan';end if;
  branch:=doc.branch_id;
 end if;
 if not public.user_can_access_branch(branch)
   or (branch is not null and not exists(select 1 from public.branches where id=branch and is_active)) then
   raise exception 'Cabang transfer tidak dapat diakses' using errcode='42501';end if;
 if exists(select 1 from public.cash_accounts a where a.id in (
   case when p_action='create' then (p_header->>'from_account_id')::uuid else doc.from_account_id end,
   case when p_action='create' then (p_header->>'to_account_id')::uuid else doc.to_account_id end
  ) and ((a.branch_id is not null and not public.user_can_access_branch(a.branch_id))
   or exists(select 1 from public.branches b where b.id=a.branch_id and not b.is_active))) then
  raise exception 'Rekening transfer di luar cabang yang dapat diakses' using errcode='42501';end if;
 select * into prior from public.cash_transfer_requests where actor_id=auth.uid() and request_key=p_request_key;
 if found then
  if prior.payload is distinct from payload then raise exception 'Permintaan sudah digunakan dengan rincian berbeda';end if;
  return prior.result;
 end if;
 select closed_until into closed from public.accounting_locks where id for share;
 if p_action<>'create' then
  if doc.voided_at is not null then raise exception 'Transfer sudah dibatalkan';end if;
  if doc.revision<>p_expected_revision then raise exception 'Transfer sudah berubah. Muat ulang sebelum mengoreksi';end if;
  if not isfinite(doc.tanggal) or doc.tanggal>(now() at time zone 'Asia/Jakarta')::date then raise exception 'Tanggal transfer sumber belum boleh dikoreksi';end if;
  if closed is not null and doc.tanggal<=closed then raise exception 'Periode akuntansi sudah ditutup';end if;
  before_value:=to_jsonb(doc);
  if doc.journal_entry_id is not null then
   select * into original from public.journal_entries where id=doc.journal_entry_id for update;
  else
   select * into original from public.journal_entries where source='transfer' and source_ref=doc.no_transfer for update;
  end if;
  if original.id is null or original.branch_id is distinct from doc.branch_id or original.tanggal is distinct from doc.tanggal
   or not ((original.source='transfer' and original.source_ref=doc.no_transfer)
    or (original.source='transfer-correction' and exists(select 1 from public.cash_transfer_revisions where transfer_id=doc.id and replacement_journal_id=original.id)))
   then raise exception 'Jurnal transfer sumber tidak sesuai';end if;
  if doc.journal_entry_id is null and (select count(*) from public.journal_entries where source='transfer' and source_ref=doc.no_transfer)<>1 then raise exception 'Jurnal transfer sumber tidak unik';end if;
  perform 1 from public.journal_lines where entry_id=original.id for update;
  select sum(l.debit),sum(l.credit),count(*) into v_debit,v_credit,line_count from public.journal_lines l where entry_id=original.id;
  if line_count<>(case when doc.biaya_admin>0 then 3 else 2 end) or v_debit is distinct from doc.jumlah+doc.biaya_admin or v_debit is distinct from v_credit
    or exists(select 1 from public.journal_lines where entry_id=original.id and (debit<0 or credit<0 or debit<>round(debit,2) or credit<>round(credit,2) or (debit>0 and credit>0))) then raise exception 'Jurnal transfer sumber tidak lengkap atau tidak seimbang';end if;
 end if;
 if p_action<>'void' then
  d:=(p_header->>'tanggal')::date; amount:=(p_header->>'jumlah')::numeric;fee:=(p_header->>'biaya_admin')::numeric;
  notes:=nullif(btrim(p_header->>'keterangan'),'');
  if length(coalesce(notes,''))>1000 then raise exception 'Keterangan transfer terlalu panjang';end if;
  if d is null or not isfinite(d) or d>(now() at time zone 'Asia/Jakarta')::date then raise exception 'Tanggal transfer tidak valid';end if;
  if closed is not null and d<=closed then raise exception 'Periode akuntansi sudah ditutup';end if;
  if amount is null or fee is null or amount<=0 or fee<0 or amount+fee>1000000000000
   or amount<>round(amount,2) or fee<>round(fee,2) or amount::text in ('NaN','Infinity','-Infinity') or fee::text in ('NaN','Infinity','-Infinity') then raise exception 'Nilai transfer tidak valid';end if;
  perform 1 from public.cash_accounts where id in ((p_header->>'from_account_id')::uuid,(p_header->>'to_account_id')::uuid) order by id for share;
  select * into from_account from public.cash_accounts where id=(p_header->>'from_account_id')::uuid;
  select * into to_account from public.cash_accounts where id=(p_header->>'to_account_id')::uuid;
  if from_account.id is null or to_account.id is null or from_account.id=to_account.id or not from_account.is_active or not to_account.is_active then raise exception 'Rekening transfer tidak valid atau tidak aktif';end if;
  if (from_account.branch_id is not null and not public.user_can_access_branch(from_account.branch_id)) or (to_account.branch_id is not null and not public.user_can_access_branch(to_account.branch_id)) then raise exception 'Rekening transfer di luar cabang yang dapat diakses' using errcode='42501';end if;
  if exists(select 1 from public.branches where id in (from_account.branch_id,to_account.branch_id) and not is_active) then raise exception 'Cabang rekening transfer tidak aktif';end if;
  perform 1 from public.coa_accounts where code in (from_account.coa_code,to_account.coa_code,'5501') order by id for share;
  select id into from_coa from public.coa_accounts where code=from_account.coa_code and is_active and not is_header;
  select id into to_coa from public.coa_accounts where code=to_account.coa_code and is_active and not is_header;
  select id into fee_coa from public.coa_accounts where code='5501' and is_active and not is_header;
  if from_coa is null or to_coa is null or (fee>0 and fee_coa is null) then raise exception 'Akun transfer tidak tersedia atau tidak aktif';end if;
 end if;
 if p_action='create' then
  select pola,digit into prefix,digits from public.document_numbering where jenis='TF';
  prefix:=coalesce(prefix,'TF.{YYYY}.{MM}.');digits:=coalesce(digits,5);
  prefix:=replace(replace(replace(replace(prefix,'{YYYY}',to_char(d,'YYYY')),'{YY}',to_char(d,'YY')),'{MM}',to_char(d,'MM')),'{DD}',to_char(d,'DD'));
  if digits not between 1 and 8 or length(prefix)+digits>24 then raise exception 'Format nomor transfer tidak valid';end if;
  perform pg_advisory_xact_lock(hashtextextended('vetos:transfer-number:'||prefix,0));
  select coalesce(max(substring(no_transfer from length(prefix)+1)::bigint),0)+1 into seq from public.cash_transfers
   where left(no_transfer,length(prefix))=prefix and substring(no_transfer from length(prefix)+1)~'^[0-9]+$';
  if length(seq::text)>digits then raise exception 'Urutan nomor transfer penuh';end if;
  document_number:=prefix||lpad(seq::text,digits,'0');
 else
  document_number:=doc.no_transfer;
  insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id)
   values(reversal,public.sales_next_number('JRN',original.tanggal),original.tanggal,'Pembalik transfer '||doc.no_transfer,'transfer-reversal',audit::text,branch);
  insert into public.journal_lines(entry_id,account_id,debit,credit) select reversal,account_id,credit,debit from public.journal_lines where entry_id=original.id;
 end if;
 if p_action<>'void' then
  insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id)
   values(journal,public.sales_next_number('JRN',d),d,'Transfer '||document_number||coalesce(' — '||notes,''),case when p_action='create' then 'transfer' else 'transfer-correction' end,case when p_action='create' then document_number else audit::text end,branch);
  insert into public.journal_lines(entry_id,account_id,debit,credit) values(journal,to_coa,amount,0),(journal,from_coa,0,amount+fee);
  if fee>0 then insert into public.journal_lines(entry_id,account_id,debit,credit) values(journal,fee_coa,fee,0);end if;
  if p_action='create' then
   insert into public.cash_transfers(no_transfer,tanggal,from_account_id,to_account_id,jumlah,biaya_admin,branch_id,keterangan,created_by,journal_entry_id)
    values(document_number,d,from_account.id,to_account.id,amount,fee,branch,notes,actor.id,journal) returning * into doc;
  else update public.cash_transfers set tanggal=d,from_account_id=from_account.id,to_account_id=to_account.id,jumlah=amount,biaya_admin=fee,keterangan=notes,journal_entry_id=journal,revision=revision+1 where id=doc.id returning * into doc;end if;
 else update public.cash_transfers set voided_at=now(),revision=revision+1 where id=doc.id returning * into doc;
 end if;
 if p_action<>'create' then
  insert into public.cash_transfer_revisions(id,transfer_id,branch_id,action,reason,before_value,after_value,original_journal_id,reversal_journal_id,replacement_journal_id,created_by)
   values(audit,doc.id,branch,p_action,btrim(p_reason),before_value,to_jsonb(doc),original.id,reversal,case when p_action='edit' then journal end,actor.id);
 end if;
 result:=jsonb_build_object('transfer_id',doc.id,'no_transfer',doc.no_transfer,'revision',doc.revision);
 insert into public.cash_transfer_requests(actor_id,request_key,transfer_id,payload,result) values(actor.id,p_request_key,doc.id,payload,result);
 return result;
end$$;
revoke all on function public.mutate_cash_transfer(text,text,uuid,integer,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.mutate_cash_transfer(text,text,uuid,integer,jsonb,text) to authenticated;
