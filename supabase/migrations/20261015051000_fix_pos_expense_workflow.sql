-- Expense posting is one database transaction. Request identity is actor-scoped,
-- independent of content, and retained so a lost response cannot duplicate money.
alter table public.expenses
  add column revision integer not null default 0,
  add column journal_entry_id uuid references public.journal_entries(id) on delete restrict,
  add column voided_at timestamptz,
  add column voided_by uuid references public.profiles(id) on delete restrict,
  add column void_reason text;

create table public.expense_posting_requests (
  actor_id uuid not null references public.profiles(id),
  request_key text not null check(length(request_key) between 1 and 120),
  kind text not null,
  branch_id uuid not null references public.branches(id),
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(actor_id,request_key)
);
alter table public.expense_posting_requests enable row level security;
revoke all on public.expense_posting_requests from public,anon,authenticated,service_role;

create table public.expense_revisions (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete restrict,
  branch_id uuid not null references public.branches(id),
  action text not null check(action in ('edit','void')),
  reason text not null,
  before_value jsonb not null,
  after_value jsonb not null,
  original_journal_id uuid not null references public.journal_entries(id) on delete restrict,
  reversal_journal_id uuid references public.journal_entries(id) on delete restrict,
  replacement_journal_id uuid references public.journal_entries(id) on delete restrict,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index on public.expense_revisions(expense_id,created_at);
alter table public.expense_revisions enable row level security;
revoke all on public.expense_revisions from public,anon,authenticated,service_role;
grant select on public.expense_revisions to authenticated;
create policy expense_revisions_read on public.expense_revisions for select to authenticated
using(public.user_can_access_branch(branch_id) and exists(select 1 from public.profiles where id=auth.uid() and is_active and role in ('OWNER','ADMIN','FINANCE')));

-- Corrections must preserve their source, proof, journal and audit trail. Existing
-- legacy create paths keep working; no client may directly rewrite/delete history.
revoke update,delete on public.expenses from authenticated;
create policy expense_insert_unmanaged_metadata on public.expenses as restrictive for insert to authenticated
with check(revision=0 and journal_entry_id is null and voided_at is null and voided_by is null and void_reason is null);

create function public.expense_assert_access(p_branch uuid,p_management boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated' or not public.user_can_access_branch(p_branch)
   or not exists(select 1 from public.profiles where id=auth.uid() and is_active
     and (not p_management or (role in ('OWNER','ADMIN','FINANCE') and
       (role='OWNER' or exists(select 1 from public.role_modules m where m.role=profiles.role and m.module_id in ('pos','buku-besar'))
         or not exists(select 1 from public.role_modules m where m.role=profiles.role))))) then
   raise exception 'Akses pengeluaran ditolak.' using errcode='42501';
 end if;
end $$;
revoke all on function public.expense_assert_access(uuid,boolean) from public,anon,authenticated,service_role;

-- Recovery does not require an open shift or an open posting period. It only
-- confirms a transaction that already committed under this actor's exact key.
create function public.get_expense_posting_result(p_request_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prior public.expense_posting_requests%rowtype;
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated' then raise exception 'Akses pengeluaran ditolak.' using errcode='42501';end if;
 if p_request_key is null or length(p_request_key) not between 1 and 120 then raise exception 'Identitas pengeluaran tidak valid';end if;
 perform pg_advisory_xact_lock(hashtextextended('vetos:expense:'||auth.uid()::text||':'||p_request_key,0));
 select * into prior from public.expense_posting_requests where actor_id=auth.uid() and request_key=p_request_key;
 if not found then return null;end if;
 perform public.expense_assert_access(prior.branch_id,prior.kind='revision' or prior.payload->>'context'='backoffice');
 return prior.result;
end $$;
revoke all on function public.get_expense_posting_result(text) from public,anon;
grant execute on function public.get_expense_posting_result(text) to authenticated;

create function public.expense_account_code(p_category text) returns text
language plpgsql immutable set search_path='' as $$
begin
 return case p_category when 'Listrik & Air' then '5301' when 'Perlengkapan' then '5302'
   when 'Transportasi' then '5303' when 'Perawatan' then '5304' when 'Perawatan Aset' then '5304'
   when 'Sewa Gedung' then '5401' when 'Operasional' then '5401' when 'Lain-lain' then '5401' else null end;
end $$;
revoke all on function public.expense_account_code(text) from public,anon,authenticated,service_role;

create function public.post_expense_atomic(p_request_key text,p_context text,p_branch_id uuid,p_expense jsonb,p_attachments jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 prior public.expense_posting_requests%rowtype; payload jsonb; branch uuid; shift public.cashier_shifts%rowtype;
 doc uuid:=gen_random_uuid(); journal uuid; d date; amount numeric; category text; method text; description text; expense_code text; cash_code text; result jsonb;
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated' then raise exception 'Akses pengeluaran ditolak.' using errcode='42501';end if;
 if p_request_key is null or length(p_request_key) not between 1 and 120 or p_context is null or p_context not in ('cashier','backoffice') then raise exception 'Identitas pengeluaran tidak valid';end if;
 payload:=jsonb_build_object('context',p_context,'branch',case when p_context='backoffice' then p_branch_id else null end,'expense',p_expense,'attachments',p_attachments);
 perform pg_advisory_xact_lock(hashtextextended('vetos:expense:'||auth.uid()::text||':'||p_request_key,0));
 select * into prior from public.expense_posting_requests where actor_id=auth.uid() and request_key=p_request_key;
 if found then
   perform public.expense_assert_access(prior.branch_id,p_context='backoffice');
   if prior.kind<>'create' or prior.payload<>payload then raise exception 'Permintaan sudah digunakan dengan rincian berbeda';end if;
   return prior.result;
 end if;
 if p_context='cashier' then
   begin
     select * into strict shift from public.cashier_shifts where opened_by=auth.uid() and status='open' and shift_type='petshop' for update;
   exception when no_data_found then raise exception 'Shift tidak valid — mulai shift terlebih dahulu';
     when too_many_rows then raise exception 'Shift tidak valid — ada lebih dari satu shift terbuka';
   end;
   branch:=shift.branch_id;
 else branch:=p_branch_id;
 end if;
 perform public.expense_assert_access(branch,p_context='backoffice');
 d:=(p_expense->>'tanggal')::date; amount:=(p_expense->>'jumlah')::numeric;
 category:=p_expense->>'kategori'; method:=p_expense->>'metode_bayar'; description:=nullif(btrim(p_expense->>'deskripsi'),'');
 expense_code:=public.expense_account_code(category);
 if d is null or d>(now() at time zone 'Asia/Jakarta')::date or amount is null or amount<=0 or amount>1000000000000
   or amount::text in ('NaN','Infinity','-Infinity') or expense_code is null or method is null or method not in ('Tunai','QRIS','Transfer','Debit','Kredit','E-Wallet') then raise exception 'Tanggal, kategori, metode atau jumlah pengeluaran tidak valid';end if;
 if jsonb_typeof(p_attachments) is distinct from 'array' or jsonb_array_length(p_attachments) not between 1 and 100 then raise exception 'Lampiran bukti wajib diisi';end if;
 if exists(select 1 from jsonb_to_recordset(p_attachments) as x(path text,nama text,mime text,ukuran numeric)
   where path is null or path='' or left(path,1)='/' or position('..' in path)>0 or length(path)>2000
     or nama is null or length(nama) not between 1 and 200 or length(mime)>120
     or (ukuran is not null and (ukuran<=0 or ukuran>10485760 or ukuran::text in ('NaN','Infinity','-Infinity') or ukuran<>trunc(ukuran)))) then raise exception 'Lampiran bukti tidak valid';end if;
 perform 1 from public.accounting_locks where id for share;
 if exists(select 1 from public.accounting_locks where id and d<=closed_until) then raise exception 'Periode akuntansi sudah ditutup';end if;
 cash_code:=public.unit_posting_cash(method,branch);
 insert into public.expenses(id,branch_id,tanggal,kategori,deskripsi,jumlah,metode_bayar,bukti_url,shift_id,created_by)
 values(doc,branch,d,category,description,amount,method,p_attachments->0->>'path',case when p_context='cashier' then shift.id else null end,auth.uid());
 insert into public.document_attachments(modul,ref_id,path,nama,mime,ukuran,uploaded_by)
 select 'pengeluaran',doc,path,nama,mime,ukuran::bigint,auth.uid() from jsonb_to_recordset(p_attachments) as x(path text,nama text,mime text,ukuran numeric);
 perform public.sales_write_journal(d,branch,'expense',doc::text,'Pengeluaran: '||coalesce(description,category),
   jsonb_build_array(jsonb_build_object('code',expense_code,'debit',amount,'credit',0),jsonb_build_object('code',cash_code,'debit',0,'credit',amount)));
 select id into strict journal from public.journal_entries where source='expense' and source_ref=doc::text;
 update public.expenses set journal_entry_id=journal where id=doc;
 result:=jsonb_build_object('expense_id',doc,'journal_id',journal);
 insert into public.expense_posting_requests(actor_id,request_key,kind,branch_id,payload,result) values(auth.uid(),p_request_key,'create',branch,payload,result);
 return result;
end $$;
revoke all on function public.post_expense_atomic(text,text,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.post_expense_atomic(text,text,uuid,jsonb,jsonb) to authenticated;

create function public.revise_expense_atomic(p_request_key text,p_expense_id uuid,p_expected_revision integer,p_action text,p_expense jsonb,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 exp public.expenses%rowtype; before_value jsonb; prior public.expense_posting_requests%rowtype; payload jsonb; result jsonb;
 audit uuid:=gen_random_uuid(); original uuid; originals uuid[]; reversal uuid; replacement uuid; original_header public.journal_entries%rowtype;
 reverse_lines jsonb; debit numeric; credit numeric; valid boolean; shift_status text;
 d date; amount numeric; category text; method text; description text; expense_code text; cash_code text;
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated' then raise exception 'Akses pengeluaran ditolak.' using errcode='42501';end if;
 if p_request_key is null or length(p_request_key) not between 1 and 120 or p_action is null or p_action not in ('edit','void')
   or p_expected_revision is null or p_expected_revision<0 or length(btrim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'Identitas atau alasan koreksi tidak valid';end if;
 payload:=jsonb_build_object('expense_id',p_expense_id,'revision',p_expected_revision,'action',p_action,'expense',p_expense,'reason',btrim(p_reason));
 perform pg_advisory_xact_lock(hashtextextended('vetos:expense:'||auth.uid()::text||':'||p_request_key,0));
 select * into prior from public.expense_posting_requests where actor_id=auth.uid() and request_key=p_request_key;
 if found then
   perform public.expense_assert_access(prior.branch_id,true);
   if prior.kind<>'revision' or prior.payload<>payload then raise exception 'Permintaan sudah digunakan dengan rincian berbeda';end if;
   return prior.result;
 end if;
 select * into exp from public.expenses where id=p_expense_id for update;
 if not found then raise exception 'Pengeluaran tidak ditemukan';end if;
 perform public.expense_assert_access(exp.branch_id,true);
 if exp.revision<>p_expected_revision then raise exception 'Pengeluaran sudah berubah. Muat ulang detail sebelum mengoreksi.';end if;
 if exp.voided_at is not null then raise exception 'Pengeluaran sudah dibatalkan';end if;
 if exp.shift_id is not null then
   select status into shift_status from public.cashier_shifts where id=exp.shift_id for update;
   if shift_status is distinct from 'open' then raise exception 'Shift sudah ditutup. Koreksi memerlukan rekonsiliasi kas terlebih dahulu.';end if;
 end if;
 before_value:=to_jsonb(exp);
 if p_action='edit' then
   d:=(p_expense->>'tanggal')::date; amount:=(p_expense->>'jumlah')::numeric; category:=p_expense->>'kategori';
   method:=p_expense->>'metode_bayar'; description:=nullif(btrim(p_expense->>'deskripsi'),''); expense_code:=public.expense_account_code(category);
   if d is null or d>(now() at time zone 'Asia/Jakarta')::date or amount is null or amount<=0 or amount>1000000000000
     or amount::text in ('NaN','Infinity','-Infinity') or expense_code is null or method is null or method not in ('Tunai','QRIS','Transfer','Debit','Kredit','E-Wallet') then raise exception 'Tanggal, kategori, metode atau jumlah pengeluaran tidak valid';end if;
 else d:=exp.tanggal;
 end if;
 perform 1 from public.accounting_locks where id for share;
 if exists(select 1 from public.accounting_locks where id and (exp.tanggal<=closed_until or d<=closed_until)) then raise exception 'Periode akuntansi sudah ditutup';end if;
 original:=exp.journal_entry_id;
 if original is null then
   -- Legacy cashier expenses already reference their UUID. Never guess an old
   -- backoffice journal whose source_ref was NULL or bind a return's journal.
   select array_agg(id) into originals from public.journal_entries where source='expense' and source_ref=exp.id::text;
   if cardinality(originals) is distinct from 1 then raise exception 'Jurnal sumber belum terhubung. Rekonsiliasi jurnal pengeluaran diperlukan sebelum koreksi.';end if;
   original:=originals[1];
 end if;
 select * into original_header from public.journal_entries where id=original for update;
 if not found or original_header.branch_id is distinct from exp.branch_id or original_header.tanggal<>exp.tanggal then raise exception 'Jurnal sumber tidak sesuai dengan pengeluaran. Rekonsiliasi diperlukan.';end if;
 if (exp.revision=0 and (original_header.source<>'expense' or original_header.source_ref is distinct from exp.id::text))
   or (exp.revision>0 and (original_header.source<>'expense-correction' or not exists(
     select 1 from public.expense_revisions r where r.expense_id=exp.id and r.action='edit'
       and r.replacement_journal_id=original and r.id::text=original_header.source_ref
       and (r.after_value->>'revision')::integer=exp.revision))) then
   raise exception 'Jurnal sumber tidak terhubung ke pengeluaran ini. Rekonsiliasi diperlukan.';
 end if;
 perform 1 from public.journal_lines where entry_id=original for update;
 select sum(l.debit),sum(l.credit),bool_and(l.debit>=0 and l.credit>=0),
   jsonb_agg(jsonb_build_object('code',a.code,'debit',l.credit,'credit',l.debit))
 into debit,credit,valid,reverse_lines from public.journal_lines l join public.coa_accounts a on a.id=l.account_id where l.entry_id=original;
 if debit is distinct from exp.jumlah or credit is distinct from exp.jumlah or valid is distinct from true or exp.jumlah<=0 then raise exception 'Jurnal sumber tidak lengkap. Rekonsiliasi diperlukan.';end if;
 insert into public.expense_revisions(id,expense_id,branch_id,action,reason,before_value,after_value,original_journal_id,created_by)
 values(audit,exp.id,exp.branch_id,p_action,btrim(p_reason),before_value,before_value,original,auth.uid());
 perform public.sales_write_journal(exp.tanggal,exp.branch_id,'expense-reversal',audit::text,'Pembalik pengeluaran: '||btrim(p_reason),reverse_lines);
 select id into strict reversal from public.journal_entries where source='expense-reversal' and source_ref=audit::text;
 if p_action='edit' then
   cash_code:=public.unit_posting_cash(method,exp.branch_id);
   perform public.sales_write_journal(d,exp.branch_id,'expense-correction',audit::text,'Koreksi pengeluaran: '||coalesce(description,category),
     jsonb_build_array(jsonb_build_object('code',expense_code,'debit',amount,'credit',0),jsonb_build_object('code',cash_code,'debit',0,'credit',amount)));
   select id into strict replacement from public.journal_entries where source='expense-correction' and source_ref=audit::text;
   update public.expenses set tanggal=d,kategori=category,deskripsi=description,jumlah=amount,metode_bayar=method,journal_entry_id=replacement,revision=revision+1 where id=exp.id;
 else
   -- All existing cash/expense readers sum jumlah. Zero the effective outflow;
   -- the full original amount, source, proof and journals stay in the audit.
   update public.expenses set jumlah=0,voided_at=now(),voided_by=auth.uid(),void_reason=btrim(p_reason),revision=revision+1 where id=exp.id;
 end if;
 update public.expense_revisions set after_value=(select to_jsonb(e) from public.expenses e where e.id=exp.id),reversal_journal_id=reversal,replacement_journal_id=replacement where id=audit;
 result:=jsonb_build_object('expense_id',exp.id,'journal_id',coalesce(replacement,reversal),'revision_id',audit);
 insert into public.expense_posting_requests(actor_id,request_key,kind,branch_id,payload,result) values(auth.uid(),p_request_key,'revision',exp.branch_id,payload,result);
 return result;
end $$;
revoke all on function public.revise_expense_atomic(text,uuid,integer,text,jsonb,text) from public,anon;
grant execute on function public.revise_expense_atomic(text,uuid,integer,text,jsonb,text) to authenticated;
