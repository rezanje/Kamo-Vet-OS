-- Internal accounting only: retain each transfer, reverse its exact posted lines,
-- and optionally create a separately numbered replacement. No historical backfill.
-- Supersedes the unmerged PR62 bank-transfer proposal; do not apply both schemas.
alter table public.cash_transfers
 add column revision integer not null default 0,
 add column journal_entry_id uuid unique references public.journal_entries(id) on delete restrict,
 add column replacement_of uuid unique references public.cash_transfers(id) on delete restrict,
 add column voided_by uuid references public.profiles(id) on delete restrict,
 add column void_reason text;

create table public.cash_transfer_revisions(
 id uuid primary key default gen_random_uuid(),
 transfer_id uuid not null unique references public.cash_transfers(id) on delete restrict,
 replacement_transfer_id uuid unique references public.cash_transfers(id) on delete restrict,
 branch_id uuid references public.branches(id) on delete restrict,
 action text not null check(action in ('edit','void')),
 reason text not null check(length(btrim(reason)) between 3 and 1000),
 before_value jsonb not null, after_value jsonb not null,
 original_journal_id uuid not null references public.journal_entries(id) on delete restrict,
 reversal_journal_id uuid not null unique references public.journal_entries(id) on delete restrict,
 replacement_journal_id uuid references public.journal_entries(id) on delete restrict,
 created_by uuid not null references public.profiles(id) on delete restrict,
 created_at timestamptz not null default clock_timestamp()
);
create table public.cash_transfer_requests(
 actor_id uuid not null references public.profiles(id) on delete restrict, request_key text not null,
 transfer_id uuid not null references public.cash_transfers(id) on delete restrict,
 payload jsonb not null,result jsonb not null,created_at timestamptz not null default clock_timestamp(),
 primary key(actor_id,request_key)
);
alter table public.cash_transfer_revisions enable row level security;
alter table public.cash_transfer_requests enable row level security;
revoke all on public.cash_transfer_revisions,public.cash_transfer_requests from public,anon,authenticated,service_role;
grant select on public.cash_transfer_revisions,public.cash_transfers to authenticated;
revoke insert,update,delete,truncate on public.cash_transfers from authenticated,anon,service_role;
drop policy cash_transfers_all on public.cash_transfers;
create policy cash_transfers_read on public.cash_transfers for select to authenticated using(
 exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and p.role in ('OWNER','ADMIN','FINANCE')
  and (p.role='OWNER' or not exists(select 1 from public.role_modules where role=p.role)
   or exists(select 1 from public.role_modules where role=p.role and module_id='kas-bank')))
 and public.user_can_access_branch(branch_id)
 and exists(select 1 from public.cash_accounts a where a.id=from_account_id and (a.branch_id is null or public.user_can_access_branch(a.branch_id)))
 and exists(select 1 from public.cash_accounts a where a.id=to_account_id and (a.branch_id is null or public.user_can_access_branch(a.branch_id)))
);
create policy cash_transfer_revisions_read on public.cash_transfer_revisions for select to authenticated
 using(exists(select 1 from public.cash_transfers t where t.id=transfer_id));

create function public.guard_internal_transfer_write() returns trigger
language plpgsql set search_path='' as $$
begin
 if current_user in ('authenticated','anon','service_role') then
  raise exception 'Catatan transfer hanya boleh disimpan melalui jalur resmi' using errcode='42501';
 end if;
 return coalesce(new,old);
end$$;
create trigger internal_transfer_write_guard before insert or update or delete on public.cash_transfers
 for each row execute function public.guard_internal_transfer_write();
create trigger internal_transfer_audit_guard before insert or update or delete on public.cash_transfer_revisions
 for each row execute function public.guard_internal_transfer_write();
create trigger internal_transfer_requests_guard before insert or update or delete on public.cash_transfer_requests
 for each row execute function public.guard_internal_transfer_write();

create function public.guard_internal_transfer_journal() returns trigger
language plpgsql set search_path='' as $$
declare protected boolean;begin
 if current_user in ('authenticated','anon','service_role') then
  if tg_table_name='journal_entries' then
   protected:=new.source in ('transfer','transfer-correction','transfer-reversal','transfer-void')
    or old.source in ('transfer','transfer-correction','transfer-reversal','transfer-void');
  else
   select exists(select 1 from public.journal_entries where id in(new.entry_id,old.entry_id)
    and source in ('transfer','transfer-correction','transfer-reversal','transfer-void')) into protected;
  end if;
  if protected then raise exception 'Jurnal transfer hanya boleh diubah melalui jalur resmi' using errcode='42501';end if;
 end if;
 return coalesce(new,old);
end$$;
create trigger internal_transfer_journal_guard before insert or update or delete on public.journal_entries
 for each row execute function public.guard_internal_transfer_journal();
create trigger internal_transfer_lines_guard before insert or update or delete on public.journal_lines
 for each row execute function public.guard_internal_transfer_journal();

-- Shared locks keep actor deactivation/role changes ordered with posting and
-- recovery, without an exclusive actor lock that could deadlock reconciliation.
create function public.internal_transfer_access(p_action text) returns void
language plpgsql security definer set search_path='' as $$
declare actor public.profiles%rowtype;begin
 select * into actor from public.profiles where id=auth.uid() for share;
 if not found or not actor.is_active or actor.role not in ('OWNER','ADMIN','FINANCE')
  or (p_action<>'create' and actor.role<>'OWNER') then
  raise exception 'Akses ditolak. Hanya Super Admin/OWNER boleh mengoreksi atau membatalkan catatan transfer' using errcode='42501';
 end if;
 if actor.role<>'OWNER' and exists(select 1 from public.role_modules where role=actor.role)
  and not exists(select 1 from public.role_modules where role=actor.role and module_id='kas-bank') then
  raise exception 'Akses modul Kas & Bank diperlukan' using errcode='42501';
 end if;
end$$;
revoke all on function public.internal_transfer_access(text) from public,anon,authenticated,service_role;

create function public.internal_transfer_scope(p_transfer_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare doc public.cash_transfers%rowtype;begin
 select * into doc from public.cash_transfers where id=p_transfer_id;
 if not found or not public.user_can_access_branch(doc.branch_id) or exists(
  select 1 from public.cash_accounts a where a.id in(doc.from_account_id,doc.to_account_id)
   and a.branch_id is not null and not public.user_can_access_branch(a.branch_id)
 ) then raise exception 'Cabang atau rekening transfer tidak dapat diakses' using errcode='42501';end if;
end$$;
revoke all on function public.internal_transfer_scope(uuid) from public,anon,authenticated,service_role;

create function public.mutate_cash_transfer(
 p_request_key text,p_action text,p_transfer_id uuid,p_expected_revision integer,p_header jsonb,p_reason text
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare
 prior public.cash_transfer_requests%rowtype;doc public.cash_transfers%rowtype;replacement public.cash_transfers%rowtype;
 original public.journal_entries%rowtype;from_account public.cash_accounts%rowtype;to_account public.cash_accounts%rowtype;
 payload jsonb;result jsonb;before_value jsonb;branch uuid;d date;closed date;amount numeric;fee numeric;notes text;
 from_coa uuid;to_coa uuid;fee_coa uuid;expected jsonb;actual jsonb;old_from uuid;old_to uuid;
 journal uuid:=gen_random_uuid();reversal uuid:=gen_random_uuid();audit uuid:=gen_random_uuid();
 prefix text;digits integer;seq bigint;document_number text;
begin
 if auth.uid() is null or length(btrim(coalesce(p_request_key,''))) not between 1 and 120 or length(p_request_key)>120
  or p_action is null or p_action not in ('create','edit','void') or jsonb_typeof(p_header) is distinct from 'object'
  or (p_action='create' and (p_transfer_id is not null or p_expected_revision is not null))
  or (p_action<>'create' and (p_transfer_id is null or p_expected_revision is null or p_expected_revision<0
   or length(btrim(coalesce(p_reason,''))) not between 3 and 1000)) then
  raise exception 'Identitas atau alasan transfer tidak valid';
 end if;
 payload:=jsonb_build_object('action',p_action,'id',p_transfer_id,'revision',p_expected_revision,'header',p_header,'reason',nullif(btrim(p_reason),''));
 perform pg_advisory_xact_lock(hashtextextended('vetos:transfer:'||auth.uid()::text||':'||p_request_key,0));
 perform public.internal_transfer_access(p_action);
 if p_action='create' then branch:=nullif(p_header->>'branch_id','')::uuid;
 else
  select * into doc from public.cash_transfers where id=p_transfer_id for update;
  if not found then raise exception 'Transfer tidak ditemukan';end if;
  perform public.internal_transfer_scope(doc.id);
  branch:=doc.branch_id;
 end if;
 select * into prior from public.cash_transfer_requests where actor_id=auth.uid() and request_key=p_request_key;
 if found then
  if prior.payload is distinct from payload then raise exception 'Permintaan sudah digunakan dengan rincian berbeda';end if;
  perform public.internal_transfer_scope(prior.transfer_id);
  if prior.result->>'replacement_transfer_id' is not null then
   perform public.internal_transfer_scope((prior.result->>'replacement_transfer_id')::uuid);
  end if;
  return prior.result;
 end if;
 if not public.user_can_access_branch(branch) then raise exception 'Cabang transfer tidak dapat diakses' using errcode='42501';end if;
 select closed_until into closed from public.accounting_locks where id for share;
 if not found then raise exception 'Pengaturan periode akuntansi tidak tersedia. Hubungi administrator';end if;
 if p_action<>'create' then
  if doc.jumlah::text in ('NaN','Infinity','-Infinity') or doc.biaya_admin::text in ('NaN','Infinity','-Infinity')
   or doc.jumlah<=0 or doc.biaya_admin<0 or doc.jumlah+doc.biaya_admin>1000000000000 then
   raise exception 'Jurnal transfer sumber memiliki nominal tidak valid. Lakukan pencocokan terlebih dahulu';
  end if;
  if doc.voided_at is not null or doc.revision<>p_expected_revision then raise exception 'Transfer sudah berubah atau dibatalkan. Muat ulang sebelum mengoreksi';end if;
  if not isfinite(doc.tanggal) or doc.tanggal>(now() at time zone 'Asia/Jakarta')::date then raise exception 'Tanggal transfer sumber belum boleh dikoreksi';end if;
  if closed is not null and doc.tanggal<=closed then raise exception 'Periode akuntansi sudah ditutup';end if;
 end if;
 if p_action<>'void' then
  d:=(p_header->>'tanggal')::date;amount:=(p_header->>'jumlah')::numeric;fee:=(p_header->>'biaya_admin')::numeric;
  notes:=nullif(btrim(p_header->>'keterangan'),'');
  if d is null or not isfinite(d) or d>(now() at time zone 'Asia/Jakarta')::date then raise exception 'Tanggal transfer tidak valid';end if;
  if closed is not null and d<=closed then raise exception 'Periode akuntansi sudah ditutup';end if;
  if p_action='edit' and (d<>doc.tanggal or (nullif(p_header->>'branch_id','') is not null and (p_header->>'branch_id')::uuid is distinct from branch)) then
   raise exception 'Koreksi nominal/rekening harus memakai tanggal dan cabang catatan asli';
  end if;
  if amount is null or fee is null or amount<=0 or fee<0 or amount+fee>1000000000000
   or amount<>round(amount,2) or fee<>round(fee,2) or amount::text in ('NaN','Infinity','-Infinity')
   or fee::text in ('NaN','Infinity','-Infinity') or length(coalesce(notes,''))>1000 then raise exception 'Nilai transfer tidak valid';end if;
 end if;
 -- Lock old and new masters in one order. Never reconstruct a reversal using a
 -- changed mapping: compare the exact expected source posting below, then copy.
 perform 1 from public.cash_accounts where id in(doc.from_account_id,doc.to_account_id,
  nullif(p_header->>'from_account_id','')::uuid,nullif(p_header->>'to_account_id','')::uuid) order by id for share;
 perform 1 from public.branches where id=branch or id in(select branch_id from public.cash_accounts where id in(
  doc.from_account_id,doc.to_account_id,nullif(p_header->>'from_account_id','')::uuid,nullif(p_header->>'to_account_id','')::uuid)) order by id for share;
 if branch is not null and not exists(select 1 from public.branches where id=branch and is_active) then raise exception 'Cabang transfer tidak aktif';end if;
 if exists(select 1 from public.cash_accounts a where a.id in(doc.from_account_id,doc.to_account_id,
   nullif(p_header->>'from_account_id','')::uuid,nullif(p_header->>'to_account_id','')::uuid)
   and (not a.is_active or (a.branch_id is not null and (not public.user_can_access_branch(a.branch_id)
    or not exists(select 1 from public.branches b where b.id=a.branch_id and b.is_active))))) then
  raise exception 'Rekening transfer tidak aktif atau di luar cabang yang dapat diakses' using errcode='42501';
 end if;
 perform 1 from public.coa_accounts where code='5501' or code in(select coa_code from public.cash_accounts where id in(
  doc.from_account_id,doc.to_account_id,nullif(p_header->>'from_account_id','')::uuid,nullif(p_header->>'to_account_id','')::uuid)) order by id for share;
 select id into fee_coa from public.coa_accounts where code='5501' and is_active and not is_header and type='BEBAN';
 if p_action<>'void' then
  select * into from_account from public.cash_accounts where id=(p_header->>'from_account_id')::uuid;
  select * into to_account from public.cash_accounts where id=(p_header->>'to_account_id')::uuid;
  if from_account.id is null or to_account.id is null or from_account.id=to_account.id then raise exception 'Rekening sumber/tujuan tidak valid atau sama';end if;
  select id into from_coa from public.coa_accounts where code=from_account.coa_code and is_active and not is_header and type='ASET' and normal_balance='D';
  select id into to_coa from public.coa_accounts where code=to_account.coa_code and is_active and not is_header and type='ASET' and normal_balance='D';
  if from_coa is null or to_coa is null or from_coa=to_coa or (fee>0 and fee_coa is null) then raise exception 'Akun transfer harus akun aset detail aktif dan biaya harus akun beban';end if;
 end if;
 -- Same ledger snapshot lock as bank reconciliation and payment correction.
 -- Acquire before source row locks/number generation; both reconciliation orders
 -- either see the corrected balance or reject the correction atomically.
 lock table public.journal_entries,public.journal_lines in share row exclusive mode;
 perform public.internal_transfer_access(p_action);
 if p_action<>'create' then
  if doc.journal_entry_id is null then
   if (select count(*) from public.journal_entries where source='transfer' and source_ref=doc.no_transfer)<>1 then raise exception 'Jurnal transfer sumber tidak unik atau belum lengkap. Lakukan pencocokan terlebih dahulu';end if;
   select * into original from public.journal_entries where source='transfer' and source_ref=doc.no_transfer;
  else select * into original from public.journal_entries where id=doc.journal_entry_id;end if;
  if original.id is null or original.source<>'transfer' or original.source_ref is distinct from doc.no_transfer
   or original.branch_id is distinct from branch or original.tanggal is distinct from doc.tanggal or original.voided_at is not null
   or exists(select 1 from public.journal_entries where source in('transfer-void','transfer-reversal') and source_ref=doc.no_transfer)
   or exists(select 1 from public.cash_transfer_revisions where transfer_id=doc.id) then raise exception 'Jurnal transfer sumber tidak sesuai. Lakukan pencocokan terlebih dahulu';end if;
  select c.id into old_from from public.cash_accounts a join public.coa_accounts c on c.code=a.coa_code
   where a.id=doc.from_account_id and c.is_active and not c.is_header and c.type='ASET' and c.normal_balance='D';
  select c.id into old_to from public.cash_accounts a join public.coa_accounts c on c.code=a.coa_code
   where a.id=doc.to_account_id and c.is_active and not c.is_header and c.type='ASET' and c.normal_balance='D';
  select jsonb_agg(jsonb_build_object('account_id',a,'debit',v_debit,'credit',v_credit) order by a,v_debit,v_credit) into expected from(
   select old_to a,doc.jumlah v_debit,0::numeric v_credit union all select old_from,0,doc.jumlah+doc.biaya_admin
   union all select fee_coa,doc.biaya_admin,0 where doc.biaya_admin>0) x;
  select jsonb_agg(jsonb_build_object('account_id',account_id,'debit',debit,'credit',credit) order by account_id,debit,credit) into actual
   from public.journal_lines where entry_id=original.id;
  if old_from is null or old_to is null or (doc.biaya_admin>0 and fee_coa is null) or actual is distinct from expected then
   raise exception 'Jurnal transfer sumber tidak cocok dengan nominal/rekening. Lakukan pencocokan terlebih dahulu';
  end if;
  before_value:=jsonb_build_object('transfer',to_jsonb(doc),'journal',to_jsonb(original),'lines',
   (select jsonb_agg(to_jsonb(l) order by id) from public.journal_lines l where entry_id=original.id));
 end if;
 -- Includes backdated new transfers and every old/new affected bank account.
 -- Legacy reconciliation codes are checked even when cash_account_id is absent.
 if exists(select 1 from public.bank_reconciliations r left join public.cash_accounts a on a.id=r.cash_account_id
  left join public.coa_accounts c on c.code=coalesce(r.bank_coa_code,a.coa_code)
  where r.voided_at is null and ((p_action<>'create' and r.tanggal>=doc.tanggal and (c.id is null or c.id in(old_from,old_to)))
   or (p_action<>'void' and r.tanggal>=d and (c.id is null or c.id in(from_coa,to_coa))))) then
  raise exception 'Rekonsiliasi bank sudah mencakup rekening dan tanggal ini. Koreksi atau batalkan rekonsiliasi terkait dahulu; rekonsiliasi lama tanpa pemetaan rekening perlu dicocokkan';
 end if;
 if p_action<>'void' then
  select pola,digit into prefix,digits from public.document_numbering where jenis='TF';
  prefix:=coalesce(prefix,'TF.{YYYY}.{MM}.');digits:=coalesce(digits,5);
  prefix:=replace(replace(replace(replace(prefix,'{YYYY}',to_char(d,'YYYY')),'{YY}',to_char(d,'YY')),'{MM}',to_char(d,'MM')),'{DD}',to_char(d,'DD'));
  if digits not between 1 and 8 or length(prefix)+digits>24 then raise exception 'Format nomor transfer tidak valid';end if;
  perform pg_advisory_xact_lock(hashtextextended('vetos:transfer-number:'||prefix,0));
  select coalesce(max(substring(no_transfer from length(prefix)+1)::bigint),0)+1 into seq from public.cash_transfers
   where left(no_transfer,length(prefix))=prefix and substring(no_transfer from length(prefix)+1)~'^[0-9]+$';
  if length(seq::text)>digits then raise exception 'Urutan nomor transfer penuh';end if;
  document_number:=prefix||lpad(seq::text,digits,'0');
 end if;
 if p_action<>'create' then
  insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id)
   values(reversal,public.sales_next_number('JRN',doc.tanggal),doc.tanggal,'Pembalik transfer '||doc.no_transfer||': '||btrim(p_reason),'transfer-reversal',audit::text,branch);
  insert into public.journal_lines(entry_id,account_id,debit,credit) select reversal,account_id,credit,debit from public.journal_lines where entry_id=original.id;
  -- Financial fields, original journal, document identity and original author remain intact.
  update public.cash_transfers set voided_at=clock_timestamp(),voided_by=auth.uid(),void_reason=btrim(p_reason),revision=revision+1 where id=doc.id;
 end if;
 if p_action<>'void' then
  insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id)
   values(journal,public.sales_next_number('JRN',d),d,'Transfer '||document_number||coalesce(' — '||notes,''),'transfer',document_number,branch);
  insert into public.journal_lines(entry_id,account_id,debit,credit) values(journal,to_coa,amount,0),(journal,from_coa,0,amount+fee);
  if fee>0 then insert into public.journal_lines(entry_id,account_id,debit,credit) values(journal,fee_coa,fee,0);end if;
  insert into public.cash_transfers(no_transfer,tanggal,from_account_id,to_account_id,jumlah,biaya_admin,branch_id,keterangan,created_by,journal_entry_id,replacement_of)
   values(document_number,d,from_account.id,to_account.id,amount,fee,branch,notes,auth.uid(),journal,case when p_action='edit' then doc.id end) returning * into replacement;
  if p_action='create' then doc:=replacement;end if;
 end if;
 if p_action<>'create' then
  insert into public.cash_transfer_revisions(id,transfer_id,replacement_transfer_id,branch_id,action,reason,before_value,after_value,original_journal_id,reversal_journal_id,replacement_journal_id,created_by)
   values(audit,doc.id,replacement.id,branch,p_action,btrim(p_reason),before_value,
    jsonb_build_object('transfer',(select to_jsonb(t) from public.cash_transfers t where id=doc.id),'replacement',to_jsonb(replacement)),
    original.id,reversal,case when p_action='edit' then journal end,auth.uid());
 end if;
 result:=jsonb_build_object('transfer_id',doc.id,'no_transfer',doc.no_transfer,'revision',case when p_action='create' then 0 else doc.revision+1 end,
  'journal_entry_id',case when p_action='create' then journal else original.id end,
  'reversal_journal_id',case when p_action<>'create' then reversal end,'replacement_transfer_id',case when p_action='edit' then replacement.id end,
  'replacement_journal_id',case when p_action='edit' then journal end,'action',p_action);
 insert into public.cash_transfer_requests(actor_id,request_key,transfer_id,payload,result) values(auth.uid(),p_request_key,doc.id,payload,result);
 return result;
end$$;
revoke all on function public.mutate_cash_transfer(text,text,uuid,integer,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.mutate_cash_transfer(text,text,uuid,integer,jsonb,text) to authenticated;

create function public.get_cash_transfer_result(p_request_key text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare prior public.cash_transfer_requests%rowtype;begin
 if length(btrim(coalesce(p_request_key,''))) not between 1 and 120 or length(p_request_key)>120 then raise exception 'Identitas simpan tidak valid';end if;
 perform pg_advisory_xact_lock(hashtextextended('vetos:transfer:'||auth.uid()::text||':'||p_request_key,0));
 select * into prior from public.cash_transfer_requests where actor_id=auth.uid() and request_key=p_request_key;
 perform public.internal_transfer_access(coalesce(prior.payload->>'action','create'));
 if prior.actor_id is null then return null;end if;
 perform public.internal_transfer_scope(prior.transfer_id);
 if prior.result->>'replacement_transfer_id' is not null then
  perform public.internal_transfer_scope((prior.result->>'replacement_transfer_id')::uuid);
 end if;
 return prior.result;
end$$;
revoke all on function public.get_cash_transfer_result(text) from public,anon,authenticated,service_role;
grant execute on function public.get_cash_transfer_result(text) to authenticated;
