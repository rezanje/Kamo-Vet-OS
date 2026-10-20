-- Backoffice expenses may override the mapped cash/bank account. Cashier
-- requests keep the existing mapping and cannot submit an account override.
create or replace function public.post_expense_atomic(p_request_key text,p_context text,p_branch_id uuid,p_expense jsonb,p_attachments jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 prior public.expense_posting_requests%rowtype; payload jsonb; branch uuid; shift public.cashier_shifts%rowtype;
 doc uuid:=gen_random_uuid(); journal uuid; d date; amount numeric; category text; method text; description text; expense_code text; cash_code text; result jsonb; selected_cash public.cash_accounts%rowtype;
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
 if p_context='cashier' and nullif(p_expense->>'account_id','') is not null then raise exception 'Pemilihan rekening hanya tersedia untuk pengeluaran backoffice';end if;
 perform public.expense_assert_access(branch,p_context='backoffice');
 d:=(p_expense->>'tanggal')::date; amount:=(p_expense->>'jumlah')::numeric;
 category:=p_expense->>'kategori'; method:=p_expense->>'metode_bayar'; description:=nullif(btrim(p_expense->>'deskripsi'),'');
 expense_code:=public.expense_account_code(category);
 if d is null or d>(now() at time zone 'Asia/Jakarta')::date or amount is null or amount<=0 or amount>1000000000000 or amount<>round(amount,2)
   or amount::text in ('NaN','Infinity','-Infinity') or expense_code is null or method is null or method not in ('Tunai','QRIS','Transfer','Debit','Kredit','E-Wallet') then raise exception 'Tanggal, kategori, metode atau jumlah pengeluaran tidak valid';end if;
 if jsonb_typeof(p_attachments) is distinct from 'array' or jsonb_array_length(p_attachments) not between 1 and 100 then raise exception 'Lampiran bukti wajib diisi';end if;
 if exists(select 1 from jsonb_to_recordset(p_attachments) as x(path text,nama text,mime text,ukuran numeric)
   where path is null or path='' or left(path,1)='/' or position('..' in path)>0 or length(path)>2000
     or nama is null or length(nama) not between 1 and 200 or length(mime)>120
     or (ukuran is not null and (ukuran<=0 or ukuran>10485760 or ukuran::text in ('NaN','Infinity','-Infinity') or ukuran<>trunc(ukuran)))) then raise exception 'Lampiran bukti tidak valid';end if;
 perform 1 from public.accounting_locks where id for share;
 if exists(select 1 from public.accounting_locks where id and d<=closed_until) then raise exception 'Periode akuntansi sudah ditutup';end if;
 if p_context='backoffice' and nullif(p_expense->>'account_id','') is not null then
   select c.* into selected_cash from public.cash_accounts c join public.coa_accounts a on a.code=c.coa_code
   where c.id=(p_expense->>'account_id')::uuid and c.is_active and (c.branch_id is null or c.branch_id=branch)
     and a.is_active and not a.is_header for share;
   if not found then raise exception 'Rekening kas/bank tidak valid untuk cabang ini';end if;
   cash_code:=selected_cash.coa_code;
 else cash_code:=public.unit_posting_cash(method,branch);
 end if;
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
