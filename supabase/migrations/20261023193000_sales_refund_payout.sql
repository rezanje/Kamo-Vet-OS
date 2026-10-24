-- Actual payout is independent of the immutable source-payment allocation.
-- A transfer request is not a posted return until finance records completion.
create table public.sales_refund_requests(
 id uuid primary key default gen_random_uuid(), sale_id uuid not null references public.sales(id),
 branch_id uuid not null references public.branches(id), requested_by uuid not null references public.profiles(id),
 request_key text not null, payload jsonb not null, quoted_total numeric not null check(quoted_total>0),
 status text not null check(status in('pending','diproses','selesai','batal')),
 processed_by uuid references public.profiles(id), processing_at timestamptz,
 completion_payload jsonb, receipt jsonb not null, return_id uuid unique references public.sales_returns(id),
 cancel_reason text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(requested_by,request_key)
);
create index sales_refund_source_status on public.sales_refund_requests(sale_id,status);
create table public.sales_refund_payouts(
 return_id uuid primary key references public.sales_returns(id), sale_id uuid not null references public.sales(id),
 branch_id uuid not null references public.branches(id), method text not null check(method in('Tunai','Transfer')),
 expense_id uuid not null unique references public.expenses(id), request_id uuid unique references public.sales_refund_requests(id),
 account_snapshot jsonb not null, amount numeric not null, actor_id uuid not null references public.profiles(id),
 point_delta integer not null default 0, created_at timestamptz not null default now()
);
alter table public.sales_refund_requests enable row level security;
alter table public.sales_refund_payouts enable row level security;
revoke all on public.sales_refund_requests,public.sales_refund_payouts from public,anon,authenticated,service_role;

create function public.sales_refund_finance_access(p_branch uuid) returns void
language plpgsql security definer set search_path='' as $$begin
 perform public.expense_assert_access(p_branch,true);perform public.sales_assert_access(p_branch);
 if not exists(select 1 from public.branches where id=p_branch and is_active) then raise exception 'Cabang refund tidak aktif';end if;
end$$;
revoke all on function public.sales_refund_finance_access(uuid) from public,anon,authenticated,service_role;

create function public.sales_refund_reserved(p_sale uuid,p_line uuid,p_except uuid default null) returns numeric
language sql stable security definer set search_path='' as $$
 select coalesce(sum((x->>'base_qty')::numeric),0) from public.sales_refund_requests r cross join lateral jsonb_array_elements(r.payload->'items')x
 where r.sale_id=p_sale and r.status='diproses' and r.id is distinct from p_except and (x->>'source_line_id')::uuid=p_line
$$;
revoke all on function public.sales_refund_reserved(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- Same source pricing/cent allocation as the return core; no price from browser.
create function public.sales_refund_quote(p_sale uuid,p_items jsonb,p_except uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.sales%rowtype;r record;l public.sale_items%rowtype;u record;used numeric;base numeric;raw_total numeric:=0;previous numeric;total numeric;ratio numeric;rows jsonb:='[]';
begin
 select * into s from public.sales where id=p_sale and channel is null and voided_at is null for update;
 if not found or (s.payment_plan is not null and s.payments_finalized_at is null) or s.total<=0 or s.subtotal<=0 then raise exception 'Sumber penjualan tidak final atau tidak dapat diretur';end if;
 -- No point reversal rule is inferred. This new payout path must not silently
 -- retain earned/redeemed loyalty on a refunded source. Existing paths unchanged.
 if coalesce(s.poin_earned,0)<>0 or coalesce(s.poin_digunakan,0)<>0
 or exists(select 1 from public.point_ledger where ref=s.no_struk)then
  raise exception 'Transaksi berpoin memerlukan rekonsiliasi pembalikan poin. Refund baru belum diposting';
 end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 100 then raise exception 'Isi 1 sampai 100 baris retur';end if;
 if (select count(*) from jsonb_array_elements(p_items))<>(select count(distinct x->>'source_line_id') from jsonb_array_elements(p_items)x) then raise exception 'Baris sumber dobel atau kosong';end if;
 ratio:=case when s.payment_plan is not null then s.total/s.subtotal else least(1,greatest(0,s.total/s.subtotal)) end;
 for r in select * from jsonb_to_recordset(p_items)x(source_line_id uuid,item_id uuid,qty numeric,satuan text,kondisi text,exp_date date) order by item_id,source_line_id loop
  if r.qty is null or r.qty<=0 or r.qty>1e9 or r.qty::text in('NaN','Infinity','-Infinity') or coalesce(r.kondisi,'baik') not in('baik','rusak') then raise exception 'Qty atau kondisi retur tidak valid';end if;
  select * into l from public.sale_items where id=r.source_line_id and sale_id=p_sale for share;
  if not found or l.item_id is null or l.item_id is distinct from r.item_id or l.faktor<=0 or l.faktor is null or l.harga<0 then raise exception 'Baris bukan sumber retur yang valid';end if;
  select * into u from public.unit_posting_factor(l.item_id,r.satuan,true);base:=r.qty*u.factor;
  if base<=0 or base>1e9 or base::text in('NaN','Infinity','-Infinity') then raise exception 'Jumlah dasar retur di luar kapasitas';end if;
  if exists(select 1 from public.sales_return_items ri join public.sales_returns rt on rt.id=ri.return_id where rt.sale_id=p_sale and rt.voided_at is null and ri.item_id=l.item_id and ri.source_line_id is null) and (select count(*) from public.sale_items where sale_id=p_sale and item_id=l.item_id)>1 then raise exception 'Retur lama perlu rekonsiliasi sumber baris';end if;
  select coalesce(sum(ri.qty),0) into used from public.sales_return_items ri join public.sales_returns rt on rt.id=ri.return_id where rt.sale_id=p_sale and rt.voided_at is null and (ri.source_line_id=l.id or (ri.source_line_id is null and ri.item_id=l.item_id));
  if base>l.qty*l.faktor-used-public.sales_refund_reserved(p_sale,l.id,p_except) then raise exception 'Qty retur melebihi sisa setelah reservasi refund diproses';end if;
  raw_total:=raw_total+base*l.harga/l.faktor*ratio;
  rows:=rows||jsonb_build_array(jsonb_build_object('source_line_id',l.id,'item_id',l.item_id,'qty',trim_scale(r.qty),'satuan',u.unit,'kondisi',coalesce(r.kondisi,'baik'),'exp_date',r.exp_date,'base_qty',base,'factor_snapshot',u.factor));
 end loop;
 select coalesce(sum(rt.total),0) into previous from public.sales_returns rt where rt.sale_id=p_sale and rt.voided_at is null;
 if s.payment_plan is not null then
  select round(coalesce(sum(ri.qty*ri.harga),0)+raw_total,2)-previous into total from public.sales_return_items ri join public.sales_returns rt on rt.id=ri.return_id where rt.sale_id=p_sale and rt.voided_at is null;
 else total:=raw_total;end if;
 if total<=0 or total<>round(total,2) or previous+total>s.total or total::text in('NaN','Infinity','-Infinity') then raise exception 'Nilai refund tidak valid atau memerlukan rekonsiliasi presisi';end if;
 return jsonb_build_object('total',total,'items',rows);
end$$;
revoke all on function public.sales_refund_quote(uuid,jsonb,uuid) from public,anon,authenticated,service_role;

create function public.post_sales_return_with_payout(p_source uuid,p_request_key text,p_header jsonb,p_items jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='8s' as $$
declare s public.sales%rowtype;prior public.sales_refund_requests%rowtype;payload jsonb;header jsonb;quote jsonb;method text;destination jsonb;result jsonb;rid uuid:=gen_random_uuid();d date;
begin
 perform public.inventory_is_average();
 select * into s from public.sales where id=p_source and channel is null for update;if not found then raise exception 'Sumber retur tidak ditemukan';end if;
 perform public.unit_posting_access('sales-return:'||p_source,s.branch_id);
 if p_request_key is null or p_request_key !~ '^[A-Za-z0-9._:-]{1,120}$' or jsonb_typeof(p_header) is distinct from 'object' then raise exception 'Permintaan refund tidak valid';end if;
 method:=p_header->>'refund_method';if method is null or method not in('Tunai','Transfer') then raise exception 'Pilih payout Tunai atau Transfer';end if;
 d:=(p_header->>'tanggal')::date;if d is null or not isfinite(d) or d>(now() at time zone 'Asia/Jakarta')::date then raise exception 'Tanggal permintaan refund tidak valid';end if;
 header:=jsonb_build_object('tanggal',d,'keterangan',nullif(btrim(p_header->>'keterangan'),''),'dari',case when p_header->>'dari'='kasir' then 'kasir' else 'office' end);
 destination:=case when method='Transfer' then jsonb_build_object('bank',btrim(p_header#>>'{destination,bank}'),'account',btrim(p_header#>>'{destination,account}'),'name',btrim(p_header#>>'{destination,name}')) else null end;
 if method='Transfer' and (coalesce(length(destination->>'bank'),0) not between 1 and 80 or coalesce(length(destination->>'name'),0) not between 1 and 120 or coalesce(destination->>'account','') !~ '^[A-Za-z0-9 -]{3,40}$') then raise exception 'Lengkapi bank, nomor rekening dan nama tujuan refund';end if;
 payload:=jsonb_build_object('header',header,'items',p_items,'method',method,'destination',destination);
 perform pg_advisory_xact_lock(hashtext('vetos:refund-request:'||auth.uid()::text||':'||p_request_key)::bigint);
 select * into prior from public.sales_refund_requests where requested_by=auth.uid() and request_key=p_request_key;
 if found then
  if prior.sale_id<>p_source or prior.payload->'submitted' is distinct from payload then raise exception 'Identitas refund digunakan dengan rincian berbeda';end if;
  return prior.receipt;
 end if;
 if header->>'dari'='kasir' then
  perform 1 from public.cashier_shifts where opened_by=auth.uid() and branch_id=s.branch_id and status='open' and shift_type='petshop' for update;
  if not found then raise exception 'Shift petshop aktif diperlukan';end if;
 else perform public.sales_assert_access(s.branch_id);end if;
 quote:=public.sales_refund_quote(p_source,p_items);
 if method='Tunai' then
  header:=header||jsonb_build_object('refund_payout',jsonb_build_object('method','Tunai','quoted_total',quote->'total'));
  result:=public.post_unit_return('sales',p_source,'j03-cash:'||md5(p_request_key),header,quote->'items')||jsonb_build_object('status','selesai','refund_request_id',rid);
  perform public.refresh_customer_spending(customer_id)from public.sales where id=p_source and customer_id is not null;
 else result:=jsonb_build_object('refund_request_id',rid,'status','pending','quoted_total',quote->'total','source_ref',s.no_struk);end if;
 insert into public.sales_refund_requests(id,sale_id,branch_id,requested_by,request_key,payload,quoted_total,status,return_id,receipt)
 values(rid,p_source,s.branch_id,auth.uid(),p_request_key,payload||jsonb_build_object('submitted',payload,'items',quote->'items'),(quote->>'total')::numeric,case when method='Tunai' then 'selesai' else 'pending' end,(result->>'document_id')::uuid,result);
 return result;
end$$;
revoke all on function public.post_sales_return_with_payout(uuid,text,jsonb,jsonb) from public,anon,service_role;
grant execute on function public.post_sales_return_with_payout(uuid,text,jsonb,jsonb) to authenticated;

create function public.claim_sales_refund_request(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$declare r public.sales_refund_requests%rowtype;sale uuid;quote jsonb;begin
 perform public.inventory_is_average();select sale_id into sale from public.sales_refund_requests where id=p_id;
 perform 1 from public.sales where id=sale for update;
 select * into r from public.sales_refund_requests where id=p_id for update;if not found then raise exception 'Permintaan refund tidak ditemukan';end if;
 perform public.sales_refund_finance_access(r.branch_id);
 if r.status='diproses' and r.processed_by=auth.uid() then return r.receipt;end if;
 if r.status<>'pending' then raise exception 'Refund sudah diproses petugas lain atau bukan pending';end if;
 quote:=public.sales_refund_quote(r.sale_id,r.payload->'items');
 if (quote->>'total')::numeric<>r.quoted_total or quote->'items' is distinct from r.payload->'items' then raise exception 'Sumber/nilai refund berubah; periksa dan buat permintaan baru';end if;
 update public.sales_refund_requests set status='diproses',processed_by=auth.uid(),processing_at=now(),updated_at=now(),receipt=receipt||jsonb_build_object('status','diproses') where id=p_id returning * into r;
 return r.receipt;
end$$;
revoke all on function public.claim_sales_refund_request(uuid) from public,anon,service_role;
grant execute on function public.claim_sales_refund_request(uuid) to authenticated;

create function public.complete_sales_refund_request(p_id uuid,p_date date,p_account uuid,p_reference text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='8s' as $$
declare r public.sales_refund_requests%rowtype;sale uuid;v_completion jsonb;quote jsonb;header jsonb;result jsonb;begin
 perform public.inventory_is_average();select sale_id into sale from public.sales_refund_requests where id=p_id;
 perform 1 from public.sales where id=sale for update;select * into r from public.sales_refund_requests where id=p_id for update;
 if not found then raise exception 'Permintaan refund tidak ditemukan';end if;perform public.sales_refund_finance_access(r.branch_id);
 if p_date is null or not isfinite(p_date) or p_date>(now() at time zone 'Asia/Jakarta')::date or p_date<(r.payload#>>'{header,tanggal}')::date or coalesce(length(btrim(p_reference)),0) not between 1 and 120 or p_account is null then raise exception 'Isi tanggal, rekening dan referensi transfer yang valid';end if;
 v_completion:=jsonb_build_object('tanggal',p_date,'account_id',p_account,'reference',btrim(p_reference));
 if r.status='selesai' then if r.completion_payload is distinct from v_completion then raise exception 'Transfer sudah tercatat dengan rincian berbeda';end if;return r.receipt;end if;
 if r.status<>'diproses' or r.processed_by is distinct from auth.uid() then raise exception 'Ambil proses refund sebelum mencatat transfer';end if;
 quote:=public.sales_refund_quote(r.sale_id,r.payload->'items',r.id);
 if (quote->>'total')::numeric<>r.quoted_total or quote->'items' is distinct from r.payload->'items' then raise exception 'Sumber/nilai refund berubah; rekonsiliasi sebelum pencatatan';end if;
 update public.sales_refund_requests set completion_payload=v_completion where id=r.id;
 header:=(r.payload->'header')||jsonb_build_object('tanggal',p_date,'dari','office','refund_payout',jsonb_build_object('method','Transfer','quoted_total',r.quoted_total,'refund_request_id',r.id,'account_id',p_account,'reference',btrim(p_reference)));
 result:=public.post_unit_return('sales',r.sale_id,'j03-transfer:'||r.id,header,r.payload->'items')||jsonb_build_object('status','selesai','refund_request_id',r.id);
 perform public.refresh_customer_spending(customer_id)from public.sales where id=r.sale_id and customer_id is not null;
 update public.sales_refund_requests set status='selesai',return_id=(result->>'document_id')::uuid,receipt=result,updated_at=now() where id=r.id;
 return result;
end$$;
revoke all on function public.complete_sales_refund_request(uuid,date,uuid,text) from public,anon,service_role;
grant execute on function public.complete_sales_refund_request(uuid,date,uuid,text) to authenticated;

create function public.pos_sale_post_refund_selected(p_sale public.sales,p_doc uuid,p_no text,p_date date,p_total numeric,p_payout jsonb,p_key text,p_items jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare previous numeric;cumulative numeric;source_lines jsonb;source_vat numeric;source_discount numeric;source_fee numeric;fee numeric;vat numeric;discount numeric;goods numeric;old_goods numeric;
 method text;cash text;shift uuid;expense uuid:=gen_random_uuid();account public.cash_accounts%rowtype;request public.sales_refund_requests%rowtype;r record;allocated numeric:=0;lines jsonb;
begin
 if p_payout is null then perform public.pos_sale_post_refund(p_sale,p_doc,p_no,p_date,p_total);return;end if;
 method:=p_payout->>'method';if method is null or method not in('Tunai','Transfer') or (p_payout->>'quoted_total')::numeric is distinct from p_total then raise exception 'Payout refund tidak valid';end if;
 if method='Tunai' then
  select id into shift from public.cashier_shifts where opened_by=auth.uid() and branch_id=p_sale.branch_id and status='open' and shift_type='petshop' order by opened_at desc,id limit 1 for update;
  if not found then raise exception 'Refund Tunai memerlukan shift petshop aktif';end if;
  select a.* into account from public.payment_account_map m join public.cash_accounts a on a.id=m.cash_account_id where m.metode='Tunai' and (m.branch_id=p_sale.branch_id or m.branch_id is null) order by m.branch_id nulls last limit 1 for share of m,a;
  if not found then raise exception 'Pemetaan kas Tunai belum tersedia';end if;
 else
  perform public.sales_refund_finance_access(p_sale.branch_id);
  select * into request from public.sales_refund_requests where id=(p_payout->>'refund_request_id')::uuid for update;
  if not found or request.sale_id<>p_sale.id or request.status<>'diproses' or request.processed_by is distinct from auth.uid() or request.completion_payload is null or request.payload->'items' is distinct from p_items or request.quoted_total<>p_total or p_key<>'j03-transfer:'||request.id
    or request.completion_payload is distinct from jsonb_build_object('tanggal',p_date,'account_id',(p_payout->>'account_id')::uuid,'reference',p_payout->>'reference') then raise exception 'Transfer harus melalui proses finance dan rincian permintaan yang sama';end if;
  select * into account from public.cash_accounts where id=(p_payout->>'account_id')::uuid for share;
 end if;
 if account.id is null or not account.is_active or account.jenis<>(case when method='Tunai' then 'Kas' else 'Bank' end) or (account.branch_id is not null and (account.branch_id<>p_sale.branch_id or not public.user_can_access_branch(account.branch_id))) then raise exception 'Rekening payout tidak aktif atau berbeda cabang';end if;
 perform 1 from public.coa_accounts where code=account.coa_code and type='ASET' and is_active and not is_header for share;if not found then raise exception 'COA payout tidak valid';end if;cash:=account.coa_code;
 select coalesce(sum(total),0) into previous from public.sales_returns where sale_id=p_sale.id and id<>p_doc and voided_at is null;cumulative:=previous+p_total;
 if p_total<=0 or p_total<>round(p_total,2) or cumulative>p_sale.total then raise exception 'Refund melebihi pembayaran sumber';end if;
 if p_sale.payment_plan is not null then
  if p_sale.payments_finalized_at is null or (select coalesce(sum(f.amount),0) from public.sale_payment_refunds f join public.sale_payments p on p.id=f.sale_payment_id join public.sales_returns rt on rt.id=f.sales_return_id and rt.voided_at is null where p.sale_id=p_sale.id) is distinct from previous then raise exception 'Alokasi pembayaran sumber perlu rekonsiliasi';end if;
  select expected_lines into strict source_lines from public.pos_sale_postings where sale_id=p_sale.id;
 else
  select jsonb_agg(jsonb_build_object('code',a.code,'debit',l.debit,'credit',l.credit)) into source_lines from public.journal_lines l join public.journal_entries j on j.id=l.entry_id join public.coa_accounts a on a.id=l.account_id where j.source='sale' and j.source_ref=p_sale.no_struk and j.voided_at is null;
  if source_lines is null or (select sum(debit-credit) from jsonb_to_recordset(source_lines)x(debit numeric,credit numeric))<>0 then raise exception 'Jurnal sumber legacy perlu rekonsiliasi';end if;
 end if;
 select coalesce(sum(credit-debit) filter(where code='2201'),0),coalesce(sum(debit-credit) filter(where code='4102'),0),coalesce(sum(credit-debit) filter(where code='4303'),0) into source_vat,source_discount,source_fee from jsonb_to_recordset(source_lines)x(code text,debit numeric,credit numeric);
 if source_fee<0 or source_fee>=p_sale.total or source_vat<0 or source_discount<0 then raise exception 'Komponen jurnal refund tidak valid';end if;
 fee:=round(source_fee*cumulative/p_sale.total,2)-round(source_fee*previous/p_sale.total,2);
 goods:=cumulative-round(source_fee*cumulative/p_sale.total,2);old_goods:=previous-round(source_fee*previous/p_sale.total,2);
 vat:=round(source_vat*goods/(p_sale.total-source_fee),2)-round(source_vat*old_goods/(p_sale.total-source_fee),2);
 discount:=round(source_discount*cumulative/p_sale.total,2)-round(source_discount*previous/p_sale.total,2);
 insert into public.expenses(id,branch_id,tanggal,kategori,deskripsi,jumlah,metode_bayar,shift_id,created_by) values(expense,p_sale.branch_id,p_date,'Retur Penjualan','Refund retur '||p_no||' (struk '||p_sale.no_struk||')',p_total,method,shift,auth.uid());
 if p_sale.payment_plan is not null then
  for r in select p.id,t.amount-coalesce((select sum(f.amount) from public.sale_payment_refunds f join public.sales_returns rt on rt.id=f.sales_return_id and rt.voided_at is null where f.sale_payment_id=p.id),0) refund from public.sale_payments p join public.pos_sale_refund_targets(p_sale.id,cumulative)t on t.sale_payment_id=p.id order by p.method,p.id loop
   if r.refund<0 then raise exception 'Alokasi refund negatif';end if;if r.refund=0 then continue;end if;
   insert into public.sale_payment_refunds(sales_return_id,sale_payment_id,amount,expense_id) values(p_doc,r.id,r.refund,expense);allocated:=allocated+r.refund;
  end loop;if allocated<>p_total then raise exception 'Alokasi sumber refund tidak cocok';end if;
 end if;
 lines:=jsonb_build_array(jsonb_build_object('code','4101','debit',p_total-fee-vat+discount,'credit',0),jsonb_build_object('code',cash,'debit',0,'credit',p_total));
 if fee>0 then lines:=lines||jsonb_build_array(jsonb_build_object('code','4303','debit',fee,'credit',0));end if;
 if discount>0 then lines:=lines||jsonb_build_array(jsonb_build_object('code','4102','debit',0,'credit',discount));end if;
 if vat>0 then lines:=lines||jsonb_build_array(jsonb_build_object('code','2201','debit',vat,'credit',0));end if;
 perform public.sales_write_journal(p_date,p_sale.branch_id,'sales-return',p_no,'Retur penjualan '||p_no,lines);
 insert into public.sales_refund_payouts(return_id,sale_id,branch_id,method,expense_id,request_id,account_snapshot,amount,actor_id) values(p_doc,p_sale.id,p_sale.branch_id,method,expense,request.id,to_jsonb(account),p_total,auth.uid());
end$$;
revoke all on function public.pos_sale_post_refund_selected(public.sales,uuid,text,date,numeric,jsonb,text,jsonb) from public,anon,authenticated,service_role;

-- Exact insertion points only; preserve unrelated return/correction logic.
do $patch$declare body text;needle text;last_line text;begin
 body:=pg_get_functiondef('public.return_record_post_base(text,uuid,text,jsonb,jsonb)'::regprocedure);
 needle:='available:=src.qty*src.faktor-used;';if position(needle in body)=0 then raise exception 'Return reservation provenance mismatch';end if;
 body:=replace(body,needle,needle||E'\n  if p_kind=''sales'' then available:=available-public.sales_refund_reserved(p_source,src.id,nullif(p_header#>>''{refund_payout,refund_request_id}'','''')::uuid);end if;');
 needle:='perform public.pos_sale_post_refund(sale,doc,no,d,total);';if position(needle in body)=0 then raise exception 'Planned refund provenance mismatch';end if;
 body:=replace(body,needle,'perform public.pos_sale_post_refund_selected(sale,doc,no,d,total,p_header->''refund_payout'',p_request_key,p_items);');
 needle:=$old$if sale.metode_bayar='Tunai' then select id into shift$old$;
 if position(needle in body)=0 then raise exception 'Legacy refund provenance mismatch';end if;
 body:=replace(body,needle,E'if p_header ? ''refund_payout'' then\n   perform public.pos_sale_post_refund_selected(sale,doc,no,d,total,p_header->''refund_payout'',p_request_key,p_items);\n  else\n  '||needle);
 last_line:=$old$jsonb_build_object('code',cash,'debit',0,'credit',total)));$old$;
 if position(last_line in body)=0 then raise exception 'Legacy journal provenance mismatch';end if;
 body:=replace(body,last_line,last_line||E'\n  end if;');execute body;
end$patch$;

create function public.guard_processing_sales_refund_source() returns trigger
language plpgsql security definer set search_path='' as $$declare source uuid;begin
 if tg_table_name='sales' then source:=old.id;elsif tg_op='INSERT' then source:=new.sale_id;else source:=old.sale_id;end if;
 if exists(select 1 from public.sales_refund_requests where sale_id=source and status='diproses') then
  if tg_op='UPDATE' and to_jsonb(new) is not distinct from to_jsonb(old) then return new;end if;
  raise exception 'Sumber sedang direservasi refund finance. Selesaikan atau batalkan permintaan belum dibayar sebelum koreksi sumber';
 end if;
 if tg_op='DELETE' then return old;else return new;end if;
end$$;
revoke all on function public.guard_processing_sales_refund_source() from public,anon,authenticated,service_role;
create trigger sales_refund_source_guard before update or delete on public.sales for each row execute function public.guard_processing_sales_refund_source();
create trigger sales_refund_line_guard before insert or update or delete on public.sale_items for each row execute function public.guard_processing_sales_refund_source();
create trigger sales_refund_prior_return_guard before update or delete on public.sales_returns for each row execute function public.guard_processing_sales_refund_source();

create function public.guard_selected_sales_refund_correction() returns trigger
language plpgsql security definer set search_path='' as $$begin
 if exists(select 1 from public.sales_refund_payouts where return_id=old.id) and (tg_op='DELETE' or to_jsonb(new) is distinct from to_jsonb(old)) then
  raise exception 'Payout metode terpilih sudah tercatat. Koreksi memerlukan rekonsiliasi refund finance; jangan membayar ulang';
 end if;
 if tg_op='DELETE' then return old;else return new;end if;
end$$;
revoke all on function public.guard_selected_sales_refund_correction() from public,anon,authenticated,service_role;
create trigger sales_refund_selected_guard before update or delete on public.sales_returns for each row execute function public.guard_selected_sales_refund_correction();

create function public.get_sales_refund_result(p_request_key text) returns jsonb
language plpgsql security definer set search_path='' as $$declare r public.sales_refund_requests%rowtype;begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated' or not exists(select 1 from public.profiles where id=auth.uid() and is_active) then raise exception 'Sesi aktif diperlukan' using errcode='42501';end if;
 select * into r from public.sales_refund_requests where requested_by=auth.uid() and request_key=p_request_key;
 if not found then return null;end if;
 if not public.user_can_access_branch(r.branch_id) then raise exception 'Cabang refund tidak dapat diakses' using errcode='42501';end if;
 return r.receipt;
end$$;
revoke all on function public.get_sales_refund_result(text) from public,anon,service_role;
grant execute on function public.get_sales_refund_result(text) to authenticated;

create function public.get_sales_refund_requests(p_sale_id uuid default null,p_office boolean default false,p_status text default '',p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$declare r record;b uuid;allowed uuid[]:='{}';result jsonb:='[]';begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated' or not exists(select 1 from public.profiles where id=auth.uid() and is_active) then raise exception 'Sesi aktif diperlukan' using errcode='42501';end if;
 if p_office and not exists(select 1 from public.profiles where id=auth.uid() and role in('OWNER','ADMIN','FINANCE')) then raise exception 'Antrian refund hanya tersedia untuk finance berwenang' using errcode='42501';end if;
 if p_status not in('','pending','diproses','selesai','batal') or p_offset is null or p_offset<0 or p_offset>100000 then raise exception 'Filter refund tidak valid';end if;
 -- Authorize branches before pagination: inaccessible rows must not consume a page.
 for b in select id from public.branches where public.user_can_access_branch(id) and (not p_office or is_active) loop
  if p_office then begin perform public.sales_refund_finance_access(b);exception when insufficient_privilege then continue;end;end if;
  allowed:=array_append(allowed,b);
 end loop;
 for r in select q.*,s.no_struk from public.sales_refund_requests q join public.sales s on s.id=q.sale_id where q.branch_id=any(allowed) and (p_office or q.requested_by=auth.uid()) and (p_sale_id is null or q.sale_id=p_sale_id) and (p_status='' or q.status=p_status) order by q.created_at desc,q.id limit 100 offset p_offset loop
  result:=result||jsonb_build_array(jsonb_build_object('id',r.id,'sale_id',r.sale_id,'source_ref',r.no_struk,'branch_id',r.branch_id,'requested_by',r.requested_by,'status',r.status,'quoted_total',r.quoted_total,'destination',r.payload->'destination','requested_date',r.payload#>>'{header,tanggal}','created_at',r.created_at,'processed_by',r.processed_by,'return_id',r.return_id,'receipt',r.receipt));
 end loop;return result;
end$$;
revoke all on function public.get_sales_refund_requests(uuid,boolean,text,integer) from public,anon,service_role;
grant execute on function public.get_sales_refund_requests(uuid,boolean,text,integer) to authenticated;

create function public.cancel_sales_refund_request(p_id uuid,p_reason text,p_unpaid_confirmed boolean) returns jsonb
language plpgsql security definer set search_path='' as $$declare r public.sales_refund_requests%rowtype;sale uuid;begin
 perform public.inventory_is_average();select sale_id into sale from public.sales_refund_requests where id=p_id;perform 1 from public.sales where id=sale for update;
 select * into r from public.sales_refund_requests where id=p_id for update;
 if not found then raise exception 'Permintaan refund tidak ditemukan';end if;
 if auth.uid() is null or auth.role() is distinct from 'authenticated' or not public.user_can_access_branch(r.branch_id) or not exists(select 1 from public.profiles where id=auth.uid() and is_active) then raise exception 'Akses refund ditolak' using errcode='42501';end if;
 if r.status='batal' then return r.receipt;end if;
 if r.status not in('pending','diproses') or p_unpaid_confirmed is distinct from true or coalesce(length(btrim(p_reason)),0) not between 3 and 500 then raise exception 'Hanya refund belum dibayar yang boleh dibatalkan dengan konfirmasi dan alasan';end if;
 if r.requested_by is distinct from auth.uid() or r.status='diproses' then
  perform public.sales_refund_finance_access(r.branch_id);
  if r.status='diproses' and r.processed_by is distinct from auth.uid() and not exists(select 1 from public.profiles where id=auth.uid() and role='OWNER') then raise exception 'Hubungi petugas pemroses refund sebelum membatalkan';end if;
 end if;
 update public.sales_refund_requests set status='batal',cancel_reason=btrim(p_reason),updated_at=now(),receipt=receipt||jsonb_build_object('status','batal') where id=p_id returning * into r;
 return r.receipt;
end$$;
revoke all on function public.cancel_sales_refund_request(uuid,text,boolean) from public,anon,service_role;
grant execute on function public.cancel_sales_refund_request(uuid,text,boolean) to authenticated;

create function public.get_sales_return_payout(p_return uuid) returns jsonb
language plpgsql security definer set search_path='' as $$declare r public.sales_refund_payouts%rowtype;source uuid;branch uuid;amount numeric;begin
 select rt.sale_id,s.branch_id,rt.total into source,branch,amount from public.sales_returns rt join public.sales s on s.id=rt.sale_id where rt.id=p_return;
 if not found then raise exception 'Sumber retur tidak dapat diakses'using errcode='42501';end if;
 perform public.unit_posting_access('sales-return:'||source,branch);
 select * into r from public.sales_refund_payouts where return_id=p_return;if not found then return null;end if;
 if r.sale_id is distinct from source or r.branch_id is distinct from branch or r.amount is distinct from amount then raise exception 'Bukti payout tidak cocok dengan sumber retur';end if;
 return jsonb_build_object('method',r.method,'amount',r.amount,'account_name',r.account_snapshot->>'nama','expense_id',r.expense_id,'request_id',r.request_id);
end$$;
revoke all on function public.get_sales_return_payout(uuid) from public,anon,service_role;
grant execute on function public.get_sales_return_payout(uuid) to authenticated;

-- The common activity index records metadata, never bank destinations/payloads.
insert into public.activity_log_sources(entity,module_id,label_key,value_keys,scope_kind,identity_keys,branch_columns,scope_parents,metadata_only,reader_roles)
 values('sales_refund_requests','kas-bank',null,'{}','refs',array['id'],array['branch_id'],'[]',true,array['OWNER','ADMIN']),
 ('sales_refund_payouts','kas-bank',null,'{}','refs',array['return_id'],array['branch_id'],'[]',true,'{}');
create trigger a01_activity_change after insert or update on public.sales_refund_requests for each row execute function public.capture_activity_log();
create trigger a01_activity_change after insert or update on public.sales_refund_payouts for each row execute function public.capture_activity_log();

-- Clinical eligibility is read-only. Actual posting must re-read under the
-- existing visit -> invoice lock order; a browser hash is never authority.
create function public.clinic_refund_source_core(p_invoice uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare i public.invoices%rowtype;branch uuid;customer uuid;reason text;lines jsonb;payments jsonb;journals jsonb;
 v_snapshot jsonb;line_total numeric;cash_received numeric;paid numeric;paid_count int;initial_count int;payment_count int;hpp_total numeric;hpp_count int;r record;
begin
 if auth.uid()is null or auth.role()is distinct from 'authenticated'or not exists(select 1 from public.profiles where id=auth.uid()and is_active)then raise exception 'Akses sumber refund klinik ditolak'using errcode='42501';end if;
 select * into i from public.invoices where id=p_invoice;
 if not found then raise exception 'Invoice tidak dapat diakses'using errcode='42501';end if;
 select v.branch_id,v.customer_id into branch,customer from public.visits v where v.id=i.visit_id;
 if branch is null or not public.user_can_access_branch(branch)then raise exception 'Invoice tidak dapat diakses'using errcode='42501';end if;
 if i.voided_at is not null or i.correction_pending or i.request_key is null then reason:='Invoice tidak aktif atau bukti penyimpanannya belum lengkap';
 elsif i.paid_status<>'Lunas'then reason:='Invoice belum lunas';
 elsif i.reissued_from is not null or exists(select 1 from public.clinic_invoice_operations o where o.invoice_id=i.id or o.result_invoice_id=i.id)then reason:='Invoice sudah dikoreksi atau terbit ulang; rekonsiliasi pembayaran asal diperlukan';
 elsif exists(select 1 from public.clinic_demo_invoice_snapshots where invoice_id=i.id)then reason:='Invoice memiliki biaya admin atau insentif tersimpan; gunakan rekonsiliasi refund yang mencakup keduanya';
 elsif i.total<=0 or i.subtotal<=0 or i.total::text in('NaN','Infinity','-Infinity')or i.subtotal::text in('NaN','Infinity','-Infinity')or i.total<>round(i.total,2)or i.total<>i.subtotal-i.discount+i.tax then reason:='Nilai invoice tidak konsisten';
 end if;
 if reason is not null then return jsonb_build_object('invoice_id',i.id,'eligible',false,'reason',reason);end if;
 select coalesce(jsonb_agg(to_jsonb(x)order by x.id),'[]'),round(sum(x.qty*x.harga*(1-coalesce(x.diskon_persen,0)/100)),2)
 into lines,line_total from public.invoice_items x where x.invoice_id=i.id;
 if jsonb_array_length(lines)=0 or line_total is distinct from i.subtotal or exists(select 1 from public.invoice_items x where x.invoice_id=i.id and(x.qty<=0 or x.harga<0 or x.harga::text in('NaN','Infinity','-Infinity')or coalesce(x.diskon_persen,0)not between 0 and 100 or x.compound_recipe_id is not null or(x.jenis='obat'and(x.item_id is null or x.faktor is null or x.faktor<=0 or x.faktor::text in('NaN','Infinity','-Infinity')or x.hpp is null or x.hpp<0 or x.hpp::text in('NaN','Infinity','-Infinity')))))then
  return jsonb_build_object('invoice_id',i.id,'eligible',false,'reason','Rincian invoice atau sumber racikan/obat memerlukan rekonsiliasi');end if;
 select coalesce(jsonb_agg(to_jsonb(p)order by p.id),'[]'),coalesce(sum(p.amount),0),count(*)
 into payments,paid,paid_count from public.invoice_payments p where p.invoice_id=i.id;
 if exists(select 1 from public.invoice_payments p where p.invoice_id=i.id and(p.transferred_from is not null or p.amount<=0 or p.amount<>round(p.amount,2)or p.kas_code is null))then
  return jsonb_build_object('invoice_id',i.id,'eligible',false,'reason','Bukti pelunasan atau saldo pindahan perlu rekonsiliasi');end if;
 select count(*)into initial_count from public.journal_entries where source='klinik'and source_ref=i.invoice_no and voided_at is null;
 select count(*)into payment_count from public.journal_entries where source='klinik-ar'and source_ref=i.invoice_no and voided_at is null;
 select coalesce(sum(l.debit-l.credit),0)into cash_received from public.journal_entries j join public.journal_lines l on l.entry_id=j.id join public.coa_accounts a on a.id=l.account_id
 where j.source='klinik'and j.source_ref=i.invoice_no and j.voided_at is null and exists(select 1 from public.cash_accounts ca where ca.coa_code=a.code);
 paid:=paid+cash_received;
 if initial_count<>1 or payment_count<>paid_count or paid<>i.total or exists(
  select 1 from public.journal_entries j left join public.journal_lines l on l.entry_id=j.id where j.source in('klinik','klinik-ar')and j.source_ref=i.invoice_no and j.voided_at is null group by j.id having count(l.id)<2 or sum(l.debit-l.credit)<>0)
  or (select coalesce(sum(l.credit-l.debit),0)from public.journal_entries j join public.journal_lines l on l.entry_id=j.id join public.coa_accounts a on a.id=l.account_id where j.source='klinik'and j.source_ref=i.invoice_no and j.voided_at is null and a.code='4201')<>i.subtotal
  or (select coalesce(sum(l.debit-l.credit),0)from public.journal_entries j join public.journal_lines l on l.entry_id=j.id join public.coa_accounts a on a.id=l.account_id where j.source='klinik'and j.source_ref=i.invoice_no and j.voided_at is null and a.code='4102')<>i.discount
  or (select coalesce(sum(l.credit-l.debit),0)from public.journal_entries j join public.journal_lines l on l.entry_id=j.id join public.coa_accounts a on a.id=l.account_id where j.source='klinik'and j.source_ref=i.invoice_no and j.voided_at is null and a.code='2201')<>i.tax
  or (select coalesce(sum(l.credit-l.debit),0)from public.journal_entries j join public.journal_lines l on l.entry_id=j.id join public.coa_accounts a on a.id=l.account_id where j.source='klinik-ar'and j.source_ref=i.invoice_no and j.voided_at is null and a.code='1201')<>paid-cash_received then
  return jsonb_build_object('invoice_id',i.id,'eligible',false,'reason','Pembayaran atau jurnal sumber belum direkonsiliasi');end if;
 select round(coalesce(sum(hpp),0),2)into hpp_total from public.invoice_items where invoice_id=i.id;
 select count(*)into hpp_count from public.journal_entries where source='klinik-hpp'and source_ref=i.invoice_no and voided_at is null;
 if hpp_total::text in('NaN','Infinity','-Infinity')or hpp_total<0
 or hpp_count<>(case when hpp_total>0 then 1 else 0 end)
 or exists(select 1 from public.journal_entries j where j.source in('klinik','klinik-ar','klinik-hpp')and j.source_ref=i.invoice_no and j.voided_at is null and j.branch_id is distinct from branch)
 or (select coalesce(sum(l.debit-l.credit),0)from public.journal_entries j join public.journal_lines l on l.entry_id=j.id join public.coa_accounts a on a.id=l.account_id where j.source='klinik-hpp'and j.source_ref=i.invoice_no and j.voided_at is null and a.code='5101')is distinct from hpp_total
 or (select coalesce(sum(l.credit-l.debit),0)from public.journal_entries j join public.journal_lines l on l.entry_id=j.id join public.coa_accounts a on a.id=l.account_id where j.source='klinik-hpp'and j.source_ref=i.invoice_no and j.voided_at is null and a.code='1301')is distinct from hpp_total
 or exists(select 1 from public.journal_entries j left join public.journal_lines l on l.entry_id=j.id where j.source='klinik-hpp'and j.source_ref=i.invoice_no and j.voided_at is null group by j.id having count(l.id)<2 or sum(l.debit-l.credit)<>0)then
  return jsonb_build_object('invoice_id',i.id,'eligible',false,'reason','Bukti jurnal HPP atau cabang sumber klinik belum direkonsiliasi');end if;
 for r in select item_id,sum(qty*faktor)base_qty,sum(hpp)cost from public.invoice_items where invoice_id=i.id and jenis='obat'group by item_id loop
  if (select -sum(qty)from public.stock_moves where source='klinik'and source_ref=i.invoice_no and item_id=r.item_id)is distinct from r.base_qty
   or (select round(-sum(qty*unit_cost),2)from public.stock_moves where source='klinik'and source_ref=i.invoice_no and item_id=r.item_id)is distinct from r.cost
   or (select count(distinct warehouse_id)from public.stock_moves where source='klinik'and source_ref=i.invoice_no and item_id=r.item_id)<>1 then
   reason:='Bukti pengeluaran stok obat tidak cocok dengan invoice';exit;end if;
 end loop;
 if reason is not null then return jsonb_build_object('invoice_id',i.id,'eligible',false,'reason',reason);end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'source',j.source,'lines',(select jsonb_agg(to_jsonb(l)order by l.id)from public.journal_lines l where l.entry_id=j.id))order by j.id),'[]')into journals
 from public.journal_entries j where j.source in('klinik','klinik-ar','klinik-hpp')and j.source_ref=i.invoice_no and j.voided_at is null;
 v_snapshot:=jsonb_build_object('invoice',to_jsonb(i),'lines',lines,'payments',payments,'journals',journals,'branch_id',branch,'customer_id',customer);
 return jsonb_build_object('invoice_id',i.id,'visit_id',i.visit_id,'branch_id',branch,'invoice_no',i.invoice_no,'eligible',true,'total',i.total,'paid_total',paid,'source_hash',md5(v_snapshot::text),
 'lines',(select jsonb_agg(jsonb_build_object('id',x.id,'item_id',x.item_id,'name',x.deskripsi,'kind',x.jenis,'qty',x.qty,'unit',x.satuan,'factor',x.faktor,'price',x.harga,'discount_percent',x.diskon_persen)order by x.id)from public.invoice_items x where x.invoice_id=i.id),'internal_snapshot',v_snapshot);
end$$;
revoke all on function public.clinic_refund_source_core(uuid)from public,anon,authenticated,service_role;
create function public.preview_clinic_refund_source(p_invoice uuid)returns jsonb language sql stable security definer set search_path=''as $$
 select public.clinic_refund_source_core(p_invoice)-'internal_snapshot'
$$;
revoke all on function public.preview_clinic_refund_source(uuid)from public,anon,service_role;
grant execute on function public.preview_clinic_refund_source(uuid)to authenticated;
