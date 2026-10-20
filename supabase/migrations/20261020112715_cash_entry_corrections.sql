alter table public.cash_entries
  add column if not exists revision integer not null default 0,
  add column if not exists journal_entry_id uuid references public.journal_entries(id) on delete restrict;

create or replace function public.guard_cash_correction_metadata() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if current_user in ('authenticated','anon') and (
    (tg_op='INSERT' and (coalesce(new.revision,0)<>0 or new.journal_entry_id is not null or new.voided_at is not null))
    or (tg_op='UPDATE' and new is distinct from old)
  ) then
    raise exception 'Metadata koreksi kas hanya boleh diubah melalui jalur koreksi resmi' using errcode='42501';
  end if;
  return new;
end $$;
drop trigger if exists cash_correction_metadata_guard on public.cash_entries;
create trigger cash_correction_metadata_guard before insert or update on public.cash_entries for each row execute function public.guard_cash_correction_metadata();

create table public.cash_entry_revisions (
  id uuid primary key default gen_random_uuid(),
  cash_entry_id uuid not null references public.cash_entries(id) on delete restrict,
  branch_id uuid references public.branches(id) on delete set null,
  action text not null check (action in ('edit','void')),
  reason text not null,
  before_value jsonb not null,
  after_value jsonb not null,
  original_journal_id uuid not null references public.journal_entries(id) on delete restrict,
  reversal_journal_id uuid not null references public.journal_entries(id) on delete restrict,
  replacement_journal_id uuid references public.journal_entries(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index cash_entry_revisions_entry_idx on public.cash_entry_revisions(cash_entry_id,created_at);
alter table public.cash_entry_revisions enable row level security;
revoke all on public.cash_entry_revisions from public,anon,authenticated,service_role;
grant select on public.cash_entry_revisions to authenticated;
create policy cash_entry_revisions_read on public.cash_entry_revisions for select to authenticated
using(branch_id is null or public.user_can_access_branch(branch_id));

create table public.cash_entry_revision_requests(
 actor_id uuid not null references public.profiles(id) on delete cascade,
 request_key text not null, cash_entry_id uuid not null references public.cash_entries(id) on delete restrict,
 payload jsonb not null, result jsonb not null, created_at timestamptz not null default now(),
 primary key(actor_id,request_key)
);
alter table public.cash_entry_revision_requests enable row level security;
revoke all on public.cash_entry_revision_requests from public,anon,authenticated,service_role;

create or replace function public.revise_cash_entry(
 p_request_key text,p_cash_entry_id uuid,p_expected_revision integer,p_action text,p_header jsonb,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_cash public.cash_entries%rowtype; v_prior public.cash_entry_revision_requests%rowtype;
 v_original public.journal_entries%rowtype; v_audit uuid:=gen_random_uuid(); v_reversal uuid:=gen_random_uuid(); v_replacement uuid;
 v_payload jsonb; v_result jsonb; v_closed date; v_date date; v_amount numeric; v_lawan text; v_desc text; v_rek public.cash_accounts%rowtype; v_cash_coa uuid; v_profile public.profiles%rowtype;
 v_debit numeric; v_credit numeric; v_lines integer; v_code text;
begin
 if auth.uid() is null or p_cash_entry_id is null or nullif(btrim(coalesce(p_request_key,'')),'') is null or length(p_request_key)>120
   or p_expected_revision is null or p_expected_revision<0 or p_action is null or p_action not in ('edit','void')
   or length(btrim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'Identitas, tindakan, atau alasan koreksi tidak valid'; end if;
 v_payload:=jsonb_build_object('cash_entry_id',p_cash_entry_id,'revision',p_expected_revision,'action',p_action,'header',coalesce(p_header,'{}'::jsonb),'reason',btrim(p_reason));
 perform pg_advisory_xact_lock(hashtextextended('vetos:cash-entry:'||auth.uid()::text||':'||p_request_key,0));
 select * into v_cash from public.cash_entries where id=p_cash_entry_id for update;
 if not found then raise exception 'Transaksi kas tidak ditemukan'; end if;
 if v_cash.branch_id is not null and not public.user_can_access_branch(v_cash.branch_id) then raise exception 'Cabang transaksi tidak dapat diakses' using errcode='42501'; end if;
 select * into v_prior from public.cash_entry_revision_requests where actor_id=auth.uid() and request_key=p_request_key;
 if found then
   if v_prior.payload<>v_payload then raise exception 'Permintaan sudah digunakan dengan rincian berbeda'; end if;
   select * into v_profile from public.profiles where id=auth.uid() for update;
   if not found or not v_profile.is_active or v_profile.role not in ('OWNER','ADMIN','FINANCE') then raise exception 'Akses transaksi kas ditolak' using errcode='42501'; end if;
   return v_prior.result;
 end if;
 select * into v_profile from public.profiles where id=auth.uid() for update;
 if not found or not v_profile.is_active or v_profile.role not in ('OWNER','ADMIN','FINANCE') then raise exception 'Akses transaksi kas ditolak' using errcode='42501'; end if;
 if p_action='edit' and v_profile.role<>'OWNER' then raise exception 'Hanya Super Admin yang bisa mengedit kas' using errcode='42501'; end if;
 if v_cash.voided_at is not null then raise exception 'Transaksi kas sudah dibatalkan'; end if;
 if v_cash.revision<>p_expected_revision then raise exception 'Transaksi kas sudah berubah. Muat ulang sebelum mengoreksi'; end if;
 select closed_until into v_closed from public.accounting_locks where id for update;
 if v_closed is not null and v_cash.tanggal<=v_closed then raise exception 'Periode akuntansi sudah ditutup'; end if;
 select * into v_original from public.journal_entries where id=v_cash.journal_entry_id for update;
 if not found then
   select * into v_original from public.journal_entries where source='kas-entry' and source_ref=v_cash.no_bukti for update;
   if not found or exists(select 1 from public.journal_entries where source='kas-entry' and source_ref=v_cash.no_bukti and id<>v_original.id) then raise exception 'Jurnal kas sumber tidak unik'; end if;
 end if;
 if v_original.source not in ('kas-entry','kas-entry-correction') then raise exception 'Jurnal kas tidak berasal dari transaksi ini'; end if;
 if (v_original.source='kas-entry' and v_original.source_ref is distinct from v_cash.no_bukti)
    or (v_original.source='kas-entry-correction' and not exists(select 1 from public.cash_entry_revisions r where r.id::text=v_original.source_ref and r.cash_entry_id=v_cash.id and r.replacement_journal_id=v_original.id)) then
   raise exception 'Jurnal kas tidak terhubung ke dokumen ini';
 end if;
 if v_original.branch_id is distinct from v_cash.branch_id or v_original.tanggal is distinct from v_cash.tanggal then
   raise exception 'Jurnal kas berbeda cabang atau tanggal dengan dokumen';
 end if;
 perform 1 from public.journal_lines where entry_id=v_original.id for update;
 select coalesce(sum(debit),0),coalesce(sum(credit),0),count(*) into v_debit,v_credit,v_lines from public.journal_lines where entry_id=v_original.id;
 if v_lines<>2 or v_debit<=0 or v_debit<>v_credit or exists(select 1 from public.journal_lines where entry_id=v_original.id and (debit is null or credit is null or debit<0 or credit<0 or debit>1000000000000 or credit>1000000000000 or (debit>0 and credit>0) or debit<>round(debit,2) or credit<>round(credit,2) or debit in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) or credit in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric))) then raise exception 'Jurnal kas sumber tidak lengkap atau tidak seimbang'; end if;
 if p_action='edit' then
   v_date:=coalesce(nullif(p_header->>'tanggal','')::date,v_cash.tanggal); v_amount:=coalesce(nullif(p_header->>'jumlah','')::numeric,v_cash.jumlah); v_lawan:=coalesce(nullif(btrim(p_header->>'lawan_code'),''),v_cash.lawan_code); v_desc:=coalesce(nullif(btrim(p_header->>'keterangan'),''),v_cash.keterangan);
   if v_date>(now() at time zone 'Asia/Jakarta')::date or v_amount<=0 or v_amount>1000000000000 or v_amount<>round(v_amount,2) or v_amount in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) then raise exception 'Tanggal atau jumlah kas tidak valid'; end if;
   if v_closed is not null and v_date<=v_closed then raise exception 'Periode akuntansi sudah ditutup'; end if;
   select * into v_rek from public.cash_accounts where id=coalesce(nullif(p_header->>'account_id','')::uuid,v_cash.account_id) for share;
   if not found or not v_rek.is_active or (v_rek.branch_id is not null and v_rek.branch_id is distinct from v_cash.branch_id) then raise exception 'Rekening kas tidak ditemukan atau di luar cabang'; end if;
   select id into v_cash_coa from public.coa_accounts where code=v_rek.coa_code and is_active and not is_header;
   if v_cash_coa is null then raise exception 'Akun rekening kas tidak aktif'; end if;
   if v_lawan in (select coa_code from public.cash_accounts) or not exists(select 1 from public.coa_accounts where code=v_lawan and is_active and not is_header) then raise exception 'Akun lawan tidak valid'; end if;
 end if;
 insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id) values(v_reversal,public.sales_next_number('JRN',v_original.tanggal),v_original.tanggal,'Pembalik kas '||v_cash.no_bukti,'kas-entry-reversal',v_audit::text,v_cash.branch_id);
 insert into public.journal_lines(entry_id,account_id,debit,credit) select v_reversal,account_id,credit,debit from public.journal_lines where entry_id=v_original.id;
 insert into public.cash_entry_revisions(id,cash_entry_id,branch_id,action,reason,before_value,after_value,original_journal_id,reversal_journal_id,created_by)
 values(v_audit,v_cash.id,v_cash.branch_id,p_action,btrim(p_reason),jsonb_build_object('cash',to_jsonb(v_cash),'journal',to_jsonb(v_original)), '{}'::jsonb,v_original.id,v_reversal,auth.uid());
 if p_action='edit' then
   v_replacement:=gen_random_uuid();
   insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id) values(v_replacement,public.sales_next_number('JRN',v_date),v_date,'Kas '||v_cash.jenis||' '||v_cash.no_bukti,'kas-entry-correction',v_audit::text,v_cash.branch_id);
   if v_cash.jenis='Masuk' then insert into public.journal_lines(entry_id,account_id,debit,credit) select v_replacement,v_cash_coa,v_amount,0 union all select v_replacement,a.id,0,v_amount from public.coa_accounts a where a.code=v_lawan;
   else insert into public.journal_lines(entry_id,account_id,debit,credit) select v_replacement,a.id,v_amount,0 from public.coa_accounts a where a.code=v_lawan union all select v_replacement,v_cash_coa,0,v_amount; end if;
   update public.cash_entries set tanggal=v_date,account_id=v_rek.id,lawan_code=v_lawan,jumlah=v_amount,keterangan=v_desc,journal_entry_id=v_replacement,revision=revision+1 where id=v_cash.id;
 else update public.cash_entries set voided_at=now(),revision=revision+1 where id=v_cash.id; end if;
 update public.cash_entry_revisions set replacement_journal_id=v_replacement,after_value=case when p_action='edit' then jsonb_build_object('cash',(select to_jsonb(c) from public.cash_entries c where c.id=v_cash.id),'journal',(select to_jsonb(j) from public.journal_entries j where j.id=v_replacement)) else jsonb_build_object('cash',(select to_jsonb(c) from public.cash_entries c where c.id=v_cash.id)) end where id=v_audit;
 v_result:=jsonb_build_object('cash_entry_id',v_cash.id,'revision_id',v_audit,'reversal_journal_id',v_reversal,'replacement_journal_id',v_replacement);
 insert into public.cash_entry_revision_requests(actor_id,request_key,cash_entry_id,payload,result) values(auth.uid(),p_request_key,v_cash.id,v_payload,v_result);
 return v_result;
end $$;
revoke all on function public.revise_cash_entry(text,uuid,integer,text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.revise_cash_entry(text,uuid,integer,text,jsonb,text) to authenticated;
